'use client';
import type { FieldDefinition, Predicate } from '@/domain/resolution/model';

type Simple = Exclude<Predicate, { op: 'and' | 'or' }>;
const OPS: { value: Simple['op']; label: string; types?: string[] }[] = [
  { value: 'isTrue', label: 'is ticked', types: ['boolean'] },
  { value: 'isFalse', label: 'is not ticked', types: ['boolean'] },
  { value: 'equals', label: 'is', types: ['choice', 'text', 'number', 'date'] },
  { value: 'notEquals', label: 'is not', types: ['choice', 'text', 'number', 'date'] },
  { value: 'includes', label: 'includes', types: ['multiChoice'] },
  { value: 'isNotEmpty', label: 'has a value' },
  { value: 'isEmpty', label: 'is empty' },
];

function opsFor(field: FieldDefinition | undefined) {
  return OPS.filter((op) => !op.types || !field || op.types.includes(field.valueType));
}
function defaultRule(fields: FieldDefinition[]): Simple {
  const field = fields.find((item) => item.valueType === 'boolean') || fields[0];
  const op = opsFor(field)[0]?.value || 'isNotEmpty';
  return op === 'equals' || op === 'notEquals' || op === 'includes'
    ? { op, fieldId: field?.id || '', value: field?.options?.[0]?.id || '' }
    : { op, fieldId: field?.id || '' };
}

/** Editable rule for a condition block: one rule, or several joined by all/any. */
export function PredicateEditor({
  value,
  fields,
  onChange,
  idPrefix,
}: {
  value: Predicate | null;
  fields: FieldDefinition[];
  onChange: (value: Predicate) => void;
  idPrefix: string;
}) {
  const rules: Simple[] = !value
    ? []
    : value.op === 'and' || value.op === 'or'
      ? (value.all.filter((rule) => rule.op !== 'and' && rule.op !== 'or') as Simple[])
      : [value as Simple];
  const join: 'and' | 'or' = value?.op === 'or' ? 'or' : 'and';
  const emit = (next: Simple[], nextJoin = join) => {
    if (next.length === 1) onChange(next[0]);
    else if (next.length) onChange({ op: nextJoin, all: next });
  };
  const update = (index: number, rule: Simple) =>
    emit(rules.map((item, i) => (i === index ? rule : item)));
  const nested =
    value && (value.op === 'and' || value.op === 'or') && value.all.length !== rules.length;
  if (!fields.length) return <p>Create a field to set a condition.</p>;
  return (
    <div className="predicate-editor">
      {nested ? (
        <p className="warning">
          This rule has nested groups that cannot be edited here. Changing it replaces the groups.
        </p>
      ) : null}
      {rules.length > 1 ? (
        <label>
          Include when
          <select
            value={join}
            onChange={(event) => emit(rules, event.target.value as 'and' | 'or')}
          >
            <option value="and">All rules match</option>
            <option value="or">Any rule matches</option>
          </select>
        </label>
      ) : null}
      {rules.map((rule, index) => {
        const field = fields.find((item) => item.id === rule.fieldId);
        const ops = opsFor(field);
        const needsValue =
          rule.op === 'equals' || rule.op === 'notEquals' || rule.op === 'includes';
        const prefix = `${idPrefix}-rule-${index}`;
        return (
          <fieldset key={index} className="predicate-rule">
            <legend className={rules.length === 1 ? 'sr-only' : undefined}>Rule {index + 1}</legend>
            <label htmlFor={prefix + '-field'}>
              Field
              <select
                id={prefix + '-field'}
                value={rule.fieldId}
                onChange={(event) => {
                  const nextField = fields.find((item) => item.id === event.target.value);
                  const op = opsFor(nextField).some((item) => item.value === rule.op)
                    ? rule.op
                    : opsFor(nextField)[0].value;
                  update(
                    index,
                    op === 'equals' || op === 'notEquals' || op === 'includes'
                      ? {
                          op,
                          fieldId: event.target.value,
                          value: nextField?.options?.[0]?.id || '',
                        }
                      : { op, fieldId: event.target.value },
                  );
                }}
              >
                <option value="">Choose a field…</option>
                {fields.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor={prefix + '-op'}>
              Test
              <select
                id={prefix + '-op'}
                value={rule.op}
                onChange={(event) => {
                  const op = event.target.value as Simple['op'];
                  update(
                    index,
                    op === 'equals' || op === 'notEquals' || op === 'includes'
                      ? {
                          op,
                          fieldId: rule.fieldId,
                          value: 'value' in rule ? rule.value : field?.options?.[0]?.id || '',
                        }
                      : { op, fieldId: rule.fieldId },
                  );
                }}
              >
                {ops.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
            </label>
            {needsValue ? (
              <label htmlFor={prefix + '-value'}>
                Value
                {field?.options?.length ? (
                  <select
                    id={prefix + '-value'}
                    value={'value' in rule ? rule.value : ''}
                    onChange={(event) =>
                      update(index, { ...rule, value: event.target.value } as Simple)
                    }
                  >
                    {field.options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={prefix + '-value'}
                    value={'value' in rule ? rule.value : ''}
                    onChange={(event) =>
                      update(index, { ...rule, value: event.target.value } as Simple)
                    }
                  />
                )}
              </label>
            ) : null}
            {rules.length > 1 ? (
              <button
                type="button"
                className="text-button danger"
                onClick={() => emit(rules.filter((_, i) => i !== index))}
              >
                Remove rule {index + 1}
              </button>
            ) : null}
          </fieldset>
        );
      })}
      <button type="button" onClick={() => emit([...rules, defaultRule(fields)])}>
        {rules.length ? 'Add another rule' : 'Set rule'}
      </button>
    </div>
  );
}
