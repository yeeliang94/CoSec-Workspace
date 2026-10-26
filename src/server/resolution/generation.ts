import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { assertCapability, assertCompany, DomainError, today } from '../../domain/access';
import type { Actor, Job } from '../../domain/model';
import { compileDocument } from '../../domain/resolution/compile';
import type { CaseInput } from '../../domain/resolution/form';
import type {
  Answers,
  ClauseEntry,
  DocumentGeneration,
  GenerationRecord,
  ResolutionCase,
  ResolutionContext,
  SignerSelection,
} from '../../domain/resolution/model';
import { dateString, plainText } from '../../domain/resolution/schema';
import { errorsOnly, IssuesError } from '../../domain/resolution/validate';
import { db, type Transaction } from '../db';
import { loadResolutionContext } from '../records/context';
import { systemActor } from '../records/scope';
import { getDocument, mutateJob, prior, remember, requestKey } from '../repository';
import { appendVersion } from '../pack-versions';
import { isFilingPreserved } from '../job-actions/shared';
import { currentPack } from '../../domain/workflows';
import * as s from '../schema';
import { listGeneratedFiles, readDownload, removeStoredFile, storeGenerated } from '../storage';
import { renderDocx, RENDERER_VERSION } from './render-docx';
import {
  assertPreparer,
  caseAsAt,
  directorQuestions,
  isDirectorClause,
  loadCaseTemplate,
  type LoadedCaseTemplate,
} from './selection';
import { auditChange, readCase } from './shared';
import { canonical, sha256 } from './templates';

const generateInput = z.strictObject({
  requestId: z.string().min(8).max(80),
  caseId: z.string().min(1).max(36),
  expectedCaseRevision: z.number().int().positive(),
  selectionRevision: z.number().int().positive(),
  familyId: z.string().min(1).max(36).optional(),
});
export type GenerationDeps = {
  render: (doc: NonNullable<DocumentGeneration['resolved']>) => Promise<Buffer>;
  store: typeof storeGenerated;
};
const defaults: GenerationDeps = { render: (doc) => renderDocx(doc), store: storeGenerated };

async function byRequestKey(tx: Transaction | typeof db, key: string, lock = false) {
  const query = tx
    .select()
    .from(s.documentGenerations)
    .where(eq(s.documentGenerations.requestKey, key));
  const [row] = await (lock ? query.for('update') : query);
  return row;
}
function replay(
  actor: Actor,
  row: { companyId: string; data: DocumentGeneration },
  requestHash: string,
) {
  assertCompany(actor, row.companyId);
  if (row.data.requestHash !== requestHash)
    throw new DomainError(
      'This request identifier was already used for a different generation.',
      'CONFLICT',
      409,
    );
  return generationView(row.data);
}
const isDuplicate = (e: unknown) =>
  (e as { code?: string }).code === 'ER_DUP_ENTRY' ||
  (e as { cause?: { code?: string } }).cause?.code === 'ER_DUP_ENTRY';
const safeName = (text: string) =>
  text
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} ._()'-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Resolution';

// ---------------------------------------------------------------- snapshot minimisation
/** Person ids a generation refers to: answer values, per-row answer keys and signers. */
function referencedPeople(
  answers: { shared: Answers; clauses: Record<string, Answers> },
  signers: SignerSelection,
) {
  const ids = new Set<string>(Object.values(signers).flat());
  const visit = (value: unknown) => {
    if (typeof value === 'string') ids.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object')
      for (const [key, inner] of Object.entries(value)) {
        ids.add(key); // per-row answers are keyed by person id
        visit(inner);
      }
  };
  visit(answers.shared);
  Object.values(answers.clauses).forEach(visit);
  return ids;
}
/**
 * The context as stored with a generation: company, case, job and firm values in full, but each
 * selector pool reduced to the people this document actually uses. The preparer's wider pools
 * (for example people visible only through another company) are never persisted or returned.
 */
