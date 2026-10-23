import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  capitalAt,
  beneficialOwnersAt,
  boBlockers,
  decimal,
  money,
  units,
  type CapitalEvent,
  type BoEvent,
} from '../src/domain/records';
const shareClass = { id: randomUUID(), name: 'Ordinary', currency: 'MYR' };
const alice = {
  id: randomUUID(),
  name: 'Fictional Alice',
  type: 'Individual' as const,
  address: 'Fictional address',
};
const bob = {
  id: randomUUID(),
  name: 'Fictional Bob',
  type: 'Individual' as const,
  address: 'Fictional address',
};
const opening: CapitalEvent = {
  id: randomUUID(),
  companyId: randomUUID(),
  jobId: randomUUID(),
  shareClass,
  kind: 'opening',
  allocations: [{ member: alice, units: '100', certificateNumber: 'C001' }],
  sourceCertificateId: null,
  remainingCertificateNumber: null,
  issuedAmount: '1250.25',
  paidAmount: '1000.10',
  consideration: '0',
  stamping: {
    disposition: 'Not applicable',
    basis: 'Fictional source reviewed',
    evidenceId: randomUUID(),
  },
  authorityEvidenceIds: [randomUUID()],
  effectiveDate: '2025-01-01',
  recordedAt: '2026-10-22T00:00:00Z',
  sequence: 1,
  packVersion: 3,
  reviewerId: randomUUID(),
  basis: 'Fictional opening reconciliation',
};
const transfer = (patch: Partial<CapitalEvent> = {}): CapitalEvent => ({
  ...structuredClone(opening),
  id: randomUUID(),
  sequence: 2,
  kind: 'transfer',
  allocations: [{ member: bob, units: '40', certificateNumber: 'C002' }],
  sourceCertificateId: opening.id + ':0',
  remainingCertificateNumber: 'C003',
  issuedAmount: '0',
  paidAmount: '0',
  effectiveDate: '2026-01-01',
  ...patch,
});
describe('dated capital ledger', () => {
  it('keeps unknown opening positions distinct from zero and future records', () => {
    expect(capitalAt([], '2026-10-22').verification).toBe('Not established');
    expect(capitalAt([opening], '2024-12-31').classes).toEqual([]);
    expect(capitalAt([opening], '2025-01-01').classes[0].units).toBe('100');
  });
  it('conserves units/capital on partial transfers and retains cancelled certificates', () => {
    const result = capitalAt([opening, transfer()], '2026-10-22');
    expect(result.classes[0]).toMatchObject({
      units: '100',
      issuedAmount: '1250.25',
      paidAmount: '1000.10',
    });
    expect(result.holdings.map((h) => h.units).sort()).toEqual(['40', '60']);
    expect(result.certificates.find((c) => c.number === 'C001')?.cancelledOn).toBe('2026-01-01');
    expect(capitalAt([opening, transfer()], '2025-12-31').holdings).toHaveLength(1);
  });
  it('increases issued units and exact capital on allotment', () => {
    const allotment: CapitalEvent = {
      ...transfer(),
      kind: 'allotment',
      sourceCertificateId: null,
      remainingCertificateNumber: null,
      issuedAmount: '25.05',
      paidAmount: '20.01',
    };
    expect(capitalAt([opening, allotment], '2026-10-22').classes[0]).toMatchObject({
      units: '140',
      issuedAmount: '1275.30',
      paidAmount: '1020.11',
    });
    expect(units('9007199254740993')).toBe(9007199254740993n);
    expect(decimal(money('90071992547409.93'))).toBe('90071992547409.93');
  });
  it('prevents overdraw, duplicate numbers including cancelled certificates, and capital changes on transfers', () => {
    expect(() =>
      capitalAt(
        [
          opening,
          transfer({ allocations: [{ member: bob, units: '101', certificateNumber: 'C002' }] }),
        ],
        '9999-12-31',
      ),
    ).toThrow('exceeds');
    expect(() =>
      capitalAt(
        [
          opening,
          transfer({ allocations: [{ member: bob, units: '40', certificateNumber: 'c001' }] }),
        ],
        '9999-12-31',
      ),
    ).toThrow('unique');
    expect(() => capitalAt([opening, transfer({ issuedAmount: '1' })], '9999-12-31')).toThrow(
      'cannot change',
    );
    expect(() =>
      capitalAt([opening, transfer({ remainingCertificateNumber: null })], '9999-12-31'),
    ).toThrow('replacement');
  });
  it('replays future transactions so backdated discoveries cannot invalidate scheduled holdings', () => {
    const future = transfer({ effectiveDate: '2027-01-01' });
    expect(capitalAt([opening, future], '2026-10-22').holdings[0].units).toBe('100');
    const backdated = transfer({
      sequence: 3,
      effectiveDate: '2026-10-01',
      allocations: [{ member: bob, units: '80', certificateNumber: 'B001' }],
      remainingCertificateNumber: 'B002',
    });
    expect(() => capitalAt([opening, future, backdated], '9999-12-31')).toThrow(
      'active source certificate',
    );
  });
  it('keeps class and member identities immutable and requires opening class reconciliation', () => {
    expect(() =>
      capitalAt(
        [opening, transfer({ shareClass: { ...shareClass, name: 'Changed' } })],
        '9999-12-31',
      ),
    ).toThrow('identity');
    expect(capitalAt([{ ...opening, kind: 'allotment' }], '9999-12-31').classes[0].units).toBe(
      '100',
    );
    expect(() => capitalAt([transfer()], '9999-12-31')).toThrow('established share class');
    expect(() => capitalAt([{ ...opening, paidAmount: '1251' }], '9999-12-31')).toThrow('Paid-up');
    expect(() =>
      capitalAt(
        [
          opening,
          {
            ...opening,
            id: randomUUID(),
            sequence: 2,
            kind: 'allotment',
            allocations: [
              { member: { ...alice, name: 'Changed' }, units: '2', certificateNumber: 'A2' },
            ],
          },
        ],
        '9999-12-31',
      ),
    ).toThrow('particulars');
    expect(() => units('1.5')).toThrow('whole');
  });
});
it('BO history separates effective/entry dates and requires the exact cessation predecessor', () => {
  const entry: BoEvent = {
    id: randomUUID(),
    companyId: randomUUID(),
    jobId: randomUUID(),
    personId: randomUUID(),
    personName: 'Fictional owner',
    kind: 'entry',
    effectiveDate: '2026-01-01',
    registerEntryDate: '2026-02-01',
    criteria: 'Fictional assessed criteria',
    sourceVersion: 'Fictional source v1',
    ownershipChain: 'Fictional chain',
    evidenceIds: [randomUUID()],
    nextReviewDate: '2027-01-01',
    predecessorId: null,
    recordedAt: '2026-02-01T00:00:00Z',
    packVersion: 1,
    reviewerId: randomUUID(),
    sequence: 1,
  };
  const cessation: BoEvent = {
    ...entry,
    id: randomUUID(),
    kind: 'cessation',
    effectiveDate: '2027-01-01',
    sequence: 2,
    predecessorId: entry.id,
  };
  expect(beneficialOwnersAt([entry, cessation], '2026-10-22')).toHaveLength(1);
  expect(beneficialOwnersAt([entry, cessation], '2027-01-01')).toHaveLength(0);
  expect(() =>
    beneficialOwnersAt([entry, { ...cessation, predecessorId: 'wrong' }], '9999-12-31'),
  ).toThrow('current BO');
});
it('nonresponse stays unresolved after escalation and is never inferred from member holdings', () => {
  const missing = boBlockers(
    {
      assessment: null,
      notices: [
        {
          id: 'n',
          recipient: 'Fictional recipient',
          sentDate: '2026-01-01',
          responseDue: '2026-01-10',
          nextChaseDate: '2026-01-05',
          evidenceId: 'e',
          ownerId: 'o',
          reply: null,
          escalation: { at: '2026-02-01', actorId: 'r', reason: 'Escalated', evidenceId: 'e' },
        },
      ],
      discrepancies: [],
    },
    '2026-10-22',
  );
  expect(missing.some((m) => m.includes('overdue') && m.includes('escalation recorded'))).toBe(
    true,
  );
  expect(missing).toContain('Prepare the sourced BO assessment.');
});
