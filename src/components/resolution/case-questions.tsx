'use client';
import { useId, useRef, useState } from 'react';
import type {
  AnswerValue,
  Answers,
  PersonSnapshot,
  SignerRole,
  SignerSelection,
} from '@/domain/resolution/model';
import { formatDate } from '@/components/workspace';
import {
  ApiError,
  getJson,
  newRequestId,
  postJson,
  type ClausesResponse,
  type FormField,
  type FormModel,
  type Issue,
} from './api';
import type { CaseApi } from './case-workspace';
import { LoadState, useLoad } from './use-load';
import { ActionFeedback, useAction } from './use-action';

type Draft = { shared: Answers; clauses: Record<string, Answers>; signers: SignerSelection };

export function CaseQuestions({ api }: { api: CaseApi }) {
  const id = api.detail.case.id;
  const load = useLoad(() => getJson<ClausesResponse>(`/api/resolution-cases/${id}/clauses`), [id]);
  if (!load.data)
    return (
      <LoadState
        loading={load.loading}
        error={load.error}
        reload={() => void load.reload()}
        label="questions"
      />
    );
  if (!load.data.selection || !load.data.form)
    return (
      <section>
        <h2>Questions</h2>
        <p className="metadata">Choose an assembly and clauses first. The questions follow them.</p>
      </section>
    );
  return (
    // Not keyed on the selection revision: remounting would drop keyboard focus to <body>.
    // QuestionForm re-initialises its draft itself when the revision changes.
    <QuestionForm
      api={api}
      form={load.data.form}
      selectionRevision={load.data.selection.revision}
      issues={load.data.issues ?? []}
      reload={load.reload}
    />
  );
}

function initial(form: FormModel, signers: SignerSelection): Draft {
  const collect = (fields: FormField[]) =>
    Object.fromEntries(
      fields.filter((f) => !f.readOnly).map((f) => [f.id, f.value ?? null]),
    ) as Answers;
  return {
    shared: collect(form.shared),
    clauses: Object.fromEntries(form.clauses.map((c) => [c.key, collect(c.fields)])),
    signers: {
      directors: [...(signers.directors ?? [])],
      members: [...(signers.members ?? [])],
      certifiers: [...(signers.certifiers ?? [])],
    },
  };
}

