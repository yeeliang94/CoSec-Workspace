'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ResolutionCase, StepState } from '@/domain/resolution/model';
import { routeMatches } from '@/domain/resolution/cases';
import { canLeaveEditing } from '@/components/edit-guard';
import { Empty, formatDate, Icon, useWorkspace } from '@/components/workspace';
import { getJson, kindLabel, newRequestId, postJson, type CaseDetail } from './api';
import { LoadState, useLoad } from './use-load';
import { ActionFeedback, useAction } from './use-action';
import { CaseClauses } from './case-clauses';
import { CaseQuestions } from './case-questions';
import { CasePreview } from './case-preview';
import { CaseDocuments } from './case-documents';

export type CaseApi = {
  detail: CaseDetail;
  act: (action: string, payload?: Record<string, unknown>) => Promise<ResolutionCase>;
  reload: () => Promise<void>;
  setCase: (next: ResolutionCase) => void;
  canEdit: boolean;
};

const SECTIONS = [
  ['overview', 'Overview'],
  ['steps', 'Steps'],
  ['clauses', 'Clauses'],
  ['questions', 'Questions'],
  ['preview', 'Preview'],
  ['documents', 'Documents'],
  ['history', 'History'],
] as const;
type Section = (typeof SECTIONS)[number][0];

