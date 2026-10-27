'use client';
import { useId, useState } from 'react';
import type { AnswerValue, Answers, PersonSnapshot, SignerRole } from '@/domain/resolution/model';
import { formatDate } from '@/components/workspace';
import { type FormField, type Issue } from './api';

export function Question({
  field,
  value,
  onChange,
  issues,
}: {
  field: FormField;
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
  issues: Issue[];
}) {
  const id = useId();
  const errorId = id + '-error';
  const helpId = id + '-help';
  const described = [field.help ? helpId : '', issues.length ? errorId : '']
    .filter(Boolean)
    .join(' ');
  const common = {
    id,
    'aria-describedby': described || undefined,
    'aria-invalid': issues.length ? true : undefined,
    required: field.required,
  };
  const label = (
    <span>
      {field.label}
      {field.required ? <span className="metadata"> (required)</span> : null}
    </span>
  );
  const help = field.help ? (
    <span id={helpId} className="metadata">
      {field.help}
    </span>
  ) : null;
  const errors = issues.length ? (
    <span id={errorId} className="field-error" role="alert">
      {issues.map((i) => i.message).join(' ')}
    </span>
  ) : null;

  if (field.readOnly)
    return (
      <div className="bound-value">
        <span className="bound-label">{field.label}</span>
        <span className="bound-text">{display(field, value)}</span>
        <details className="advanced-filters">
          <summary>Source</summary>
          <p>{field.sourceLabel || 'From records'}</p>
        </details>
      </div>
    );

  switch (field.valueType) {
    case 'boolean':
      if (!field.validation?.mustBeChecked)
        return (
          <label htmlFor={id}>
            {label}
            <select
              {...common}
              value={typeof value === 'boolean' ? String(value) : ''}
              onChange={(event) =>
                onChange(event.target.value === '' ? null : event.target.value === 'true')
              }
            >
              <option value="">Select…</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
            {help}
            {errors}
          </label>
        );
      return (
        <div>
          <label className="inline" htmlFor={id}>
            <input
              {...common}
              type="checkbox"
              checked={value === true}
              onChange={(event) => onChange(event.target.checked)}
            />
            {label}
          </label>
          {help}
          {errors}
        </div>
      );
    case 'choice': {
      const options = field.options ?? [];
      if (options.length <= 4)
        return (
          <fieldset aria-describedby={described || undefined}>
            <legend>{label}</legend>
            {options.map((option) => (
              <label className="inline" key={option.id}>
                <input
                  type="radio"
                  name={id}
                  checked={value === option.id}
                  onChange={() => onChange(option.id)}
                />
                {option.label}
              </label>
            ))}
            {help}
            {errors}
          </fieldset>
        );
      return (
        <label htmlFor={id}>
          {label}
          <select
            {...common}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(event.target.value || null)}
          >
            <option value="">Select…</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {help}
          {errors}
        </label>
      );
    }
    case 'multiChoice': {
      const selected = Array.isArray(value) ? value : [];
      return (
        <fieldset aria-describedby={described || undefined}>
          <legend>{label}</legend>
          {(field.options ?? []).map((option) => (
            <label className="inline" key={option.id}>
              <input
                type="checkbox"
                checked={selected.includes(option.id)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? (field.options ?? [])
                          .map((o) => o.id)
                          .filter((o) => o === option.id || selected.includes(o))
                      : selected.filter((v) => v !== option.id),
                  )
                }
              />
              {option.label}
            </label>
          ))}
          {help}
          {errors}
        </fieldset>
      );
    }
    case 'recordReference':
      return (
        <PersonPicker
          id={id}
          label={label}
          labelText={field.label}
          pool={field.choices ?? []}
          value={typeof value === 'string' ? value : ''}
          onChange={(v) => onChange(v || null)}
          help={help}
          errors={errors}
          described={described}
        />
      );
    case 'recordList':
      return (
        <OrderedPeople
          labelText={field.label}
          label={label}
          pool={field.choices ?? []}
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
          help={help}
          errors={errors}
        />
      );
    case 'multiline':
      return (
        <label htmlFor={id}>
          {label}
          <textarea
            {...common}
            value={typeof value === 'string' ? value : ''}
            maxLength={field.validation?.maxLength}
            onChange={(event) => onChange(event.target.value)}
          />
          {help}
          {errors}
        </label>
      );
    default:
      return (
        <label htmlFor={id}>
          {label}
          <input
            {...common}
            type={field.valueType === 'date' ? 'date' : 'text'}
            inputMode={field.valueType === 'number' ? 'decimal' : undefined}
            min={field.valueType === 'date' ? field.validation?.min : undefined}
            max={field.valueType === 'date' ? field.validation?.max : undefined}
            maxLength={field.validation?.maxLength}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(event.target.value)}
          />
          {help}
          {errors}
        </label>
      );
  }
}

