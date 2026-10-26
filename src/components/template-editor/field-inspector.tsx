'use client';
import { useId, useMemo, useRef, useState } from 'react';
import type {
  BlockNode,
  FieldDefinition,
  FieldSource,
  RecordContext,
  RecordFieldDefinition,
  RecordProperty,
  SignerRole,
  ValueType,
} from '@/domain/resolution/model';
import { BINDINGS } from '@/domain/resolution/bindings';
import type { SelectionContext, TemplateEditorHandle } from './editor';
import { findFieldUsages, slugId, sourceSummary, VALUE_TYPES } from './fields';
import { PredicateEditor } from './predicate-editor';
import { PROPERTY_LABELS, ROLE_LABELS } from './nodes';

export type WordingRef = { key: string; name: string; blocks: BlockNode[] };

const RECORD_CONTEXTS: { value: RecordContext; label: string }[] = [
  { value: 'currentDirectors', label: 'Current directors' },
  { value: 'currentMembers', label: 'Current members' },
  { value: 'companyPeople', label: 'People linked to the company' },
  { value: 'proposedPerson', label: 'Any person (for a proposed appointee)' },
];
const isRecord = (type: ValueType) => type === 'recordReference' || type === 'recordList';

function optionId(label: string, existing: string[]) {
  const id = slugId(label, existing).replace(/^field_/, '');
  return /^[a-z0-9]/.test(id) && !existing.includes(id) ? id : slugId('option ' + label, existing);
}

