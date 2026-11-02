import { describe, expect, it } from 'vitest';
import { NEW_PERSON, resolvePick } from '../src/components/person-field';
import { carryOver, refreshCopiedDate } from '../src/components/resolution/case-questions';
import type { FormModel } from '../src/domain/resolution/form';
import type { Person } from '../src/domain/resolution/model';

const person = (id: string, fullName: string): Person => ({
  id,
  fullName,
  nameHistory: [],
  email: null,
  notes: '',
  customValues: {},
  createdBy: 'u',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  revision: 1,
});
const people = [person('a', 'Tan Wei'), person('b', 'Tan Wei'), person('c', 'Siti Aminah')];

describe('choosing a person by name', () => {
  it('creates a new person for an unknown name', () => {
    expect(resolvePick(people, { name: ' Lee Mei ', choice: '' })).toEqual({ fullName: 'Lee Mei' });
  });
  it('needs a choice when the name matches existing people', () => {
    expect(() => resolvePick(people, { name: 'tan wei', choice: '' })).toThrow('Choose which');
    expect(() => resolvePick(people, { name: 'Siti Aminah', choice: '' })).toThrow('Choose which');
  });
  it('uses the chosen namesake or a new person', () => {
    expect(resolvePick(people, { name: 'Tan Wei', choice: 'b' })).toEqual({ personId: 'b' });
    expect(resolvePick(people, { name: 'Tan Wei', choice: NEW_PERSON })).toEqual({
      fullName: 'Tan Wei',
    });
  });
});

describe('keeping unsaved answers when the wording changes', () => {
  it('keeps answers to questions still asked and drops the rest', () => {
    const draft = {
      shared: { date: '2026-02-01', gone: 'x' },
      clauses: { k1: { name: 'Typed' }, k2: { amount: '5' } },
      signers: { directors: ['p1'], members: [], certifiers: [] },
    };
    const fresh = {
      shared: { date: null, added: null },
      clauses: { k1: { name: 'Saved', extra: null }, k3: { amount: null } },
      signers: { directors: [], members: [], certifiers: [] },
    };
    expect(carryOver(fresh, draft)).toEqual({
      shared: { date: '2026-02-01', added: null },
      clauses: { k1: { name: 'Typed', extra: null }, k3: { amount: null } },
      signers: draft.signers,
    });
  });
});

describe('date copied from step 1', () => {
  const date = { id: 'resolution_date', label: 'Resolution date', valueType: 'date', value: null };
  const form = { shared: [date], clauses: [] } as unknown as FormModel;
  const signers = { directors: [], members: [], certifiers: [] };
  const draft = (value: string | null) => ({
    shared: { resolution_date: value },
    clauses: {},
    signers,
  });

  it('follows a changed date while the answer is untouched', () => {
    const next = refreshCopiedDate(draft('2026-01-01'), form, '2026-01-01', '2026-02-01');
    expect(next.draft.shared.resolution_date).toBe('2026-02-01');
    expect(next.prefilled).toBe(true);
  });

  it('fills a blank answer when the date is first set', () => {
    const next = refreshCopiedDate(draft(null), form, null, '2026-02-01');
    expect(next.draft.shared.resolution_date).toBe('2026-02-01');
  });

  it('keeps an answer someone typed', () => {
    const next = refreshCopiedDate(draft('2026-03-03'), form, '2026-01-01', '2026-02-01');
    expect(next.draft.shared.resolution_date).toBe('2026-03-03');
    expect(next.prefilled).toBe(false);
  });
});
