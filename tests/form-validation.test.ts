import { describe, expect, it } from 'vitest';
import { requiredChoiceError } from '../src/components/form-validation';

const evidence = { name: 'evidenceIds', label: 'Evidence', type: 'multi', required: true };

describe('required evidence choices', () => {
  it('rejects a missing selection, including when there are no available documents', () => {
    expect(requiredChoiceError([evidence], new FormData())).toBe(
      'Choose at least one item for “Evidence”.',
    );
  });

  it('rejects empty placeholder values', () => {
    const values = new FormData();
    values.append('evidenceIds', '');
    expect(requiredChoiceError([evidence], values)).not.toBe('');
  });

  it('accepts any selected item without requiring all documents', () => {
    const values = new FormData();
    values.append('evidenceIds', 'document-2');
    expect(requiredChoiceError([evidence], values)).toBe('');
  });

  it('validates each required group independently and ignores optional groups', () => {
    const values = new FormData();
    values.append('evidenceIds', 'document-1');
    expect(
      requiredChoiceError(
        [evidence, { ...evidence, name: 'documentIds', label: 'Exact submitted documents' }],
        values,
      ),
    ).toContain('Exact submitted documents');
    expect(requiredChoiceError([{ ...evidence, required: false }], new FormData())).toBe('');
  });
});
