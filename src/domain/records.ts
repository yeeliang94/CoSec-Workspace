import { DomainError } from './access';

export type Member = {
  id: string;
  name: string;
  type: 'Individual' | 'Organisation';
  address: string;
};
export type ShareClass = { id: string; name: string; currency: string };
export type Allocation = { member: Member; units: string; certificateNumber: string };
export type CapitalProposal = {
  kind: 'opening' | 'allotment' | 'transfer';
  shareClass: ShareClass;
  allocations: Allocation[];
  sourceCertificateId: string | null;
  remainingCertificateNumber: string | null;
  issuedAmount: string;
  paidAmount: string;
  consideration: string;
  stamping: {
    disposition: 'Evidence recorded' | 'Not applicable';
    basis: string;
    evidenceId: string;
  };
  authorityEvidenceIds: string[];
};
export type CapitalEvent = CapitalProposal & {
  id: string;
  companyId: string;
  jobId: string;
  effectiveDate: string;
  recordedAt: string;
  sequence: number;
  packVersion: number;
  reviewerId: string;
  basis: string;
};
export type Certificate = {
  id: string;
  number: string;
  memberId: string;
  classId: string;
  units: string;
  issuedOn: string;
  eventId: string;
  cancelledOn: string | null;
};
export type CapitalPosition = {
  verification: 'Not established' | 'Reviewed';
  classes: (ShareClass & { units: string; issuedAmount: string; paidAmount: string })[];
  members: Member[];
  holdings: { memberId: string; classId: string; units: string }[];
  certificates: Certificate[];
};
export type CapitalReconciliation = {
  before: CapitalPosition['classes'][number] | null;
  after: CapitalPosition['classes'][number];
  sourceCertificate: Certificate | null;
  sourceMember: Member | null;
};
export type BoNotice = {
  id: string;
  recipient: string;
  sentDate: string;
  responseDue: string;
  nextChaseDate: string;
  evidenceId: string;
  ownerId: string;
  reply: null | { date: string; evidenceId: string; summary: string };
  escalation: null | { at: string; actorId: string; reason: string; evidenceId: string };
};
export type BoAssessment = {
  personId: string;
  personName: string;
  kind: 'entry' | 'review' | 'cessation';
  effectiveDate: string;
  registerEntryDate: string;
  criteria: string;
  sourceVersion: string;
  ownershipChain: string;
  evidenceIds: string[];
  nextReviewDate: string;
  predecessorId: string | null;
};
export type BoCase = {
  notices: BoNotice[];
  assessment: BoAssessment | null;
  discrepancies: {
    id: string;
    wording: string;
    evidenceId: string;
    resolution: null | { basis: string; evidenceId: string; actorId: string; at: string };
  }[];
};
export type BoEvent = BoAssessment & {
  id: string;
  companyId: string;
  jobId: string;
  recordedAt: string;
  packVersion: number;
  reviewerId: string;
  sequence: number;
};
export type CompanyRegisters = {
  revision: number;
  capitalEvents: CapitalEvent[];
  boEvents: BoEvent[];
};
export const emptyRegisters = (): CompanyRegisters => ({
  revision: 1,
  capitalEvents: [],
  boEvents: [],
});
export const emptyBoCase = (): BoCase => ({ notices: [], assessment: null, discrepancies: [] });

