import { eq, inArray } from 'drizzle-orm';
import { db, type Transaction } from '../db';
import * as s from '../schema';
import { getJob, getSettings } from '../repository';
import { memberSnapshot } from '../record-store';
import { readCase } from '../resolution/shared';
import { readProfile } from './profile';
import { companyRelationships, directorsAsAt } from './relationships';
import { lockCompany, visiblePersonIds } from './scope';
import { assertCompany, DomainError, today } from '../../domain/access';
import type { Actor } from '../../domain/model';
import type {
  CitationKey,
  PersonSnapshot,
  RelationshipRole,
  ResolutionContext,
} from '../../domain/resolution/model';
import { CITATION_KEYS } from '../../domain/resolution/model';
import { isCalendarDate, resolveValues, valueAt } from '../../domain/resolution/records';

const roleLabel: Record<RelationshipRole, string> = {
  director: 'Director',
  member: 'Member',
  secretary: 'Secretary',
  auditor: 'Auditor',
  other: '',
};
const PROPOSED_LIMIT = 1000;

/**
 * The authorised as-at record view a resolution template may bind to. Directors come from posted
 * officer events; members from the capital register (never BO data). Director projections are
 * refreshed when W04 posts, so this read never syncs them. Without `tx` it is a plain read in one
 * snapshot transaction, with no locks. With `tx` the caller already holds the company row lock
 * (taken before the case lock, as `mutateCase` and generation do); re-reading it here adds none.
 */
export async function loadResolutionContext(
  actor: Actor,
  caseId: string,
  asAt: string,
  tx?: Transaction,
): Promise<ResolutionContext> {
  if (!isCalendarDate(asAt)) throw new DomainError('Choose a valid as-at date.');
  if (!tx) return db.transaction((own) => readContext(actor, caseId, asAt, own, false));
  return readContext(actor, caseId, asAt, tx, true);
}

async function readContext(
  actor: Actor,
  caseId: string,
  asAt: string,
  tx: Transaction,
  callerHoldsLock: boolean,
): Promise<ResolutionContext> {
  const resolutionCase = await readCase(actor, caseId, tx);
  const companyId = resolutionCase.companyId;
  assertCompany(actor, companyId);
  const company = callerHoldsLock
    ? await lockCompany(companyId, tx)
    : (await tx.select().from(s.companies).where(eq(s.companies.id, companyId)))[0]?.data;
  if (!company) throw new DomainError('Company access is unavailable.', 'NOT_FOUND', 404);
  const profile = await readProfile(companyId, tx);
  const settings = await getSettings(tx);
  const relationships = await companyRelationships(companyId, tx);
  const job = resolutionCase.jobId ? await getJob(actor, resolutionCase.jobId, tx) : null;
  const directors = await directorsAsAt(companyId, asAt, tx, relationships);

  const position = await memberSnapshot(companyId, asAt, tx);
  const holders = new Set(position.holdings.filter((h) => h.units !== '0').map((h) => h.memberId));
  const memberRecords = position.members.filter((m) => holders.has(m.id));
  const memberPeople = new Map(
    memberRecords.length
      ? (
          await tx
            .select({ id: s.people.id, name: s.people.fullName })
            .from(s.people)
            .where(
              inArray(
                s.people.id,
                memberRecords.map((m) => m.id),
              ),
            )
        ).map((p) => [p.id, p.name] as const)
      : [],
  );
  const members: PersonSnapshot[] = memberRecords
    .map((m) => ({
      id: m.id,
      name: memberPeople.get(m.id) ?? m.name,
      capacity: 'Member',
      appointedOn: null,
      ceasedOn: null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Directors first so their snapshot (from events) wins over other roles of the same person.
  const companyPeople = new Map<string, PersonSnapshot>(directors.map((d) => [d.id, d]));
  for (const r of relationships) {
    if (companyPeople.has(r.personId)) continue;
    if ((r.startDate && r.startDate > asAt) || (r.endDate && r.endDate <= asAt)) continue;
    if (r.role === 'director') continue; // directors as-at already come from officer events
    companyPeople.set(r.personId, {
      id: r.personId,
      name: r.personName,
      capacity: r.capacity || roleLabel[r.role as RelationshipRole] || '',
      appointedOn: r.startDate,
      ceasedOn: r.endDate,
    });
  }

  const visible = await visiblePersonIds(actor, { limit: PROPOSED_LIMIT }, tx);
  const proposedPeople: PersonSnapshot[] = visible.length
    ? (
        await tx
          .select({ id: s.people.id, name: s.people.fullName })
          .from(s.people)
          .where(inArray(s.people.id, visible))
      )
        .map((p) => ({ id: p.id, name: p.name, capacity: '', appointedOn: null, ceasedOn: null }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  // A W04 appointee may not have a people record yet; the linked job makes them selectable here.
  if (job?.personId && job.personName && !proposedPeople.some((p) => p.id === job.personId))
    proposedPeople.unshift({
      id: job.personId,
      name: job.personName,
      capacity: '',
      appointedOn: null,
      ceasedOn: null,
    });

  const citations: Partial<Record<CitationKey, string>> = {};
  for (const key of CITATION_KEYS) {
    const value = valueAt(profile.citations[key], asAt);
    if (typeof value === 'string') citations[key] = value;
  }
  return {
    asAt,
    preparedOn: today(),
    firm: { name: settings.firmName },
    company: {
      id: company.id,
      name: company.name,
      registrationNumber: company.registrationNumber,
      address: company.address,
      incorporationDate: company.incorporationDate,
      financialYearEnd: company.financialYearEnd,
      revision: company.revision,
      profileRevision: profile.revision,
      citations,
      custom: resolveValues(profile.customValues, asAt),
    },
    case: {
      id: resolutionCase.id,
      kind: resolutionCase.kind,
      title: resolutionCase.title,
      revision: resolutionCase.revision,
      instructionDate: resolutionCase.instructionDate,
      resolutionDate: resolutionCase.resolutionDate,
      effectiveDate: resolutionCase.effectiveDate,
      custom: resolveValues(resolutionCase.customValues, asAt),
    },
    job: job
      ? {
          id: job.id,
          revision: job.revision,
          route: job.route,
          personId: job.personId,
          personName: job.personName,
          effectiveDate: job.effectiveDate,
          packVersion: job.packs.at(-1)?.version ?? null,
        }
      : null,
    directors,
    members,
    companyPeople: [...companyPeople.values()].sort((a, b) => a.name.localeCompare(b.name)),
    proposedPeople,
  };
}
