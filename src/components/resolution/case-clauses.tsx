'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CLAUSE_CATEGORIES, type ClauseEntry, type OutputType } from '@/domain/resolution/model';
import { Icon } from '@/components/workspace';
import {
  getJson,
  latestPublished,
  newestPerClause,
  newRequestId,
  postJson,
  type AssemblyWithVersions,
  type AvailableClause,
  type ClausesResponse,
} from './api';
import type { CaseApi } from './case-workspace';
import { LoadState, useLoad } from './use-load';
import { ActionFeedback, useAction } from './use-action';

type Entry = { key?: string; clauseId: string; clauseVersionId: string };

export function CaseClauses({ api }: { api: CaseApi }) {
  const id = api.detail.case.id;
  const kind = api.detail.case.kind;
  const load = useLoad(async () => {
    const [model, library] = await Promise.all([
      getJson<ClausesResponse>(`/api/resolution-cases/${id}/clauses`),
      getJson<{ assemblies: AssemblyWithVersions[] }>('/api/resolution-assemblies').catch(() => ({
        assemblies: [] as AssemblyWithVersions[],
      })),
    ]);
    // Once a selection exists the clauses endpoint lists only assemblies for the current output
    // type. Add published assemblies of other types so the output type can be switched; the
    // server still validates eligibility when the selection is saved.
    const today = new Date().toISOString().slice(0, 10);
    const known = new Set(model.available.assemblies.map((a) => a.assemblyVersionId));
    const extra = library.assemblies
      .filter((a) => !a.archived && a.usageContexts.includes(kind))
      .flatMap((a) => {
        const v = latestPublished(a.versions);
        return v && !known.has(v.id) && (!v.effectiveDate || v.effectiveDate <= today)
          ? [
              {
                assemblyId: a.id,
                assemblyVersionId: v.id,
                version: v.version,
                name: a.name,
                outputTypeId: a.outputTypeId,
                description: a.description,
                starterClauseIds: v.starterClauseIds,
              },
            ]
          : [];
      });
    return {
      ...model,
      available: { ...model.available, assemblies: [...model.available.assemblies, ...extra] },
    };
  }, [id]);
  if (!load.data)
    return (
      <LoadState
        loading={load.loading}
        error={load.error}
        reload={() => void load.reload()}
        label="clauses"
      />
    );
  return (
    // Not keyed on the selection revision: remounting after each move/add/remove would drop
    // keyboard focus to <body> and lose the live-region announcement.
    <ClauseSelection
      api={api}
      model={load.data}
      outputTypes={[...load.data.outputTypes].sort((a, b) => a.order - b.order)}
      reload={load.reload}
    />
  );
}

