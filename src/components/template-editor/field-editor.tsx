'use client';
import { useRef, useState } from 'react';
import type {
  FieldDefinition,
  FieldSource,
  RecordContext,
  RecordFieldDefinition,
  RecordProperty,
  ValueType,
} from '@/domain/resolution/model';
import { BINDINGS } from '@/domain/resolution/bindings';
import { isRecord, optionId, RECORD_CONTEXTS, sourceSummary, VALUE_TYPES } from './fields';
import { PROPERTY_LABELS } from './nodes';

export function FieldEditor({
  field,
  fields,
  usages,
  readOnly,
  customDefinitions,
  onChange,
  onDelete,
}: {
  field: FieldDefinition;
  fields: FieldDefinition[];
  usages: string[];
  readOnly: boolean;
  customDefinitions: RecordFieldDefinition[];
  onChange: (change: (field: FieldDefinition) => FieldDefinition) => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const optionCounter = useRef(field.options?.length ?? 0);
  const set = (patch: Partial<FieldDefinition>) =>
    onChange((current) => clean({ ...current, ...patch }));
  const source = field.source;
  const others = fields.filter((item) => item.id !== field.id);
  const bindingPaths = [
    ...BINDINGS.map((binding) => ({ path: binding.path, label: binding.description })),
    ...customDefinitions
      .filter((definition) => !definition.archived && definition.scope !== 'person')
      .map((definition) => ({
        path: `${definition.scope}.custom.${definition.id}`,
        label: `${definition.scope === 'company' ? 'Company' : 'Case'} custom: ${definition.label}`,
      })),
    ...fields
      .filter((item) => item.valueType === 'recordReference')
      .flatMap((item) =>
        (['name', 'capacity', 'appointedOn', 'ceasedOn'] as const).map((property) => ({
          path: `selection.${item.id}.${property}`,
          label: `${item.label}: ${PROPERTY_LABELS[property]}`,
        })),
      ),
  ];
  const setSource = (kind: string) => {
    const next: FieldSource =
      kind === 'binding'
        ? { kind: 'binding', path: bindingPaths[0]?.path || 'company.name' }
        : kind === 'constant'
          ? { kind: 'constant', value: '' }
          : kind === 'addDays'
            ? {
                kind: 'derived',
                op: 'addDays',
                fieldId: others.find((item) => item.valueType === 'date')?.id || '',
                days: 0,
                sourceNote: '',
              }
            : kind === 'sum' || kind === 'count'
              ? { kind: 'derived', op: kind, fieldId: others[0]?.id || '' }
              : kind === 'join'
                ? {
                    kind: 'derived',
                    op: 'join',
                    fieldId: others.find((item) => item.valueType === 'recordList')?.id || '',
                    property: 'name',
                  }
                : { kind: 'question' };
    set({ source: next });
  };
  const sourceKind = source.kind === 'derived' ? source.op : source.kind;
  return (
    <fieldset className="field-editor plain-fieldset" disabled={readOnly}>
      <legend className="sr-only">Settings for {field.label}</legend>
      <div className="form-stack">
        <label>
          Label
          <input
            value={field.label}
            onChange={(event) => set({ label: event.target.value })}
            maxLength={200}
            required
          />
        </label>
        <label>
          Help for the preparer
          <input
            value={field.help || ''}
            onChange={(event) => set({ help: event.target.value || undefined })}
          />
        </label>
        <label>
          Answer type
          <select
            value={field.valueType}
            onChange={(event) => {
              const valueType = event.target.value as ValueType;
              set({
                valueType,
                options:
                  valueType === 'choice' || valueType === 'multiChoice'
                    ? field.options?.length
                      ? field.options
                      : [{ id: 'option_1', label: 'Option 1' }]
                    : undefined,
                record: isRecord(valueType)
                  ? field.record || { context: 'currentDirectors' }
                  : undefined,
              });
            }}
          >
            {VALUE_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Asked
          <select
            value={field.scope}
            onChange={(event) => set({ scope: event.target.value as 'case' | 'clause' })}
          >
            <option value="clause">For this paragraph only</option>
            <option value="case">Once per resolution (shared)</option>
          </select>
        </label>
        <label>
          Value comes from
          <select value={sourceKind} onChange={(event) => setSource(event.target.value)}>
            <option value="question">A question for the preparer</option>
            <option value="binding">Company or case records</option>
            <option value="constant">A fixed value</option>
            <option value="addDays">A date plus days</option>
            <option value="sum">Total of a per-person number</option>
            <option value="join">Names from a list</option>
            <option value="count">Number of people in a list</option>
          </select>
        </label>
        {source.kind === 'binding' ? (
          <label>
            Record value
            <select
              value={source.path}
              onChange={(event) => set({ source: { kind: 'binding', path: event.target.value } })}
            >
              {!bindingPaths.some((item) => item.path === source.path) ? (
                <option value={source.path}>{source.path}</option>
              ) : null}
              {bindingPaths.map((item) => (
                <option key={item.path} value={item.path}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        ) : source.kind === 'constant' ? (
          <label>
            Fixed value
            <input
              value={source.value}
              onChange={(event) => set({ source: { kind: 'constant', value: event.target.value } })}
            />
          </label>
        ) : source.kind === 'derived' ? (
          <>
            <label>
              Based on
              <select
                value={source.fieldId}
                onChange={(event) => set({ source: { ...source, fieldId: event.target.value } })}
              >
                <option value="">Choose a field…</option>
                {others.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            {source.op === 'addDays' ? (
              <>
                <label>
                  Days to add
                  <input
                    type="number"
                    inputMode="numeric"
                    value={source.days}
                    onChange={(event) =>
                      set({
                        source: { ...source, days: Math.trunc(Number(event.target.value) || 0) },
                      })
                    }
                  />
                </label>
                <label>
                  Approved source for this period
                  <input
                    value={source.sourceNote}
                    onChange={(event) =>
                      set({ source: { ...source, sourceNote: event.target.value } })
                    }
                  />
                </label>
                {!source.sourceNote.trim() ? (
                  <p className="warning">
                    Without an approved source, the calculated date is shown as a sample value.
                  </p>
                ) : null}
              </>
            ) : null}
            {source.op === 'join' ? (
              <label>
                Show
                <select
                  value={source.property}
                  onChange={(event) =>
                    set({ source: { ...source, property: event.target.value as RecordProperty } })
                  }
                >
                  {Object.entries(PROPERTY_LABELS).map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </>
        ) : null}
        {field.options ? (
          <fieldset>
            <legend>Choices</legend>
            <ul className="option-list">
              {field.options.map((option, index) => (
                <li key={option.id}>
                  <label>
                    <span className="sr-only">Choice {index + 1} label</span>
                    <input
                      value={option.label}
                      onChange={(event) =>
                        set({
                          options: field.options!.map((item) =>
                            item.id === option.id ? { ...item, label: event.target.value } : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="quiet"
                    aria-label={`Remove choice ${option.label}`}
                    disabled={field.options!.length < 2}
                    onClick={() =>
                      set({ options: field.options!.filter((item) => item.id !== option.id) })
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => {
                optionCounter.current += 1;
                const text = `Option ${field.options!.length + 1}`;
                set({
                  options: [
                    ...field.options!,
                    {
                      id: optionId(
                        text,
                        field.options!.map((item) => item.id),
                      ),
                      label: text,
                    },
                  ],
                });
              }}
            >
              Add choice
            </button>
          </fieldset>
        ) : null}
        {isRecord(field.valueType) ? (
          <label>
            People offered
            <select
              value={field.record?.context || 'currentDirectors'}
              onChange={(event) =>
                set({ record: { context: event.target.value as RecordContext } })
              }
            >
              {RECORD_CONTEXTS.map((context) => (
                <option key={context.value} value={context.value}>
                  {context.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {!isRecord(field.valueType) ? (
          <label>
            Ask for each person in
            <select
              value={field.repeatScope || ''}
              onChange={(event) => set({ repeatScope: event.target.value || undefined })}
            >
              <option value="">Not per person</option>
              {others
                .filter((item) => item.valueType === 'recordList')
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        {source.kind === 'question' ? (
          <label className="inline">
            <input
              type="checkbox"
              checked={Boolean(field.required)}
              onChange={(event) => set({ required: event.target.checked || undefined })}
            />
            Answer required
          </label>
        ) : null}
        <ValidationAndFormat field={field} set={set} />
        <details className="file-details">
          <summary>Field references</summary>
          <dl className="record-meta">
            <div>
              <dt>Stable ID</dt>
              <dd>
                <code>{field.id}</code>
              </dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{sourceSummary(field)}</dd>
            </div>
            <div>
              <dt>References</dt>
              <dd>{usages.length}</dd>
            </div>
          </dl>
          {field.options?.length ? (
            <dl className="record-meta">
              {field.options.map((option) => (
                <div key={option.id}>
                  <dt>{option.label}</dt>
                  <dd>
                    <code>{option.id}</code>
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </details>
        <div className="field-delete">
          {usages.length ? (
            <div className="metadata">
              Remove these references before deleting:
              <ul>
                {usages.map((usage) => (
                  <li key={usage}>{usage}</li>
                ))}
              </ul>
            </div>
          ) : confirmDelete ? (
            <div className="confirmation">
              <p>Delete {field.label}? It is not used anywhere.</p>
              <div className="actions">
                <button type="button" className="primary" onClick={onDelete}>
                  Delete {field.label}
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)}>
                  Keep field
                </button>
              </div>
            </div>
          ) : null}
          {!confirmDelete ? (
            <button
              type="button"
              className="danger"
              disabled={usages.length > 0}
              onClick={() => setConfirmDelete(true)}
            >
              Delete field
            </button>
          ) : null}
        </div>
      </div>
    </fieldset>
  );
}

function ValidationAndFormat({
  field,
  set,
}: {
  field: FieldDefinition;
  set: (patch: Partial<FieldDefinition>) => void;
}) {
  const validation = field.validation || {};
  const format = field.format || {};
  const setValidation = (patch: Partial<NonNullable<FieldDefinition['validation']>>) =>
    set({ validation: { ...validation, ...patch } });
  const setFormat = (patch: Partial<NonNullable<FieldDefinition['format']>>) =>
    set({ format: { ...format, ...patch } });
  const type = field.valueType;
  return (
    <details className="disclosure compact">
      <summary>Validation and format</summary>
      <div className="form-stack">
        {type === 'number' || type === 'date' ? (
          <div className="form-grid">
            <label>
              Minimum
              <input
                type={type === 'date' ? 'date' : 'text'}
                inputMode={type === 'number' ? 'decimal' : undefined}
                value={validation.min || ''}
                onChange={(event) => setValidation({ min: event.target.value || undefined })}
              />
            </label>
            <label>
              Maximum
              <input
                type={type === 'date' ? 'date' : 'text'}
                inputMode={type === 'number' ? 'decimal' : undefined}
                value={validation.max || ''}
                onChange={(event) => setValidation({ max: event.target.value || undefined })}
              />
            </label>
          </div>
        ) : null}
        {type === 'text' || type === 'multiline' ? (
          <label>
            Maximum length
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={validation.maxLength ?? ''}
              onChange={(event) =>
                setValidation({
                  maxLength: event.target.value ? Number(event.target.value) : undefined,
                })
              }
            />
          </label>
        ) : null}
        {type === 'boolean' ? (
          <label className="inline">
            <input
              type="checkbox"
              checked={Boolean(validation.mustBeChecked)}
              onChange={(event) =>
                setValidation({ mustBeChecked: event.target.checked || undefined })
              }
            />
            Must be ticked
          </label>
        ) : null}
        {type === 'date' || type === 'recordReference' || type === 'recordList' ? (
          <label>
            Date format
            <select
              value={format.date || 'long'}
              onChange={(event) => setFormat({ date: event.target.value as 'long' | 'iso' })}
            >
              <option value="long">1 August 2026</option>
              <option value="iso">2026-08-01</option>
            </select>
          </label>
        ) : null}
        {type === 'number' ? (
          <div className="form-grid">
            <label>
              Decimal places
              <input
                type="number"
                min={0}
                max={8}
                value={format.decimals ?? ''}
                onChange={(event) =>
                  setFormat({
                    decimals: event.target.value === '' ? undefined : Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              Prefix
              <input
                value={format.prefix || ''}
                maxLength={20}
                onChange={(event) => setFormat({ prefix: event.target.value || undefined })}
              />
            </label>
          </div>
        ) : null}
        <label className="inline">
          <input
            type="checkbox"
            checked={format.case === 'upper'}
            onChange={(event) => setFormat({ case: event.target.checked ? 'upper' : undefined })}
          />
          Show in capitals
        </label>
      </div>
    </details>
  );
}

/** Removes empty optional keys so the server's strict schema accepts the definition. */
function clean(field: FieldDefinition): FieldDefinition {
  const out: Record<string, unknown> = { ...field };
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key];
  for (const key of ['validation', 'format'] as const) {
    const value = out[key] as Record<string, unknown> | undefined;
    if (value) {
      for (const inner of Object.keys(value)) if (value[inner] === undefined) delete value[inner];
      if (!Object.keys(value).length) delete out[key];
    }
  }
  if (out.help === '') delete out.help;
  return out as FieldDefinition;
}
