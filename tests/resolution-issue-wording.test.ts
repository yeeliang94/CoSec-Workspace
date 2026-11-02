import { describe, expect, it } from 'vitest';
import { issueFields, plainIssue, type IssueField } from '../src/components/resolution/api';

const missing = (label: string, fieldId: string, unit: string) => ({
  message: `No value is recorded for ${label}. Complete the source record.`,
  location: `clause "Paragraph" › field "${label}"`,
  severity: 'error' as const,
  fieldId,
  unit,
});
const bound = (id: string, label: string, path: string): IssueField => ({
  id,
  label,
  source: { kind: 'binding', path },
});

describe('plainIssue', () => {
  it('names the question from the paragraph the issue belongs to', () => {
    const fields: IssueField[] = [
      { id: 'date', label: 'Appointment date', valueType: 'date', unit: 'first' },
      { id: 'date', label: 'Appointee', valueType: 'recordReference', unit: 'second' },
    ];
    const issue = {
      message: 'Answer this question.',
      location: '',
      severity: 'error' as const,
      fieldId: 'date',
    };
    expect(plainIssue({ ...issue, unit: 'second' }, fields)).toBe('Appointee: choose a person');
    expect(plainIssue({ ...issue, unit: 'first' }, fields)).toBe('Appointment date: enter a date');
  });

  it('sends a missing value to where it is actually entered', () => {
    const say = (path: string) =>
      plainIssue(missing('Value', 'value', 'case'), [bound('value', 'Value', path)]);
    expect(say('case.resolutionDate')).toBe('Value: add it in step 1, Details');
    expect(say('company.address')).toBe('Value: not recorded on the company file yet');
    expect(say('case.custom.reference')).toBe('Value: no value recorded yet');
    expect(say('firm.name')).toBe('Value: no value recorded yet');
  });

  it('stays neutral when the field source is unavailable', () => {
    expect(plainIssue(missing('Value', 'value', 'case'))).toBe('Value: no value recorded yet');
  });
});

describe('issueFields', () => {
  it('tags shared and paragraph fields with their unit', () => {
    const field = { id: 'date', label: 'Date' };
    const fields = issueFields({
      shared: [field],
      clauses: [{ key: 'second', clauseName: 'Second', fields: [field] }],
    } as unknown as Parameters<typeof issueFields>[0]);
    expect(fields.map((f) => f.unit)).toEqual(['case', 'second']);
  });
});
