'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type {
  AssemblyVersion,
  ClauseVersion,
  FieldDefinition,
  OutputType,
  RecordFieldDefinition,
  ResolvedDocument,
} from '@/domain/resolution/model';
import type { ConvertIssue } from '@/components/template-editor/convert';
import { plainText } from '@/components/template-editor/convert';
import {
  ApiError,
  download,
  errorText,
  getJson,
  latest,
  newRequestId,
  postJson,
  type AssemblyWithVersions,
  type ClauseWithVersions,
  type Issue,
} from './api';
import { DocumentPreview } from './document-preview';

type Kind = 'clause' | 'assembly';
type Template<K extends Kind> = K extends 'clause' ? ClauseWithVersions : AssemblyWithVersions;
type Version<K extends Kind> = K extends 'clause' ? ClauseVersion : AssemblyVersion;
export type Change = { path: string; before: unknown; after: unknown };

const base = (kind: Kind) =>
  kind === 'clause' ? '/api/clause-templates' : '/api/resolution-assemblies';

export function useTemplateVersion<K extends Kind>(kind: K, id: string) {
  const router = useRouter();
  // Read reactively so same-route `?version=` links (the version history) switch versions.
  const versionParam = useSearchParams().get('version');
  const [versionId, setVersionId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<{
    template: Template<K>;
    all: Template<K>[];
    version: Version<K>;
    issues: Issue[];
    changes: Change[];
    outputTypes: OutputType[];
    definitions: RecordFieldDefinition[];
    otherClauses: ClauseWithVersions[];
  } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  /** Increments when content is reloaded from the server, so editors remount. */
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    setVersionId(versionParam);
    setReady(true);
  }, [versionParam]);

  const load = useCallback(
    async (target: string | null) => {
      setLoading(true);
      setError('');
      try {
        const listUrl = base(kind) + '?includeHidden=true';
        const [list, types, definitions, clauses] = await Promise.all([
          getJson<Record<string, Template<K>[]>>(listUrl),
          getJson<{ outputTypes: OutputType[] }>('/api/output-types'),
          getJson<{ definitions: RecordFieldDefinition[] }>('/api/record-fields').catch(() => ({
            definitions: [] as RecordFieldDefinition[],
          })),
          kind === 'clause'
            ? null
            : getJson<{ clauses: ClauseWithVersions[] }>(
                '/api/clause-templates?includeHidden=true',
              ),
        ]);
        const all = (kind === 'clause' ? list.clauses : list.assemblies) as Template<K>[];
        const template = all.find((t) => t.id === id);
        if (!template) throw new ApiError('This template is unavailable.', 404);
        const versions = template.versions as Version<K>[];
        const chosen =
          versions.find((v) => v.id === target) || (latest(versions) as Version<K> | undefined);
        if (!chosen) throw new ApiError('This template has no versions.', 404);
        const detail = await getJson<{ version: Version<K>; issues: Issue[]; changes: Change[] }>(
          `${base(kind)}/${id}/versions/${chosen.id}`,
        );
        setState({
          template,
          all,
          version: detail.version,
          issues: detail.issues ?? [],
          changes: detail.changes ?? [],
          outputTypes: [...types.outputTypes].sort((a, b) => a.order - b.order),
          definitions: definitions.definitions,
          otherClauses:
            kind === 'clause' ? (all as ClauseWithVersions[]) : (clauses?.clauses ?? []),
        });
        setGeneration((n) => n + 1);
      } catch (e) {
        setError(errorText(e));
      } finally {
        setLoading(false);
      }
    },
    [id, kind],
  );

  useEffect(() => {
    if (ready) void load(versionId);
  }, [ready, versionId, load]);

  const selectVersion = (next: string) => {
    router.replace(
      `/templates/${kind === 'clause' ? 'clauses' : 'assemblies'}/${id}?version=${next}`,
    );
    setVersionId(next);
  };

  async function saveDraft(content: Record<string, unknown>) {
    if (!state) throw new Error('Not loaded');
    const result = await postJson<{ version: Version<K>; issues: Issue[] }>(
      `${base(kind)}/${id}/versions/${state.version.id}`,
      {
        action: 'save_draft',
        expectedRevision: state.version.revision,
        requestId: newRequestId(),
        ...content,
      },
    );
    setState((current) =>
      current
        ? {
            ...current,
            version: result.version,
            issues: result.issues ?? [],
            template: {
              ...current.template,
              versions: (current.template.versions as Version<K>[]).map((v) =>
                v.id === result.version.id ? result.version : v,
              ),
            } as Template<K>,
          }
        : current,
    );
    return result;
  }

  async function updateTemplate(patch: Record<string, unknown>) {
    if (!state) return;
    const next = await postJson<Template<K>>(base(kind), {
      action: 'update',
      requestId: newRequestId(),
      id,
      expectedRevision: state.template.revision,
      ...patch,
    });
    setState((current) => (current ? { ...current, template: next } : current));
  }

  return {
    state,
    error,
    loading,
    generation,
    reload: () => load(state?.version.id ?? versionId),
    selectVersion,
    saveDraft,
    updateTemplate,
    versionUrl: (versionId: string) => `${base(kind)}/${id}/versions/${versionId}`,
  };
}

