'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildForm, validateAnswers, type CaseInput } from '@/domain/resolution/form';
import type { AnswerValue, Answers, SignerSelection } from '@/domain/resolution/model';
import {
  ApiError,
  getJson,
  newRequestId,
  plainIssue,
  postJson,
  type ClausesResponse,
  type FormField,
  type FormModel,
  type Issue,
} from './api';
import type { CaseApi } from './case-workspace';
import { LoadState, useLoad } from './use-load';
import { ActionFeedback, useAction } from './use-action';
import { currentDate } from '@/components/workspace';
import { PerRowTable, Question, SignerList } from './case-question';

type Draft = { shared: Answers; clauses: Record<string, Answers>; signers: SignerSelection };

export function CaseQuestions({ api }: { api: CaseApi }) {
  const id = api.detail.case.id;
  // On the single Prepare page the wording sits above; reload when its saved selection changes.
  const selection = api.detail.case.selection;
  const load = useLoad(
    () => getJson<ClausesResponse>(`/api/resolution-cases/${id}/clauses`),
    // The resolution date decides who is a director or member, so a new date reloads the lists.
    [
      id,
      selection?.revision ?? 0,
      selection?.assemblyVersionId ?? '',
      api.detail.case.resolutionDate ?? '',
    ],
  );
  if (!load.data)
    return (
      <LoadState
        loading={load.loading}
        error={load.error}
        reload={() => void load.reload()}
        label="questions"
      />
    );
  if (!load.data.selection || !load.data.form || !load.data.formInput)
    return (
      <section aria-labelledby="case-questions">
        <h2 id="case-questions">3. Answers</h2>
        <p className="metadata">Choose the layout in step 2 first.</p>
      </section>
    );
  return (
    // Not keyed on the selection revision: remounting would drop keyboard focus to <body>.
    // QuestionForm re-initialises its draft itself when the revision changes.
    <QuestionForm
      api={api}
      initialForm={load.data.form}
      formInput={load.data.formInput}
      selectionRevision={load.data.selection.revision}
      reload={load.reload}
    />
  );
}

/** The resolution date question takes the date from step 1 while it is unanswered. */
const isResolutionDate = (field: FormField) =>
  field.valueType === 'date' &&
  (field.id === 'resolution_date' || field.label.trim().toLowerCase() === 'resolution date');

/** Moves answers still holding the previous step 1 date to the new one. */
export function refreshCopiedDate(
  draft: Draft,
  form: FormModel,
  previous: string | null,
  next: string | null,
) {
  let prefilled = false;
  const refresh = (fields: FormField[], answers: Answers) => {
    const updated = { ...answers };
    for (const field of fields) {
      if (field.readOnly || !isResolutionDate(field)) continue;
      if (field.value !== null && field.value !== undefined && field.value !== '') continue;
      const current = answers[field.id];
      if (current !== null && current !== undefined && current !== '' && current !== previous)
        continue;
      updated[field.id] = next;
      if (next) prefilled = true;
    }
    return updated;
  };
  return {
    draft: {
      ...draft,
      shared: refresh(form.shared, draft.shared),
      clauses: Object.fromEntries(
        form.clauses.map((clause) => [
          clause.key,
          refresh(clause.fields, draft.clauses[clause.key] ?? {}),
        ]),
      ),
    } as Draft,
    prefilled,
  };
}

function initial(form: FormModel, signers: SignerSelection, resolutionDate: string | null) {
  let prefilled = false;
  const collect = (fields: FormField[]) =>
    Object.fromEntries(
      fields
        .filter((f) => !f.readOnly)
        .map((f) => {
          const value = f.value ?? null;
          if ((value === null || value === '') && resolutionDate && isResolutionDate(f)) {
            prefilled = true;
            return [f.id, resolutionDate];
          }
          return [f.id, value];
        }),
    ) as Answers;
  const draft: Draft = {
    shared: collect(form.shared),
    clauses: Object.fromEntries(form.clauses.map((c) => [c.key, collect(c.fields)])),
    signers: {
      directors: [...(signers.directors ?? [])],
      members: [...(signers.members ?? [])],
      certifiers: [...(signers.certifiers ?? [])],
    },
  };
  return { draft, prefilled };
}

/** `fresh` with the unsaved answers from `draft` for the fields `fresh` still has. */
export function carryOver(fresh: Draft, draft: Draft): Draft {
  const keep = (next: Answers, old: Answers | undefined) =>
    Object.fromEntries(
      Object.entries(next).map(([id, value]) => [id, old && id in old ? old[id] : value]),
    ) as Answers;
  return {
    shared: keep(fresh.shared, draft.shared),
    clauses: Object.fromEntries(
      Object.entries(fresh.clauses).map(([key, answers]) => [
        key,
        keep(answers, draft.clauses[key]),
      ]),
    ),
    signers: draft.signers,
  };
}

