'use client';
import { useId, useMemo, useState } from 'react';
import type {
  BlockNode,
  FieldDefinition,
  RecordFieldDefinition,
  RecordProperty,
  SignerRole,
  ValueType,
} from '@/domain/resolution/model';
import type { SelectionContext, TemplateEditorHandle } from './editor';
import { findFieldUsages, slugId, VALUE_TYPES, isRecord } from './fields';
import { PredicateEditor } from './predicate-editor';
import { PROPERTY_LABELS, ROLE_LABELS } from './nodes';
import { omit } from '@/domain/objects';
import { FieldEditor } from './field-editor';

export type WordingRef = { key: string; name: string; blocks: BlockNode[] };

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
              ? selectedField?.label || 'Unknown field'
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
                {!selectedField ? (
                  <p className="feedback error" role="alert">
                    Field {selection.fieldId} is missing. Remove this chip or create the field.
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
                  <div>
                    {field.label}
                    {field.from ? (
                      <dl className="record-meta">
                        <div>
                          <dt>Shared from</dt>
                          <dd>{field.from}</dd>
                        </div>
                      </dl>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="quiet"
                    aria-label={`Insert ${field.label}`}
                    onClick={() => {
                      if (field.from) {
                        const definition = omit(field, 'from');
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
                      <strong>{field.label}</strong>
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
