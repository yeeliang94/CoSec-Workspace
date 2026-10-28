import { memberSnapshot, readRegisters } from './record-store';
import { and, eq, inArray, lt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, transaction, type Transaction } from './db';
import { isUniqueViolation } from './db-errors';
import * as s from './schema';
import type {
  Actor,
  Company,
  Document,
  Job,
  OfficerEvent,
  Preferences,
  Reminder,
  Settings,
} from '../domain/model';
import { officersAt } from '../domain/workflows';
import { defaultSettings } from '../domain/model';
import { beneficialOwnersAt } from '../domain/records';
import { deriveReminders } from '../domain/reminders';
import { addOpeningPeople, type OpeningPerson } from './records/relationships';
import {
  assertCapability,
  assertCompany,
  assertJobAccess,
  canReadJob,
  DomainError,
  today,
} from '../domain/access';
export type { Transaction } from './db';
// Reads take an optional transaction. Inside a transaction, always pass it: the transaction
// already holds a pooled connection, and borrowing a second one can exhaust the pool.
export async function getActorById(id: string, tx?: Transaction): Promise<Actor | null> {
  const [u] = await (tx ?? db)
    .select()
    .from(s.user)
    .where(and(eq(s.user.id, id), eq(s.user.active, true)));
  return u
    ? {
        id: u.id,
        name: u.name,
        email: u.email,
        capabilities: u.capabilities,
        companyIds: u.companyIds,
        preferences: u.preferences,
      }
    : null;
}
export async function listUsers() {
  return db
    .select({ id: s.user.id, name: s.user.name })
    .from(s.user)
    .where(eq(s.user.active, true));
}
export async function listCompanyIds() {
  return (await db.select({ id: s.companies.id }).from(s.companies)).map((r) => r.id);
}
export async function getCompany(id: string, tx?: Transaction) {
  const [r] = await (tx ?? db).select().from(s.companies).where(eq(s.companies.id, id));
  if (!r) throw new DomainError('Company access is unavailable.', 'NOT_FOUND', 404);
  return r.data;
}
export async function listCompanies(actor: Actor) {
  if (!actor.companyIds.length) return [];
  return (await db.select().from(s.companies).where(inArray(s.companies.id, actor.companyIds))).map(
    (r) => r.data,
  );
}
export async function listJobs(actor: Actor, tx?: Transaction) {
  if (!actor.companyIds.length) return [];
  return (await (tx ?? db).select().from(s.jobs).where(inArray(s.jobs.companyId, actor.companyIds)))
    .map((r) => r.data)
    .filter((job) => canReadJob(actor, job));
}
export async function getJob(actor: Actor, id: string, tx?: Transaction) {
  const [r] = await (tx ?? db).select().from(s.jobs).where(eq(s.jobs.id, id));
  if (!r) throw new DomainError('Job access is unavailable.', 'NOT_FOUND', 404);
  assertJobAccess(actor, r.data);
  return r.data;
}
export async function audit(
  actor: Actor,
  companyId: string | null,
  action: string,
  subjectId: string,
  detail: unknown,
  tx?: Transaction,
) {
  const write = (t: Transaction) =>
    t.insert(s.auditEvents).values({
      id: randomUUID(),
      actorId: actor.id,
      companyId,
      action,
      subjectId,
      detail,
      createdAt: new Date(),
    });
  await (tx ? write(tx) : transaction(write));
}
/** A replayed request returns the subject's current state, so only a small receipt is stored. */
type RequestReceipt = { id: string; revision?: number; activity?: Job['activity'] };
export async function prior(tx: Transaction, key: string) {
  const [r] = await tx.select().from(s.requests).where(eq(s.requests.id, key));
  return r?.result as RequestReceipt | undefined;
}
export async function remember(tx: Transaction, key: string, receipt: RequestReceipt) {
  await tx.insert(s.requests).values({ id: key, result: receipt, createdAt: new Date() });
}
export async function pruneRequests(olderThanDays: number) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const result = await transaction((tx) =>
    tx.delete(s.requests).where(lt(s.requests.createdAt, cutoff)).run(),
  );
  return result.changes;
}
export function requestKey(actor: Actor, subject: string, requestId: string) {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(requestId))
    throw new DomainError('A valid request identifier is required.');
  return `${actor.id}:${subject}:${requestId}`;
}
export async function createJob(actor: Actor, job: Job, requestId: string) {
  assertCompany(actor, job.companyId, 'prepare_job');
  assertJobAccess(actor, job);
  const key = requestKey(actor, `create:${job.companyId}`, requestId);
  try {
    return await transaction(async (tx) => {
      // The write transaction serialises duplicate creates, period constraints and director proposals.
      const old = await prior(tx, key);
      if (old) {
        // Access is checked before comparing activities so a replay never reveals a hidden job.
        const replayed = await getJob(actor, old.id, tx);
        if (replayed.activity !== job.activity)
          throw new DomainError(
            'This request identifier already belongs to another activity.',
            'CONFLICT',
            409,
          );
        return replayed;
      }
      if (job.activity === 'W03' && job.snapshot) {
        const [companyRow] = await tx
          .select()
          .from(s.companies)
          .where(eq(s.companies.id, job.companyId));
        job.snapshot = {
          ...job.snapshot,
          company: companyRow.data,
          officers: officersAt(await listOfficerEvents(job.companyId, tx), job.snapshot.asAt),
          members: await memberSnapshot(job.companyId, job.snapshot.asAt, tx),
          capturedAt: new Date().toISOString(),
        };
      }
      await tx.insert(s.jobs).values({
        id: job.id,
        companyId: job.companyId,
        periodKey: job.activity === 'W03' ? `${job.companyId}:${job.year}` : null,
        revision: job.revision,
        data: job,
      });
      await audit(actor, job.companyId, 'job.created', job.id, { activity: job.activity }, tx);
      await remember(tx, key, { id: job.id, activity: job.activity });
      await reconcileCompanyReminders(job.companyId, tx);
      return job;
    });
  } catch (e) {
    if (isUniqueViolation(e))
      throw new DomainError(
        'An annual return already exists for this company and year.',
        'DUPLICATE',
        409,
      );
    throw e;
  }
}
export async function mutateJob(
  actor: Actor,
  id: string,
  expectedRevision: number,
  requestId: string,
  operation: (job: Job, tx: Transaction) => Promise<Job> | Job,
) {
  const key = requestKey(actor, id, requestId);
  // Company scope is immutable, so it can be resolved before the transaction.
  const [identity] = await db
    .select({ companyId: s.jobs.companyId })
    .from(s.jobs)
    .where(eq(s.jobs.id, id));
  if (!identity) throw new DomainError('Job access is unavailable.', 'NOT_FOUND', 404);
  assertCompany(actor, identity.companyId);
  return transaction(async (tx) => {
    const [row] = await tx.select().from(s.jobs).where(eq(s.jobs.id, id));
    if (!row) throw new DomainError('Job access is unavailable.', 'NOT_FOUND', 404);
    assertJobAccess(actor, row.data);
    if (await prior(tx, key)) return row.data;
    if (row.revision !== expectedRevision)
      throw new DomainError(
        'This job changed. Refresh and review the current version.',
        'STALE',
        409,
      );
    const result = await operation(structuredClone(row.data), tx);
    if (result.id !== id || result.companyId !== row.companyId)
      throw new DomainError('Job identity cannot change.');
    result.revision = row.revision + 1;
    result.updatedAt = new Date().toISOString();
    await tx
      .update(s.jobs)
      .set({ data: result, revision: result.revision })
      .where(eq(s.jobs.id, id));
    await audit(
      actor,
      result.companyId,
      'job.updated',
      id,
      {
        fromRevision: row.revision,
        toRevision: result.revision,
        history: result.history.slice(-1),
      },
      tx,
    );
    await remember(tx, key, { id, revision: result.revision });
    await reconcileCompanyReminders(result.companyId, tx);
    return result;
  });
}
export async function listOfficerEvents(companyId: string, tx?: Transaction) {
  return (
    await (tx ?? db).select().from(s.officerEvents).where(eq(s.officerEvents.companyId, companyId))
  ).map((r) => r.data);
}
export async function insertOfficerEvent(event: OfficerEvent, tx: Transaction) {
  await tx
    .insert(s.officerEvents)
    .values({ id: event.id, companyId: event.companyId, data: event });
}
export async function listDocuments(actor: Actor) {
  if (!actor.companyIds.length) return [];
  return (
    await db.select().from(s.documents).where(inArray(s.documents.companyId, actor.companyIds))
  )
    .map((r) => r.data)
    .filter((doc) => doc.classification !== 'BO' || actor.capabilities.includes('view_bo'));
}
/** One query for any number of documents; every id must exist and be readable by the actor. */
export async function getDocuments(actor: Actor, ids: string[], tx?: Transaction) {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const rows = await (tx ?? db).select().from(s.documents).where(inArray(s.documents.id, unique));
  if (rows.length !== unique.length)
    throw new DomainError('Document access is unavailable.', 'NOT_FOUND', 404);
  for (const r of rows) {
    assertCompany(actor, r.companyId);
    if (r.data.classification === 'BO' && !actor.capabilities.includes('view_bo'))
      throw new DomainError('Document access is unavailable.', 'NOT_FOUND', 404);
  }
  return rows.map((r) => r.data);
}
export async function getDocument(actor: Actor, id: string, tx?: Transaction) {
  return (await getDocuments(actor, [id], tx))[0];
}
export async function insertDocument(actor: Actor, doc: Document) {
  assertCompany(actor, doc.companyId);
  if (doc.classification === 'BO') assertCapability(actor, 'view_bo');
  if (!actor.capabilities.some((c) => ['prepare_job', 'review_pack', 'record_filing'].includes(c)))
    throw new DomainError('You do not have permission to store evidence.', 'FORBIDDEN', 403);
  await transaction(async (tx) => {
    await tx.insert(s.documents).values({ id: doc.id, companyId: doc.companyId, data: doc });
    await audit(
      actor,
      doc.companyId,
      'document.stored',
      doc.id,
      { sha256: doc.sha256, size: doc.size },
      tx,
    );
  });
  return doc;
}
export async function getSettings(tx?: Transaction) {
  const [r] = await (tx ?? db).select().from(s.settings).where(eq(s.settings.id, 'firm'));
  return r?.data ?? defaultSettings;
}
export async function mutateSettings(
  actor: Actor,
  expectedRevision: number,
  requestId: string,
  fn: (settings: Settings) => Promise<Settings> | Settings,
) {
  const key = requestKey(actor, 'settings', requestId);
  return transaction(async (tx) => {
    const [r] = await tx.select().from(s.settings).where(eq(s.settings.id, 'firm'));
    if (!r) throw new DomainError('Settings are not initialized.');
    if (await prior(tx, key)) return r.data;
    if (r.revision !== expectedRevision)
      throw new DomainError('Settings changed. Refresh before saving.', 'STALE', 409);
    const result = await fn(structuredClone(r.data));
    result.revision = r.revision + 1;
    await tx
      .update(s.settings)
      .set({ revision: result.revision, data: result })
      .where(eq(s.settings.id, 'firm'));
    await audit(
      actor,
      null,
      'settings.updated',
      'firm',
      { fromRevision: r.revision, toRevision: result.revision },
      tx,
    );
    await remember(tx, key, { id: 'firm', revision: result.revision });
    return result;
  });
}
export async function saveActorPreferences(actor: Actor, preferences: Preferences) {
  await transaction(async (tx) => {
    await tx
      .update(s.user)
      .set({ preferences, updatedAt: new Date() })
      .where(eq(s.user.id, actor.id));
    await audit(actor, null, 'preferences.updated', actor.id, preferences, tx);
  });
  return preferences;
}
export async function listReminders(actor: Actor) {
  if (!actor.companyIds.length) return [];
  const visibleJobs = new Set((await listJobs(actor)).map((job) => job.id));
  return (
    await db
      .select()
      .from(s.reminders)
      .where(and(inArray(s.reminders.companyId, actor.companyIds), eq(s.reminders.resolved, false)))
  )
    .map((r) => r.data)
    .filter((r) => visibleJobs.has(r.jobId));
}
/**
 * Brings one company's open reminders in line with its jobs. The caller's write transaction
 * serialises this with every job and register change.
 * Only rows whose state actually changes are written.
 */