export function pruneSnapshot(
  ctx: ResolutionContext,
  answers: { shared: Answers; clauses: Record<string, Answers> },
  signers: SignerSelection,
): ResolutionContext {
  const ids = referencedPeople(answers, signers);
  const keep = (pool: ResolutionContext['directors'] | undefined) =>
    (pool ?? []).filter((p) => ids.has(p.id));
  return {
    ...ctx,
    directors: keep(ctx.directors),
    members: keep(ctx.members),
    companyPeople: keep(ctx.companyPeople),
    proposedPeople: keep(ctx.proposedPeople),
  };
}
/** Every generation leaving this module: snapshot pools pruned (also for rows stored earlier). */
export function generationView<T extends DocumentGeneration>(generation: T): T {
  if (!generation.snapshot) return generation;
  return {
    ...generation,
    snapshot: pruneSnapshot(generation.snapshot, generation.answers, generation.signers),
  };
}

// ---------------------------------------------------------------- generation
const templateKey = (t: LoadedCaseTemplate) =>
  canonical([
    [t.assembly.version.id, t.assembly.version.revision],
    ...t.clauses.map((c) => [c.key, c.version.id, c.version.revision]),
  ]);
type Precompiled = {
  revision: number;
  asAt: string;
  ctxHash: string;
  templateKey: string;
  compiled: ReturnType<typeof compileDocument>;
};
/**
 * Compiles before the company and case locks are taken, so the bounded but CPU-heavy compile
 * does not hold them. Returns null when the case no longer matches the request (the locked
 * path then reports it authoritatively). Blocking issues and size limits fail fast here.
 */
async function precompile(
  actor: Actor,
  request: z.infer<typeof generateInput>,
): Promise<Precompiled | null> {
  const rc = await readCase(actor, request.caseId);
  if (
    rc.state !== 'Open' ||
    rc.revision !== request.expectedCaseRevision ||
    !rc.selection ||
    rc.selection.revision !== request.selectionRevision ||
    rc.answers.selectionRevision !== rc.selection.revision
  )
    return null;
  const template = await loadCaseTemplate(db, rc.selection);
  const asAt = caseAsAt(rc);
  const ctx = await loadResolutionContext(actor, rc.id, asAt);
  const compiled = compileDocument(caseInput(template, ctx, rc), 'final');
  const blocking = errorsOnly(compiled.issues);
  if (blocking.length) throw new IssuesError('Generation is blocked:', blocking);
  return {
    revision: rc.revision,
    asAt,
    ctxHash: sha256(canonical(ctx)),
    templateKey: templateKey(template),
    compiled,
  };
}
const caseInput = (
  template: LoadedCaseTemplate,
  ctx: ResolutionContext,
  rc: ResolutionCase,
): CaseInput => ({ ...template, ctx, answers: rc.answers, signers: rc.signers });

/**
 * Reserve (one transaction under the company and case locks) → render outside the lock →
 * finalise (one transaction). Only a Ready generation has a document; failures are recorded.
 * Every generation advances the case revision, so a concurrent duplicate request built on the
 * same revision is rejected as stale rather than adding a second document to the family.
 */
