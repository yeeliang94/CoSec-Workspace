import { and, eq, inArray, lt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, transaction, type Transaction } from './db';
import * as s from './schema';
import type {
  Actor,
  Company,
  Document,
  OfficerEvent,
  Preferences,
  Settings,
} from '../domain/model';
import { defaultSettings } from '../domain/model';
import { addOpeningPeople, type OpeningPerson } from './records/relationships';
import { assertCapability, assertCompany, DomainError } from '../domain/access';
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
/** Active users, each with only the companies they share with `actor` (for assignment lists). */
export async function listUsers(actor: Actor) {
  const shared = new Set(actor.companyIds);
  return (
    await db
      .select({ id: s.user.id, name: s.user.name, companyIds: s.user.companyIds })
      .from(s.user)
      .where(eq(s.user.active, true))
  ).map((u) => ({ ...u, companyIds: u.companyIds.filter((id) => shared.has(id)) }));
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
type RequestReceipt = { id: string; revision?: number };
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
    .filter((doc) => doc.classification !== 'BO');
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
    if (r.data.classification === 'BO')
      throw new DomainError('Document access is unavailable.', 'NOT_FOUND', 404);
  }
  return rows.map((r) => r.data);
}
export async function getDocument(actor: Actor, id: string, tx?: Transaction) {
  return (await getDocuments(actor, [id], tx))[0];
}
export async function insertDocument(actor: Actor, doc: Document) {
  assertCompany(actor, doc.companyId);
  if (doc.classification === 'BO')
    throw new DomainError('Restricted evidence is no longer stored.', 'FORBIDDEN', 403);
  if (!actor.capabilities.some((c) => ['prepare_job', 'review_pack'].includes(c)))
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
