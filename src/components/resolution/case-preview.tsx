'use client';
import type { ResolvedDocument } from '@/domain/resolution/model';
import { postJson, type Issue } from './api';
import type { CaseApi } from './case-workspace';
import { DocumentPreview } from './document-preview';
import { LoadState, useLoad } from './use-load';

export function CasePreview({ api }: { api: CaseApi }) {
  const id = api.detail.case.id;
  const load = useLoad(
    () =>
      postJson<{ resolved: ResolvedDocument | null; issues: Issue[] }>(
        `/api/resolution-cases/${id}/preview`,
        {},
      ),
    [id, api.detail.case.revision],
  );
  // Before any wording is chosen there is nothing to preview: that is the next step, not an error.
  if (!api.detail.case.selection)
    return (
      <section aria-labelledby="case-preview">
        <h2 id="case-preview">4. Preview</h2>
        <p className="muted">No preview yet</p>
      </section>
    );
  return (
    <section aria-labelledby="case-preview">
      <div className="page-header section-header">
        <h2 id="case-preview">4. Preview</h2>
        <button type="button" onClick={() => void load.reload()} disabled={load.loading}>
          {load.loading ? 'Refreshing…' : 'Refresh preview'}
        </button>
      </div>
      <dl className="record-meta">
        <div>
          <dt>Answers</dt>
          <dd>Last saved</dd>
        </div>
        <div>
          <dt>Records</dt>
          <dd>Current</dd>
        </div>
      </dl>
      {load.data ? (
        <DocumentPreview document={load.data.resolved} issues={load.data.issues} />
      ) : (
        <LoadState
          loading={load.loading}
          error={load.error}
          reload={() => void load.reload()}
          label="preview"
        />
      )}
      {load.data && load.error ? (
        <p className="feedback error" role="alert">
          {load.error}
        </p>
      ) : null}
    </section>
  );
}