export async function generateDocument(
  actor: Actor,
  input: unknown,
  deps: GenerationDeps = defaults,
) {
  assertPreparer(actor);
  const request = generateInput.parse(input);
  const key = requestKey(actor, 'generate', request.requestId);
  const requestHash = sha256(
    canonical({
      caseId: request.caseId,
      expectedCaseRevision: request.expectedCaseRevision,
      selectionRevision: request.selectionRevision,
      familyId: request.familyId ?? null,
    }),
  );
  const existing = await byRequestKey(db, key);
  if (existing) return replay(actor, existing, requestHash);
  const early = await precompile(actor, request);
  // Resolve immutable scope outside the transaction; its first consistent read must happen
  // after the company lock, including when a writer commits while we wait for that lock.
  const identity = await readCase(actor, request.caseId);
  let generation: DocumentGeneration;
  let replayed = false;
  try {
    generation = await db.transaction(async (tx) => {
      await tx
        .select()
        .from(s.companies)
        .where(eq(s.companies.id, identity.companyId))
        .for('update');
      const rc = await readCase(actor, request.caseId, tx, true);
      const again = await byRequestKey(tx, key, true);
      if (again) {
        replayed = true;
        return replay(actor, again, requestHash);
      }
      if (rc.state !== 'Open') throw new DomainError('This case is closed.', 'CONFLICT', 409);
      if (rc.revision !== request.expectedCaseRevision)
        throw new DomainError(
          'This resolution case changed. Refresh and review it before generating.',
          'STALE',
          409,
        );
      if (!rc.selection) throw new DomainError('Choose an assembly and clauses first.');
      if (
        rc.selection.revision !== request.selectionRevision ||
        rc.answers.selectionRevision !== rc.selection.revision
      )
        throw new DomainError(
          'The clause selection changed. Refresh before generating.',
          'STALE',
          409,
        );
      const template = await loadCaseTemplate(tx, rc.selection);
      for (const v of [template.assembly.version, ...template.clauses.map((c) => c.version)])
        if (v.status !== 'Published' && v.status !== 'Superseded')
          throw new DomainError('Only published template versions can be generated.');
      const asAt = caseAsAt(rc);
      const ctx = await loadResolutionContext(actor, rc.id, asAt, tx);
      // Reuse the pre-lock compile only when every input is unchanged under the lock.
      const compiled =
        early &&
        early.revision === rc.revision &&
        early.asAt === asAt &&
        early.templateKey === templateKey(template) &&
        early.ctxHash === sha256(canonical(ctx))
          ? early.compiled
          : compileDocument(caseInput(template, ctx, rc), 'final');
      const blocking = errorsOnly(compiled.issues);
      if (blocking.length) throw new IssuesError('Generation is blocked:', blocking);

      const now = new Date().toISOString();
      let familyId = request.familyId;
      let newFamily: ResolutionCase['families'][number] | null = null;
      if (familyId) {
        if (!rc.families.some((f) => f.id === familyId))
          throw new DomainError('The document family is unavailable.', 'NOT_FOUND', 404);
      } else {
        familyId = randomUUID();
        newFamily = {
          id: familyId,
          title: `${template.outputType.name} — ${rc.title}`,
          createdAt: now,
        };
      }
      await advanceCase(tx, actor, rc, now, newFamily, request.requestId);
      const answers = { shared: rc.answers.shared, clauses: rc.answers.clauses };
      const snapshot = pruneSnapshot(ctx, answers, rc.signers);
      const [predecessor] = await tx
        .select({ id: s.documentGenerations.id })
        .from(s.documentGenerations)
        .where(
          and(
            eq(s.documentGenerations.familyId, familyId),
            eq(s.documentGenerations.status, 'Ready'),
          ),
        )
        .orderBy(desc(s.documentGenerations.createdAt))
        .limit(1);
      const next: DocumentGeneration = {
        id: randomUUID(),
        familyId,
        predecessorId: predecessor?.id ?? null,
        caseId: rc.id,
        companyId: rc.companyId,
        jobId: rc.jobId,
        packVersion: ctx.job?.packVersion ?? null,
        outputTypeId: template.outputType.id,
        assemblyVersionId: template.assembly.version.id,
        clauseVersionIds: template.clauses.map((c) => c.version.id),
        clauses: rc.selection.clauses.map(({ key, clauseId, clauseVersionId }) => ({
          key,
          clauseId,
          clauseVersionId,
        })),
        selectionRevision: rc.selection.revision,
        signers: rc.signers,
        answers,
        snapshot,
        resolvedValues: compiled.values,
        resolved: compiled.resolved,
        snapshotHash: sha256(canonical(snapshot)),
        rendererVersion: RENDERER_VERSION,
        status: 'Pending',
        failure: null,
        documentId: null,
        sha256: null,
        requestHash,
        createdBy: actor.id,
        createdAt: now,
        finalisedAt: null,
      };
      await tx.insert(s.documentGenerations).values({
        id: next.id,
        familyId,
        caseId: rc.id,
        companyId: rc.companyId,
        status: 'Pending',
        requestKey: key,
        data: next,
        createdAt: new Date(now),
      });
      await auditChange(tx, actor, {
        companyId: rc.companyId,
        entityType: 'document_generation',
        entityId: next.id,
        action: 'document_generation.created',
        detail: {
          caseId: rc.id,
          familyId,
          predecessorId: next.predecessorId,
          outputTypeId: next.outputTypeId,
          assemblyVersionId: next.assemblyVersionId,
          clauseVersionIds: next.clauseVersionIds,
          selectionRevision: next.selectionRevision,
          snapshotHash: next.snapshotHash,
          asAt,
        },
        requestId: request.requestId,
      });
      return next;
    });
  } catch (error) {
    if (!isDuplicate(error)) throw error;
    const raced = await byRequestKey(db, key);
    if (!raced) throw error;
    return replay(actor, raced, requestHash);
  }
  if (replayed || generation.status !== 'Pending') return generation;
  return finalise(actor, generation, deps);
}

