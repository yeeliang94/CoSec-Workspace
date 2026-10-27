import { and, eq, inArray, like, sql, type SQL } from 'drizzle-orm';
import { db, type Transaction } from '../db';
import * as s from '../schema';
import { getDocuments } from '../repository';
import { DomainError } from '../../domain/access';
import { defaultPreferences, type Actor, type Capability } from '../../domain/model';

/** Author of derived writes (officer-event projections, migrations). Not a sign-in identity. */
export const systemActor: Actor = {
  id: 'system',
  name: 'System',
  email: 'system@cosec.local',
  capabilities: [],
  companyIds: [],
  preferences: defaultPreferences,
};

export const personUnavailable = () =>
  new DomainError('Person access is unavailable.', 'NOT_FOUND', 404);

export function assertAny(actor: Actor, capabilities: Capability[]) {
  if (!capabilities.some((c) => actor.capabilities.includes(c)))
    throw new DomainError('You do not have permission for this action.', 'FORBIDDEN', 403);
}

export async function lockCompany(companyId: string, tx: Transaction) {
  const [row] = await tx
    .select()
    .from(s.companies)
    .where(eq(s.companies.id, companyId))
    .for('update');
  if (!row) throw new DomainError('Company access is unavailable.', 'NOT_FOUND', 404);
  return row.data;
}

function escapeLike(text: string) {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}
/**
 * People the actor may see: anyone related to one of the actor's companies, plus people the actor
 * created that are not yet linked to any company. Optional narrowing by ids, name or company.
 * With a limit, the first `limit` people by name are returned and `truncated` says more matched.
 */
export async function visiblePeople(
  actor: Actor,
  options: { ids?: string[]; q?: string; companyId?: string; limit?: number } = {},
  tx?: Transaction,
): Promise<{ ids: string[]; truncated: boolean }> {
  const runner = tx ?? db;
  if (options.ids && !options.ids.length) return { ids: [], truncated: false };
  const limit = options.limit ?? 100000;
  const companies = options.companyId ? [options.companyId] : actor.companyIds;
  const nameFilter = options.q?.trim()
    ? like(s.people.fullName, `%${escapeLike(options.q.trim())}%`)
    : undefined;
  const idFilter = options.ids ? inArray(s.people.id, options.ids) : undefined;
  const found = new Map<string, string>();
  if (companies.length) {
    const rows = await runner
      .selectDistinct({ id: s.people.id, fullName: s.people.fullName })
      .from(s.people)
      .innerJoin(s.companyRelationships, eq(s.companyRelationships.personId, s.people.id))
      .where(and(inArray(s.companyRelationships.companyId, companies), nameFilter, idFilter))
      .orderBy(s.people.fullName, s.people.id)
      .limit(limit + 1);
    rows.forEach((r) => found.set(r.id, r.fullName));
  }
  if (!options.companyId) {
    const conditions: (SQL | undefined)[] = [
      sql`JSON_UNQUOTE(JSON_EXTRACT(${s.people.data}, '$.createdBy')) = ${actor.id}`,
      sql`NOT EXISTS (SELECT 1 FROM company_relationships r WHERE r.person_id = ${s.people.id})`,
      nameFilter,
      idFilter,
    ];
    const rows = await runner
      .select({ id: s.people.id, fullName: s.people.fullName })
      .from(s.people)
      .where(and(...conditions))
      .orderBy(s.people.fullName, s.people.id)
      .limit(limit + 1);
    rows.forEach((r) => found.set(r.id, r.fullName));
  }
  const sorted = [...found]
    .sort(([aId, aName], [bId, bName]) => aName.localeCompare(bName) || aId.localeCompare(bId))
    .map(([id]) => id);
  return { ids: sorted.slice(0, limit), truncated: sorted.length > limit };
}
export async function visiblePersonIds(
  actor: Actor,
  options: { ids?: string[]; q?: string; companyId?: string; limit?: number } = {},
  tx?: Transaction,
): Promise<string[]> {
  return (await visiblePeople(actor, options, tx)).ids;
}
export async function assertPersonVisible(actor: Actor, personId: string, tx?: Transaction) {
  if (!(await visiblePersonIds(actor, { ids: [personId] }, tx)).length) throw personUnavailable();
}

/** Evidence on records and cases must be readable General documents of the same company. */
export async function companyEvidence(
  actor: Actor,
  companyId: string,
  ids: string[],
  tx?: Transaction,
) {
  const documents = await getDocuments(actor, ids, tx);
  if (documents.some((d) => d.companyId !== companyId || d.classification !== 'General'))
    throw new DomainError('Evidence must be General documents from this company.');
  return [...new Set(ids)];
}

/** Active users who can act for the company (for owners of case steps). */
export async function assertAssignable(userId: string, companyId: string, tx: Transaction) {
  const [u] = await tx
    .select({ companyIds: s.user.companyIds, active: s.user.active })
    .from(s.user)
    .where(eq(s.user.id, userId));
  if (!u || !u.active || !u.companyIds.includes(companyId))
    throw new DomainError('Choose an active owner with access to this company.');
}
