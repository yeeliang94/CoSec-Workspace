import { randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { assertCapability, assertCompany, DomainError, today } from '../../domain/access';
import type { Actor, Job } from '../../domain/model';
import type {
  ClauseEntry,
  DocumentGeneration,
  GenerationRecord,
} from '../../domain/resolution/model';
import { dateString, plainText } from '../../domain/resolution/schema';
import { db, transaction, type Transaction } from '../db';
import { audit, getDocument, mutateJob, prior, remember, requestKey } from '../repository';
import { appendVersion } from '../pack-versions';
import { isFilingPreserved } from '../job-actions/shared';
import { currentPack } from '../../domain/workflows';
import * as s from '../schema';
import { readDownload } from '../storage';
import { directorQuestions, isDirectorClause } from './selection';
import { auditChange, requestId } from './shared';
import { generationView } from './generation';
import { generationRequirements } from './generation-signers';
import { reviewedExecutionState } from './execution';

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
  z.strictObject({
    action: z.literal('attach_to_pack'),
    requestId,
    expectedJobRevision: z.number().int(),
  }),
]);

/**
 * The generation's director clause must name the job's person and effective date. The job check
 * alone is not enough: the preparer may change the prefilled answers after the case is bound.
 */
async function assertDirectorAnswers(tx: Transaction, generation: DocumentGeneration, job: Job) {
  const kind = generation.snapshot.case.kind;
  if (kind === 'board') return;
  let entries: ClauseEntry[] | undefined = generation.clauses;
  if (!entries) {
    // Generations stored before entries were recorded: the case selection still identifies them.
    const [row] = await tx
      .select({ data: s.resolutionCases.data })
      .from(s.resolutionCases)
      .where(eq(s.resolutionCases.id, generation.caseId));
    if (row?.data.selection?.revision !== generation.selectionRevision)
      throw new DomainError(
        'The clause selection changed after this document was generated. Generate a new version first.',
        'STALE',
        409,
      );
    entries = row.data.selection.clauses;
  }
  if (!entries.length) return;
  const [templates, versions] = await Promise.all([
    tx
      .select()
      .from(s.clauseTemplates)
      .where(inArray(s.clauseTemplates.id, [...new Set(entries.map((e) => e.clauseId))])),
    tx
      .select()
      .from(s.clauseTemplateVersions)
      .where(
        inArray(
          s.clauseTemplateVersions.id,
          entries.map((e) => e.clauseVersionId),
        ),
      ),
  ]);
  for (const entry of entries) {
    const template = templates.find((t) => t.id === entry.clauseId)?.data;
    if (!isDirectorClause(template, kind)) continue;
    const { person, date } = directorQuestions(
      versions.find((v) => v.id === entry.clauseVersionId)?.data,
    );
    const answers = generation.answers.clauses[entry.key] ?? {};
    const answer = (fieldId: string) => (Object.hasOwn(answers, fieldId) ? answers[fieldId] : null);
    const wrongPerson = person && answer(person.id) !== (job.personId ?? null);
    const wrongDate = date && answer(date.id) !== (job.effectiveDate ?? null);
    if (wrongPerson || wrongDate)
      throw new DomainError(
        `This document's director clause names a different ${wrongPerson ? 'person' : 'effective date'} from the director change job. Correct the clause answers and generate a new version.`,
        'STALE',
        409,
      );
  }
}

/** Document ids of the other generations in this generation's family (earlier or replaced). */
async function familyDocumentIds(tx: Transaction, generation: DocumentGeneration) {
  const rows = await tx
    .select({ data: s.documentGenerations.data })
    .from(s.documentGenerations)
    .where(
      and(
        eq(s.documentGenerations.familyId, generation.familyId),
        ne(s.documentGenerations.id, generation.id),
      ),
    );
  return new Set(rows.flatMap((r) => (r.data.documentId ? [r.data.documentId] : [])));
}

/**
 * Adds the exact generated document to a new version of its linked W04 pack, replacing any
 * earlier version of the same document. The new pack version needs its own independent review;
 * earlier approvals stay with the earlier version. A completed, cancelled, posted or filed job
 * is never reopened by this route.
 */