/** Advances the case revision for every generation; a new family is recorded on the case. */
async function advanceCase(
  tx: Transaction,
  actor: Actor,
  rc: ResolutionCase,
  at: string,
  family: ResolutionCase['families'][number] | null,
  requestId: string,
) {
  const next: ResolutionCase = {
    ...rc,
    families: family ? [...rc.families, family] : rc.families,
    revision: rc.revision + 1,
    updatedAt: at,
    history: [
      ...rc.history,
      family
        ? {
            id: randomUUID(),
            action: 'family_created',
            actorId: actor.id,
            at,
            detail: `Started document "${family.title}".`,
          }
        : {
            id: randomUUID(),
            action: 'document_generated',
            actorId: actor.id,
            at,
            detail: 'Generated a new version of a document.',
          },
    ],
  };
  await tx
    .update(s.resolutionCases)
    .set({ data: next, revision: next.revision })
    .where(eq(s.resolutionCases.id, rc.id));
  if (!family) return;
  await auditChange(tx, actor, {
    companyId: rc.companyId,
    entityType: 'resolution_case',
    entityId: rc.id,
    action: 'resolution_case.family_created',
    before: { families: rc.families },
    after: { families: next.families },
    detail: { fromRevision: rc.revision, toRevision: next.revision },
    requestId,
  });
}

async function finalise(actor: Actor, generation: DocumentGeneration, deps: GenerationDeps) {
  let bytes: Buffer;
  try {
    bytes = await deps.render(generation.resolved!);
  } catch (error) {
    return fail(
      actor,
      generation.id,
      `The Word document could not be produced: ${messageOf(error)}`,
    );
  }
  const storageKey = `${randomUUID()}.docx`;
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(s.documentGenerations)
        .where(eq(s.documentGenerations.id, generation.id))
        .for('update');
      if (!row) throw new DomainError('Document access is unavailable.', 'NOT_FOUND', 404);
      if (row.data.status !== 'Pending') return row.data; // reconciled meanwhile
      const [caseRow] = await tx
        .select({ data: s.resolutionCases.data })
        .from(s.resolutionCases)
        .where(eq(s.resolutionCases.id, generation.caseId));
      const title = `${generation.resolved!.title} — ${caseRow?.data.title ?? 'Resolution'}`;
      const document = await deps.store(
        actor,
        {
          companyId: generation.companyId,
          jobId: generation.jobId,
          title,
          fileName: `${safeName(title)}.docx`,
          bytes,
          generationId: generation.id,
          storageKey,
        },
        tx,
      );
      const next: DocumentGeneration = {
        ...row.data,
        status: 'Ready',
        documentId: document.id,
        sha256: document.sha256,
        finalisedAt: new Date().toISOString(),
      };
      await tx
        .update(s.documentGenerations)
        .set({ status: 'Ready', data: next })
        .where(eq(s.documentGenerations.id, generation.id));
      await auditChange(tx, actor, {
        companyId: generation.companyId,
        entityType: 'document_generation',
        entityId: generation.id,
        action: 'document_generation.ready',
        before: { status: 'Pending' },
        after: { status: 'Ready', documentId: document.id, sha256: document.sha256 },
        detail: { size: document.size, rendererVersion: generation.rendererVersion },
      });
      return next;
    });
  } catch (error) {
    await removeStoredFile(storageKey);
    return fail(actor, generation.id, `The Word document could not be stored: ${messageOf(error)}`);
  }
}