export function units(value: string): bigint {
  if (!/^(0|[1-9]\d{0,17})$/.test(value))
    throw new DomainError('Enter whole share units, up to 18 digits.');
  return BigInt(value);
}
export function money(value: string): bigint {
  if (!/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/.test(value))
    throw new DomainError('Enter a non-negative amount with up to two decimal places.');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export function decimal(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}
const fail = (message: string): never => {
  throw new DomainError(message);
};
const ordered = <T extends { effectiveDate: string; sequence: number }>(events: T[]) =>
  [...events].sort(
    (a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.sequence - b.sequence,
  );

/** Replay the complete dated ledger, including future events, before accepting a posting. */
export function capitalAt(events: CapitalEvent[], asAt: string): CapitalPosition {
  const classes = new Map<string, CapitalPosition['classes'][number]>();
  const members = new Map<string, Member>();
  const certificates: Certificate[] = [];
  const numbers = new Set<string>();
  for (const event of ordered(events).filter((e) => e.effectiveDate <= asAt)) {
    const proposal = event;
    let shareClass = classes.get(proposal.shareClass.id);
    if (
      shareClass &&
      (shareClass.name !== proposal.shareClass.name ||
        shareClass.currency !== proposal.shareClass.currency)
    )
      fail('A share class identity cannot change in a transaction.');
    if (!shareClass) {
      if (proposal.kind === 'transfer') fail('Select an established share class for a transfer.');
      if (
        [...classes.values()].some(
          (c) => c.name.toLowerCase() === proposal.shareClass.name.toLowerCase(),
        )
      )
        fail('A class with this name already exists.');
      shareClass = { ...proposal.shareClass, units: '0', issuedAmount: '0.00', paidAmount: '0.00' };
      classes.set(shareClass.id, shareClass);
    } else if (proposal.kind === 'opening') fail('Opening balances already exist for this class.');
    if (!proposal.allocations.length) fail('Record at least one allocation.');
    let total = 0n;
    const issue = (memberId: string, count: bigint, number: string, suffix: string) => {
      const normalized = number.trim().toUpperCase();
      if (!normalized || numbers.has(normalized))
        fail(
          'Certificate numbers must be unique across this company, including cancelled certificates.',
        );
      numbers.add(normalized);
      certificates.push({
        id: `${event.id}:${suffix}`,
        number: number.trim(),
        memberId,
        classId: proposal.shareClass.id,
        units: count.toString(),
        issuedOn: event.effectiveDate,
        eventId: event.id,
        cancelledOn: null,
      });
    };
    let source: Certificate | undefined;
    if (proposal.kind === 'transfer') {
      if (proposal.allocations.length !== 1) fail('A transfer requires one recipient allocation.');
      source =
        certificates.find(
          (c) =>
            c.id === proposal.sourceCertificateId &&
            !c.cancelledOn &&
            c.classId === proposal.shareClass.id,
        ) ?? fail('Select an active source certificate for this class on the effective date.');
      if (source.memberId === proposal.allocations[0].member.id)
        fail('Transferor and transferee must differ.');
      if (money(proposal.issuedAmount) !== 0n || money(proposal.paidAmount) !== 0n)
        fail('A transfer cannot change issued or paid-up capital.');
    }
    for (const [index, allocation] of proposal.allocations.entries()) {
      const count = units(allocation.units);
      if (count <= 0n) fail('Each allocation must have positive share units.');
      const existing = members.get(allocation.member.id);
      if (
        existing &&
        (existing.name !== allocation.member.name ||
          existing.type !== allocation.member.type ||
          existing.address !== allocation.member.address)
      )
        fail('Existing member particulars must remain unchanged; use a reviewed correction route.');
      members.set(allocation.member.id, allocation.member);
      total += count;
      issue(allocation.member.id, count, allocation.certificateNumber, String(index));
    }
    if (source) {
      if (total > units(source.units))
        fail('The transfer exceeds units on the source certificate.');
      source.cancelledOn = event.effectiveDate;
      const remaining = units(source.units) - total;
      if (remaining > 0n) {
        const remainingNumber =
          proposal.remainingCertificateNumber ??
          fail('Record a replacement certificate for the transferor balance.');
        issue(source.memberId, remaining, remainingNumber, 'balance');
      } else if (proposal.remainingCertificateNumber)
        fail('No transferor balance remains for a replacement certificate.');
    } else {
      const issued = money(proposal.issuedAmount),
        paid = money(proposal.paidAmount);
      if (paid > issued) fail('Paid-up amount cannot exceed the recorded issued amount.');
      shareClass.units = (units(shareClass.units) + total).toString();
      shareClass.issuedAmount = decimal(money(shareClass.issuedAmount) + issued);
      shareClass.paidAmount = decimal(money(shareClass.paidAmount) + paid);
      money(shareClass.issuedAmount);
      money(shareClass.paidAmount);
    }
    money(proposal.consideration);
  }
  const holdings = new Map<string, CapitalPosition['holdings'][number]>();
  for (const certificate of certificates.filter((c) => !c.cancelledOn)) {
    const key = `${certificate.memberId}:${certificate.classId}`;
    const holding = holdings.get(key) ?? {
      memberId: certificate.memberId,
      classId: certificate.classId,
      units: '0',
    };
    holding.units = (units(holding.units) + units(certificate.units)).toString();
    holdings.set(key, holding);
  }
  for (const shareClass of classes.values()) {
    const sum = [...holdings.values()]
      .filter((h) => h.classId === shareClass.id)
      .reduce((n, h) => n + units(h.units), 0n);
    if (sum !== units(shareClass.units))
      fail('Member holdings do not reconcile with issued class units.');
  }
  return {
    verification: events.some((e) => e.effectiveDate <= asAt) ? 'Reviewed' : 'Not established',
    classes: [...classes.values()],
    members: [...members.values()],
    holdings: [...holdings.values()],
    certificates,
  };
}
export function beneficialOwnersAt(events: BoEvent[], asAt: string): BoEvent[] {
  const current = new Map<string, BoEvent>();
  for (const event of ordered(events).filter((e) => e.effectiveDate <= asAt)) {
    const previous = current.get(event.personId);
    if (event.kind === 'entry') {
      if (previous)
        fail('This person already has an active BO entry; a linked correction route is required.');
      current.set(event.personId, event);
    } else {
      if (
        !previous ||
        event.predecessorId !== previous.id ||
        event.personName !== previous.personName
      )
        fail('Select the current BO entry before recording cessation.');
      if (event.kind === 'review') current.set(event.personId, event);
      else current.delete(event.personId);
    }
  }
  return [...current.values()];
}
export function boBlockers(record: BoCase | undefined, date: string): string[] {
  if (!record) return ['Prepare the sourced BO assessment.'];
  const result: string[] = [];
  if (!record.assessment) result.push('Prepare the sourced BO assessment.');
  if (!record.notices.length) result.push('Record the evidenced information notice.');
  for (const notice of record.notices.filter((n) => !n.reply))
    result.push(
      `${notice.recipient}: reply evidence outstanding${notice.responseDue < date ? '; response overdue' : ''}${notice.escalation ? '; escalation recorded' : ''}.`,
    );
  if (record.discrepancies.some((d) => !d.resolution))
    result.push('Resolve the evidenced BO discrepancies.');
  return result;
}

export type CapitalRegister = {
  revision: number;
  asAt: string;
  position: CapitalPosition;
  events: CapitalEvent[];
};
export type BoRegister = { revision: number; asAt: string; owners: BoEvent[]; events: BoEvent[] };
