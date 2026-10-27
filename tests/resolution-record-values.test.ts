import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { appendCustomValue } from '../src/server/records/custom-fields';
import type { Transaction } from '../src/server/db';
import type { Actor } from '../src/domain/model';
import type { RecordFieldDefinition } from '../src/domain/resolution/model';
import { defaultPreferences } from '../src/domain/model';
import { date } from '../src/server/records/inputs';

describe('record custom values', () => {
  it('returns validation issues for impossible dates at the records request boundary', () => {
    for (const value of ['2026-13-01', '2026-00-00', '2026-02-30'])
      expect(date.safeParse(value).success).toBe(false);
  });
  it('stores and appends values whose accepted identifier is an inherited property name', async () => {
    const actor: Actor = {
      id: 'test',
      name: 'Test',
      email: 'test@example.invalid',
      companyIds: [],
      capabilities: [],
      preferences: defaultPreferences,
    };
    const definition: RecordFieldDefinition = {
      id: 'constructor',
      scope: 'company',
      label: 'Constructor',
      valueType: 'text',
      version: 1,
      revision: 1,
      archived: false,
      createdBy: actor.id,
      createdAt: new Date().toISOString(),
    };
    // Only the database lookup is stubbed; the real append/validation path handles both writes.
    const tx = {
      select: () => ({ from: () => ({ where: async () => [{ data: definition }] }) }),
    } as unknown as Transaction;
    const input = {
      definitionId: definition.id,
      value: 'First',
      effectiveDate: '2026-10-27',
      reason: 'Fictional test',
    };
    const first = await appendCustomValue(actor, {}, input, 'company', tx);
    const second = await appendCustomValue(
      actor,
      first,
      { ...input, value: 'Second' },
      'company',
      tx,
    );
    expect(Object.hasOwn(second, definition.id)).toBe(true);
    expect(second[definition.id].map((entry) => entry.value)).toEqual(['First', 'Second']);
  });
});