export function FieldInspector({
  fields,
  onFieldsChange,
  wordings,
  selection,
  editor,
  readOnly,
  defaultScope,
  reusable = [],
  customDefinitions = [],
  newQuestionRef,
  settingsRef,
}: {
  fields: FieldDefinition[];
  onFieldsChange: (fields: FieldDefinition[]) => void;
  wordings: WordingRef[];
  selection: SelectionContext | null;
  editor: React.RefObject<TemplateEditorHandle | null>;
  readOnly: boolean;
  defaultScope: 'case' | 'clause';
  /** Shared (case-level) questions defined in other templates, offered for reuse by id. */
  reusable?: (FieldDefinition & { from: string })[];
  customDefinitions?: RecordFieldDefinition[];
  newQuestionRef?: React.RefObject<HTMLInputElement | null>;
  settingsRef?: React.RefObject<HTMLElement | null>;
}) {
  const id = useId();
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [valueType, setValueType] = useState<ValueType>('text');
  const [scope, setScope] = useState<'case' | 'clause'>(defaultScope);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const ids = fields.map((field) => field.id);
  const proposedId = label.trim() ? slugId(label.trim(), ids) : '';

  const update = (fieldId: string, change: (field: FieldDefinition) => FieldDefinition) =>
    onFieldsChange(fields.map((field) => (field.id === fieldId ? change(field) : field)));

  function create() {
    const text = label.trim();
    if (!text) return;
    const field: FieldDefinition = {
      id: slugId(text, ids),
      label: text,
      valueType,
      source: { kind: 'question' },
      scope,
      required: true,
      ...(valueType === 'choice' || valueType === 'multiChoice'
        ? { options: [{ id: 'option_1', label: 'Option 1' }] }
        : {}),
      ...(isRecord(valueType) ? { record: { context: 'currentDirectors' as const } } : {}),
    };
    onFieldsChange([...fields, field]);
    editor.current?.insertField(field.id, isRecord(valueType) ? 'name' : null);
    setLabel('');
    setEditing(field.id);
    setNotice(`Created ${field.label} and inserted it at the cursor`);
  }

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    const own = fields.map((field) => ({ ...field, from: '' }));
    const others = reusable.filter((field) => !ids.includes(field.id));
    return [...own, ...others].filter(
      (field) => !term || `${field.label} ${field.id}`.toLowerCase().includes(term),
    );
  }, [search, fields, reusable, ids]);

  const recordFields = fields.filter((field) => field.valueType === 'recordList');
  const selectedField =
    selection?.kind === 'field' ? fields.find((field) => field.id === selection.fieldId) : null;

  return (
    <aside className="template-inspector" aria-label="Fields and settings">
      <p className="sr-only" role="status">
        {notice}
      </p>
      {selection ? (
        <section
          className="inspector-section"
          ref={settingsRef as React.RefObject<HTMLElement>}
          tabIndex={-1}
          aria-labelledby={id + '-selected'}
        >
          <h3 id={id + '-selected'}>
            {selection.kind === 'field'
              ? 'Selected field'
              : selection.kind === 'condition'
                ? 'Condition'
                : selection.kind === 'repeat'
                  ? 'Repeat'
                  : selection.kind === 'clauseSlot'
                    ? 'Clause slot'
                    : 'Signature block'}
          </h3>
          <fieldset disabled={readOnly} className="plain-fieldset">
            {selection.kind === 'field' ? (
              <div className="form-stack">
                <p>
                  <strong>{selectedField?.label || 'Unknown field'}</strong>
                  <span className="metadata"> · {selection.fieldId}</span>
                </p>
                {!selectedField ? (
                  <p className="feedback error" role="alert">
                    This chip refers to a field that is not defined. Remove it or create the field.
                  </p>
                ) : null}
                {selectedField && isRecord(selectedField.valueType) ? (
                  <label>
                    Show
                    <select
                      value={selection.property || 'name'}
                      onChange={(event) =>
                        editor.current?.updateNode(selection.pos, {
                          property: event.target.value as RecordProperty,
                        })
                      }
                    >
                      {Object.entries(PROPERTY_LABELS).map(([value, text]) => (
                        <option key={value} value={value}>
                          {text[0].toUpperCase() + text.slice(1)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <div className="actions">
                  {selectedField ? (
                    <button type="button" onClick={() => setEditing(selectedField.id)}>
                      Edit {selectedField.label}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="danger"
                    onClick={() => editor.current?.deleteNode(selection.pos)}
                  >
                    Remove chip
                  </button>
                </div>
              </div>
            ) : selection.kind === 'condition' ? (
              <div className="form-stack">
                <PredicateEditor
                  idPrefix={id + '-condition'}
                  value={selection.when}
                  fields={fields}
                  onChange={(when) => editor.current?.updateNode(selection.pos, { when })}
                />
                <button
                  type="button"
                  className="text-button"
                  onClick={() => editor.current?.unwrapNode(selection.pos)}
                >
                  Remove condition and keep its text
                </button>
              </div>
            ) : selection.kind === 'repeat' ? (
              <div className="form-stack">
                <label>
                  Repeat for each person in
                  <select
                    value={selection.fieldId}
                    onChange={(event) =>
                      editor.current?.updateNode(selection.pos, { fieldId: event.target.value })
                    }
                  >
                    <option value="">Choose a list field…</option>
                    {recordFields.map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                </label>
                {!recordFields.length ? (
                  <p className="metadata">
                    Create a field of type &ldquo;People from records&rdquo; to repeat over.
                  </p>
                ) : null}
                <label>
                  Text when nobody is selected
                  <input
                    value={selection.emptyText || ''}
                    onChange={(event) =>
                      editor.current?.updateNode(selection.pos, {
                        emptyText: event.target.value || null,
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => editor.current?.unwrapNode(selection.pos)}
                >
                  Remove repeat and keep its text
                </button>
              </div>
            ) : selection.kind === 'clauseSlot' ? (
              <div className="form-stack">
                <label>
                  Clause numbering
                  <select
                    value={selection.numbering}
                    onChange={(event) =>
                      editor.current?.updateNode(selection.pos, { numbering: event.target.value })
                    }
                  >
                    <option value="decimal">Numbered 1, 2, 3</option>
                    <option value="none">Not numbered</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="text-button danger"
                  onClick={() => editor.current?.deleteNode(selection.pos)}
                >
                  Remove clause slot
                </button>
              </div>
            ) : (
              <div className="form-stack">
                <label>
                  Signer role
                  <select
                    value={selection.role}
                    onChange={(event) =>
                      editor.current?.updateNode(selection.pos, {
                        role: event.target.value as SignerRole,
                      })
                    }
                  >
                    {Object.entries(ROLE_LABELS).map(([value, text]) => (
                      <option key={value} value={value}>
                        {text}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Heading above signatures
                  <input
                    value={selection.heading || ''}
                    onChange={(event) =>
                      editor.current?.updateNode(selection.pos, {
                        heading: event.target.value || null,
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="text-button danger"
                  onClick={() => editor.current?.deleteNode(selection.pos)}
                >
                  Remove signature block
                </button>
              </div>
            )}
          </fieldset>
        </section>
      ) : null}

      {readOnly ? null : (
        <section className="inspector-section" aria-labelledby={id + '-insert'}>
          <h3 id={id + '-insert'}>Insert a field</h3>
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              create();
            }}
          >
            <label>
              New question label
              <input
                ref={newQuestionRef}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                maxLength={200}
              />
            </label>
            {proposedId ? <p className="metadata">Field ID: {proposedId}</p> : null}
            <label>
              Answer type
              <select
                value={valueType}
                onChange={(event) => setValueType(event.target.value as ValueType)}
              >
                {VALUE_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline">
              <input
                type="checkbox"
                checked={scope === 'case'}
                onChange={(event) => setScope(event.target.checked ? 'case' : 'clause')}
              />
              Shared across clauses (asked once)
            </label>
            <div className="actions">
              <button type="submit" disabled={!label.trim()}>
                Create and insert
              </button>
            </div>
          </form>
          <div className="field-search">
            <label className="search">
              <span>Find an existing field</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <ul className="field-pick-list" aria-label="Existing fields">
              {matches.slice(0, 30).map((field) => (
                <li key={(field.from || 'own') + field.id}>
                  <span>
                    {field.label}
                    <span className="metadata">
                      {' '}
                      · {field.from ? `shared, from ${field.from}` : field.id}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="quiet"
                    aria-label={`Insert ${field.label}`}
                    onClick={() => {
                      if (field.from) {
                        const { from: _from, ...definition } = field;
                        void _from;
                        onFieldsChange([...fields, definition]);
                      }
                      editor.current?.insertField(
                        field.id,
                        isRecord(field.valueType) ? 'name' : null,
                      );
                      setNotice(`Inserted ${field.label}`);
                    }}
                  >
                    Insert
                  </button>
                </li>
              ))}
              {!matches.length ? <li className="metadata">No matching fields</li> : null}
            </ul>
          </div>
        </section>
      )}

      <section className="inspector-section" aria-labelledby={id + '-fields'}>
        <h3 id={id + '-fields'}>Fields ({fields.length})</h3>
        {fields.length ? (
          <ul className="field-list">
            {fields.map((field) => {
              const usages = findFieldUsages(field.id, wordings, fields);
              const open = editing === field.id;
              return (
                <li key={field.id}>
                  <div className="field-row">
                    <div>
                      <strong>{field.label}</strong>{' '}
                      <span className="tag">
                        {field.scope === 'case' ? 'Shared' : 'This clause'}
                      </span>
                      <div className="metadata">
                        {field.id} · {sourceSummary(field)} · used {usages.length}{' '}
                        {usages.length === 1 ? 'time' : 'times'}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="quiet"
                      aria-expanded={open}
                      aria-label={`${open ? 'Close' : readOnly ? 'View' : 'Edit'} ${field.label}`}
                      onClick={() => setEditing(open ? null : field.id)}
                    >
                      {open ? 'Close' : readOnly ? 'View' : 'Edit'}
                    </button>
                  </div>
                  {open ? (
                    <FieldEditor
                      field={field}
                      fields={fields}
                      usages={usages.map((usage) => usage.place)}
                      readOnly={readOnly}
                      customDefinitions={customDefinitions}
                      onChange={(change) => update(field.id, change)}
                      onDelete={() => {
                        onFieldsChange(fields.filter((item) => item.id !== field.id));
                        setEditing(null);
                        setNotice(`Deleted ${field.label}`);
                      }}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="metadata">No fields yet.</p>
        )}
      </section>
    </aside>
  );
}

function FieldEditor({
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
        <p className="metadata">ID {field.id} stays the same when you rename the label.</p>
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
            <option value="clause">For this clause only</option>
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
                  <span className="metadata">{option.id}</span>
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
        <div className="field-delete">
          {usages.length ? (
            <div className="metadata">
              In use, so it cannot be deleted. Remove these references first:
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