export async function attachGenerationToPack(actor: Actor, id: string, input: unknown) {
  const action = z
    .strictObject({
      action: z.literal('attach_to_pack'),
      requestId,
      expectedJobRevision: z.number().int(),
    })
    .parse(input);
  assertCapability(actor, 'prepare_job');
  const generation = await readGeneration(actor, id);
  if (generation.status !== 'Ready' || !generation.documentId)
    throw new DomainError('Only a ready document can be attached.', 'NOT_READY', 409);
  if (!generation.jobId)
    throw new DomainError('This resolution case is not linked to a director change job.');
  const documentId = generation.documentId;
  return mutateJob(
    actor,
    generation.jobId,
    action.expectedJobRevision,
    action.requestId,
    async (job, tx) => {
      if (job.activity !== 'W04' || job.companyId !== generation.companyId)
        throw new DomainError('The linked job is not a director change for this company.');
      if (job.state === 'Complete' || job.state === 'Cancelled')
        throw new DomainError(
          `The director change job is ${job.state.toLowerCase()}; a document cannot be attached to it.`,
          'CONFLICT',
          409,
        );
      if (job.recordEventId || isFilingPreserved(job))
        throw new DomainError(
          'The director event is already posted or filed; open a correction route instead.',
          'CONFLICT',
          409,
        );
      const source = generation.snapshot.job;
      if (
        !source ||
        source.personId !== job.personId ||
        source.route !== job.route ||
        source.effectiveDate !== job.effectiveDate
      )
        throw new DomainError(
          "The job's person, route or effective date changed after this document was generated. Generate a new version first.",
          'STALE',
          409,
        );
      await assertDirectorAnswers(tx, generation, job);
      const [newer] = await tx
        .select({ id: s.documentGenerations.id })
        .from(s.documentGenerations)
        .where(
          and(
            eq(s.documentGenerations.familyId, generation.familyId),
            eq(s.documentGenerations.status, 'Ready'),
            gt(s.documentGenerations.createdAt, new Date(generation.createdAt)),
          ),
        )
        .limit(1);
      if (newer)
        throw new DomainError(
          'A newer version of this document exists; attach that one.',
          'STALE',
          409,
        );
      const pack = currentPack(job);
      if (pack.documentIds.includes(documentId))
        throw new DomainError('This document is already in the current pack version.');
      const replaced = await familyDocumentIds(tx, generation);
      const kept = pack.documentIds.filter((d) => !replaced.has(d));
      appendVersion(job, actor, { documentIds: [...kept, documentId] });
      const removed = pack.documentIds.length - kept.length;
      job.history.push({
        id: randomUUID(),
        action: 'resolution_attached',
        actorId: actor.id,
        at: new Date().toISOString(),
        detail: `Attached generated resolution ${generation.id} (sha256 ${generation.sha256?.slice(0, 12)}) as pack v${currentPack(job).version}${removed ? `, replacing ${removed} earlier version${removed === 1 ? '' : 's'} of the same document` : ''}; independent review of this version is required.`,
      });
      return job;
    },
  );
}

/** Review and execution are separate records bound to the exact bytes; the generation never changes. */
export async function applyGenerationAction(actor: Actor, id: string, input: unknown) {
  const action = recordInput.parse(input);
  if (action.action === 'attach_to_pack')
    throw new DomainError('Use attachGenerationToPack for pack attachment.');
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
    if (record.kind === 'execution') await refreshPackState(actor, generation, tx);
    await remember(tx, key, { id: record.id });
    return { ...generationView(generation), records: await recordsOf(id, tx) };
  });
}

const SIGNING_STATES = new Set([
  'Reviewed',
  'Issued for signature',
  'Partly signed',
  'Fully signed',
]);

/** A reviewed pack holding this generation re-derives its signing state from the new evidence. */
async function refreshPackState(actor: Actor, generation: DocumentGeneration, tx: Transaction) {
  if (!generation.jobId || !generation.documentId) return;
  const [row] = await tx.select().from(s.jobs).where(eq(s.jobs.id, generation.jobId));
  if (!row) return;
  const job = structuredClone(row.data);
  const pack = currentPack(job);
  if (!pack.documentIds.includes(generation.documentId) || !SIGNING_STATES.has(pack.state)) return;
  const state = await reviewedExecutionState(actor, job, tx);
  if (state === pack.state) return;
  const from = pack.state;
  pack.state = state;
  job.revision = row.revision + 1;
  job.updatedAt = new Date().toISOString();
  await tx.update(s.jobs).set({ data: job, revision: job.revision }).where(eq(s.jobs.id, job.id));
  await audit(
    actor,
    job.companyId,
    'job.updated',
    job.id,
    { fromRevision: row.revision, toRevision: job.revision, packState: { from, to: state } },
    tx,
  );
}