const messageOf = (error: unknown) =>
  (error instanceof Error ? error.message : 'unknown error').slice(0, 300);

async function fail(actor: Actor, id: string, failure: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(s.documentGenerations)
      .where(eq(s.documentGenerations.id, id))
      .for('update');
    if (!row) throw new DomainError('Document access is unavailable.', 'NOT_FOUND', 404);
    if (row.data.status !== 'Pending') return row.data;
    const next: DocumentGeneration = {
      ...row.data,
      status: 'Failed',
      failure,
      finalisedAt: new Date().toISOString(),
    };
    await tx
      .update(s.documentGenerations)
      .set({ status: 'Failed', data: next })
      .where(eq(s.documentGenerations.id, id));
    await auditChange(tx, actor, {
      companyId: next.companyId,
      entityType: 'document_generation',
      entityId: id,
      action: 'document_generation.failed',
      before: { status: 'Pending' },
      after: { status: 'Failed', failure },
    });
    return next;
  });
}

/**
 * Worker sweep: a Pending generation older than the limit is treated as unable to finish (the
 * caller stops waiting for a render after 15 s; see renderDocx), so it is marked Failed; generated
 * files no document row refers to are removed.
 */
export async function reconcilePendingGenerations(olderThanMs = 10 * 60_000) {
  const cutoff = new Date(Date.now() - olderThanMs);
  const stale = await db
    .select({ id: s.documentGenerations.id })
    .from(s.documentGenerations)
    .where(
      and(eq(s.documentGenerations.status, 'Pending'), lt(s.documentGenerations.createdAt, cutoff)),
    );
  let failed = 0;
  for (const { id } of stale) {
    const result = await fail(
      systemActor,
      id,
      'Generation did not finish. Generate the document again.',
    );
    if (result.status === 'Failed') failed++;
  }
  const referenced = new Set(
    (
      await db
        .select({
          key: sql<string>`JSON_UNQUOTE(JSON_EXTRACT(${s.documents.data}, '$.storageKey'))`,
        })
        .from(s.documents)
        .where(sql`JSON_UNQUOTE(JSON_EXTRACT(${s.documents.data}, '$.storageKey')) LIKE '%.docx'`)
    ).map((r) => r.key),
  );
  let removed = 0;
  for (const file of await listGeneratedFiles())
    if (!referenced.has(file.storageKey) && file.modifiedAt < cutoff.getTime()) {
      await removeStoredFile(file.storageKey);
      removed++;
    }
  return { failed, removedFiles: removed };
}

// ---------------------------------------------------------------- reads, download, records
async function readGeneration(
  actor: Actor,
  id: string,
  tx: Transaction | typeof db = db,
  lock = false,
) {
  const query = tx.select().from(s.documentGenerations).where(eq(s.documentGenerations.id, id));
  const [row] = await (lock ? query.for('update') : query);
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
  return { ...generationView(generation), records: await recordsOf(id) };
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
  await db.transaction((tx) =>
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
    requestId: z.string().min(8).max(80),
    decision: z.enum(['Approved', 'Returned']),
    reason: plainText(2000, true).trim().default(''),
  }),
  z.strictObject({
    action: z.literal('record_execution'),
    requestId: z.string().min(8).max(80),
    signerPersonId: z.string().min(1).max(100),
    capacity: plainText(160).trim().min(1),
    signedDate: dateString,
    evidenceId: z.string().min(1).max(64),
  }),
  z.strictObject({
    action: z.literal('attach_to_pack'),
    requestId: z.string().min(8).max(80),
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
      requestId: z.string().min(8).max(80),
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
            sql`${s.documentGenerations.createdAt} > ${new Date(generation.createdAt)}`,
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
  return db.transaction(async (tx) => {
    const identity = await readGeneration(actor, id, tx);
    await tx.select().from(s.companies).where(eq(s.companies.id, identity.companyId)).for('update');
    const generation = await readGeneration(actor, id, tx, true);
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
      const signers = new Set(Object.values(generation.signers).flat());
      if (!signers.has(action.signerPersonId))
        throw new DomainError('Choose a signer named in this document.');
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
