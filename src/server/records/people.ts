import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db, transaction, type Transaction } from '../db';
import * as s from '../schema';
import { prior, remember, requestKey } from '../repository';
import { auditChange } from '../resolution/shared';
import { appendCustomValue } from './custom-fields';
import { personUnavailable, visiblePeople, visiblePersonIds } from './scope';
import { queryAudit } from './audit';
import { assertCapability, assertCompany, DomainError, today } from '../../domain/access';
import type { Actor } from '../../domain/model';
import type { CompanyRelationship, Person } from '../../domain/resolution/model';

const SEARCH_LIMIT = 200;

/** Relationships of the given people, limited to the actor's companies. */
async function scopedRelationships(actor: Actor, personIds: string[], tx?: Transaction) {
  if (!personIds.length || !actor.companyIds.length) return [];
  return (
    await (tx ?? db)
      .select({ data: s.companyRelationships.data })
      .from(s.companyRelationships)
      .where(
        and(
          inArray(s.companyRelationships.personId, personIds),
          inArray(s.companyRelationships.companyId, actor.companyIds),
        ),
      )
  ).map((r) => r.data);
}
/** Every company the person is linked to, including ones outside the actor's access. */
async function linkedCompanyIds(personId: string, tx: Transaction) {
  const rows = await tx
    .selectDistinct({ companyId: s.companyRelationships.companyId })
    .from(s.companyRelationships)
    .where(eq(s.companyRelationships.personId, personId));
  return rows.map((r) => r.companyId).sort();
}

/**
 * People search: a plain read (projections are refreshed when W04 posts). The first
 * `SEARCH_LIMIT` matches by name are returned; `truncated` says more matched.
 */
export async function listPeople(actor: Actor, options: { q?: string; companyId?: string }) {
  if (options.companyId) assertCompany(actor, options.companyId);
  const { ids, truncated } = await visiblePeople(actor, { ...options, limit: SEARCH_LIMIT });
  if (!ids.length) return { people: [], truncated };
  const [rows, relationships] = await Promise.all([
    db.select().from(s.people).where(inArray(s.people.id, ids)),
    scopedRelationships(actor, ids),
  ]);
  const people = rows
    .map((r) => ({
      ...r.data,
      relationships: relationships.filter((rel) => rel.personId === r.id),
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName) || a.id.localeCompare(b.id));
  return { people, truncated };
}

export async function getPerson(actor: Actor, id: string) {
  if (!(await visiblePersonIds(actor, { ids: [id] })).length) throw personUnavailable();
  const [row] = await db.select().from(s.people).where(eq(s.people.id, id));
  if (!row) throw personUnavailable();
  const relationships: CompanyRelationship[] = await scopedRelationships(actor, [id]);
  const audit = actor.capabilities.includes('view_audit')
    ? (await queryAudit(actor, { entityType: 'person', entityId: id })).entries
    : [];
  return { person: row.data, relationships, audit };
}

export type PersonInput =
  | { action: 'create'; requestId: string; fullName: string; email?: string | null; notes?: string }
  | {
      action: 'update';
      id: string;
      expectedRevision: number;
      requestId: string;
      fullName?: string;
      email?: string | null;
      notes?: string;
      reason: string;
    }
  | {
      action: 'set_custom';
      id: string;
      expectedRevision: number;
      requestId: string;
      definitionId: string;
      value: unknown;
      effectiveDate: string;
      reason: string;
    };

export async function changePerson(actor: Actor, input: PersonInput): Promise<Person> {
  assertCapability(actor, 'manage_people');
  if (input.action === 'create') {
    const key = requestKey(actor, 'person:create', input.requestId);
    return transaction(async (tx) => {
      const old = await prior(tx, key);
      if (old) {
        // A replay returns current data, so it needs the same access as a normal read.
        const [row] = await tx.select().from(s.people).where(eq(s.people.id, old.id));
        if (!row || !(await visiblePersonIds(actor, { ids: [old.id] }, tx)).length)
          throw personUnavailable();
        return row.data;
      }
      const now = new Date().toISOString();
      const person: Person = {
        id: randomUUID(),
        fullName: input.fullName.trim(),
        nameHistory: [],
        email: input.email?.trim() || null,
        notes: input.notes?.trim() ?? '',
        customValues: {},
        createdBy: actor.id,
        createdAt: now,
        updatedAt: now,
        revision: 1,
      };
      await tx
        .insert(s.people)
        .values({ id: person.id, fullName: person.fullName, revision: 1, data: person });
      // Unlinked people are firm-level until a relationship links them to a company.
      await auditChange(tx, actor, {
        companyId: null,
        scopeCompanyIds: [],
        entityType: 'person',
        entityId: person.id,
        action: 'person.created',
        before: null,
        after: person,
        requestId: input.requestId,
      });
      await remember(tx, key, { id: person.id, revision: 1 });
      return person;
    });
  }
  const key = requestKey(actor, `person:${input.id}`, input.requestId);
  return transaction(async (tx) => {
    const [row] = await tx.select().from(s.people).where(eq(s.people.id, input.id));
    if (!row || !(await visiblePersonIds(actor, { ids: [input.id] }, tx)).length)
      throw personUnavailable();
    if (await prior(tx, key)) return row.data;
    if (row.revision !== input.expectedRevision)
      throw new DomainError('This person changed. Refresh and try again.', 'STALE', 409);
    const companies = await linkedCompanyIds(input.id, tx);
    // Shared identity feeds every linked company's future outputs, so only someone who can act
    // for all of them may change it.
    if (companies.some((c) => !actor.companyIds.includes(c)))
      throw new DomainError('You cannot change this shared identity.', 'FORBIDDEN', 403);
    const before = row.data;
    const next = structuredClone(before);
    if (input.action === 'update') {
      const fullName = input.fullName?.trim();
      if (fullName !== undefined && fullName !== before.fullName) {
        next.nameHistory.push({
          name: before.fullName,
          until: today(),
          actorId: actor.id,
          reason: input.reason.trim(),
        });
        next.fullName = fullName;
      }
      if (input.email !== undefined) next.email = input.email?.trim() || null;
      if (input.notes !== undefined) next.notes = input.notes.trim();
    } else
      next.customValues = await appendCustomValue(actor, before.customValues, input, 'person', tx);
    if (JSON.stringify(next) === JSON.stringify(before))
      throw new DomainError('No change to save.');
    next.revision = before.revision + 1;
    next.updatedAt = new Date().toISOString();
    await tx
      .update(s.people)
      .set({ fullName: next.fullName, revision: next.revision, data: next })
      .where(eq(s.people.id, next.id));
    await auditChange(tx, actor, {
      companyId: null,
      scopeCompanyIds: companies,
      entityType: 'person',
      entityId: next.id,
      action: input.action === 'update' ? 'person.updated' : 'person.custom_set',
      before,
      after: next,
      reason: input.reason,
      requestId: input.requestId,
      detail: { fromRevision: before.revision, toRevision: next.revision },
    });
    await remember(tx, key, { id: next.id, revision: next.revision });
    return next;
  });
}
