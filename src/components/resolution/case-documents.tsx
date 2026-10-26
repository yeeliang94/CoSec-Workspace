'use client';
import { useEffect, useRef, useState } from 'react';
import type { DocumentGeneration, GenerationRecord } from '@/domain/resolution/model';
import { Empty, formatDate, useWorkspace } from '@/components/workspace';
import { getJson, newRequestId, postJson } from './api';
import type { CaseApi } from './case-workspace';
import { ActionFeedback, useAction } from './use-action';

export function CaseDocuments({ api }: { api: CaseApi }) {
  const { data } = useWorkspace();
  const { case: item, generations, records } = api.detail;
  const generate = useAction();
  const [familyId, setFamilyId] = useState('');
  // One request id per intended generation, so a network retry is idempotent. It is bound to the
  // payload's case and selection revisions and dropped once the server has answered.
  const requestId = useRef('');
  const requestFor = useRef('');
  const [polling, setPolling] = useState(false);
  const pending = generations.some((g) => g.status === 'Pending');

  useEffect(() => {
    if (!pending) return;
    setPolling(true);
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      void api.reload();
      if (tries > 20) {
        window.clearInterval(timer);
        setPolling(false);
      }
    }, 2000);
    return () => {
      window.clearInterval(timer);
      setPolling(false);
    };
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return null;
  const caps = data.actor.capabilities;
  const canGenerate = api.canEdit && caps.includes('generate_documents');
  const families = new Map<string, DocumentGeneration[]>();
  for (const generation of [...generations].sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
    families.set(generation.familyId, [...(families.get(generation.familyId) ?? []), generation]);
  const familyTitle = (id: string) =>
    item.families.find((f) => f.id === id)?.title || 'Resolution document';

  return (
    <section aria-labelledby="case-documents">
      <h2 id="case-documents">Documents</h2>
      {canGenerate ? (
        <form
          className="generate-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!item.selection) return;
            const target = `${item.revision}:${item.selection.revision}:${familyId}`;
            if (!requestId.current || requestFor.current !== target) {
              requestId.current = newRequestId();
              requestFor.current = target;
            }
            const created = await generate.run(
              () =>
                postJson<DocumentGeneration>('/api/document-generations', {
                  requestId: requestId.current,
                  caseId: item.id,
                  expectedCaseRevision: item.revision,
                  selectionRevision: item.selection!.revision,
                  ...(familyId ? { familyId } : {}),
                }),
              'Generation started',
            );
            // Keep the id only when the outcome is unknown (network failure or an unreadable
            // server reply), where the request may have landed. A coded rejection is final.
            const code = generate.lastCode.current;
            if (created || (code && code !== 'ERROR')) requestId.current = '';
            if (created) {
              generate.setStatus(
                created.status === 'Ready'
                  ? 'Word document ready'
                  : created.status === 'Failed'
                    ? ''
                    : 'Generating the Word document…',
              );
              if (created.status === 'Failed')
                generate.setError(created.failure || 'Generation failed.');
              await api.reload();
            }
          }}
        >
          {families.size ? (
            <label>
              Generate as
              <select
                value={familyId}
                onChange={(event) => {
                  setFamilyId(event.target.value);
                  requestId.current = '';
                }}
              >
                <option value="">A new document</option>
                {[...families.keys()].map((id) => (
                  <option key={id} value={id}>
                    New version of {familyTitle(id)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="actions">
            <button className="primary" disabled={generate.pending || !item.selection || pending}>
              {generate.pending ? 'Generating…' : 'Generate Word document'}
            </button>
            {!item.selection ? (
              <span className="metadata">Choose clauses before generating.</span>
            ) : null}
            {polling ? <span className="metadata">Waiting for the document to finish…</span> : null}
          </div>
          <ActionFeedback
            error={generate.error}
            status={generate.status}
            conflict={generate.conflict}
            onReload={() => void api.reload()}
          />
        </form>
      ) : null}
      {families.size ? (
        [...families.entries()].map(([id, list]) => (
          <section key={id} className="family" aria-label={familyTitle(id)}>
            <h3>{familyTitle(id)}</h3>
            <ol className="list-plain generation-list" reversed>
              {[...list].reverse().map((generation) => (
                <Generation
                  key={generation.id}
                  generation={generation}
                  number={list.indexOf(generation) + 1}
                  records={records.filter((r) => r.generationId === generation.id)}
                  onChanged={api.reload}
                  companyId={item.companyId}
                />
              ))}
            </ol>
          </section>
        ))
      ) : (
        <Empty>No documents generated yet</Empty>
      )}
    </section>
  );
}

function Generation({
  generation,
  number,
  records,
  onChanged,
  companyId,
}: {
  generation: DocumentGeneration;
  number: number;
  records: GenerationRecord[];
  onChanged: () => Promise<void>;
  companyId: string;
}) {
  const { data } = useWorkspace();
  const action = useAction();
  const [mode, setMode] = useState<'' | 'review' | 'execution'>('');
  const [decision, setDecision] = useState<'Approved' | 'Returned'>('Approved');
  const [reason, setReason] = useState('');
  const [signer, setSigner] = useState('');
  const [capacity, setCapacity] = useState('');
  const [signedDate, setSignedDate] = useState('');
  const [evidenceId, setEvidenceId] = useState('');
  const [detail, setDetail] = useState<DocumentGeneration | null>(null);
  if (!data) return null;
  const name = (id: string) => data.users.find((u) => u.id === id)?.name || id;
  const reviews = records.filter((r) => r.kind === 'review');
  const executions = records.filter((r) => r.kind === 'execution');
  const lastReview = reviews.at(-1);
  const caps = data.actor.capabilities;
  const canReview =
    generation.status === 'Ready' &&
    caps.includes('review_pack') &&
    data.actor.id !== generation.createdBy;
  const canRecord = generation.status === 'Ready' && caps.includes('generate_documents');
  const people = [
    ...(generation.snapshot?.directors ?? []),
    ...(generation.snapshot?.members ?? []),
    ...(generation.snapshot?.companyPeople ?? []),
  ];
  const signerIds = [
    ...new Set([
      ...(generation.signers?.directors ?? []),
      ...(generation.signers?.members ?? []),
      ...(generation.signers?.certifiers ?? []),
    ]),
  ];
  const personName = (id: string) => people.find((p) => p.id === id)?.name || 'Signer';
  const evidence = data.documents.filter((d) => d.companyId === companyId);
  const post = (body: Record<string, unknown>, done: string) =>
    action
      .run(
        () =>
          postJson(`/api/document-generations/${generation.id}`, {
            requestId: newRequestId(),
            ...body,
          }),
        done,
      )
      .then(async (ok) => {
        if (ok) {
          setMode('');
          await onChanged();
        }
      });
  return (
    <li className="generation">
      <div className="generation-row">
        <div>
          <strong>Version {number}</strong>{' '}
          <span
            className={
              generation.status === 'Failed'
                ? 'danger'
                : generation.status === 'Ready'
                  ? undefined
                  : 'muted'
            }
          >
            · {generation.status}
          </span>
          {lastReview?.kind === 'review' ? (
            <span className={lastReview.decision === 'Approved' ? 'success' : 'danger'}>
              {' '}
              · {lastReview.decision === 'Approved' ? 'Approved' : 'Returned'} by{' '}
              {name(lastReview.actorId)}
            </span>
          ) : generation.status === 'Ready' ? (
            <span className="muted"> · Not reviewed</span>
          ) : null}
          <p className="metadata">
            Created by {name(generation.createdBy)} {formatDate(generation.createdAt)} ·{' '}
            {generation.clauseVersionIds.length} clauses · selection revision{' '}
            {generation.selectionRevision}
            {generation.sha256 ? (
              <>
                {' '}
                · SHA-256 <code>{generation.sha256.slice(0, 12)}</code>
              </>
            ) : null}
          </p>
          {generation.failure ? <p className="danger">{generation.failure}</p> : null}
        </div>
        <div className="actions">
          {generation.status === 'Ready' ? (
            <a
              className="button"
              href={`/api/document-generations/${generation.id}/download`}
              download
            >
              Download version {number}
            </a>
          ) : null}
          {canReview && !mode ? (
            <button type="button" onClick={() => setMode('review')}>
              Review version {number}
            </button>
          ) : null}
          {canRecord && !mode ? (
            <button type="button" className="quiet" onClick={() => setMode('execution')}>
              Record signed copy
            </button>
          ) : null}
        </div>
      </div>
      <ActionFeedback error={action.error} status={action.status} />
      {mode === 'review' ? (
        <form
          className="confirmation form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void post(
              { action: 'review', decision, reason: reason.trim() },
              `Version ${number} ${decision === 'Approved' ? 'approved' : 'returned'}`,
            );
          }}
        >
          <p>
            Your decision applies only to version {number} (SHA-256{' '}
            {generation.sha256?.slice(0, 12)}). A later version needs its own review.
          </p>
          <fieldset>
            <legend>Decision</legend>
            <label className="inline">
              <input
                type="radio"
                name={'decision-' + generation.id}
                checked={decision === 'Approved'}
                onChange={() => setDecision('Approved')}
              />
              Approve
            </label>
            <label className="inline">
              <input
                type="radio"
                name={'decision-' + generation.id}
                checked={decision === 'Returned'}
                onChange={() => setDecision('Returned')}
              />
              Return for changes
            </label>
          </fieldset>
          <label>
            {decision === 'Returned' ? 'Reason' : 'Note'}
            <textarea
              value={reason}
              required={decision === 'Returned'}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className="actions">
            <button
              className="primary"
              disabled={action.pending || (decision === 'Returned' && !reason.trim())}
            >
              {decision === 'Approved' ? `Approve version ${number}` : `Return version ${number}`}
            </button>
            <button type="button" onClick={() => setMode('')}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {mode === 'execution' ? (
        <form
          className="confirmation form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            void post(
              {
                action: 'record_execution',
                signerPersonId: signer,
                capacity: capacity.trim(),
                signedDate,
                evidenceId,
              },
              `Signed copy recorded against version ${number}`,
            );
          }}
        >
          <p className="full">
            Record a signature against version {number} exactly. Upload the signed copy as company
            evidence first.
          </p>
          <label>
            Signer
            <select required value={signer} onChange={(event) => setSigner(event.target.value)}>
              <option value="">Select…</option>
              {signerIds.map((id) => (
                <option key={id} value={id}>
                  {personName(id)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Capacity
            <input
              required
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
            />
          </label>
          <label>
            Signed on
            <input
              type="date"
              required
              value={signedDate}
              onChange={(event) => setSignedDate(event.target.value)}
            />
          </label>
          <label>
            Signed copy
            <select
              required
              value={evidenceId}
              onChange={(event) => setEvidenceId(event.target.value)}
            >
              <option value="">Select evidence…</option>
              {evidence.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.title}
                </option>
              ))}
            </select>
          </label>
          <div className="actions full">
            <button className="primary" disabled={action.pending}>
              Record signed copy
            </button>
            <button type="button" onClick={() => setMode('')}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {reviews.length || executions.length ? (
        <ul className="generation-records">
          {records.map((record) => (
            <li key={record.id} className="metadata">
              {record.kind === 'review'
                ? `${record.decision} by ${name(record.actorId)} ${formatDate(record.at)}${record.reason ? ` — ${record.reason}` : ''}`
                : `Signed by ${personName(record.signerPersonId)} (${record.capacity}) on ${formatDate(record.signedDate)}, recorded by ${name(record.actorId)}`}
            </li>
          ))}
        </ul>
      ) : null}
      <details
        className="advanced-filters"
        onToggle={(event) => {
          if ((event.target as HTMLDetailsElement).open && !detail)
            void getJson<DocumentGeneration | { generation: DocumentGeneration }>(
              `/api/document-generations/${generation.id}`,
            )
              .then((value) =>
                setDetail('generation' in value ? value.generation : (value as DocumentGeneration)),
              )
              .catch(() => undefined);
        }}
      >
        <summary>Source versions</summary>
        <dl className="source-versions">
          <dt>Assembly version</dt>
          <dd>
            <code>{generation.assemblyVersionId}</code>
          </dd>
          <dt>Clause versions (in order)</dt>
          <dd>
            {generation.clauseVersionIds.map((id) => (
              <code key={id}>{id}</code>
            ))}
          </dd>
          <dt>Output type</dt>
          <dd>{generation.outputTypeId}</dd>
          <dt>Records as at</dt>
          <dd>{formatDate(generation.snapshot?.asAt)}</dd>
          {detail?.resolved?.containsSamples ? (
            <>
              <dt>Samples</dt>
              <dd className="danger">Contains labelled sample values</dd>
            </>
          ) : null}
        </dl>
      </details>
    </li>
  );
}
