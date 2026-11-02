import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { closeDatabase, transaction, writerDb } from '../src/server/db';
import * as s from '../src/server/schema';
import { carryRegisterMembers, memberTerms } from '../src/server/records/register-members';
import { lockCompany } from '../src/server/records/scope';
import { loadResolutionContext } from '../src/server/records/context';
import { createCase } from '../src/server/records/cases';
import { defaultPreferences, ROLE_CAPABILITIES, type Actor } from '../src/domain/model';

const ann = { id: randomUUID(), name: 'Ann Holder (fictional)' };
const ben = { id: randomUUID(), name: 'Ben Buyer (fictional)' };
const cat = { id: randomUUID(), name: 'Cat Later (fictional)' };
const event = (
  id: string,
  kind: 'opening' | 'allotment' | 'transfer',
  effectiveDate: string,
  sequence: number,
  allocations: { member: { id: string; name: string }; units: string }[],
  sourceCertificateId: string | null = null,
) => ({ id, kind, effectiveDate, sequence, allocations, sourceCertificateId });
// Ann opens with 100; transfers 40 to Ben (keeps 60); later transfers her 60 balance to Ben.
// Cat is allotted shares in the future.
const events = [
  event('e1', 'opening', '2025-01-01', 1, [{ member: ann, units: '100' }]),
  event('e2', 'transfer', '2025-06-01', 2, [{ member: ben, units: '40' }], 'e1:0'),
  event('e3', 'transfer', '2026-02-01', 3, [{ member: ben, units: '60' }], 'e2:balance'),
  event('e4', 'allotment', '2099-01-01', 4, [{ member: cat, units: '10' }]),
];

describe('memberTerms', () => {
  it('follows transfers and balances to each holding term', () => {
    expect(memberTerms(events)).toEqual([
      { memberId: ann.id, name: ann.name, startDate: '2025-01-01', endDate: '2026-02-01' },
      { memberId: ben.id, name: ben.name, startDate: '2025-06-01', endDate: null },
      { memberId: cat.id, name: cat.name, startDate: '2099-01-01', endDate: null },
    ]);
  });
  it('treats an empty register as no members', () => {
    expect(memberTerms([])).toEqual([]);
  });
});

describe('carrying the retired share register into members', () => {
  const companyId = randomUUID();
  const actor: Actor = {
    id: randomUUID(),
    name: 'Register carry (test)',
    email: `carry-${companyId}@example.invalid`,
    capabilities: ROLE_CAPABILITIES.user,
    companyIds: [companyId],
    preferences: defaultPreferences,
  };
  afterAll(() => closeDatabase());

  it('records holders as dated members once, and resolutions list them by date', async () => {
    await writerDb.insert(s.user).values({
      id: actor.id,
      name: actor.name,
      email: actor.email,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      capabilities: actor.capabilities,
      companyIds: actor.companyIds,
      preferences: actor.preferences,
      active: true,
    });
    await writerDb.insert(s.companies).values({
      id: companyId,
      data: {
        id: companyId,
        name: 'Register carry Sdn. Bhd. (fictional)',
        registrationNumber: `RC-${companyId}`,
        incorporationDate: '2024-01-01',
        financialYearEnd: '12-31',
        legalStatus: 'Existing',
        engagementStatus: 'Active',
        address: 'Fictional',
        activity: '',
        verification: 'Unverified',
        sourceEvidenceId: null,
        revision: 1,
      },
    });
    await writerDb.insert(s.companyRegisters).values({
      companyId,
      revision: 2,
      data: { revision: 2, capitalEvents: events, boEvents: [] },
    });
    const carry = () =>
      transaction(async (tx) => {
        await lockCompany(companyId, tx);
        return carryRegisterMembers(companyId, tx);
      });
    expect(await carry()).toHaveLength(3);
    expect(await carry()).toEqual([]);
    const rows = await writerDb
      .select()
      .from(s.companyRelationships)
      .where(eq(s.companyRelationships.companyId, companyId));
    expect(rows.map((r) => r.role)).toEqual(['member', 'member', 'member']);

    const rc = await createCase(actor, {
      requestId: randomUUID(),
      companyId,
      kind: 'board',
      title: 'Members by date',
    });
    const names = async (asAt: string) =>
      (await loadResolutionContext(actor, rc.id, asAt)).members.map((m) => m.name);
    expect(await names('2024-12-31')).toEqual([]);
    expect(await names('2025-07-01')).toEqual([ann.name, ben.name]);
    expect(await names('2026-03-01')).toEqual([ben.name]);
  });
  it('reuses existing terms, imports only uncovered dates, and respects later edits on restart', async () => {
    const id = randomUUID();
    await writerDb.insert(s.companies).values({
      id,
      data: {
        id,
        name: 'Existing members (fictional)',
        registrationNumber: id,
        incorporationDate: '2024-01-01',
        financialYearEnd: '12-31',
        legalStatus: 'Existing',
        engagementStatus: 'Active',
        address: 'Fictional',
        activity: '',
        verification: 'Unverified',
        sourceEvidenceId: null,
        revision: 1,
      },
    });
    const now = new Date().toISOString();
    const existingId = randomUUID();
    // Ben already exists from the first test; his recorded membership covers part of the ledger.
    await writerDb.insert(s.companyRelationships).values({
      id: existingId,
      companyId: id,
      personId: ben.id,
      role: 'member',
      revision: 1,
      data: {
        id: existingId,
        companyId: id,
        personId: ben.id,
        role: 'member',
        capacity: 'Recorded capacity',
        startDate: '2025-06-01',
        endDate: '2026-01-01',
        projectedFrom: null,
        evidenceIds: [],
        createdBy: actor.id,
        createdAt: now,
        revision: 1,
      },
    });
    await writerDb.insert(s.companyRegisters).values({
      companyId: id,
      revision: 1,
      data: {
        capitalEvents: [
          event('existing-opening', 'opening', '2025-06-01', 1, [{ member: ben, units: '100' }]),
        ],
      },
    });
    const carry = () =>
      transaction(async (tx) => {
        await lockCompany(id, tx);
        return carryRegisterMembers(id, tx);
      });
    const added = await carry();
    const rows = await writerDb
      .select()
      .from(s.companyRelationships)
      .where(eq(s.companyRelationships.companyId, id));
    expect(rows.map((row) => [row.data.startDate, row.data.endDate]).sort()).toEqual([
      ['2025-06-01', '2026-01-01'],
      ['2026-01-01', null],
    ]);
    expect(added).toHaveLength(1);
    const imported = rows.find((row) => row.id !== existingId)!;
    await writerDb
      .update(s.companyRelationships)
      .set({ data: { ...imported.data, endDate: '2026-03-01' }, revision: 2 })
      .where(eq(s.companyRelationships.id, imported.id));
    expect(await carry()).toEqual([]);
    expect(
      (
        await writerDb
          .select()
          .from(s.companyRelationships)
          .where(eq(s.companyRelationships.companyId, id))
      ).length,
    ).toBe(2);
    expect(rows.find((row) => row.id === existingId)!.data.capacity).toBe('Recorded capacity');
  });
});
