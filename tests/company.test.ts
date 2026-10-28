import { describe, expect, it } from 'vitest';
import { formatYearEnd, isYearEnd, nextYearEnd, yearEndMonthDay } from '../src/domain/company';
import { caseStatus } from '../src/domain/resolution/cases';
import type { ResolutionCase } from '../src/domain/resolution/model';

describe('financial year end', () => {
  it('keeps only the day and month, including from older full dates', () => {
    expect(yearEndMonthDay('2026-12-31')).toBe('12-31');
    expect(yearEndMonthDay('06-30')).toBe('06-30');
    expect(formatYearEnd('2026-12-31')).toBe('31 December');
    expect(formatYearEnd('06-30')).toBe('30 June');
  });

  it('rejects days a month never has', () => {
    expect(isYearEnd('02-29')).toBe(true);
    expect(isYearEnd('02-30')).toBe(false);
    expect(isYearEnd('04-31')).toBe(false);
    expect(isYearEnd('13-01')).toBe(false);
  });

  it('rolls over to the next year end on its own', () => {
    expect(nextYearEnd('06-30', '2026-03-01')).toBe('2026-06-30');
    expect(nextYearEnd('06-30', '2026-06-30')).toBe('2026-06-30');
    expect(nextYearEnd('06-30', '2026-07-01')).toBe('2027-06-30');
    expect(nextYearEnd('2020-12-31', '2027-01-05')).toBe('2027-12-31');
    expect(nextYearEnd('02-29', '2027-01-01')).toBe('2027-02-28');
    expect(nextYearEnd('02-29', '2028-01-01')).toBe('2028-02-29');
  });
});

describe('resolution status', () => {
  const name = (id: string) => ({ r: 'Daniel' })[id] ?? id;
  const base = { state: 'Open', review: null } as unknown as ResolutionCase;
  const review = (status: 'With reviewer' | 'Returned' | 'Approved') =>
    ({
      ...base,
      review: { status, reviewerId: 'r', sentBy: 'p', sentAt: '', decidedAt: null, comment: '' },
    }) as ResolutionCase;

  it('reads as plain words', () => {
    expect(caseStatus(base, name)).toBe('Draft');
    expect(caseStatus(review('With reviewer'), name)).toBe('With Daniel for review');
    expect(caseStatus(review('Returned'), name)).toBe('Returned by Daniel');
    expect(caseStatus(review('Approved'), name)).toBe('Approved by Daniel');
    expect(caseStatus({ ...base, state: 'Complete' }, name)).toBe('Complete');
  });
});
