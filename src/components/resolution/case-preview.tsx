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
  return (
    <section aria-labelledby="case-preview">
      <div className="page-header section-header">
        <h2 id="case-preview">Preview</h2>
        <button type="button" onClick={() => void load.reload()} disabled={load.loading}>
          {load.loading ? 'Refreshing…' : 'Refresh preview'}
        </button>
      </div>
      <p className="metadata">Uses the saved answers and the records as they stand today.</p>
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