/** Save button, dirty marker and polite live region for a draft. */
export function SaveBar({
  dirty,
  pending,
  readOnly,
  blocked,
  status,
  onSave,
}: {
  dirty: boolean;
  pending: boolean;
  readOnly: boolean;
  blocked: boolean;
  status: string;
  onSave: () => void;
}) {
  if (readOnly) return null;
  return (
    <div className="save-bar">
      <span className="metadata" role="status" aria-live="polite">
        {pending ? 'Saving…' : dirty ? 'Unsaved changes' : status}
      </span>
      <button
        type="button"
        className="primary"
        disabled={pending || !dirty || blocked}
        onClick={onSave}
        title={blocked ? 'Remove unsupported content before saving' : undefined}
      >
        {pending ? 'Saving…' : 'Save draft'}
      </button>
    </div>
  );
}

/** Validation issues; each navigates to its location when possible. */
export function IssueList({
  issues,
  converter,
  onNavigate,
  title = 'Validation',
}: {
  issues: Issue[];
  converter: { wording: string; name: string; issue: ConvertIssue }[];
  onNavigate: (target: { wording?: string; block?: number; location: string }) => void;
  title?: string;
}) {
  if (!issues.length && !converter.length) return null;
  const errors = issues.filter((i) => i.severity !== 'warning');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return (
    <div
      className={errors.length || converter.length ? 'warning issue-list' : 'issue-list'}
      role="region"
      aria-label={title}
    >
      <strong>
        {converter.length + errors.length
          ? `${converter.length + errors.length} to fix`
          : 'No blocking issues'}
        {warnings.length ? ` · ${warnings.length} to check` : ''}
      </strong>
      <ul>
        {converter.map((item, i) => (
          <li key={'c' + i}>
            <button
              type="button"
              className="text-button"
              onClick={() =>
                onNavigate({
                  wording: item.wording,
                  block: item.issue.blockIndex,
                  location: item.name,
                })
              }
            >
              {item.issue.message}
            </button>
            <span className="metadata">
              {' '}
              · {item.name}, block {item.issue.blockIndex + 1} · not saved until removed
            </span>
          </li>
        ))}
        {[...errors, ...warnings].map((issue, i) => {
          const block = /block (\d+)/.exec(issue.location);
          return (
            <li key={i} className={issue.severity === 'warning' ? 'muted' : undefined}>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  onNavigate({
                    block: block ? Number(block[1]) - 1 : undefined,
                    location: issue.location,
                  })
                }
              >
                {issue.severity === 'warning' ? 'Check: ' : ''}
                {issue.message}
              </button>
              {issue.location ? <span className="metadata"> · {issue.location}</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function SamplePreview({
  kind,
  versionId,
  outputTypes,
  defaultOutputType,
  draft,
  dirty,
}: {
  kind: Kind;
  versionId: string;
  outputTypes: OutputType[];
  defaultOutputType: string;
  draft: Record<string, unknown> | null;
  dirty: boolean;
}) {
  const [outputTypeId, setOutputTypeId] = useState(defaultOutputType);
  const [result, setResult] = useState<{ resolved: ResolvedDocument; issues: Issue[] } | null>(
    null,
  );
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [downloading, setDownloading] = useState(false);
  async function refresh() {
    setPending(true);
    setError('');
    try {
      setResult(
        await postJson('/api/templates/preview', {
          kind,
          versionId,
          ...(outputTypeId ? { outputTypeId } : {}),
          ...(draft ? { draft } : {}),
        }),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [outputTypeId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section aria-labelledby="sample-preview">
      <div className="page-header section-header">
        <h2 id="sample-preview">Sample preview</h2>
        <div className="header-actions">
          <button type="button" onClick={() => void refresh()} disabled={pending}>
            {pending ? 'Refreshing…' : 'Refresh preview'}
          </button>
          <button
            type="button"
            disabled={downloading}
            onClick={async () => {
              setDownloading(true);
              setError('');
              try {
                const params = new URLSearchParams({ kind, versionId, format: 'docx' });
                if (outputTypeId) params.set('outputTypeId', outputTypeId);
                await download('/api/templates/preview?' + params, undefined, 'sample.docx');
              } catch (e) {
                setError(errorText(e));
              } finally {
                setDownloading(false);
              }
            }}
          >
            {downloading ? 'Preparing…' : 'Download sample .docx'}
          </button>
        </div>
      </div>
      <div className="toolbar">
        <label>
          Output type
          <select value={outputTypeId} onChange={(event) => setOutputTypeId(event.target.value)}>
            {outputTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {dirty ? (
        <p className="warning">
          Preview includes unsaved edits. Download uses the last saved draft.
        </p>
      ) : null}
      {error ? (
        <p className="feedback error" role="alert">
          {error}
        </p>
      ) : null}
      {result ? <DocumentPreview document={result.resolved} issues={result.issues} /> : null}
    </section>
  );
}

/** Plain-language summary of what changed against the previous published version. */
export function DiffSummary({
  previous,
  current,
  wordings,
  serverChanges,
}: {
  previous: {
    version: number;
    fields: FieldDefinition[];
    source: string;
    effectiveDate: string | null;
  } | null;
  current: { fields: FieldDefinition[]; source: string; effectiveDate: string | null };
  wordings: { name: string; before: unknown[] | undefined; after: unknown[] | undefined }[];
  serverChanges: Change[];
}) {
  if (!previous) return <p>First version.</p>;
  const lines: string[] = [];
  for (const w of wordings) {
    const before = w.before ? plainText(w.before as never) : null;
    const after = w.after ? plainText(w.after as never) : null;
    if (before === null && after !== null) lines.push(`Added wording: ${w.name}`);
    else if (before !== null && after === null) lines.push(`Removed wording: ${w.name}`);
    else if (before !== after) lines.push(`Changed wording: ${w.name}`);
    else if (JSON.stringify(w.before) !== JSON.stringify(w.after))
      lines.push(`Changed formatting: ${w.name}`);
  }
  const ids = new Set([...previous.fields, ...current.fields].map((f) => f.id));
  for (const id of ids) {
    const a = previous.fields.find((f) => f.id === id);
    const b = current.fields.find((f) => f.id === id);
    if (!a && b) lines.push(`Added field: ${b.label}`);
    else if (a && !b) lines.push(`Removed field: ${a.label}`);
    else if (a && b && JSON.stringify(a) !== JSON.stringify(b))
      lines.push(
        a.label !== b.label
          ? `Renamed field: ${a.label} → ${b.label}`
          : `Changed field: ${b.label}`,
      );
  }
  if (previous.source !== current.source) lines.push('Changed source or basis');
  if (previous.effectiveDate !== current.effectiveDate)
    lines.push(
      `Effective date: ${previous.effectiveDate || '—'} → ${current.effectiveDate || '—'}`,
    );
  return (
    <>
      <p>Compared with published v{previous.version}:</p>
      {lines.length ? (
        <ul>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p>No content changes.</p>
      )}
      {serverChanges.length ? (
        <details className="advanced-filters">
          <summary>{serverChanges.length} detailed changes</summary>
          <ul className="compact-list">
            {serverChanges.slice(0, 60).map((change, i) => (
              <li key={i}>
                <code>{change.path}</code>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