function QuestionForm({
  api,
  initialForm,
  formInput,
  selectionRevision,
  reload,
}: {
  api: CaseApi;
  initialForm: FormModel;
  formInput: CaseInput;
  selectionRevision: number;
  reload: () => Promise<void>;
}) {
  const item = api.detail.case;
  // A read-only case keeps its stored answers; only an editable one copies the date from step 1.
  const copiedDate = api.canEdit ? item.resolutionDate : null;
  const start = () => initial(initialForm, item.signers, copiedDate);
  const [draft, setDraft] = useState<Draft>(() => start().draft);
  const [dirty, setDirty] = useState(false);
  // A date copied from step 1 can be saved, but nobody has edited anything to lose by leaving.
  const [copied, setCopied] = useState(() => start().prefilled);
  // Field errors wait until the person has tried to save.
  const [attempted, setAttempted] = useState(false);
  const action = useAction();
  const [saveIssues, setSaveIssues] = useState<Issue[]>([]);
  const statusRef = useRef<HTMLSpanElement>(null);
  const [focusStatus, setFocusStatus] = useState(false);
  useEffect(() => {
    if (!focusStatus) return;
    setFocusStatus(false);
    statusRef.current?.focus();
  }, [focusStatus]);
  // Counts edits so a save only clears `dirty` when nothing changed while it was in flight.
  const edits = useRef(0);
  const markDirty = () => {
    edits.current += 1;
    setDirty(true);
    setSaveIssues([]);
  };
  // Rebuild the questions while retaining unsaved answers to fields that are still asked.
  const [seenRevision, setSeenRevision] = useState(selectionRevision);
  if (seenRevision !== selectionRevision) {
    setSeenRevision(selectionRevision);
    const next = start();
    setDraft(dirty ? carryOver(next.draft, draft) : next.draft);
    setCopied(copied || next.prefilled);
    setAttempted(false);
    setSaveIssues([]);
  }
  // Step 1's date changed: untouched copies follow it, and answers someone typed stay.
  const [seenDate, setSeenDate] = useState(copiedDate);
  if (seenDate !== copiedDate) {
    setSeenDate(copiedDate);
    const next = refreshCopiedDate(draft, initialForm, seenDate, copiedDate);
    setDraft(next.draft);
    setCopied(copied || next.prefilled);
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
  const { form, issues } = useMemo(() => {
    const input: CaseInput = { ...formInput, answers: draft, signers: draft.signers };
    return { form: buildForm(input), issues: validateAnswers(input, true) };
  }, [formInput, draft]);
  // Form issues carry the unit (clause entry key, or 'case') and the field id.
  const allIssues = [...issues, ...saveIssues];
  const shownIssues = attempted ? allIssues : saveIssues;
  const allFields = [...form.shared, ...form.clauses.flatMap((c) => c.fields)];
  const issuesFor = (field: FormField, unit: string) =>
    shownIssues.filter(
      (issue) =>
        issue.fieldId === field.id &&
        (!issue.unit || issue.unit === unit || (unit === '@shared' && issue.unit === 'case')),
    );

  async function save() {
    setAttempted(true);
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
      if (edits.current === started) {
        setDirty(false);
        setCopied(false);
      }
      await api.reload();
      await reload();
      // The pressed button is disabled once saved; keep focus on the result instead of <body>.
      setFocusStatus(true);
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
        <h2 id="case-questions">3. Answers</h2>
        {editable ? (
          <div className="actions question-save">
            <span className="metadata" aria-live="polite" tabIndex={-1} ref={statusRef}>
              {dirty ? 'Unsaved changes' : action.status}
            </span>
            <button disabled={action.pending || !(dirty || copied)}>
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
        <div className="warning question-issues">
          <strong>Still to answer before generating</strong>
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
                  {plainIssue(issue, allFields)}
                </button>
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
              fieldsForIssues={allFields}
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
                fieldsForIssues={allFields}
              />
            ) : (
              <p className="metadata">Nothing to answer for this paragraph.</p>
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
                companyId={item.companyId}
                asAt={item.resolutionDate ?? currentDate()}
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
          <button disabled={action.pending || !(dirty || copied)}>
            {action.pending ? 'Saving…' : 'Save answers'}
          </button>
        </div>
      ) : null}
    </form>
  );
}

/** Under its own field the label is already visible: "Choose a person". */
function besideField(text: string, label: string) {
  const rest = text.startsWith(label + ': ') ? text.slice(label.length + 2) : text;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
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
  fieldsForIssues,
}: {
  unit: string;
  fields: FormField[];
  values: Answers;
  onChange: (unit: string, fieldId: string, value: AnswerValue | Answers) => void;
  issuesFor: (field: FormField) => Issue[];
  fieldsForIssues: FormField[];
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
                issues={issuesFor(field).map((issue) => ({
                  ...issue,
                  message: besideField(plainIssue(issue, fieldsForIssues), field.label),
                }))}
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