export async function reconcileCompanyReminders(
  companyId: string,
  tx?: Transaction,
): Promise<number> {
  if (!tx) return transaction((own) => reconcileCompanyReminders(companyId, own));
  const jobRows = await tx.select().from(s.jobs).where(eq(s.jobs.companyId, companyId));
  const registers = await readRegisters(companyId, tx);
  const activeBoJobs = new Set(beneficialOwnersAt(registers.boEvents, today()).map((e) => e.jobId));
  const wanted = new Map<string, Reminder>(
    deriveReminders(
      jobRows.map((r) => r.data),
      activeBoJobs,
    ).map((r) => [r.id, r]),
  );
  const openCount = wanted.size;
  const open = await tx
    .select()
    .from(s.reminders)
    .where(and(eq(s.reminders.companyId, companyId), eq(s.reminders.resolved, false)));
  for (const row of open) {
    const next = wanted.get(row.id);
    wanted.delete(row.id);
    if (next && next.ownerId === row.data.ownerId) continue;
    await tx
      .update(s.reminders)
      .set(
        next
          ? { data: { ...next, createdAt: row.data.createdAt } }
          : { resolved: true, data: { ...row.data, resolved: true } },
      )
      .where(eq(s.reminders.id, row.id));
  }
  if (wanted.size) {
    // Occurrence ids are deterministic, so a resolved occurrence can become due again.
    const reopened = await tx
      .select()
      .from(s.reminders)
      .where(inArray(s.reminders.id, [...wanted.keys()]));
    for (const row of reopened) {
      const next = wanted.get(row.id)!;
      wanted.delete(row.id);
      await tx
        .update(s.reminders)
        .set({ resolved: false, data: { ...next, createdAt: row.data.createdAt } })
        .where(eq(s.reminders.id, row.id));
    }
  }
  if (wanted.size)
    await tx
      .insert(s.reminders)
      .values([...wanted.values()].map((item) => ({ id: item.id, companyId, data: item })));
  return openCount;
}
export async function createCompany(actor: Actor, people: OpeningPerson[], company: Company) {
  assertCapability(actor, 'prepare_job');
  await transaction(async (tx) => {
    const [u] = await tx.select().from(s.user).where(eq(s.user.id, actor.id));
    await tx.insert(s.companies).values({ id: company.id, data: company });
    await tx
      .update(s.user)
      .set({ companyIds: [...(u?.companyIds ?? []), company.id], updatedAt: new Date() })
      .where(eq(s.user.id, actor.id));
    await audit(actor, company.id, 'company.created', company.id, { name: company.name }, tx);
    await addOpeningPeople(
      { ...actor, companyIds: [...actor.companyIds, company.id] },
      company.id,
      people,
      tx,
    );
  });
  return company;
}

