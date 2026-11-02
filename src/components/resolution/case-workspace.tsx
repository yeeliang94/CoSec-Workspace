'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ResolutionCase } from '@/domain/resolution/model';
import { caseStatus, isEditable } from '@/domain/resolution/cases';
import { canLeaveEditing, confirmAction, hasUnsavedEdits } from '@/components/edit-guard';
import {
  Empty,
  formatDate,
  formatDay,
  formatDatesIn,
  Icon,
  useWorkspace,
} from '@/components/workspace';
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
  ['prepare', 'Prepare'],
  ['documents', 'Word documents'],
  ['history', 'History'],
] as const;
type Section = (typeof SECTIONS)[number][0];
/** Links to the old separate tabs land on the matching part of the single Prepare page. */
const OLD_SECTIONS = ['overview', 'steps', 'clauses', 'questions', 'preview'];

/** History entries in words; the stored action names are internal. */
const HISTORY_LABELS: Record<string, string> = {
  created: 'Created',
  create: 'Created',
  link_job: 'Linked director change',
  update_details: 'Updated details',
  add_step: 'Added step',
  update_step: 'Updated step',
  record_decision: 'Recorded outcome',
  cancel: 'Cancelled',
  complete: 'Marked complete',
  send_for_review: 'Sent for review',
  review: 'Reviewed',
  reopen: 'Reopened for changes',
  set_custom: 'Changed company value',
  set_selection: 'Selected layout and wording',
  save_answers: 'Saved answers',
  accept_version: 'Updated paragraph wording',
  family_created: 'Started a Word document',
  document_generated: 'Created Word document',
  resolution_attached: 'Attached to job',
};
export function historyLabel(action: string) {
  if (HISTORY_LABELS[action]) return HISTORY_LABELS[action];
  const words = action
    .replace(/^resolution_case\./, '')
    .replaceAll(/[_.]/g, ' ')
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const isSection = (value: string | null): value is Section =>
  SECTIONS.some(([key]) => key === value);

export function CaseWorkspace({ id }: { id: string }) {
  const { data } = useWorkspace();
  const [section, setSection] = useState<Section>('prepare');
  const load = useLoad(() => getJson<CaseDetail>('/api/resolution-cases/' + id), [id]);
  useEffect(() => {
    // The open section lives in the address (?section=documents) so reloads and shared links
    // return to it. Older #hash links still work.
    const read = () => {
      const param = new URLSearchParams(window.location.search).get('section');
      const hash = window.location.hash.slice(1);
      if (isSection(param)) setSection(param);
      else if (isSection(hash)) setSection(hash);
      else if (OLD_SECTIONS.includes(hash)) {
        setSection('prepare');
        requestAnimationFrame(() => document.getElementById('prepare-' + hash)?.scrollIntoView());
      }
    };
    read();
    window.addEventListener('hashchange', read);
    window.addEventListener('popstate', read);
    return () => {
      window.removeEventListener('hashchange', read);
      window.removeEventListener('popstate', read);
    };
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
  const caps = data.actor.capabilities;
  const canEdit =
    isEditable(item) && (caps.includes('generate_documents') || caps.includes('prepare_job'));
  const userName = (userId: string) => data.users.find((u) => u.id === userId)?.name || userId;
  const api: CaseApi = {
    detail,
    canEdit,
    reload: load.reload,
    setCase: (next) => load.setData((current) => (current ? { ...current, case: next } : current)),
    act: async (action, payload = {}) => {
      if ((action === 'send_for_review' || action === 'complete') && hasUnsavedEdits())
        throw new Error('Save your changes before sending for review or marking complete.');
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
  const choose = async (key: Section) => {
    if (key === section || !(await canLeaveEditing())) return;
    setSection(key);
    const params = new URLSearchParams(window.location.search);
    if (key === 'prepare') params.delete('section');
    else params.set('section', key);
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + (params.size ? '?' + params.toString() : ''),
    );
  };
  return (
    <>
      <Link href="/resolutions" className="back-link">
        <Icon kind="back" />
        Resolutions
      </Link>
      <header className="record-heading resolution-heading">
        <div>
          <h1>{item.title}</h1>
          <p className="record-number">
            <Link href={'/companies/' + item.companyId}>{company?.name || 'Company'}</Link>{' '}
            {company?.registrationNumber}
          </p>
        </div>
        <div className="header-actions">
          <CompleteResolution api={api} />
        </div>
      </header>
      <DirectorRecordReminder item={item} />
      <ReviewPanel api={api} />
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
      <div className="split record-split">
        <div className="split-main section-content">
          {section === 'prepare' ? (
            <Prepare api={api} />
          ) : section === 'documents' ? (
            <>
              <CaseDocuments api={api} />
              <DecisionRecord api={api} />
            </>
          ) : (
            <section aria-labelledby="case-history">
              <h2 id="case-history">History</h2>
              {item.history.length ? (
                <ul className="list-plain case-history">
                  {[...item.history].reverse().map((event) => (
                    <li key={event.id}>
                      <strong>{historyLabel(event.action)}</strong>
                      <p className="metadata">
                        {data.users.find((u) => u.id === event.actorId)?.name || event.actorId},{' '}
                        {formatDay(event.at)}
                      </p>
                      {event.detail ? <p>{formatDatesIn(event.detail)}</p> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>No history yet</Empty>
              )}
            </section>
          )}
        </div>
        <aside className="detail-aside" aria-labelledby="case-facts">
          <h2 id="case-facts">Details</h2>
          <dl className="facts stacked">
            <div>
              <dt>Kind</dt>
              <dd>{kindLabel(item.kind)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{caseStatus(item, userName)}</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{userName(item.ownerId)}</dd>
            </div>
            <div>
              <dt>Revision</dt>
              <dd>{item.revision}</dd>
            </div>
          </dl>
          <p className="aside-link">
            <Link className="section-link" href={'/resolutions/companies/' + item.companyId}>
              Company details used in resolutions
            </Link>
          </p>
        </aside>
      </div>
    </>
  );
}

/** Everything the preparer fills in, on one page, ending with the hand-off to a reviewer. */
function Prepare({ api }: { api: CaseApi }) {
  return (
    <>
      <div id="prepare-overview">
        <Details api={api} />
      </div>
      <div id="prepare-clauses" className="section">
        <CaseClauses api={api} />
      </div>
      <div id="prepare-questions" className="section">
        <CaseQuestions api={api} />
      </div>
      <div id="prepare-preview" className="section">
        <CasePreview api={api} />
      </div>
      <SendForReview api={api} />
    </>
  );
}

function SendForReview({ api }: { api: CaseApi }) {
  const { data } = useWorkspace();
  const item = api.detail.case;
  const send = useAction();
  const closing = useAction();
  const [reviewerId, setReviewerId] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  if (!data || !api.canEdit) return null;
  const reviewers = data.users.filter(
    (user) => user.id !== data.actor.id && user.companyIds.includes(item.companyId),
  );
  return (
    <section className="section send-review" aria-labelledby="case-send">
      <h2 id="case-send">5. Send for review (optional)</h2>
      <form
        className="send-review-form"
        onSubmit={(event) => {
          event.preventDefault();
          void send.run(() => api.act('send_for_review', { reviewerId }), 'Sent for review');
        }}
      >
        <label>
          Reviewer
          <select required value={reviewerId} onChange={(e) => setReviewerId(e.target.value)}>
            <option value="">Choose a colleague…</option>
            {reviewers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
        <button disabled={send.pending || !item.selection}>
          {send.pending ? 'Sending…' : 'Send for review'}
        </button>
      </form>
      {!item.selection ? <p className="metadata">Choose the layout in step 2 first.</p> : null}
      <ActionFeedback
        error={send.error || closing.error}
        status={send.status || closing.status}
        conflict={send.conflict || closing.conflict}
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
            <textarea required value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <div className="actions">
            <button disabled={closing.pending || !reason.trim()}>Cancel resolution</button>
            <button type="button" onClick={() => setCancelling(false)}>
              Keep it
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="quiet cancel-link" onClick={() => setCancelling(true)}>
          Cancel this resolution…
        </button>
      )}
    </section>
  );
}

/** Where the resolution stands, and the one thing to do next for whoever is looking. */
function ReviewPanel({ api }: { api: CaseApi }) {
  const { data } = useWorkspace();
  const item = api.detail.case;
  const action = useAction();
  const [comment, setComment] = useState('');
  if (!data) return null;
  const review = item.review;
  const name = (id: string) => data.users.find((u) => u.id === id)?.name || id;
  const me = data.actor.id;
  const canTakeBack = me === review?.sentBy || me === review?.reviewerId;
  if (item.state !== 'Open')
    return item.cancellationReason ? (
      <div className="review-panel">Cancelled: {item.cancellationReason}</div>
    ) : null;
  if (!review) return null;
  const feedback = (
    <ActionFeedback
      error={action.error}
      status={action.status}
      conflict={action.conflict}
      onReload={() => void api.reload()}
    />
  );
  if (review.status === 'Returned')
    return (
      <div className="review-panel warning" role="status">
        <strong>Returned by {name(review.reviewerId)}</strong>
        <p>{review.comment}</p>
        <p className="metadata">
          Make the changes below, then send it for review again or mark it complete.
        </p>
      </div>
    );
  if (review.status === 'With reviewer' && review.reviewerId === me)
    return (
      <section className="review-panel" aria-labelledby="your-review">
        <h2 id="your-review">Your review</h2>
        <p>
          {name(review.sentBy)} sent this on {formatDate(review.sentAt)}. Check the preview below,
          then approve it or send it back.
        </p>
        <form className="form-stack" onSubmit={(event) => event.preventDefault()}>
          <label>
            Comment (needed if you send it back)
            <textarea value={comment} onChange={(event) => setComment(event.target.value)} />
          </label>
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={action.pending}
              onClick={() =>
                void action.run(
                  () => api.act('review', { decision: 'Approved', comment }),
                  'Approved',
                )
              }
            >
              Approve
            </button>
            <button
              type="button"
              disabled={action.pending || !comment.trim()}
              onClick={() =>
                void action.run(
                  () => api.act('review', { decision: 'Returned', comment }),
                  'Sent back for changes',
                )
              }
            >
              Send back for changes
            </button>
          </div>
        </form>
        {feedback}
      </section>
    );
  if (review.status === 'With reviewer')
    return (
      <div className="review-panel" role="status">
        <strong>With {name(review.reviewerId)} for review</strong>
        <p className="metadata">Sent {formatDate(review.sentAt)}. Editing is paused meanwhile.</p>
        {canTakeBack ? (
          <div className="actions">
            <button
              type="button"
              disabled={action.pending}
              onClick={() => void action.run(() => api.act('reopen'), 'Taken back')}
            >
              Take back to edit
            </button>
          </div>
        ) : null}
        {feedback}
      </div>
    );
  return (
    <div className="review-panel approved" role="status">
      <strong>Approved by {name(review.reviewerId)}</strong>
      {review.comment ? <p>{review.comment}</p> : null}
      <p className="metadata">Create the Word document under Word documents when needed.</p>
      {canTakeBack ? (
        <div className="actions">
          <button
            type="button"
            disabled={action.pending}
            onClick={() => void action.run(() => api.act('reopen'), 'Reopened for changes')}
          >
            Reopen for changes
          </button>
        </div>
      ) : null}
      {feedback}
    </div>
  );
}

/**
 * A director resolution records the decision only; the company's director list changes when
 * someone adds or ends the director on the company page.
 */
function DirectorRecordReminder({ item }: { item: ResolutionCase }) {
  if (item.kind === 'board' || item.state === 'Cancelled') return null;
  const change =
    item.kind === 'director_appointment'
      ? 'add the new director'
      : 'end the director’s appointment';
  return (
    <div className="warning">
      {item.state === 'Complete'
        ? 'This resolution does not change the company’s director list. '
        : 'Completing this resolution does not change the company’s director list. '}
      To record it, {change} under People on the{' '}
      <Link href={'/companies/' + item.companyId}>company page</Link>.
    </div>
  );
}

function CompleteResolution({ api }: { api: CaseApi }) {
  const { data } = useWorkspace();
  const action = useAction();
  if (
    api.detail.case.state !== 'Open' ||
    api.detail.case.review?.status === 'With reviewer' ||
    !data?.actor.capabilities.some((cap) => cap === 'prepare_job' || cap === 'generate_documents')
  )
    return null;
  return (
    <>
      <button
        type="button"
        className="primary"
        disabled={action.pending}
        onClick={async () => {
          // Completion is final: a completed resolution can no longer be edited or reopened.
          const ready = api.detail.generations.some((g) => g.status === 'Ready');
          const confirmed = await confirmAction({
            message: ready
              ? 'Mark this resolution complete? It can no longer be changed afterwards.'
              : 'This resolution has no Word document yet. Mark it complete anyway? It can no longer be changed afterwards.',
            confirmLabel: 'Mark complete',
            cancelLabel: 'Not yet',
          });
          if (confirmed) void action.run(() => api.act('complete'), 'Resolution completed');
        }}
      >
        {action.pending ? 'Completing…' : 'Mark complete'}
      </button>
      <ActionFeedback
        error={action.error}
        status={action.status}
        conflict={action.conflict}
        onReload={() => void api.reload()}
      />
    </>
  );
}

function Details({ api }: { api: CaseApi }) {
  const { data } = useWorkspace();
  const item = api.detail.case;
  const details = useAction();
  const saved = {
    title: item.title,
    ownerId: item.ownerId,
    instructionDate: item.instructionDate || '',
    resolutionDate: item.resolutionDate || '',
    effectiveDate: item.effectiveDate || '',
  };
  const [form, setForm] = useState(saved);
  // When the case changes elsewhere (for example in another tab),
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
  if (!data) return null;
  const dirty =
    form.title !== item.title ||
    form.ownerId !== item.ownerId ||
    form.instructionDate !== (item.instructionDate || '') ||
    form.resolutionDate !== (item.resolutionDate || '') ||
    form.effectiveDate !== (item.effectiveDate || '');
  return (
    <>
      <section className="section" aria-labelledby="case-details">
        <h2 id="case-details">1. Details</h2>
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
                {data.users
                  .filter(
                    (user) => user.companyIds.includes(item.companyId) || user.id === form.ownerId,
                  )
                  .map((user) => (
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
            <div className="form-grid form-pair compact-pair">
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
            </div>
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
    </>
  );
}

function DecisionRecord({ api }: { api: CaseApi }) {
  const { data } = useWorkspace();
  const item = api.detail.case;
  const decision = useAction();
  const [record, setRecord] = useState({
    status: item.decision.status,
    date: item.decision.date || '',
    note: item.decision.note,
    evidenceIds: item.decision.evidenceIds,
  });
  if (!data) return null;
  const evidence = data.documents.filter((d) => d.companyId === item.companyId);
  const decisionDirty =
    record.status !== item.decision.status ||
    record.date !== (item.decision.date || '') ||
    record.note !== item.decision.note ||
    record.evidenceIds.join() !== item.decision.evidenceIds.join();
  const canRecord = item.state === 'Open';
  return (
    <section className="section" aria-labelledby="case-decision">
      <h2 id="case-decision">Signed copy and outcome (optional)</h2>

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
        <fieldset className="plain-fieldset full form-grid" disabled={!canRecord}>
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
        {canRecord ? (
          <div className="full form-footer">
            <ActionFeedback
              error={decision.error}
              status={decision.status}
              conflict={decision.conflict}
              onReload={() => void api.reload()}
            />
            <div className="actions">
              <button disabled={decision.pending || !decisionDirty}>
                {decision.pending ? 'Saving…' : 'Save outcome'}
              </button>
            </div>
          </div>
        ) : null}
      </form>
    </section>
  );
}
