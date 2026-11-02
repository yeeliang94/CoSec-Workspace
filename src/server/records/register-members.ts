import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Transaction } from '../db';
import * as s from '../schema';
import { auditChange } from '../resolution/shared';
import { systemActor } from './scope';
import type { CompanyRelationship, Person } from '../../domain/resolution/model';

/** The parts of a retired share-register event that decide who held shares, and when. */
type LegacyCapitalEvent = {
  id: string;
  kind: 'opening' | 'allotment' | 'transfer';
  effectiveDate: string;
  sequence: number;
  sourceCertificateId: string | null;
  allocations: { member: { id: string; name: string }; units: string }[];
};
export type MemberTerm = {
  memberId: string;
  name: string;
  startDate: string;
  endDate: string | null;
};

/**
 * Replays the retired share register (posted events only, in effective-date order) and returns
 * each member's holding terms. A term starts on the date a member first holds shares and ends on
 * the date their last share leaves (the end date is the first day they are no longer a member).
 * Certificates are tracked like the register did: a transfer cancels the source certificate,
 * issues the transferred units to the recipient and returns any balance to the transferor.
 */
export function memberTerms(events: LegacyCapitalEvent[]): MemberTerm[] {
  const certificates = new Map<string, { memberId: string; units: bigint }>();
  const held = new Map<string, bigint>();
  const names = new Map<string, string>();
  const open = new Map<string, string>();
  const terms: MemberTerm[] = [];
  const add = (memberId: string, delta: bigint) =>
    held.set(memberId, (held.get(memberId) ?? 0n) + delta);
  const ordered = [...events].sort(
    (a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.sequence - b.sequence,
  );
  for (let i = 0; i < ordered.length; i++) {
    const event = ordered[i];
    let total = 0n;
    for (const [index, allocation] of event.allocations.entries()) {
      const units = BigInt(allocation.units);
      names.set(allocation.member.id, allocation.member.name);
      certificates.set(`${event.id}:${index}`, { memberId: allocation.member.id, units });
      add(allocation.member.id, units);
      total += units;
    }
    const source = event.kind === 'transfer' && event.sourceCertificateId;
    const certificate = source ? certificates.get(source) : undefined;
    if (source && certificate) {
      certificates.delete(source);
      add(certificate.memberId, -certificate.units);
      const balance = certificate.units - total;
      if (balance > 0n) {
        certificates.set(`${event.id}:balance`, { memberId: certificate.memberId, units: balance });
        add(certificate.memberId, balance);
      }
    }
    // Membership is judged once all events of a date are applied.
    if (ordered[i + 1]?.effectiveDate === event.effectiveDate) continue;
    for (const [memberId, units] of held) {
      if (units > 0n && !open.has(memberId)) open.set(memberId, event.effectiveDate);
      else if (units <= 0n && open.has(memberId)) {
        terms.push({
          memberId,
          name: names.get(memberId)!,
          startDate: open.get(memberId)!,
          endDate: event.effectiveDate,
        });
        open.delete(memberId);
      }
    }
  }
  for (const [memberId, startDate] of open)
    terms.push({ memberId, name: names.get(memberId)!, startDate, endDate: null });
  return terms.sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || a.memberId.localeCompare(b.memberId),
  );
}

const termId = (companyId: string, term: MemberTerm) =>
  'register-member-' +
  createHash('sha256')
    .update(`${companyId}:${term.memberId}:${term.startDate}`)
    .digest('hex')
    .slice(0, 32);

/**
 * Carries one company's retired share-register holders into member relationships, so members'
 * resolutions keep listing them. Safe to re-run: each term has a fixed id and is added only once,
 * and an existing person keeps their recorded name. The caller holds the company lock.
 */