function QuestionForm({
  api,
  form,
  selectionRevision,
  issues,
  reload,
}: {
  api: CaseApi;
  form: FormModel;
  selectionRevision: number;
  issues: Issue[];
  reload: () => Promise<void>;
}) {
  const item = api.detail.case;
  const [draft, setDraft] = useState<Draft>(() => initial(form, item.signers));
  const [dirty, setDirty] = useState(false);
  const action = useAction();
  const [saveIssues, setSaveIssues] = useState<Issue[]>([]);
  // Counts edits so a save only clears `dirty` when nothing changed while it was in flight.
  const edits = useRef(0);
  const markDirty = () => {
    edits.current += 1;
    setDirty(true);
  };
  // The questions follow the clause selection; start a fresh draft when it changes.
  const [seenRevision, setSeenRevision] = useState(selectionRevision);
  if (seenRevision !== selectionRevision) {
    setSeenRevision(selectionRevision);
    setDraft(initial(form, item.signers));
    setDirty(false);
    setSaveIssues([]);
  }
  const formRef = useRef<HTMLFormElement>(null);
  const editable = api.canEdit;
  const setAnswer = (unit: string, fieldId: string, value: AnswerValue | Answers) => {
    markDirty();
    setDraft((current) =>
      unit === '@shared'
        ? { ...current, shared: { ...current.shared, [fieldId]: value as AnswerValue } }
        : {
            ...current,
            clauses: {
              ...current.clauses,
              [unit]: { ...current.clauses[unit], [fieldId]: value as AnswerValue },
            },
          },
    );
  };
  // Form issues carry the unit (clause entry key, or 'case') and the field id.
  const allIssues = [...issues, ...saveIssues];
  const issuesFor = (field: FormField, unit: string) =>
    allIssues.filter(
      (issue) =>
        issue.fieldId === field.id &&
        (!issue.unit || issue.unit === unit || (unit === '@shared' && issue.unit === 'case')),
    );

  async function save() {
    setSaveIssues([]);
    const started = edits.current;
    const ok = await action.run(
      () =>
        postJson(`/api/resolution-cases/${item.id}/clauses`, {
          action: 'save_answers',
          expectedRevision: item.revision,
          requestId: newRequestId(),
          selectionRevision,
          shared: draft.shared,
          clauses: draft.clauses,
          signers: draft.signers,
        }).catch((e: unknown) => {
          if (e instanceof ApiError) setSaveIssues(e.issues);
          throw e;
        }),
      'Answers saved',
    );
    if (ok) {
      if (edits.current === started) setDirty(false);
      await api.reload();
      await reload();
    }
  }

  return (
    <form
      ref={formRef}
      className="question-form"
      noValidate
      data-dirty={dirty ? 'true' : 'false'}
      aria-labelledby="case-questions"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="page-header section-header">
        <h2 id="case-questions">Questions</h2>
        {editable ? (
          <div className="actions question-save">
            <span className="metadata" aria-live="polite">
              {dirty ? 'Unsaved changes' : action.status}
            </span>
            <button className="primary" disabled={action.pending || !dirty}>
              {action.pending ? 'Saving…' : 'Save answers'}
            </button>
          </div>
        ) : null}
      </div>
      <ActionFeedback
        error={action.error}
        status=""
        conflict={action.conflict}
        onReload={() => {
          void api.reload();
          void reload();
        }}
      />
      {allIssues.length || form.conflicts.length ? (
        <div className="warning" role="alert">
          <strong>Needs attention before generating</strong>
          <ul>
            {[...form.conflicts, ...allIssues].map((issue, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    const target = formRef.current?.querySelector<HTMLElement>(
                      `[data-field-ids~="${CSS.escape(issue.fieldId || fieldFromLocation(issue, form))}"]`,
                    );
                    target?.scrollIntoView({ block: 'center' });
                    target?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
                  }}
                >
                  {issue.message}
                </button>
                {issue.location ? <span className="metadata"> · {issue.location}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <fieldset className="plain-fieldset" disabled={!editable}>
        {form.shared.length ? (
          <section className="question-section" aria-labelledby="shared-questions">
            <h3 id="shared-questions">For the whole resolution</h3>
            <FieldGroup
              unit="@shared"
              fields={form.shared}
              values={draft.shared}
              onChange={setAnswer}
              issuesFor={(field) => issuesFor(field, '@shared')}
            />
          </section>
        ) : null}
        {form.clauses.map((clause, index) => (
          <section
            className="question-section"
            key={clause.key}
            aria-labelledby={`clause-${clause.key}`}
          >
            <h3 id={`clause-${clause.key}`}>
              {index + 1}. {clause.clauseName}
            </h3>
            {clause.fields.filter((f) => f.active !== false).length ? (
              <FieldGroup
                unit={clause.key}
                fields={clause.fields}
                values={draft.clauses[clause.key] || {}}
                onChange={setAnswer}
                issuesFor={(field) => issuesFor(field, clause.key)}
              />
            ) : (
              <p className="metadata">No questions for this clause.</p>
            )}
          </section>
        ))}
        {form.signers.length ? (
          <section className="question-section" aria-labelledby="signer-questions">
            <h3 id="signer-questions">Signers</h3>
            {form.signers.map((role) => (
              <SignerList
                key={role.role}
                role={role.role}
                label={role.label}
                pool={role.pool}
                value={draft.signers[role.role] ?? []}
                onChange={(ids) => {
                  markDirty();
                  setDraft((current) => ({
                    ...current,
                    signers: { ...current.signers, [role.role]: ids },
                  }));
                }}
              />
            ))}
          </section>
        ) : null}
      </fieldset>
      {editable ? (
        <div className="actions">
          <button className="primary" disabled={action.pending || !dirty}>
            {action.pending ? 'Saving…' : 'Save answers'}
          </button>
        </div>
      ) : null}
    </form>
  );
}

function fieldFromLocation(issue: Issue, form: FormModel) {
  const all = [...form.shared, ...form.clauses.flatMap((c) => c.fields)];
  return (
    all.find((f) => issue.location.includes(f.id) || issue.message.includes(f.label))?.id ||
    '__none'
  );
}

function FieldGroup({
  unit,
  fields,
  values,
  onChange,
  issuesFor,
}: {
  unit: string;
  fields: FormField[];
  values: Answers;
  onChange: (unit: string, fieldId: string, value: AnswerValue | Answers) => void;
  issuesFor: (field: FormField) => Issue[];
}) {
  const visible = fields.filter((f) => f.active !== false);
  const perRow = visible.filter((f) => f.repeatScope);
  return (
    <div className="question-grid">
      {visible
        .filter((f) => !f.repeatScope)
        .map((field) => {
          const rows = perRow.filter((f) => f.repeatScope === field.id);
          return (
            <div
              key={field.id}
              className={
                field.valueType === 'multiline' ||
                field.valueType === 'recordList' ||
                field.valueType === 'multiChoice' ||
                rows.length
                  ? 'question full'
                  : 'question'
              }
              data-field-ids={[field.id, ...rows.map((r) => r.id)].join(' ')}
            >
              <Question
                field={field}
                value={
                  field.readOnly ? (field.value as AnswerValue) : (values[field.id] as AnswerValue)
                }
                onChange={(value) => onChange(unit, field.id, value)}
                issues={issuesFor(field)}
              />
              {rows.length ? (
                <PerRowTable
                  list={field}
                  selected={
                    (Array.isArray(values[field.id])
                      ? (values[field.id] as string[])
                      : Array.isArray(field.value)
                        ? (field.value as string[])
                        : []) as string[]
                  }
                  fields={rows}
                  values={values}
                  onChange={(fieldId, value) => onChange(unit, fieldId, value)}
                />
              ) : null}
            </div>
          );
        })}
      {perRow
        .filter((f) => !visible.some((v) => v.id === f.repeatScope))
        .map((field) => (
          <p key={field.id} className="metadata">
            {field.label} is asked for each selected person once the list is answered.
          </p>
        ))}
    </div>
  );
}

function Question({
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

function PerRowTable({
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

function SignerList({
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