function ClauseSelection({
  api,
  model,
  outputTypes,
  reload,
}: {
  api: CaseApi;
  model: ClausesResponse;
  outputTypes: OutputType[];
  reload: () => Promise<void>;
}) {
  const item = api.detail.case;
  const selection = model.selection;
  const action = useAction();
  const [search, setSearch] = useState('');
  const [outputTypeId, setOutputTypeId] = useState(
    selection?.outputTypeId || outputTypes[0]?.id || '',
  );
  const firstAssembly = (typeId: string) =>
    model.available.assemblies.find((a) => a.outputTypeId === typeId)?.assemblyVersionId || '';
  const [assemblyVersionId, setAssemblyVersionId] = useState(
    selection?.assemblyVersionId || firstAssembly(outputTypeId),
  );
  // Re-initialise the type and assembly pickers when the saved selection changes.
  const revision = selection?.revision ?? 0;
  const [seenRevision, setSeenRevision] = useState(revision);
  if (seenRevision !== revision) {
    setSeenRevision(revision);
    const typeId = selection?.outputTypeId || outputTypes[0]?.id || '';
    setOutputTypeId(typeId);
    setAssemblyVersionId(selection?.assemblyVersionId || firstAssembly(typeId));
  }
  const [removing, setRemoving] = useState<ClauseEntry | null>(null);
  const [reason, setReason] = useState('');
  const [announce, setAnnounce] = useState('');
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  /** Control to refocus once the saved selection re-renders (rows are keyed by clause key). */
  const focusAfter = useRef<{ key?: string; control: 'up' | 'down' | 'heading' } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const editable = api.canEdit;
  const busy = action.pending;

  useEffect(() => {
    const target = focusAfter.current;
    const root = listRef.current;
    if (!target || !root) return;
    focusAfter.current = null;
    const heading = root.querySelector<HTMLElement>('#selected-clauses');
    if (target.control === 'heading' || !target.key) return heading?.focus();
    const row = [...root.querySelectorAll<HTMLElement>('[data-clause-key]')].find(
      (el) => el.dataset.clauseKey === target.key,
    );
    const button = (control: string) =>
      row?.querySelector<HTMLButtonElement>(`button[data-control="${control}"]:not(:disabled)`);
    (button(target.control) ?? button(target.control === 'up' ? 'down' : 'up') ?? heading)?.focus();
  }, [revision]);

  // Clause edits always apply to the saved output type and assembly; only "Apply" sends the
  // locally edited values.
  const savedTypeId = selection?.outputTypeId || outputTypeId;
  const assemblies = model.available.assemblies.filter((a) => a.outputTypeId === outputTypeId);
  const library = newestPerClause(model.available.clauses).filter(
    (c) => !savedTypeId || c.outputTypeIds.includes(savedTypeId),
  );
  const entries = selection?.clauses ?? [];
  const info = (entry: ClauseEntry) => {
    const exact = model.available.clauses.find((c) => c.clauseVersionId === entry.clauseVersionId);
    const any = model.available.clauses.find((c) => c.clauseId === entry.clauseId);
    const newer = model.available.newerVersions.find((n) => n.key === entry.key);
    return {
      name:
        model.form?.clauses.find((c) => c.key === entry.key)?.clauseName ||
        exact?.name ||
        any?.name ||
        'Paragraph',
      category: exact?.category || any?.category || '',
      version: exact?.version || newer?.pinnedVersion || 0,
    };
  };
  const needsReason = (entry: ClauseEntry) =>
    Boolean(item.jobId) && item.kind !== 'board' && info(entry).category === 'Director';

  async function save(
    clauses: Entry[],
    message: string,
    extra: Record<string, unknown> = {},
    applyEdited = false,
  ) {
    const useEdited = applyEdited || !selection;
    const result = await action.run(
      () =>
        postJson<unknown>(`/api/resolution-cases/${item.id}/clauses`, {
          action: 'set_selection',
          expectedRevision: item.revision,
          requestId: newRequestId(),
          outputTypeId: useEdited ? outputTypeId : selection.outputTypeId,
          assemblyVersionId: useEdited ? assemblyVersionId : selection.assemblyVersionId,
          clauses: clauses.map((entry) => ({
            ...(entry.key ? { key: entry.key } : {}),
            clauseId: entry.clauseId,
            clauseVersionId: entry.clauseVersionId,
          })),
          ...extra,
        }),
      message,
    );
    if (result) {
      setAnnounce(message);
      await api.reload();
      await reload();
    }
    return result;
  }

  async function move(index: number, to: number, control?: 'up' | 'down') {
    if (busy || to < 0 || to >= entries.length || to === index) return;
    const next = [...entries];
    const [entry] = next.splice(index, 1);
    next.splice(to, 0, entry);
    if (control) focusAfter.current = { key: entry.key, control };
    if (!(await save(next, `Moved ${info(entry).name} to position ${to + 1}`)))
      focusAfter.current = null;
  }

  function add(clause: AvailableClause) {
    if (busy) return;
    void save(
      [...entries, { clauseId: clause.clauseId, clauseVersionId: clause.clauseVersionId }],
      `Added ${clause.name}`,
    );
  }

  async function remove(entry: ClauseEntry, why?: string) {
    if (busy) return;
    const rest = entries.filter((e) => e.key !== entry.key);
    const name = info(entry).name;
    // The removed row's controls disappear; move focus to the list heading.
    focusAfter.current = { control: 'heading' };
    const ok = await save(
      rest,
      `Removed ${name}`,
      why ? { removalReasons: { [entry.clauseId]: why } } : {},
    );
    if (ok) return setRemoving(null);
    focusAfter.current = null;
    if (action.lastCode.current === 'REASON_REQUIRED') {
      setRemoving(entry);
      setReason('');
    }
  }

  const grouped = useMemo(() => {
    const term = search.trim().toLowerCase();
    const matches = library.filter(
      (c) => !term || `${c.name} ${c.description} ${c.category}`.toLowerCase().includes(term),
    );
    return CLAUSE_CATEGORIES.map((category) => ({
      category,
      clauses: matches
        .filter((c) => c.category === category)
        .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)),
    })).filter((group) => group.clauses.length);
  }, [library, search]);

  const chosenAssembly = assemblies.find((a) => a.assemblyVersionId === assemblyVersionId);
  const typeChanged =
    selection &&
    (outputTypeId !== selection.outputTypeId || assemblyVersionId !== selection.assemblyVersionId);

  return (
    <section aria-labelledby="case-clauses">
      <h2 id="case-clauses">2. Wording</h2>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      <ActionFeedback
        error={action.error}
        status=""
        conflict={action.conflict}
        onReload={() => {
          void api.reload();
          void reload();
        }}
      />
      {model.form?.conflicts.length ? (
        <div className="warning" role="alert">
          <strong>Resolve before generating</strong>
          <ul>
            {model.form.conflicts.map((issue, i) => (
              <li key={i}>
                {issue.message}
                {issue.location ? <span className="metadata"> · {issue.location}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="toolbar">
        <label className="wide-select">
          Document type
          <select
            value={outputTypeId}
            disabled={!editable || action.pending}
            onChange={(event) => {
              setOutputTypeId(event.target.value);
              setAssemblyVersionId(firstAssembly(event.target.value));
            }}
          >
            {!outputTypeId ? <option value="">Select…</option> : null}
            {outputTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
        <label className="wide-select">
          Layout
          <select
            value={assemblyVersionId}
            disabled={!editable || action.pending}
            onChange={(event) => setAssemblyVersionId(event.target.value)}
          >
            <option value="">{assemblies.length ? 'Select…' : 'No layout available'}</option>
            {assemblies.map((a) => (
              <option key={a.assemblyVersionId} value={a.assemblyVersionId}>
                {a.name} · v{a.version}
              </option>
            ))}
          </select>
        </label>
        {editable && (!selection || typeChanged) ? (
          <button
            type="button"
            className="primary"
            disabled={!outputTypeId || !assemblyVersionId || action.pending}
            onClick={() => {
              if (selection)
                void save(
                  entries,
                  'Document type and layout changed. Each paragraph now uses its matching wording.',
                  {},
                  true,
                );
              // An empty first selection starts from the assembly's starter clauses (server rule).
              else void save([], `Started from ${chosenAssembly?.name || 'the layout'}`);
            }}
          >
            {selection ? 'Apply document type and layout' : 'Use this layout'}
          </button>
        ) : null}
        {typeChanged ? (
          <button
            type="button"
            className="quiet"
            onClick={() => {
              setOutputTypeId(selection!.outputTypeId);
              setAssemblyVersionId(selection!.assemblyVersionId);
            }}
          >
            Keep current
          </button>
        ) : null}
      </div>
      {!selection ? (
        <p className="metadata">Choose a document type and layout, then press “Use this layout”.</p>
      ) : (
        // Not inert while pending: that would blur the pressed control. Handlers ignore input
        // while a save is in flight instead.
        <div className="clause-picker" ref={listRef} aria-busy={busy}>
          <div className="clause-selected">
            <h3 id="selected-clauses" tabIndex={-1}>
              Paragraphs in this resolution ({entries.length})
            </h3>
            {typeChanged ? (
              <p className="metadata">
                Paragraph changes use the saved document type and layout until you apply the new
                ones.
              </p>
            ) : null}
            {entries.length ? (
              <ol className="selected-clause-list" aria-labelledby="selected-clauses">
                {entries.map((entry, index) => {
                  const meta = info(entry);
                  const newer = model.available.newerVersions.find((n) => n.key === entry.key);
                  return (
                    <li
                      key={entry.key}
                      data-clause-key={entry.key}
                      draggable={editable && !busy}
                      className={dragOver === index ? 'drag-over' : undefined}
                      onDragStart={(event) => {
                        dragFrom.current = index;
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', String(index));
                      }}
                      onDragOver={(event) => {
                        if (dragFrom.current === null) return;
                        event.preventDefault();
                        setDragOver(index);
                      }}
                      onDragLeave={() => setDragOver(null)}
                      onDragEnd={() => {
                        dragFrom.current = null;
                        setDragOver(null);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const from = dragFrom.current;
                        dragFrom.current = null;
                        setDragOver(null);
                        if (from !== null) void move(from, index);
                      }}
                    >
                      <div className="selected-clause-row">
                        <span className="clause-index" aria-hidden="true">
                          {index + 1}
                        </span>
                        <div className="clause-meta">
                          <strong>{meta.name}</strong>
                          <div className="metadata">
                            {meta.category}
                            {meta.version ? ` · v${meta.version}` : ''}
                          </div>
                          {newer && editable ? (
                            <div className="newer-version">
                              <span className="metadata">
                                v{newer.newerVersion} is published
                                {newer.hasWording
                                  ? '.'
                                  : ' but has no wording for this output type.'}
                              </span>{' '}
                              {newer.hasWording ? (
                                <button
                                  type="button"
                                  className="text-button"
                                  onClick={async () => {
                                    const message = `${meta.name} now uses v${newer.newerVersion}`;
                                    const ok = await action.run(
                                      () =>
                                        postJson(`/api/resolution-cases/${item.id}/clauses`, {
                                          action: 'accept_version',
                                          expectedRevision: item.revision,
                                          requestId: newRequestId(),
                                          key: entry.key,
                                          clauseVersionId: newer.newerVersionId,
                                        }),
                                      message,
                                    );
                                    if (!ok) return;
                                    setAnnounce(message);
                                    await api.reload();
                                    await reload();
                                  }}
                                >
                                  Use v{newer.newerVersion}
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        {editable ? (
                          <div className="reorder-controls">
                            <button
                              type="button"
                              className="quiet"
                              aria-label={`Move ${meta.name} up`}
                              data-control="up"
                              disabled={index === 0}
                              aria-disabled={busy || undefined}
                              onClick={() => void move(index, index - 1, 'up')}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="quiet"
                              aria-label={`Move ${meta.name} down`}
                              data-control="down"
                              disabled={index === entries.length - 1}
                              aria-disabled={busy || undefined}
                              onClick={() => void move(index, index + 1, 'down')}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="quiet danger"
                              aria-label={`Remove ${meta.name}`}
                              aria-disabled={busy || undefined}
                              onClick={() => {
                                if (busy) return;
                                if (needsReason(entry)) {
                                  setRemoving(entry);
                                  setReason('');
                                } else void remove(entry);
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        ) : null}
                      </div>
                      {removing?.key === entry.key ? (
                        <form
                          className="confirmation form-stack removal-reason"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void remove(entry, reason.trim());
                          }}
                        >
                          <label>
                            Why remove the default clause {meta.name}?
                            <textarea
                              required
                              value={reason}
                              onChange={(event) => setReason(event.target.value)}
                            />
                          </label>
                          <div className="actions">
                            <button className="primary" disabled={!reason.trim()}>
                              Remove {meta.name}
                            </button>
                            <button type="button" onClick={() => setRemoving(null)}>
                              Keep clause
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="metadata">No paragraphs yet. Add them from standard wording.</p>
            )}
          </div>
          {editable ? (
            <div className="clause-library-panel">
              <h3>Standard wording</h3>
              <label className="search">
                <span className="sr-only">Search standard wording</span>
                <Icon kind="search" />
                <input
                  type="search"
                  placeholder="Search standard wording"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              {grouped.length ? (
                grouped.map((group) => (
                  <div key={group.category} className="library-group">
                    <h4>{group.category}</h4>
                    <ul className="library-list">
                      {group.clauses.map((c) => {
                        const added = entries.some((e) => e.clauseId === c.clauseId);
                        return (
                          <li key={c.clauseId}>
                            <div>
                              <span>{c.name}</span>
                              <div className="metadata">
                                v{c.version}
                                {c.description ? ` · ${c.description}` : ''}
                              </div>
                            </div>
                            {/* aria-disabled keeps focus on the button once it reads "Added". */}
                            <button
                              type="button"
                              aria-disabled={added || entries.length >= 40 || busy || undefined}
                              aria-label={added ? `${c.name} added` : `Add ${c.name}`}
                              onClick={() => {
                                if (!added && entries.length < 40) add(c);
                              }}
                            >
                              {added ? 'Added' : 'Add'}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))
              ) : (
                <p className="metadata">
                  {library.length
                    ? 'No matching paragraphs'
                    : 'No standard wording exists for this document type yet.'}
                </p>
              )}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
