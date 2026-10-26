'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { TemplateStatus } from '@/domain/resolution/model';
import { formatDate, useWorkspace } from '@/components/workspace';
import { canLeaveEditing } from '@/components/edit-guard';
import { errorText, newRequestId, postJson } from './api';

type VersionLike = {
  id: string;
  version: number;
  status: TemplateStatus;
  revision: number;
  createdBy: string;
  createdAt: string;
  submittedBy: string | null;
  submittedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  returnReason: string | null;
  contentHash: string | null;
};

export function statusLabel(status: TemplateStatus) {
  return status;
}

/** Submit, return and publish controls for one template version. */
export function VersionLifecycle({
  version,
  url,
  dirty,
  diff,
  onChanged,
  onNewVersion,
}: {
  version: VersionLike;
  /** POST endpoint for this version. */
  url: string;
  dirty: boolean;
  /** Summary of changes against the previous published version. */
  diff: React.ReactNode;
  onChanged: () => Promise<void> | void;
  onNewVersion: (id: string) => void;
}) {
  const { data } = useWorkspace();
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [mode, setMode] = useState<'' | 'return' | 'publish'>('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  if (!data) return null;
  const actor = data.actor;
  const caps = actor.capabilities;
  const canManage = caps.includes('manage_templates');
  const independent = actor.id !== version.createdBy && actor.id !== version.submittedBy;
  const canReview = caps.includes('review_pack') && canManage && independent;
  const name = (id: string | null) => data.users.find((user) => user.id === id)?.name || id || '—';

  async function run(action: string, extra: Record<string, unknown> = {}, done = '') {
    setPending(action);
    setError('');
    setStatus('');
    try {
      const result = await postJson<{ id?: string; version?: { id: string } }>(url, {
        action,
        // A successor is created from an immutable published version, so it carries no revision.
        ...(action === 'new_version' ? {} : { expectedRevision: version.revision }),
        requestId: newRequestId(),
        ...extra,
      });
      setMode('');
      setReason('');
      setConfirmed(false);
      if (action === 'new_version') {
        const id = result.version?.id || result.id;
        if (id) onNewVersion(id);
        return;
      }
      setStatus(done);
      await onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending('');
    }
  }

  return (
    <div className="lifecycle">
      <p className="lifecycle-state">
        <strong>
          v{version.version} · {version.status}
        </strong>
        <span className="metadata">
          {' '}
          · created by {name(version.createdBy)}
          {version.submittedAt
            ? ` · submitted by ${name(version.submittedBy)} ${formatDate(version.submittedAt)}`
            : ''}
          {version.reviewedAt
            ? ` · ${version.status === 'Returned' ? 'returned' : 'published'} by ${name(version.reviewedBy)} ${formatDate(version.reviewedAt)}`
            : ''}
        </span>
      </p>
      {version.status === 'Returned' && version.returnReason ? (
        <p className="warning">Returned: {version.returnReason}</p>
      ) : null}
      {error ? (
        <p className="feedback error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="sr-only" role="status">
        {status}
      </p>
      {status ? <p className="success">{status}</p> : null}
      <div className="actions">
        {(version.status === 'Draft' || version.status === 'Returned') && canManage ? (
          <>
            <button
              type="button"
              disabled={Boolean(pending) || dirty}
              onClick={() => void run('submit', {}, `v${version.version} submitted for review`)}
            >
              {pending === 'submit' ? 'Submitting…' : `Submit v${version.version} for review`}
            </button>
            {dirty ? <span className="metadata">Save the draft before submitting.</span> : null}
          </>
        ) : null}
        {version.status === 'In review' && canReview && !mode ? (
          <>
            <button type="button" className="primary" onClick={() => setMode('publish')}>
              Review and publish v{version.version}
            </button>
            <button type="button" onClick={() => setMode('return')}>
              Return v{version.version}
            </button>
          </>
        ) : null}
        {version.status === 'In review' && !canReview ? (
          <span className="metadata">
            {independent
              ? 'Waiting for review by someone with review permission.'
              : 'Waiting for review by a different person.'}
          </span>
        ) : null}
        {(version.status === 'Published' || version.status === 'Superseded') && canManage ? (
          <button type="button" disabled={Boolean(pending)} onClick={() => void run('new_version')}>
            {pending === 'new_version' ? 'Creating…' : 'Create new version'}
          </button>
        ) : null}
      </div>
      {mode === 'return' ? (
        <form
          className="confirmation form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void run('return', { reason }, `v${version.version} returned`);
          }}
        >
          <label>
            Reason for returning v{version.version}
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} required />
          </label>
          <div className="actions">
            <button className="primary" disabled={!reason.trim() || Boolean(pending)}>
              {pending === 'return' ? 'Returning…' : `Return v${version.version}`}
            </button>
            <button type="button" onClick={() => setMode('')}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {mode === 'publish' ? (
        <form
          className="confirmation"
          onSubmit={(event) => {
            event.preventDefault();
            void run('publish', { confirm: true }, `v${version.version} published`);
          }}
        >
          <h3>Changes in v{version.version}</h3>
          <div className="diff-summary">{diff}</div>
          <label className="inline">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I have reviewed these changes and the sample preview
          </label>
          <div className="actions">
            <button className="primary" disabled={!confirmed || Boolean(pending)}>
              {pending === 'publish' ? 'Publishing…' : `Publish v${version.version}`}
            </button>
            <button type="button" onClick={() => setMode('')}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export function VersionHistory({
  versions,
  currentId,
  hrefFor,
}: {
  versions: VersionLike[];
  currentId: string;
  hrefFor: (id: string) => string;
}) {
  const { data } = useWorkspace();
  const name = (id: string | null) => data?.users.find((user) => user.id === id)?.name || id || '—';
  return (
    <ul className="list-plain version-list">
      {[...versions]
        .sort((a, b) => b.version - a.version)
        .map((version) => (
          <li key={version.id}>
            {version.id === currentId ? (
              <strong aria-current="true">v{version.version} (open)</strong>
            ) : (
              <Link
                href={hrefFor(version.id)}
                onNavigate={(event) => {
                  if (!canLeaveEditing()) event.preventDefault();
                }}
              >
                v{version.version}
              </Link>
            )}{' '}
            · {version.status}
            <p className="metadata">
              Created by {name(version.createdBy)} {formatDate(version.createdAt)}
              {version.reviewedAt
                ? ` · reviewed by ${name(version.reviewedBy)} ${formatDate(version.reviewedAt)}`
                : ''}
            </p>
          </li>
        ))}
    </ul>
  );
}