export async function carryRegisterMembers(companyId: string, tx: Transaction) {
  const [row] = await tx
    .select({ data: s.companyRegisters.data })
    .from(s.companyRegisters)
    .where(eq(s.companyRegisters.companyId, companyId));
  const events = (row?.data.capitalEvents ?? []) as LegacyCapitalEvent[];
  const created: string[] = [];
  const now = new Date().toISOString();
  const existing = (
    await tx
      .select()
      .from(s.companyRelationships)
      .where(
        and(
          eq(s.companyRelationships.companyId, companyId),
          eq(s.companyRelationships.role, 'member'),
        ),
      )
  ).map((row) => row.data);
  const receipts = await tx
    .select({ requestId: s.auditEvents.requestId })
    .from(s.auditEvents)
    .where(
      and(
        eq(s.auditEvents.companyId, companyId),
        eq(s.auditEvents.action, 'company.share_register_term_reconciled'),
      ),
    );
  const handled = new Set(receipts.map((row) => row.requestId));
  for (const term of memberTerms(events)) {
    const id = termId(companyId, term);
    // Recognise imports from the earlier migrator as well as the durable reconciliation receipt.
    if (handled.has(id) || existing.some((row) => row.id === id)) continue;
    let uncovered = [term];
    for (const row of existing.filter((row) => row.personId === term.memberId)) {
      uncovered = uncovered.flatMap((piece) => {
        if (
          (row.endDate && row.endDate <= piece.startDate) ||
          (piece.endDate && row.startDate && row.startDate >= piece.endDate)
        )
          return [piece];
        const gaps: MemberTerm[] = [];
        if (row.startDate && row.startDate > piece.startDate)
          gaps.push({ ...piece, endDate: row.startDate });
        if (row.endDate && (!piece.endDate || row.endDate < piece.endDate))
          gaps.push({ ...piece, startDate: row.endDate });
        return gaps;
      });
    }
    let skipped = false;
    const person: Person = {
      id: term.memberId,
      fullName: term.name,
      nameHistory: [],
      email: null,
      notes: '',
      customValues: {},
      createdBy: systemActor.id,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
    const inserted = await tx
      .insert(s.people)
      .values({ id: person.id, fullName: person.fullName, revision: 1, data: person })
      .onConflictDoNothing({ target: s.people.id })
      .returning({ id: s.people.id });
    if (inserted.length)
      await auditChange(tx, systemActor, {
        companyId: null,
        scopeCompanyIds: [companyId],
        entityType: 'person',
        entityId: person.id,
        action: 'person.carried_from_share_register',
        before: null,
        after: person,
        detail: { source: 'share_register', companyId },
      });
    else {
      // A legacy id may collide with someone else's record. Linking would grant this company access
      // to that person, so an id with a different name and no tie here is left for reconciliation.
      const [stored] = await tx
        .select({ fullName: s.people.fullName })
        .from(s.people)
        .where(eq(s.people.id, person.id));
      const [related] = await tx
        .select({ id: s.companyRelationships.id })
        .from(s.companyRelationships)
        .where(
          and(
            eq(s.companyRelationships.companyId, companyId),
            eq(s.companyRelationships.personId, person.id),
          ),
        )
        .limit(1);
      if (stored.fullName !== term.name && !related) {
        skipped = true;
        uncovered = [];
      }
    }
    const relationshipIds: string[] = [];
    for (const gap of uncovered) {
      const gapId = termId(companyId, gap);
      const relationship: CompanyRelationship = {
        id: gapId,
        companyId,
        personId: term.memberId,
        role: 'member',
        capacity: '',
        startDate: gap.startDate,
        endDate: gap.endDate,
        projectedFrom: null,
        evidenceIds: [],
        createdBy: systemActor.id,
        createdAt: now,
        revision: 1,
      };
      await tx.insert(s.companyRelationships).values({
        id: gapId,
        companyId,
        personId: term.memberId,
        role: 'member',
        revision: 1,
        data: relationship,
      });
      await auditChange(tx, systemActor, {
        companyId,
        entityType: 'company_relationship',
        entityId: gapId,
        action: 'relationship.carried_from_share_register',
        before: null,
        after: relationship,
      });
      existing.push(relationship);
      created.push(gapId);
      relationshipIds.push(gapId);
    }
    // Unlike request receipts, audit history is retained after later edits and request pruning.
    await auditChange(tx, systemActor, {
      companyId,
      entityType: 'company',
      entityId: companyId,
      action: 'company.share_register_term_reconciled',
      requestId: id,
      detail: {
        memberId: term.memberId,
        startDate: term.startDate,
        endDate: term.endDate,
        relationshipIds,
        ...(skipped
          ? {
              skippedReason:
                'The share register names this person differently from the existing person record.',
            }
          : {}),
      },
    });
  }
  return created;
}
