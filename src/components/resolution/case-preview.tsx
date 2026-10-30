'use client';
import type { ResolvedDocument } from '@/domain/resolution/model';
import { getJson, postJson, type ClausesResponse, type Issue, type IssueField } from './api';
import type { CaseApi } from './case-workspace';
import { DocumentPreview } from './document-preview';
import { LoadState, useLoad } from './use-load';

type Preview = { resolved: ResolvedDocument | null; issues: Issue[]; fields: IssueField[] };

export function CasePreview({ api }: { api: CaseApi }) {
  const item = api.detail.case;
  const hasSelection = Boolean(item.selection);
  // Nothing to preview until a layout is chosen; asking the server would only return an error.
  const load = useLoad<Preview | null>(async () => {
    if (!hasSelection) return null;
    const [preview, clauses] = await Promise.all([
      postJson<{ resolved: ResolvedDocument | null; issues: Issue[] }>(
        `/api/resolution-cases/${item.id}/preview`,
        {},
      ),
      // The form names each field, so issues can be phrased against what the reader sees.
      getJson<ClausesResponse>(`/api/resolution-cases/${item.id}/clauses`).catch(() => null),
    ]);
    const form = clauses?.form;
    const fields: IssueField[] = form
      ? [...form.shared, ...form.clauses.flatMap((c) => c.fields)].map((f) => ({
          id: f.id,
          label: f.label,
          valueType: f.valueType,
          source: f.source as IssueField['source'],
        }))
      : [];
    return { ...preview, fields };
  }, [item.id, item.revision, hasSelection]);
  return (
    <section aria-labelledby="case-preview">
      <div className="page-header section-header">
        <h2 id="case-preview">4. Preview</h2>
        {hasSelection ? (
          <button type="button" onClick={() => void load.reload()} disabled={load.loading}>
            {load.loading ? 'Refreshing…' : 'Refresh preview'}
          </button>
        ) : null}
      </div>
      {!hasSelection ? (
        <p className="metadata">The preview appears once a layout is chosen in step 2.</p>
      ) : load.data ? (
        <DocumentPreview
          document={load.data.resolved}
          issues={load.data.issues}
          fields={load.data.fields}
        />
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