/** Called inside the company's event-posting transaction; never rewrites a captured snapshot. */
export async function markSnapshotConsequences(
  actor: Actor,
  companyId: string,
  effectiveDate: string,
  eventId: string,
  tx: Transaction,
  eventLabel = 'Director event',
) {
  const rows = await tx.select().from(s.jobs).where(eq(s.jobs.companyId, companyId));
  for (const row of rows) {
    const job = row.data;
    if (job.activity !== 'W03' || !job.snapshot || job.snapshot.asAt < effectiveDate) continue;
    if (job.filingAttempts.length)
      throw new DomainError(
        'This event affects a filed anniversary snapshot. A practising secretary must establish a linked correction and consequence-review route before posting.',
      );
    if (['Complete', 'Cancelled'].includes(job.state)) continue;
    const reason = `${eventLabel} effective ${effectiveDate} affects the captured anniversary position. Refresh the snapshot and obtain new client confirmation and review.`;
    job.snapshotNeedsReview = { eventId, reason };
    if (job.filingState === 'Ready') job.filingState = 'Not ready';
    job.state = 'Blocked';
    job.revision = row.revision + 1;
    job.updatedAt = new Date().toISOString();
    job.history.push({
      id: randomUUID(),
      action: 'snapshot_consequence',
      actorId: actor.id,
      at: job.updatedAt,
      detail: reason,
    });
    await tx.update(s.jobs).set({ data: job, revision: job.revision }).where(eq(s.jobs.id, job.id));
    await audit(
      actor,
      companyId,
      'snapshot.consequence',
      job.id,
      { eventId, fromRevision: row.revision, toRevision: job.revision },
      tx,
    );
  }
}

