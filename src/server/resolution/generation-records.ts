import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { assertCapability, assertCompany, DomainError, today } from '../../domain/access';
import type { Actor } from '../../domain/model';
import type { GenerationRecord } from '../../domain/resolution/model';
import { dateString, plainText } from '../../domain/resolution/schema';
import { db, transaction, type Transaction } from '../db';
import { getDocument, prior, remember, requestKey } from '../repository';
import * as s from '../schema';
import { readDownload } from '../storage';
import { auditChange, requestId } from './shared';
import { generationView } from './generation';
import { generationRequirements } from './generation-signers';

// ---------------------------------------------------------------- reads, download, records
async function readGeneration(actor: Actor, id: string, tx: Transaction | typeof db = db) {
  const query = tx.select().from(s.documentGenerations).where(eq(s.documentGenerations.id, id));
  const [row] = await query;
  if (!row) throw new DomainError('Document access is unavailable.', 'NOT_FOUND', 404);
  assertCompany(actor, row.companyId);
  return row.data;
}
async function recordsOf(id: string, tx: Transaction | typeof db = db) {
  return (
    await tx.select().from(s.generationRecords).where(eq(s.generationRecords.generationId, id))
  )
    .map((r) => r.data)
    .sort((a, b) => a.at.localeCompare(b.at));
}
export async function getGeneration(actor: Actor, id: string) {
  const generation = await readGeneration(actor, id);
  return {
    ...generationView(generation),
    executionRequirements: await generationRequirements(generation, db),
    records: await recordsOf(id),
  };
}

/** Stored bytes of a Ready generation; hash-checked against both the file and the generation. */
export async function downloadGeneration(actor: Actor, id: string) {
  const generation = await readGeneration(actor, id);
  if (generation.status !== 'Ready' || !generation.documentId)
    throw new DomainError('This document is not ready for download.', 'NOT_READY', 409);
  // One audit entry per download: the generation's, which names the document and hash.
  const { document, bytes } = await readDownload(actor, generation.documentId, { audit: false });
  if (document.generationId !== generation.id || document.sha256 !== generation.sha256)
    throw new DomainError('The stored file failed its integrity check.', 'STORAGE', 503);
  await transaction((tx) =>
    auditChange(tx, actor, {
      companyId: generation.companyId,
      entityType: 'document_generation',
      entityId: generation.id,
      action: 'document_generation.downloaded',
      detail: { documentId: document.id, sha256: document.sha256 },
    }),
  );
  return { document, bytes };
}

const recordInput = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('review'),
    requestId,
    decision: z.enum(['Approved', 'Returned']),
    reason: plainText(2000, true).trim().default(''),
  }),
  z.strictObject({
    action: z.literal('record_execution'),
    requestId,
    signerPersonId: z.string().min(1).max(100),
    signerRole: z.enum(['directors', 'members', 'certifiers']),
    capacity: plainText(160).trim().min(1),
    signedDate: dateString,
    evidenceId: z.string().min(1).max(64),
  }),
]);

/** Review and execution are separate records bound to the exact bytes; the generation never changes. */
export async function applyGenerationAction(actor: Actor, id: string, input: unknown) {
  const action = recordInput.parse(input);
  if (action.action === 'review') assertCapability(actor, 'review_pack');
  else if (
    !actor.capabilities.some((c) =>
      ['generate_documents', 'prepare_job', 'review_pack'].includes(c),
    )
  )
    throw new DomainError('You do not have permission for this action.', 'FORBIDDEN', 403);
  const key = requestKey(actor, `generation:${id}`, action.requestId);
  return transaction(async (tx) => {
    const generation = await readGeneration(actor, id, tx);
    const old = await prior(tx, key);
    if (old) return { ...generationView(generation), records: await recordsOf(id, tx) };
    if (generation.status !== 'Ready' || !generation.sha256)
      throw new DomainError('Only a ready document can be reviewed or recorded.', 'NOT_READY', 409);
    const at = new Date().toISOString();
    let record: GenerationRecord;
    if (action.action === 'review') {
      if (generation.createdBy === actor.id)
        throw new DomainError(
          'An independent reviewer must review this document.',
          'SELF_APPROVAL',
          403,
        );
      if (action.decision === 'Returned' && !action.reason)
        throw new DomainError('Record why the document is returned.');
      record = {
        id: randomUUID(),
        kind: 'review',
        generationId: id,
        sha256: generation.sha256,
        decision: action.decision,
        reason: action.reason,
        actorId: actor.id,
        at,
      };
    } else {
      const requirements = await generationRequirements(generation, tx);
      if (
        !requirements.some(
          (r) => r.personId === action.signerPersonId && r.role === action.signerRole,
        )
      )
        throw new DomainError(
          'Choose a signer named in this document in the selected signing role.',
        );
      if (action.signedDate > today())
        throw new DomainError('The signed date cannot be in the future.');
      const evidence = await getDocument(actor, action.evidenceId, tx);
      if (evidence.companyId !== generation.companyId || evidence.classification !== 'General')
        throw new DomainError('Execution evidence must be a document of this company.');
      if (evidence.id === generation.documentId)
        throw new DomainError('Attach the signed copy as evidence, not the generated draft.');
      record = {
        id: randomUUID(),
        kind: 'execution',
        generationId: id,
        sha256: generation.sha256,
        signerPersonId: action.signerPersonId,
        signerRole: action.signerRole,
        capacity: action.capacity,
        signedDate: action.signedDate,
        evidenceId: evidence.id,
        actorId: actor.id,
        at,
      };
    }
    await tx.insert(s.generationRecords).values({
      id: record.id,
      generationId: id,
      companyId: generation.companyId,
      kind: record.kind,
      data: record,
      createdAt: new Date(at),
    });
    await auditChange(tx, actor, {
      companyId: generation.companyId,
      entityType: 'document_generation',
      entityId: id,
      action:
        record.kind === 'review'
          ? 'document_generation.reviewed'
          : 'document_generation.execution_recorded',
      after: record,
      reason: record.kind === 'review' ? record.reason || null : null,
      requestId: action.requestId,
    });
    await remember(tx, key, { id: record.id });
    return { ...generationView(generation), records: await recordsOf(id, tx) };
  });
}