export function CaseWorkspace({ id }: { id: string }) {
  const { data } = useWorkspace();
  const [section, setSection] = useState<Section>('overview');
  const load = useLoad(() => getJson<CaseDetail>('/api/resolution-cases/' + id), [id]);
  useEffect(() => {
    const read = () => {
      const hash = window.location.hash.slice(1);
      if (SECTIONS.some(([key]) => key === hash)) setSection(hash as Section);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  if (!data) return null;
  if (!load.data)
    return (
      <>
        <Link href="/resolutions" className="back-link">
          <Icon kind="back" />
          Resolutions
        </Link>
        <LoadState
          loading={load.loading}
          error={load.error}
          reload={() => void load.reload()}
          label="resolution"
        />
      </>
    );
  const detail = load.data;
  const item = detail.case;
  const company = data.companies.find((c) => c.id === item.companyId);
  const job = item.jobId ? data.jobs.find((j) => j.id === item.jobId) : null;
  const caps = data.actor.capabilities;
  const canEdit =
    item.state === 'Open' && (caps.includes('generate_documents') || caps.includes('prepare_job'));
  const api: CaseApi = {
    detail,
    canEdit,
    reload: load.reload,
    setCase: (next) => load.setData((current) => (current ? { ...current, case: next } : current)),
    act: async (action, payload = {}) => {
      const next = await postJson<ResolutionCase>('/api/resolution-cases/' + id, {
        action,
        expectedRevision: item.revision,
        requestId: newRequestId(),
        ...payload,
      });
      load.setData((current) => (current ? { ...current, case: next } : current));
      return next;
    },
  };
  const choose = (key: Section) => {
    if (key === section || !canLeaveEditing()) return;
    setSection(key);
    window.history.replaceState(window.history.state, '', '#' + key);
  };
  return (
    <>
      <Link href="/resolutions" className="back-link">
        <Icon kind="back" />
        Resolutions
      </Link>
      <header className="record-heading">
        <div className="record-line">
          <Link href={'/companies/' + item.companyId}>{company?.name || 'Company'}</Link>
          <span className="metadata">·</span>
          <Link href={'/resolutions/companies/' + item.companyId} className="metadata-link">
            Company resolution settings
          </Link>
        </div>
        <h1>{item.title}</h1>
        <p className="metadata">
          {kindLabel(item.kind)} · {item.state}
          {job ? (
            <>
              {' '}
              · linked to <Link href={'/jobs/' + job.id}>{job.title}</Link>
            </>
          ) : null}{' '}
          · revision {item.revision}
        </p>
      </header>
      <nav className="section-nav" aria-label="Resolution sections">
        {SECTIONS.map(([key, label]) => (
          <button
            type="button"
            key={key}
            className={section === key ? 'active' : ''}
            aria-current={section === key ? 'page' : undefined}
            onClick={() => choose(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="section-content">
        {section === 'overview' ? (
          <Overview api={api} />
        ) : section === 'steps' ? (
          <Steps api={api} />
        ) : section === 'clauses' ? (
          <CaseClauses api={api} />
        ) : section === 'questions' ? (
          <CaseQuestions api={api} />
        ) : section === 'preview' ? (
          <CasePreview api={api} />
        ) : section === 'documents' ? (
          <CaseDocuments api={api} />
        ) : (
          <section aria-labelledby="case-history">
            <h2 id="case-history">History</h2>
            {item.history.length ? (
              <ul className="list-plain">
                {[...item.history].reverse().map((event) => (
                  <li key={event.id}>
                    <strong>{event.action.replaceAll('_', ' ')}</strong>
                    <p className="metadata">
                      {data.users.find((u) => u.id === event.actorId)?.name || event.actorId} ·{' '}
                      {formatDate(event.at)}
                    </p>
                    {event.detail ? <p>{event.detail}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No history yet</Empty>
            )}
          </section>
        )}
      </div>
    </>
  );
}

function Overview({ api }: { api: CaseApi }) {
  const { data } = useWorkspace();
  const item = api.detail.case;
  const details = useAction();
  const decision = useAction();
  const closing = useAction();
  const saved = {
    title: item.title,
    ownerId: item.ownerId,
    instructionDate: item.instructionDate || '',
    resolutionDate: item.resolutionDate || '',
    effectiveDate: item.effectiveDate || '',
  };
  const [form, setForm] = useState(saved);
  // When the case changes elsewhere (for example linking a W04 job sets the effective date),
  // fields the user has not touched follow the latest values, so saving never reverts them.
  const [base, setBase] = useState(saved);
  const savedKey = JSON.stringify(saved);
  if (savedKey !== JSON.stringify(base)) {
    setBase(saved);
    setForm((current) => {
      const next = { ...current };
      for (const key of Object.keys(saved) as (keyof typeof saved)[])
        if (current[key] === base[key]) next[key] = saved[key];
      return next;
    });
  }
  const [record, setRecord] = useState({
    status: item.decision.status,
    date: item.decision.date || '',
    note: item.decision.note,
    evidenceIds: item.decision.evidenceIds,
  });
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  if (!data) return null;
  const evidence = data.documents.filter((d) => d.companyId === item.companyId);
  const dirty =
    form.title !== item.title ||
    form.ownerId !== item.ownerId ||
    form.instructionDate !== (item.instructionDate || '') ||
    form.resolutionDate !== (item.resolutionDate || '') ||
    form.effectiveDate !== (item.effectiveDate || '');
  const decisionDirty =
    record.status !== item.decision.status ||
    record.date !== (item.decision.date || '') ||
    record.note !== item.decision.note ||
    record.evidenceIds.join() !== item.decision.evidenceIds.join();
  const open = item.steps.filter((s) => s.state !== 'Complete' && s.state !== 'Not applicable');
  const name = (id: string | null) => data.users.find((u) => u.id === id)?.name || id || '—';
  return (
    <>
      <section className="section" aria-labelledby="case-next">
        <h2 id="case-next">Next action</h2>
        <div className="next-action">
          {item.state !== 'Open' ? (
            <strong>
              {item.state}
              {item.cancellationReason ? `: ${item.cancellationReason}` : ''}
            </strong>
          ) : open[0] ? (
            <>
              <strong>{open[0].label}</strong>
              <p className="metadata">
                {open[0].state} · {name(open[0].ownerId)}
                {open[0].dueDate ? ` · due ${formatDate(open[0].dueDate)}` : ''}
              </p>
            </>
          ) : (
            <strong>All steps are complete or not applicable</strong>
          )}
        </div>
        <dl className="facts">
          <div>
            <dt>Owner</dt>
            <dd>{name(item.ownerId)}</dd>
          </div>
          <div>
            <dt>Resolution date</dt>
            <dd>{formatDate(item.resolutionDate)}</dd>
          </div>
          <div>
            <dt>Decision</dt>
            <dd>
              {item.decision.status}
              {item.decision.date ? ` · ${formatDate(item.decision.date)}` : ''}
            </dd>
          </div>
        </dl>
      </section>
      {!item.jobId && item.kind !== 'board' && api.canEdit ? <LinkDirectorJob api={api} /> : null}
      <section className="section" aria-labelledby="case-details">
        <h2 id="case-details">Details</h2>
        <form
          className="form-grid"
          data-dirty={dirty ? 'true' : 'false'}
          inert={details.pending}
          onSubmit={(event) => {
            event.preventDefault();
            void details.run(
              () =>
                api.act('update_details', {
                  title: form.title.trim(),
                  ownerId: form.ownerId,
                  instructionDate: form.instructionDate || null,
                  resolutionDate: form.resolutionDate || null,
                  effectiveDate: form.effectiveDate || null,
                }),
              'Details saved',
            );
          }}
        >
          <fieldset className="plain-fieldset full form-grid" disabled={!api.canEdit}>
            <label className="full">
              Title
              <input
                required
                maxLength={300}
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </label>
            <label>
              Owner
              <select
                value={form.ownerId}
                onChange={(event) => setForm({ ...form, ownerId: event.target.value })}
              >
                {data.users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Instruction date
              <input
                type="date"
                value={form.instructionDate}
                onChange={(event) => setForm({ ...form, instructionDate: event.target.value })}
              />
            </label>
            <label>
              Resolution date
              <input
                type="date"
                value={form.resolutionDate}
                onChange={(event) => setForm({ ...form, resolutionDate: event.target.value })}
              />
            </label>
            <label>
              Effective date
              <input
                type="date"
                value={form.effectiveDate}
                onChange={(event) => setForm({ ...form, effectiveDate: event.target.value })}
              />
            </label>
          </fieldset>
          {api.canEdit ? (
            <div className="full form-footer">
              <ActionFeedback
                error={details.error}
                status={details.status}
                conflict={details.conflict}
                onReload={() => void api.reload()}
              />
              <div className="actions">
                <button disabled={details.pending || !dirty}>
                  {details.pending ? 'Saving…' : 'Save details'}
                </button>
                {dirty ? <span className="metadata">Unsaved changes</span> : null}
              </div>
            </div>
          ) : null}
        </form>
      </section>
      <section className="section" aria-labelledby="case-decision">
        <h2 id="case-decision">Decision record</h2>
        <p className="metadata section-intro">
          Record the actual outcome and its evidence. A generated document does not record a
          decision by itself.
        </p>
        <form
          className="form-grid"
          data-dirty={decisionDirty ? 'true' : 'false'}
          inert={decision.pending}
          onSubmit={(event) => {
            event.preventDefault();
            void decision.run(
              () =>
                api.act('record_decision', {
                  status: record.status,
                  date: record.date || null,
                  note: record.note,
                  evidenceIds: record.evidenceIds,
                }),
              'Decision recorded',
            );
          }}
        >
          <fieldset className="plain-fieldset full form-grid" disabled={!api.canEdit}>
            <label>
              Outcome
              <select
                value={record.status}
                onChange={(event) =>
                  setRecord({
                    ...record,
                    status: event.target.value as typeof record.status,
                  })
                }
              >
                <option>Not recorded</option>
                <option>Passed</option>
                <option>Not passed</option>
              </select>
            </label>
            <label>
              Decision date
              <input
                type="date"
                value={record.date}
                onChange={(event) => setRecord({ ...record, date: event.target.value })}
              />
            </label>
            <label className="full">
              Note
              <textarea
                value={record.note}
                maxLength={4000}
                onChange={(event) => setRecord({ ...record, note: event.target.value })}
              />
            </label>
            <fieldset className="full">
              <legend>Evidence</legend>
              {evidence.length ? (
                evidence.map((doc) => (
                  <label className="inline" key={doc.id}>
                    <input
                      type="checkbox"
                      checked={record.evidenceIds.includes(doc.id)}
                      onChange={(event) =>
                        setRecord({
                          ...record,
                          evidenceIds: event.target.checked
                            ? [...record.evidenceIds, doc.id]
                            : record.evidenceIds.filter((value) => value !== doc.id),
                        })
                      }
                    />
                    {doc.title}
                  </label>
                ))
              ) : (
                <p className="metadata">No company evidence uploaded.</p>
              )}
            </fieldset>
          </fieldset>
          {api.canEdit ? (
            <div className="full form-footer">
              <ActionFeedback
                error={decision.error}
                status={decision.status}
                conflict={decision.conflict}
                onReload={() => void api.reload()}
              />
              <div className="actions">
                <button disabled={decision.pending || !decisionDirty}>
                  {decision.pending ? 'Saving…' : 'Record decision'}
                </button>
              </div>
            </div>
          ) : null}
        </form>
      </section>
      {api.canEdit ? (
        <section className="section" aria-labelledby="case-close">
          <h2 id="case-close">Close resolution</h2>
          <ActionFeedback
            error={closing.error}
            status={closing.status}
            conflict={closing.conflict}
            onReload={() => void api.reload()}
          />
          {cancelling ? (
            <form
              className="confirmation form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void closing.run(() => api.act('cancel', { reason }), 'Resolution cancelled');
              }}
            >
              <label>
                Reason for cancelling
                <textarea
                  required
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <div className="actions">
                <button className="primary" disabled={closing.pending || !reason.trim()}>
                  Cancel resolution
                </button>
                <button type="button" onClick={() => setCancelling(false)}>
                  Keep open
                </button>
              </div>
            </form>
          ) : (
            <div className="actions">
              <button
                type="button"
                disabled={closing.pending || open.length > 0}
                onClick={() => void closing.run(() => api.act('complete'), 'Resolution completed')}
              >
                Complete resolution
              </button>
              <button type="button" className="danger" onClick={() => setCancelling(true)}>
                Cancel resolution…
              </button>
              {open.length ? (
                <span className="metadata">
                  Complete or mark not applicable: {open.map((s) => s.label).join(', ')}
                </span>
              ) : null}
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}

function LinkDirectorJob({ api }: { api: CaseApi }) {
  const { data } = useWorkspace();
  const [jobId, setJobId] = useState('');
  const action = useAction();
  const item = api.detail.case;
  const jobs =
    data?.jobs.filter(
      (job) =>
        job.companyId === item.companyId &&
        job.activity === 'W04' &&
        job.state !== 'Cancelled' &&
        routeMatches(item.kind, job.route),
    ) ?? [];
  return (
    <section className="section" aria-labelledby="link-director-job">
      <h2 id="link-director-job">Link director change</h2>
      <form
        className="form-stack"
        data-dirty={jobId ? 'true' : 'false'}
        inert={action.pending}
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(() => api.act('link_job', { jobId }), 'Director change linked');
        }}
      >
        <label>
          Director change (W04)
          <select required value={jobId} onChange={(event) => setJobId(event.target.value)}>
            <option value="">Select director change…</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.title} · {job.personName} · {formatDate(job.effectiveDate)}
              </option>
            ))}
          </select>
        </label>
        <p className="metadata">
          Linking takes the person and effective date from this job. Record posting remains subject
          to W04 review.
        </p>
        {!jobs.length ? (
          <Link href={`/jobs/new?company=${item.companyId}&activity=W04`}>New director change</Link>
        ) : null}
        <ActionFeedback
          error={action.error}
          status={action.status}
          conflict={action.conflict}
          onReload={() => void api.reload()}
        />
        <div className="actions">
          <button disabled={action.pending || !jobId}>Link W04 job</button>
        </div>
      </form>
    </section>
  );
}

function Steps({ api }: { api: CaseApi }) {
  const { data } = useWorkspace();
  const item = api.detail.case;
  const action = useAction();
  const [label, setLabel] = useState('');
  const [ownerId, setOwnerId] = useState(data?.actor.id || '');
  const [dueDate, setDueDate] = useState('');
  const [dependsOn, setDependsOn] = useState<string[]>([]);
  const [naFor, setNaFor] = useState('');
  const [reason, setReason] = useState('');
  if (!data) return null;
  const name = (id: string) => data.users.find((u) => u.id === id)?.name || id;
  const done = (state: StepState) => state === 'Complete' || state === 'Not applicable';
  const update = (stepId: string, patch: Record<string, unknown>, message: string) =>
    action.run(() => api.act('update_step', { stepId, ...patch }), message);
  return (
    <section aria-labelledby="case-steps">
      <h2 id="case-steps">Steps</h2>
      <ActionFeedback
        error={action.error}
        status={action.status}
        conflict={action.conflict}
        onReload={() => void api.reload()}
      />
      <ol className="list-plain step-list">
        {item.steps.map((step) => {
          const blockers = step.dependsOn
            .map((dep) => item.steps.find((s) => s.id === dep))
            .filter((dep) => dep && !done(dep.state));
          return (
            <li key={step.id}>
              <div className="step-row">
                <div>
                  <h3>{step.label}</h3>
                  <p className="metadata">
                    <span className={step.state === 'Complete' ? 'success' : undefined}>
                      {step.state}
                    </span>{' '}
                    · {name(step.ownerId)}
                    {step.dueDate ? ` · due ${formatDate(step.dueDate)}` : ''}
                    {step.completedAt ? ` · completed ${formatDate(step.completedAt)}` : ''}
                  </p>
                  {step.reason ? <p className="metadata">Reason: {step.reason}</p> : null}
                  {blockers.length && !done(step.state) ? (
                    <p className="danger step-blocker">
                      Waiting for {blockers.map((b) => b!.label).join(', ')} to finish first
                    </p>
                  ) : null}
                </div>
                {api.canEdit && !done(step.state) ? (
                  <div className="actions step-actions">
                    {step.state === 'Pending' ? (
                      <button
                        type="button"
                        disabled={action.pending}
                        onClick={() =>
                          void update(step.id, { state: 'In progress' }, `${step.label} started`)
                        }
                      >
                        Start
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={action.pending || blockers.length > 0}
                      aria-label={`Mark ${step.label} complete`}
                      onClick={() =>
                        void update(step.id, { state: 'Complete' }, `${step.label} completed`)
                      }
                    >
                      Mark complete
                    </button>
                    <button
                      type="button"
                      className="quiet"
                      aria-label={`Mark ${step.label} not applicable`}
                      onClick={() => {
                        setNaFor(step.id);
                        setReason('');
                      }}
                    >
                      Not applicable…
                    </button>
                  </div>
                ) : null}
              </div>
              {naFor === step.id ? (
                <form
                  className="confirmation form-stack"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const ok = await update(
                      step.id,
                      { state: 'Not applicable', reason },
                      `${step.label} marked not applicable`,
                    );
                    if (ok) setNaFor('');
                  }}
                >
                  <label>
                    Why is {step.label} not applicable?
                    <textarea
                      required
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </label>
                  <div className="actions">
                    <button className="primary" disabled={!reason.trim() || action.pending}>
                      Mark not applicable
                    </button>
                    <button type="button" onClick={() => setNaFor('')}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
              {api.canEdit && !done(step.state) ? (
                <StepEdit
                  step={step}
                  users={data.users}
                  pending={action.pending}
                  onSave={(patch) => update(step.id, patch, `${step.label} updated`)}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      {api.canEdit ? (
        <details className="disclosure">
          <summary>Add a step</summary>
          <form
            className="form-grid"
            data-dirty={label ? 'true' : 'false'}
            onSubmit={async (event) => {
              event.preventDefault();
              const ok = await action.run(
                () =>
                  api.act('add_step', {
                    kind: 'custom',
                    label: label.trim(),
                    ownerId,
                    dueDate: dueDate || null,
                    dependsOn,
                  }),
                `Added ${label.trim()}`,
              );
              if (ok) {
                setLabel('');
                setDueDate('');
                setDependsOn([]);
              }
            }}
          >
            <label className="full">
              Step
              <input
                required
                maxLength={200}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>
            <label>
              Owner
              <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
                {data.users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Due date
              <input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </label>
            {item.steps.length ? (
              <fieldset className="full">
                <legend>Finish first</legend>
                {item.steps.map((step) => (
                  <label className="inline" key={step.id}>
                    <input
                      type="checkbox"
                      checked={dependsOn.includes(step.id)}
                      onChange={(event) =>
                        setDependsOn(
                          event.target.checked
                            ? [...dependsOn, step.id]
                            : dependsOn.filter((value) => value !== step.id),
                        )
                      }
                    />
                    {step.label}
                  </label>
                ))}
              </fieldset>
            ) : null}
            <div className="actions">
              <button disabled={action.pending || !label.trim()}>Add step</button>
            </div>
          </form>
        </details>
      ) : null}
    </section>
  );
}

function StepEdit({
  step,
  users,
  pending,
  onSave,
}: {
  step: ResolutionCase['steps'][number];
  users: { id: string; name: string }[];
  pending: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<unknown>;
}) {
  const [ownerId, setOwnerId] = useState(step.ownerId);
  const [dueDate, setDueDate] = useState(step.dueDate || '');
  const dirty = ownerId !== step.ownerId || dueDate !== (step.dueDate || '');
  return (
    <details className="advanced-filters step-edit">
      <summary>Change owner or due date</summary>
      <form
        className="toolbar"
        data-dirty={dirty ? 'true' : 'false'}
        onSubmit={(event) => {
          event.preventDefault();
          void onSave({ ownerId, dueDate: dueDate || null });
        }}
      >
        <label>
          Owner
          <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Due date
          <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </label>
        <button disabled={pending || !dirty} aria-label={`Save ${step.label} owner and due date`}>
          Save
        </button>
      </form>
    </details>
  );
}
