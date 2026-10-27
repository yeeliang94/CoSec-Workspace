import { randomUUID } from 'node:crypto';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { assertCompany, DomainError } from '../../domain/access';
import type { Actor } from '../../domain/model';
import { compileDocument } from '../../domain/resolution/compile';
import type { CaseInput } from '../../domain/resolution/form';
import type {
  Answers,
  DocumentGeneration,
  ResolutionCase,
  ResolutionContext,
  SignerSelection,
} from '../../domain/resolution/model';
import { errorsOnly, IssuesError } from '../../domain/resolution/validate';
import { db, type Transaction } from '../db';
import { loadResolutionContext } from '../records/context';
import { systemActor } from '../records/scope';
import { requestKey } from '../repository';
import * as s from '../schema';
import { listGeneratedFiles, removeStoredFile, storeGenerated } from '../storage';
import { renderDocx, RENDERER_VERSION } from './render-docx';
import { assertPreparer, caseAsAt, loadCaseTemplate, type LoadedCaseTemplate } from './selection';
import { auditChange, readCase, requestId } from './shared';
import { canonical, sha256 } from './templates';

const generateInput = z.strictObject({
  requestId,
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
        executionRequirements: compiled.executionRequirements,
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
      `The Word document could not be produced. ${userReason(error)}`,
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
    return fail(
      actor,
      generation.id,
      `The Word document could not be stored. ${userReason(error)}`,
    );
  }
}

/**
 * The stored failure is shown to users and audited, so only our own DomainError messages pass
 * through; anything else (driver, file-system or renderer internals) stays in the server log.
 */
function userReason(error: unknown) {
  if (error instanceof DomainError) return error.message.slice(0, 300);
  console.error('Document generation failed', {
    type: error instanceof Error ? error.name : 'Unknown',
    message: error instanceof Error ? error.message : String(error),
  });
  return 'Try again; if it keeps failing, contact support.';
}

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
