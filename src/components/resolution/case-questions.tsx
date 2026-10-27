'use client';
import { useRef, useState } from 'react';
import type { AnswerValue, Answers, SignerSelection } from '@/domain/resolution/model';
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
import { PerRowTable, Question, SignerList } from './case-question';

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
        <p className="metadata">Choose an assembly and clauses first.</p>
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