function display(field: FormField, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value))
    return (
      value.map((v) => field.choices?.find((p) => p.id === v)?.name || String(v)).join(', ') || '—'
    );
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value))
    return formatDate(value.slice(0, 10));
  if (field.valueType === 'recordReference')
    return field.choices?.find((p) => p.id === value)?.name || String(value);
  return String(value);
}

function personLine(person: PersonSnapshot) {
  return [
    person.name,
    person.capacity,
    person.appointedOn ? `appointed ${formatDate(person.appointedOn)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function PersonPicker({
  id,
  label,
  labelText,
  pool,
  value,
  onChange,
  help,
  errors,
  described,
}: {
  id: string;
  label: React.ReactNode;
  labelText: string;
  pool: PersonSnapshot[];
  value: string;
  onChange: (value: string) => void;
  help: React.ReactNode;
  errors: React.ReactNode;
  described: string;
}) {
  const [filter, setFilter] = useState('');
  const options = pool.filter(
    (p) => p.id === value || !filter || p.name.toLowerCase().includes(filter.toLowerCase()),
  );
  const stale = value && !pool.some((p) => p.id === value);
  return (
    <div className="person-picker">
      <label htmlFor={id}>{label}</label>
      {pool.length > 8 ? (
        <input
          type="search"
          aria-label={`Filter people for ${labelText}`}
          placeholder="Filter by name"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      ) : null}
      <select
        id={id}
        aria-describedby={described || undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select a person…</option>
        {stale ? <option value={value}>Selected person is no longer available</option> : null}
        {options.map((person) => (
          <option key={person.id} value={person.id}>
            {personLine(person)}
          </option>
        ))}
      </select>
      {stale ? (
        <span className="field-error" role="alert">
          The selected person is not in the current list. Choose again.
        </span>
      ) : null}
      {help}
      {errors}
    </div>
  );
}

function OrderedPeople({
  label,
  labelText,
  pool,
  value,
  onChange,
  help,
  errors,
}: {
  label: React.ReactNode;
  labelText: string;
  pool: PersonSnapshot[];
  value: string[];
  onChange: (value: string[]) => void;
  help: React.ReactNode;
  errors: React.ReactNode;
}) {
  const addId = useId();
  const [adding, setAdding] = useState('');
  const name = (id: string) => pool.find((p) => p.id === id)?.name || 'Unavailable person';
  const move = (index: number, to: number) => {
    const next = [...value];
    const [entry] = next.splice(index, 1);
    next.splice(to, 0, entry);
    onChange(next);
  };
  return (
    <fieldset className="ordered-people">
      <legend>{label}</legend>
      {value.length ? (
        <ol>
          {value.map((id, index) => (
            <li key={id}>
              <span className={pool.some((p) => p.id === id) ? undefined : 'danger'}>
                {name(id)}
              </span>
              <span className="reorder-controls">
                <button
                  type="button"
                  className="quiet"
                  aria-label={`Move ${name(id)} up in ${labelText}`}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="quiet"
                  aria-label={`Move ${name(id)} down in ${labelText}`}
                  disabled={index === value.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="quiet danger"
                  aria-label={`Remove ${name(id)} from ${labelText}`}
                  onClick={() => onChange(value.filter((v) => v !== id))}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="metadata">Nobody selected.</p>
      )}
      <div className="add-person">
        <label htmlFor={addId} className="sr-only">
          Add a person to {labelText}
        </label>
        <select id={addId} value={adding} onChange={(event) => setAdding(event.target.value)}>
          <option value="">Add a person…</option>
          {pool
            .filter((p) => !value.includes(p.id))
            .map((person) => (
              <option key={person.id} value={person.id}>
                {personLine(person)}
              </option>
            ))}
        </select>
        <button
          type="button"
          disabled={!adding}
          onClick={() => {
            onChange([...value, adding]);
            setAdding('');
          }}
        >
          Add
        </button>
      </div>
      {help}
      {errors}
    </fieldset>
  );
}

export function PerRowTable({
  list,
  selected,
  fields,
  values,
  onChange,
}: {
  list: FormField;
  selected: string[];
  fields: FormField[];
  values: Answers;
  onChange: (fieldId: string, value: Answers) => void;
}) {
  const name = (id: string) => list.choices?.find((p) => p.id === id)?.name || id;
  if (!selected.length)
    return <p className="metadata">Select people above to answer per-person questions.</p>;
  return (
    <div className="table-wrap per-row">
      <table>
        <caption className="sr-only">{list.label}: answers per person</caption>
        <thead>
          <tr>
            <th scope="col">{list.label}</th>
            {fields.map((field) => (
              <th scope="col" key={field.id}>
                {field.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {selected.map((personId) => (
            <tr key={personId}>
              <th scope="row">{name(personId)}</th>
              {fields.map((field) => {
                const rows = ((field.readOnly ? field.value : values[field.id]) || {}) as Record<
                  string,
                  AnswerValue
                >;
                const cell = rows[personId] ?? null;
                const set = (value: AnswerValue) =>
                  onChange(field.id, { ...rows, [personId]: value });
                const aria = `${field.label} for ${name(personId)}`;
                return (
                  <td key={field.id}>
                    {field.activeItemIds && !field.activeItemIds.includes(personId) ? (
                      <span className="metadata">Not applicable</span>
                    ) : field.readOnly ? (
                      display(field, cell)
                    ) : field.valueType === 'boolean' && !field.validation?.mustBeChecked ? (
                      <select
                        aria-label={aria}
                        value={typeof cell === 'boolean' ? String(cell) : ''}
                        onChange={(event) =>
                          set(event.target.value === '' ? null : event.target.value === 'true')
                        }
                      >
                        <option value="">Select…</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    ) : field.valueType === 'boolean' ? (
                      <input
                        type="checkbox"
                        aria-label={aria}
                        checked={cell === true}
                        onChange={(event) => set(event.target.checked)}
                      />
                    ) : field.valueType === 'multiChoice' ? (
                      <Question
                        field={{ ...field, label: aria, help: undefined }}
                        value={cell}
                        onChange={set}
                        issues={[]}
                      />
                    ) : field.valueType === 'choice' ? (
                      <select
                        aria-label={aria}
                        value={typeof cell === 'string' ? cell : ''}
                        onChange={(event) => set(event.target.value || null)}
                      >
                        <option value="">Select…</option>
                        {(field.options ?? []).map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        aria-label={aria}
                        type={field.valueType === 'date' ? 'date' : 'text'}
                        inputMode={field.valueType === 'number' ? 'decimal' : undefined}
                        value={typeof cell === 'string' ? cell : ''}
                        onChange={(event) => set(event.target.value)}
                      />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SignerList({
  role,
  label,
  pool,
  value,
  onChange,
}: {
  role: SignerRole;
  label: string;
  pool: PersonSnapshot[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="signer-role" data-field-ids={`signers_${role}`}>
      <OrderedPeople
        label={label}
        labelText={label}
        pool={pool}
        value={value}
        onChange={onChange}
        help={null}
        errors={null}
      />
    </div>
  );
}
