import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db, transaction, type Transaction } from '../db';
import * as s from '../schema';
import { listOfficerEvents, prior, remember, requestKey } from '../repository';
import { auditChange } from '../resolution/shared';
import {
  assertPersonVisible,
  companyEvidence,
  lockCompany,
  personUnavailable,
  systemActor,
  visiblePersonIds,
} from './scope';
import { assertCompany, DomainError } from '../../domain/access';
import { officersAt } from '../../domain/workflows';
import type { Actor } from '../../domain/model';
import type {
  CompanyRelationship,
  Person,
  PersonSnapshot,
  RelationshipRole,
} from '../../domain/resolution/model';
import { directorIntervals, directorRelationshipId } from '../../domain/resolution/records';

export type ProjectionResult = {
  peopleCreated: string[];
  relationshipsCreated: string[];
  relationshipsUpdated: string[];
  /** Existing people not linked because this company's events name them differently. */
  peopleSkipped: string[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Longest person id the people and relationship tables store. */
export const PERSON_ID_MAX = 64;

/**
 * Brings the company's director relationships in line with its posted officer events. Officer
 * event person ids become people ids unchanged; people are never merged by name, and an existing
 * person's (possibly corrected) name is never overwritten. An existing person who is not yet
 * related to this company is linked only when every one of this company's events names them
 * exactly as the person record does; otherwise the link is skipped and flagged in the audit. The
 * caller holds the company row lock.
 */
export async function syncDirectorProjection(
  companyId: string,
  tx: Transaction,
): Promise<ProjectionResult> {
  const result: ProjectionResult = {
    peopleCreated: [],
    relationshipsCreated: [],
    relationshipsUpdated: [],
    peopleSkipped: [],
  };
  const events = await listOfficerEvents(companyId, tx);
  if (!events.length) return result;
  const intervals = directorIntervals(events);
  const now = new Date().toISOString();
  // Sorted so concurrent projections of different companies insert shared ids in the same order.
  const personIds = [...new Set(events.map((e) => e.personId))].sort();
  const existingNames = new Map(
    (
      await tx
        .select({ id: s.people.id, fullName: s.people.fullName })
        .from(s.people)
        .where(inArray(s.people.id, personIds))
    ).map((r) => [r.id, r.fullName] as const),
  );
  for (const personId of personIds) {
    if (existingNames.has(personId)) continue;
    const latest = events
      .filter((e) => e.personId === personId)
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
      .at(-1)!;
    const person: Person = {
      id: personId,
      fullName: latest.personName,
      nameHistory: [],
      email: null,
      notes: '',
      customValues: {},
      createdBy: systemActor.id,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
    // Another company's projection may already have inserted the same id; the first insert wins.
    await tx
      .insert(s.people)
      .values({ id: personId, fullName: person.fullName, revision: 1, data: person })
      .onConflictDoNothing({ target: s.people.id });
    const [stored] = await tx
      .select({ fullName: s.people.fullName, data: s.people.data })
      .from(s.people)
      .where(eq(s.people.id, personId));
    if (stored.data.createdBy !== systemActor.id || stored.data.createdAt !== now) {
      existingNames.set(personId, stored.fullName);
      continue;
    }
    result.peopleCreated.push(personId);
    await auditChange(tx, systemActor, {
      companyId: null,
      scopeCompanyIds: [companyId],
      entityType: 'person',
      entityId: personId,
      action: 'person.projected',
      before: null,
      after: person,
      detail: { source: 'officer_events', companyId },
    });
  }
  // Re-check at posting time: an existing person only joins this company when this company's
  // events agree with the person's recorded name. A guessed id from another company never links.
  const existingIds = [...existingNames.keys()];
  const related = new Set(
    existingIds.length
      ? (
          await tx
            .selectDistinct({ personId: s.companyRelationships.personId })
            .from(s.companyRelationships)
            .where(
              and(
                eq(s.companyRelationships.companyId, companyId),
                inArray(s.companyRelationships.personId, existingIds),
              ),
            )
        ).map((r) => r.personId)
      : [],
  );
  const skipped = new Set(
    existingIds.filter(
      (personId) =>
        !related.has(personId) &&
        events.some((e) => e.personId === personId && e.personName !== existingNames.get(personId)),
    ),
  );
  for (const personId of [...skipped].sort()) {
    result.peopleSkipped.push(personId);
    const officerEventIds = events.filter((e) => e.personId === personId).map((e) => e.id);
    const [flagged] = await tx
      .select({ id: s.auditEvents.id })
      .from(s.auditEvents)
      .where(
        and(
          eq(s.auditEvents.entityType, 'person'),
          eq(s.auditEvents.subjectId, personId),
          eq(s.auditEvents.companyId, companyId),
          eq(s.auditEvents.action, 'relationship.projection_skipped'),
        ),
      )
      .limit(1);
    if (flagged) continue;
    await auditChange(tx, systemActor, {
      companyId,
      entityType: 'person',
      entityId: personId,
      action: 'relationship.projection_skipped',
      detail: {
        reason:
          'Officer events name this person differently from the existing person record; the director link was not created. Review the identity.',
        officerEventIds,
      },
    });
  }
  const current = new Map(
    (
      await tx
        .select()
        .from(s.companyRelationships)
        .where(
          and(
            eq(s.companyRelationships.companyId, companyId),
            eq(s.companyRelationships.role, 'director'),
          ),
        )
    ).map((r) => [r.id, r.data]),
  );
  const evidenceByEvent = new Map(events.map((e) => [e.id, e.evidenceIds]));
  for (const interval of intervals) {
    const id = directorRelationshipId(interval.appointmentEventId);
    const evidenceIds = [
      ...new Set(interval.officerEventIds.flatMap((e) => evidenceByEvent.get(e) ?? [])),
    ];
    const existing = current.get(id);
    if (!existing) {
      if (skipped.has(interval.personId)) continue;
      const relationship: CompanyRelationship = {
        id,
        companyId,
        personId: interval.personId,
        role: 'director',
        capacity: '',
        startDate: interval.startDate,
        endDate: interval.endDate,
        projectedFrom: { officerEventIds: interval.officerEventIds },
        evidenceIds,
        createdBy: systemActor.id,
        createdAt: now,
        revision: 1,
      };
      await tx.insert(s.companyRelationships).values({
        id,
        companyId,
        personId: interval.personId,
        role: 'director',
        revision: 1,
        data: relationship,
      });
      result.relationshipsCreated.push(id);
      await auditChange(tx, systemActor, {
        companyId,
        entityType: 'company_relationship',
        entityId: id,
        action: 'relationship.projected',
        before: null,
        after: relationship,
        detail: { officerEventIds: interval.officerEventIds },
      });
      continue;
    }
    const next: CompanyRelationship = {
      ...existing,
      personId: interval.personId,
      startDate: interval.startDate,
      endDate: interval.endDate,
      projectedFrom: { officerEventIds: interval.officerEventIds },
      evidenceIds,
    };
    if (JSON.stringify(next) === JSON.stringify(existing)) continue;
    next.revision = existing.revision + 1;
    await tx
      .update(s.companyRelationships)
      .set({ personId: next.personId, revision: next.revision, data: next })
      .where(eq(s.companyRelationships.id, id));
    result.relationshipsUpdated.push(id);
    await auditChange(tx, systemActor, {
      companyId,
      entityType: 'company_relationship',
      entityId: id,
      action: 'relationship.projected',
      before: existing,
      after: next,
      detail: { officerEventIds: interval.officerEventIds },
    });
  }
  return result;
}

/**
 * W04 person checks at job creation. An existing person must be visible to the actor (for an
 * appointment) or related to this company (for a cessation), and the proposal must use the
 * person's recorded name. An id with no person record is a new appointee and must be a fresh
 * UUID, or, for a cessation, an officer of this company whose projection is still pending. Every
 * failure gives the same not-found response so ids from other companies are not disclosed.
 */
/**
 * The W04 person must be one the actor may act on. At posting (`posting: true`) a still-unlinked
 * person is also accepted, since the preparer chose them and linking exposes them only to this
 * company; a person linked elsewhere must be visible to the poster.
 */
export async function assertDirectorChangePerson(
  actor: Actor,
  input: { companyId: string; route: string; personId: string; personName: string },
  tx?: Transaction,
  posting = false,
) {
  const { companyId, route, personId, personName } = input;
  if (personId.length > PERSON_ID_MAX) throw personUnavailable();
  const [row] = await (tx ?? db)
    .select({ fullName: s.people.fullName })
    .from(s.people)
    .where(eq(s.people.id, personId));
  if (row) {
    const visible = await visiblePersonIds(
      actor,
      route === 'appointment' ? { ids: [personId] } : { ids: [personId], companyId },
      tx,
    );
    if (row.fullName !== personName) throw personUnavailable();
    if (visible.length) return;
    if (posting && route === 'appointment') {
      const [linked] = await (tx ?? db)
        .select({ id: s.companyRelationships.id })
        .from(s.companyRelationships)
        .where(eq(s.companyRelationships.personId, personId))
        .limit(1);
      if (!linked) return;
    }
    throw personUnavailable();
  }
  if (route === 'appointment') {
    if (!UUID.test(personId)) throw personUnavailable();
    return;
  }
  if (!(await listOfficerEvents(companyId, tx)).some((e) => e.personId === personId))
    throw personUnavailable();
}

export type RelationshipView = CompanyRelationship & { personName: string };
/** Relationships of one company with person names. Caller has checked company access. */
export async function companyRelationships(companyId: string, tx?: Transaction) {
  return (
    await (tx ?? db)
      .select({ data: s.companyRelationships.data, personName: s.people.fullName })
      .from(s.companyRelationships)
      .innerJoin(s.people, eq(s.people.id, s.companyRelationships.personId))
      .where(eq(s.companyRelationships.companyId, companyId))
  ).map((r): RelationshipView => ({ ...r.data, personName: r.personName }));
}

/** As-at directors from officer events, with names from people and capacity from projections. */
export async function directorsAsAt(
  companyId: string,
  asAt: string,
  tx?: Transaction,
  relationships?: RelationshipView[],
): Promise<PersonSnapshot[]> {
  const rels = relationships ?? (await companyRelationships(companyId, tx));
  const byEvent = new Map(rels.filter((r) => r.role === 'director').map((r) => [r.id, r] as const));
  const names = new Map(rels.map((r) => [r.personId, r.personName] as const));
  return officersAt(await listOfficerEvents(companyId, tx), asAt).map((o) => {
    // The open interval may have been opened by an earlier appointment than `o.eventId`.
    const rel =
      byEvent.get(directorRelationshipId(o.eventId)) ??
      rels.find(
        (r) =>
          r.role === 'director' &&
          r.personId === o.personId &&
          (r.startDate ?? '') <= asAt &&
          (!r.endDate || r.endDate > asAt),
      );
    return {
      id: o.personId,
      name: names.get(o.personId) ?? o.personName,
      capacity: rel?.capacity || 'Director',
      appointedOn: rel?.startDate ?? o.appointedOn,
      ceasedOn: rel?.endDate ?? null,
    };
  });
}

/**
 * A plain read: projections are refreshed when W04 posts (and by the people migration), so no
 * company lock or projection sync happens here. One transaction gives a consistent snapshot.
 */
export async function listCompanyRelationships(actor: Actor, companyId: string, asAt: string) {
  assertCompany(actor, companyId);
  return transaction(async (tx) => {
    const relationships = await companyRelationships(companyId, tx);
    return {
      relationships,
      directorsAsAt: await directorsAsAt(companyId, asAt, tx, relationships),
    };
  });
}

type RelationshipInput =
  | {
      action: 'add';
      requestId: string;
      personId: string;
      role: Exclude<RelationshipRole, 'director'>;
      capacity: string;
      startDate: string | null;
      evidenceIds: string[];
    }
  | {
      action: 'end';
      id: string;
      expectedRevision: number;
      requestId: string;
      endDate: string;
      reason: string;
    }
  | {
      action: 'set_capacity';
      id: string;
      expectedRevision: number;
      requestId: string;
      capacity: string;
      reason: string;
    };

export async function changeRelationship(
  actor: Actor,
  companyId: string,
  input: RelationshipInput,
): Promise<CompanyRelationship> {
  assertCompany(actor, companyId, 'manage_people');
  if (input.action === 'add') {
    if ((input.role as string) === 'director')
      throw new DomainError(
        'Director relationships come from posted officer events. Use a W04 director change.',
      );
    const key = requestKey(actor, `relationship:${companyId}`, input.requestId);
    return transaction(async (tx) => {
      await lockCompany(companyId, tx);
      const old = await prior(tx, key);
      if (old) return readRelationship(actor, old.id, tx);
      // Checked under the company lock so a concurrent change cannot slip between check and write.
      await assertPersonVisible(actor, input.personId, tx);
      const evidenceIds = await companyEvidence(actor, companyId, input.evidenceIds, tx);
      const now = new Date().toISOString();
      const relationship: CompanyRelationship = {
        id: randomUUID(),
        companyId,
        personId: input.personId,
        role: input.role,
        capacity: input.capacity.trim(),
        startDate: input.startDate,
        endDate: null,
        projectedFrom: null,
        evidenceIds,
        createdBy: actor.id,
        createdAt: now,
        revision: 1,
      };
      await tx.insert(s.companyRelationships).values({
        id: relationship.id,
        companyId,
        personId: relationship.personId,
        role: relationship.role,
        revision: 1,
        data: relationship,
      });
      await auditChange(tx, actor, {
        companyId,
        entityType: 'company_relationship',
        entityId: relationship.id,
        action: 'relationship.added',
        before: null,
        after: relationship,
        detail: { personId: relationship.personId },
        requestId: input.requestId,
      });
      await remember(tx, key, { id: relationship.id, revision: 1 });
      return relationship;
    });
  }
  const key = requestKey(actor, `relationship:${input.id}`, input.requestId);
  return transaction(async (tx) => {
    await lockCompany(companyId, tx);
    const [row] = await tx
      .select()
      .from(s.companyRelationships)
      .where(eq(s.companyRelationships.id, input.id));
    if (!row || row.companyId !== companyId)
      throw new DomainError('Relationship access is unavailable.', 'NOT_FOUND', 404);
    if (await prior(tx, key)) return row.data;
    if (row.revision !== input.expectedRevision)
      throw new DomainError('This relationship changed. Refresh and try again.', 'STALE', 409);
    const before = row.data;
    const next = structuredClone(before);
    if (input.action === 'end') {
      if (before.projectedFrom || before.role === 'director')
        throw new DomainError(
          'A director relationship ends only through a posted W04 cessation event.',
        );
      if (before.endDate) throw new DomainError('This relationship has already ended.');
      if (before.startDate && input.endDate < before.startDate)
        throw new DomainError('The end date cannot be before the start date.');
      next.endDate = input.endDate;
    } else {
      next.capacity = input.capacity.trim();
      if (next.capacity === before.capacity) throw new DomainError('No change to save.');
    }
    next.revision = before.revision + 1;
    await tx
      .update(s.companyRelationships)
      .set({ revision: next.revision, data: next })
      .where(eq(s.companyRelationships.id, next.id));
    await auditChange(tx, actor, {
      companyId,
      entityType: 'company_relationship',
      entityId: next.id,
      action: input.action === 'end' ? 'relationship.ended' : 'relationship.capacity_set',
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

async function readRelationship(actor: Actor, id: string, tx: Transaction) {
  const [row] = await tx
    .select()
    .from(s.companyRelationships)
    .where(eq(s.companyRelationships.id, id));
  if (!row) throw new DomainError('Relationship access is unavailable.', 'NOT_FOUND', 404);
  assertCompany(actor, row.companyId);
  return row.data;
}