export async function reviewOpening(
  actor: Actor,
  id: string,
  input: { expectedRevision: number; requestId: string; sourceEvidenceId: string; basis: string },
) {
  assertCompany(actor, id, 'confirm_record');
  const document = await getDocument(actor, input.sourceEvidenceId);
  if (document.companyId !== id || document.classification !== 'General')
    throw new DomainError('Opening evidence must be General evidence from this company.');
  if (document.createdBy === actor.id)
    throw new DomainError(
      'An independent reviewer must check the opening source.',
      'SELF_APPROVAL',
      403,
    );
  const key = requestKey(actor, `opening:${id}`, input.requestId);
  return transaction(async (tx) => {
    const [row] = await tx.select().from(s.companies).where(eq(s.companies.id, id));
    if (!row) throw new DomainError('Company access is unavailable.', 'NOT_FOUND', 404);
    if (await prior(tx, key)) return row.data;
    if (row.data.revision !== input.expectedRevision)
      throw new DomainError('This company record changed. Refresh before reviewing.', 'STALE', 409);
    if (row.data.createdBy === actor.id)
      throw new DomainError(
        'The opening preparer cannot approve their own record.',
        'SELF_APPROVAL',
        403,
      );
    const result: Company = {
      ...row.data,
      verification: 'Reviewed',
      sourceEvidenceId: document.id,
      openingReview: { reviewerId: actor.id, at: new Date().toISOString(), basis: input.basis },
      revision: row.data.revision + 1,
    };
    await tx.update(s.companies).set({ data: result }).where(eq(s.companies.id, id));
    await audit(
      actor,
      id,
      'company.opening_review',
      id,
      { revision: result.revision, evidenceId: document.id, basis: input.basis },
      tx,
    );
    await remember(tx, key, { id, revision: result.revision });
    return result;
  });
}
