'use client';
import type { RecordFieldDefinition } from '@/domain/resolution/model';

export function CustomValueInput({
  definition,
  value,
  onChange,
}: {
  definition: RecordFieldDefinition | undefined;
  value: string;
  onChange: (value: string) => void;
}) {
  if (!definition) return null;
  if (definition.valueType === 'boolean')
    return (
      <label>
        Value
        <select required value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select…</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </label>
    );
  if (definition.valueType === 'choice')
    return (
      <label>
        Value
        <select required value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select…</option>
          {(definition.options ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <label>
      Value
      <input
        required
        type={definition.valueType === 'date' ? 'date' : 'text'}
        inputMode={definition.valueType === 'number' ? 'decimal' : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
