'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CLAUSE_CATEGORIES,
  type ClauseCategory,
  type OutputType,
  type UsageContext,
} from '@/domain/resolution/model';
import { Empty, formatDate, Icon, PageHeader, useWorkspace } from '@/components/workspace';
import {
  getJson,
  latest,
  latestPublished,
  newRequestId,
  postJson,
  USAGE_CONTEXTS,
  type AssemblyWithVersions,
  type ClauseWithVersions,
} from '@/components/resolution/api';
import { LoadState, useLoad } from '@/components/resolution/use-load';
import { ActionFeedback, useAction } from '@/components/resolution/use-action';
import { slugId } from '@/components/template-editor/fields';

type Tab = 'clauses' | 'assemblies' | 'outputs';

export default function TemplatesPage() {
  const { data } = useWorkspace();
  const [tab, setTab] = useState<Tab>('clauses');
  const [creating, setCreating] = useState(false);
  const load = useLoad(async () => {
    const [clauses, assemblies, types] = await Promise.all([
      getJson<{ clauses: ClauseWithVersions[] }>('/api/clause-templates?includeHidden=true'),
      getJson<{ assemblies: AssemblyWithVersions[] }>(
        '/api/resolution-assemblies?includeHidden=true',
      ),
      getJson<{ outputTypes: OutputType[] }>('/api/output-types'),
    ]);
    return {
      clauses: clauses.clauses,
      assemblies: assemblies.assemblies,
      outputTypes: types.outputTypes,
    };
  }, []);
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash === 'assemblies' || hash === 'outputs') setTab(hash);
  }, []);
  if (!data) return null;
  const canManage = data.actor.capabilities.includes('manage_templates');
  const choose = (next: Tab) => {
    setTab(next);
    setCreating(false);
    window.history.replaceState(window.history.state, '', '#' + next);
  };
  return (
    <>
      <Link href="/resolutions" className="back-link">
        <Icon kind="back" />
        Resolutions
      </Link>
      <PageHeader title="Clause library">
        {canManage && tab !== 'outputs' ? (
          <button
            type="button"
            className="primary"
            aria-expanded={creating}
            onClick={() => setCreating(!creating)}
          >
            {tab === 'clauses' ? 'New clause' : 'New assembly'}
          </button>
        ) : null}
      </PageHeader>
      <div className="filters" role="group" aria-label="Library sections">
        {(
          [
            ['clauses', 'Clauses', load.data?.clauses.filter((c) => !c.archived).length],
            ['assemblies', 'Assemblies', load.data?.assemblies.filter((a) => !a.archived).length],
            ...(canManage ? [['outputs', 'Output types', load.data?.outputTypes.length]] : []),
          ] as [Tab, string, number | undefined][]
        ).map(([key, label, count]) => (
          <button
            type="button"
            key={key}
            className={'filter' + (tab === key ? ' active' : '')}
            aria-pressed={tab === key}
            onClick={() => choose(key)}
          >
            {label}
            {count !== undefined ? <small>{count}</small> : null}
          </button>
        ))}
      </div>
      <LoadState
        loading={load.loading && !load.data}
        error={load.error}
        reload={() => void load.reload()}
        label="clause library"
      />
      {load.data ? (
        tab === 'clauses' ? (
          <ClauseLibrary
            clauses={load.data.clauses}
            canManage={canManage}
            creating={creating}
            onCreating={setCreating}
            reload={load.reload}
          />
        ) : tab === 'assemblies' ? (
          <AssemblyLibrary
            assemblies={load.data.assemblies}
            outputTypes={load.data.outputTypes}
            canManage={canManage}
            creating={creating}
            onCreating={setCreating}
            reload={load.reload}
          />
        ) : (
          <OutputTypes types={load.data.outputTypes} reload={load.reload} />
        )
      ) : null}
    </>
  );
}

function statusOf<T extends { version: number; status: string }>(versions: T[]) {
  const last = latest(versions);
  const published = latestPublished(versions);
  return { last, published };
}

function ClauseLibrary({
  clauses,
  canManage,
  creating,
  onCreating,
  reload,
}: {
  clauses: ClauseWithVersions[];
  canManage: boolean;
  creating: boolean;
  onCreating: (value: boolean) => void;
  reload: () => Promise<void>;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [act, setAct] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState('');
  const action = useAction();
  const acts = [...new Set(clauses.map((c) => c.governingAct).filter(Boolean))].sort();
  const groups = useMemo(() => {
    const term = query.trim().toLowerCase();
    const rows = clauses.filter(
      (c) =>
        (showHidden || (!c.hidden && !c.archived)) &&
        (!category || c.category === category) &&
        (!act || c.governingAct === act) &&
        (!term || `${c.name} ${c.description}`.toLowerCase().includes(term)),
    );
    return CLAUSE_CATEGORIES.map((name) => ({
      name,
      rows: rows
        .filter((c) => c.category === name)
        .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)),
    })).filter((group) => group.rows.length);
  }, [clauses, query, category, act, showHidden]);
  const update = (clause: ClauseWithVersions, patch: Record<string, unknown>, message: string) =>
    action
      .run(
        () =>
          postJson('/api/clause-templates', {
            action: 'update',
            requestId: newRequestId(),
            id: clause.id,
            expectedRevision: clause.revision,
            ...patch,
          }),
        message,
      )
      .then(async (ok) => {
        if (ok) await reload();
      });
  const filtered = Boolean(query || category || act);
  return (
    <>
      {creating ? (
        <CreateClause
          onCancel={() => onCreating(false)}
          onCreated={(id) => router.push('/templates/clauses/' + id)}
        />
      ) : null}
      <div className="toolbar">
        <label className="search">
          <span className="sr-only">Search clauses</span>
          <Icon kind="search" />
          <input
            type="search"
            placeholder="Search clauses"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {CLAUSE_CATEGORIES.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Governing Act</span>
          <select value={act} onChange={(event) => setAct(event.target.value)}>
            <option value="">All Acts</option>
            {acts.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="inline toolbar-check">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(event) => setShowHidden(event.target.checked)}
          />
          Show hidden and archived
        </label>
        {filtered ? (
          <button
            type="button"
            className="quiet"
            onClick={() => {
              setQuery('');
              setCategory('');
              setAct('');
            }}
          >
            Clear filters
          </button>
        ) : null}
      </div>
      <ActionFeedback
        error={action.error}
        status={action.status}
        conflict={action.conflict}
        onReload={() => void reload()}
      />
      {groups.length ? (
        groups.map((group) => (
          <section
            key={group.name}
            className="library-category"
            aria-labelledby={'cat-' + group.name}
          >
            <h2 id={'cat-' + group.name}>{group.name}</h2>
            <div className="table-wrap">
              <table className="library-table stack-table">
                <caption className="sr-only">{group.name} clauses</caption>
                <thead>
                  <tr>
                    <th>Clause</th>
                    <th>Latest version</th>
                    <th>Published</th>
                    <th>Act</th>
                    {canManage ? <th>Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((clause) => {
                    const { last, published } = statusOf(clause.versions);
                    return (
                      <tr key={clause.id}>
                        <td>
                          <Link href={'/templates/clauses/' + clause.id}>{clause.name}</Link>
                          {clause.hidden || clause.archived ? (
                            <div className="state">
                              {clause.archived ? 'Archived' : 'Hidden from new resolutions'}
                            </div>
                          ) : clause.description ? (
                            <div className="metadata">{clause.description}</div>
                          ) : null}
                        </td>
                        <td data-label="Latest">
                          {last ? `v${last.version} · ${last.status}` : '—'}
                          {last ? (
                            <div className="metadata">
                              Updated {formatDate(last.updatedAt.slice(0, 10))}
                            </div>
                          ) : null}
                        </td>
                        <td data-label="Published">
                          {published ? `v${published.version}` : 'Not yet'}
                        </td>
                        <td data-label="Act">{clause.governingAct || '—'}</td>
                        {canManage ? (
                          <td>
                            <div className="row-actions">
                              <button
                                type="button"
                                className="quiet"
                                aria-label={`Copy ${clause.name}`}
                                disabled={action.pending}
                                onClick={async () => {
                                  const copy = await action.run(
                                    () =>
                                      postJson<ClauseWithVersions>('/api/clause-templates', {
                                        action: 'copy',
                                        requestId: newRequestId(),
                                        sourceId: clause.id,
                                        name: `Copy of ${clause.name}`.slice(0, 160),
                                      }),
                                    `Copied ${clause.name}`,
                                  );
                                  if (copy) router.push('/templates/clauses/' + copy.id);
                                }}
                              >
                                Copy
                              </button>
                              {!clause.archived ? (
                                <button
                                  type="button"
                                  className="quiet"
                                  aria-label={`${clause.hidden ? 'Unhide' : 'Hide'} ${clause.name}`}
                                  disabled={action.pending}
                                  onClick={() =>
                                    void update(
                                      clause,
                                      { hidden: !clause.hidden },
                                      `${clause.name} ${clause.hidden ? 'shown in' : 'hidden from'} the library`,
                                    )
                                  }
                                >
                                  {clause.hidden ? 'Unhide' : 'Hide'}
                                </button>
                              ) : null}
                              {clause.archived ? (
                                <button
                                  type="button"
                                  className="quiet"
                                  aria-label={`Restore ${clause.name}`}
                                  onClick={() =>
                                    void update(
                                      clause,
                                      { archived: false },
                                      `${clause.name} restored`,
                                    )
                                  }
                                >
                                  Restore
                                </button>
                              ) : confirmArchive === clause.id ? (
                                <span className="inline-confirm">
                                  <button
                                    type="button"
                                    className="danger"
                                    onClick={() => {
                                      setConfirmArchive('');
                                      void update(
                                        clause,
                                        {
                                          archived: true,
                                          reason: 'Archived from the clause library',
                                        },
                                        `${clause.name} archived`,
                                      );
                                    }}
                                  >
                                    Archive {clause.name}
                                  </button>
                                  <button
                                    type="button"
                                    className="quiet"
                                    onClick={() => setConfirmArchive('')}
                                  >
                                    Keep
                                  </button>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className="quiet danger"
                                  aria-label={`Archive ${clause.name}`}
                                  onClick={() => setConfirmArchive(clause.id)}
                                >
                                  Archive
                                </button>
                              )}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      ) : (
        <Empty>
          {filtered ? 'No matching clauses' : 'No clauses yet'}
          {!filtered && canManage ? (
            <div>
              <button type="button" className="primary" onClick={() => onCreating(true)}>
                New clause
              </button>
            </div>
          ) : null}
        </Empty>
      )}
    </>
  );
}

function UsageChecks({
  value,
  onChange,
}: {
  value: UsageContext[];
  onChange: (value: UsageContext[]) => void;
}) {
  return (
    <fieldset className="full">
      <legend>Used for</legend>
      {USAGE_CONTEXTS.map((context) => (
        <label className="inline" key={context.value}>
          <input
            type="checkbox"
            checked={value.includes(context.value)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...value, context.value]
                  : value.filter((v) => v !== context.value),
              )
            }
          />
          {context.label}
        </label>
      ))}
    </fieldset>
  );
}

function CreateClause({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const action = useAction();
  const [requestId, setRequestId] = useState(newRequestId);
  const [form, setForm] = useState({
    name: '',
    category: 'Director' as ClauseCategory,
    governingAct: 'Companies Act 2016',
    displayOrder: '100',
    description: '',
    usageContexts: ['board'] as UsageContext[],
  });
  return (
    <section className="new-resolution" aria-labelledby="new-clause">
      <h2 id="new-clause">New clause</h2>
      <form
        className="form-grid"
        data-dirty={form.name ? 'true' : 'false'}
        onChange={() => setRequestId(newRequestId())}
        onSubmit={async (event) => {
          event.preventDefault();
          const created = await action.run(
            () =>
              postJson<ClauseWithVersions>('/api/clause-templates', {
                action: 'create',
                requestId,
                name: form.name.trim(),
                category: form.category,
                governingAct: form.governingAct.trim(),
                displayOrder: Number(form.displayOrder) || 0,
                description: form.description.trim(),
                usageContexts: form.usageContexts,
              }),
            'Clause created',
          );
          if (created) {
            event.currentTarget?.setAttribute('data-dirty', 'false');
            onCreated(created.id);
          }
        }}
      >
        <label className="full">
          Name
          <input
            required
            maxLength={160}
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </label>
        <label>
          Category
          <select
            value={form.category}
            onChange={(event) =>
              setForm({ ...form, category: event.target.value as ClauseCategory })
            }
          >
            {CLAUSE_CATEGORIES.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          Governing Act
          <input
            value={form.governingAct}
            maxLength={160}
            onChange={(event) => setForm({ ...form, governingAct: event.target.value })}
          />
        </label>
        <label>
          Display order
          <input
            type="number"
            min={0}
            value={form.displayOrder}
            onChange={(event) => setForm({ ...form, displayOrder: event.target.value })}
          />
        </label>
        <UsageChecks
          value={form.usageContexts}
          onChange={(usageContexts) => setForm({ ...form, usageContexts })}
        />
        <label className="full">
          Description
          <input
            maxLength={1000}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </label>
        <div className="full form-footer">
          <ActionFeedback error={action.error} status={action.status} />
          <div className="actions">
            <button className="primary" disabled={action.pending || !form.usageContexts.length}>
              Create clause
            </button>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

function AssemblyLibrary({
  assemblies,
  outputTypes,
  canManage,
  creating,
  onCreating,
  reload,
}: {
  assemblies: AssemblyWithVersions[];
  outputTypes: OutputType[];
  canManage: boolean;
  creating: boolean;
  onCreating: (value: boolean) => void;
  reload: () => Promise<void>;
}) {
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const action = useAction();
  const typeName = (id: string) => outputTypes.find((t) => t.id === id)?.name || id;
  const rows = assemblies.filter((a) => showArchived || !a.archived);
  return (
    <>
      {creating ? (
        <CreateAssembly
          outputTypes={outputTypes.filter((t) => t.active)}
          onCancel={() => onCreating(false)}
          onCreated={(id) => router.push('/templates/assemblies/' + id)}
        />
      ) : null}
      <div className="toolbar">
        <label className="inline toolbar-check">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          Show archived
        </label>
      </div>
      <ActionFeedback
        error={action.error}
        status={action.status}
        conflict={action.conflict}
        onReload={() => void reload()}
      />
      {rows.length ? (
        <div className="table-wrap">
          <table className="library-table stack-table">
            <caption className="sr-only">Assemblies</caption>
            <thead>
              <tr>
                <th>Assembly</th>
                <th>Output type</th>
                <th>Latest version</th>
                <th>Published</th>
                {canManage ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((assembly) => {
                const { last, published } = statusOf(assembly.versions);
                return (
                  <tr key={assembly.id}>
                    <td>
                      <Link href={'/templates/assemblies/' + assembly.id}>{assembly.name}</Link>
                      {assembly.archived ? <div className="state">Archived</div> : null}
                    </td>
                    <td data-label="Output type">{typeName(assembly.outputTypeId)}</td>
                    <td data-label="Latest">{last ? `v${last.version} · ${last.status}` : '—'}</td>
                    <td data-label="Published">
                      {published ? `v${published.version}` : 'Not yet'}
                    </td>
                    {canManage ? (
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="quiet"
                            aria-label={`Copy ${assembly.name}`}
                            onClick={async () => {
                              const copy = await action.run(
                                () =>
                                  postJson<AssemblyWithVersions>('/api/resolution-assemblies', {
                                    action: 'copy',
                                    requestId: newRequestId(),
                                    sourceId: assembly.id,
                                    name: `Copy of ${assembly.name}`.slice(0, 160),
                                  }),
                                `Copied ${assembly.name}`,
                              );
                              if (copy) router.push('/templates/assemblies/' + copy.id);
                            }}
                          >
                            Copy
                          </button>
                          <button
                            type="button"
                            className="quiet"
                            aria-label={`${assembly.archived ? 'Restore' : 'Archive'} ${assembly.name}`}
                            onClick={async () => {
                              const ok = await action.run(
                                () =>
                                  postJson('/api/resolution-assemblies', {
                                    action: 'update',
                                    requestId: newRequestId(),
                                    id: assembly.id,
                                    expectedRevision: assembly.revision,
                                    archived: !assembly.archived,
                                  }),
                                `${assembly.name} ${assembly.archived ? 'restored' : 'archived'}`,
                              );
                              if (ok) await reload();
                            }}
                          >
                            {assembly.archived ? 'Restore' : 'Archive'}
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No assemblies yet</Empty>
      )}
    </>
  );
}

function CreateAssembly({
  outputTypes,
  onCancel,
  onCreated,
}: {
  outputTypes: OutputType[];
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const action = useAction();
  const [requestId, setRequestId] = useState(newRequestId);
  const [form, setForm] = useState({
    name: '',
    outputTypeId: outputTypes[0]?.id || '',
    description: '',
    usageContexts: ['board'] as UsageContext[],
  });
  return (
    <section className="new-resolution" aria-labelledby="new-assembly">
      <h2 id="new-assembly">New assembly</h2>
      <form
        className="form-grid"
        data-dirty={form.name ? 'true' : 'false'}
        onChange={() => setRequestId(newRequestId())}
        onSubmit={async (event) => {
          event.preventDefault();
          const created = await action.run(
            () =>
              postJson<AssemblyWithVersions>('/api/resolution-assemblies', {
                action: 'create',
                requestId,
                name: form.name.trim(),
                outputTypeId: form.outputTypeId,
                description: form.description.trim(),
                usageContexts: form.usageContexts,
              }),
            'Assembly created',
          );
          if (created) {
            event.currentTarget?.setAttribute('data-dirty', 'false');
            onCreated(created.id);
          }
        }}
      >
        <label className="full">
          Name
          <input
            required
            maxLength={160}
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </label>
        <label>
          Output type
          <select
            value={form.outputTypeId}
            onChange={(event) => setForm({ ...form, outputTypeId: event.target.value })}
          >
            {outputTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
        <UsageChecks
          value={form.usageContexts}
          onChange={(usageContexts) => setForm({ ...form, usageContexts })}
        />
        <label className="full">
          Description
          <input
            maxLength={1000}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </label>
        <div className="full form-footer">
          <ActionFeedback error={action.error} status={action.status} />
          <div className="actions">
            <button className="primary" disabled={action.pending || !form.usageContexts.length}>
              Create assembly
            </button>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

function OutputTypes({ types, reload }: { types: OutputType[]; reload: () => Promise<void> }) {
  const action = useAction();
  const [name, setName] = useState('');
  const [body, setBody] = useState<'directors' | 'members'>('directors');
  return (
    <section aria-labelledby="output-types">
      <h2 id="output-types" className="sr-only">
        Output types
      </h2>
      <ActionFeedback error={action.error} status={action.status} />
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Output types</caption>
          <thead>
            <tr>
              <th>Output type</th>
              <th>Body</th>
              <th>ID</th>
              <th>State</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {types.map((type) => (
              <tr key={type.id}>
                <td>{type.name}</td>
                <td>{type.body === 'directors' ? 'Directors' : 'Members'}</td>
                <td>
                  <code>{type.id}</code>
                </td>
                <td>{type.active ? 'Active' : 'Inactive'}</td>
                <td>
                  <button
                    type="button"
                    className="quiet"
                    aria-label={`${type.active ? 'Deactivate' : 'Activate'} ${type.name}`}
                    onClick={async () => {
                      const ok = await action.run(
                        () =>
                          postJson('/api/output-types', {
                            action: 'update',
                            requestId: newRequestId(),
                            id: type.id,
                            active: !type.active,
                          }),
                        `${type.name} ${type.active ? 'deactivated' : 'activated'}`,
                      );
                      if (ok) await reload();
                    }}
                  >
                    {type.active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="disclosure">
        <summary>Add an output type</summary>
        <form
          className="form-grid"
          data-dirty={name ? 'true' : 'false'}
          onSubmit={async (event) => {
            event.preventDefault();
            const ok = await action.run(
              () =>
                postJson('/api/output-types', {
                  action: 'create',
                  requestId: newRequestId(),
                  id: slugId(
                    name,
                    types.map((t) => t.id),
                  ),
                  name: name.trim(),
                  body,
                  order: (types.at(-1)?.order ?? 0) + 10,
                }),
              `${name.trim()} added`,
            );
            if (ok) {
              setName('');
              await reload();
            }
          }}
        >
          <label>
            Name
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Body
            <select value={body} onChange={(e) => setBody(e.target.value as typeof body)}>
              <option value="directors">Directors</option>
              <option value="members">Members</option>
            </select>
          </label>
          {name.trim() ? (
            <p className="metadata full">
              ID:{' '}
              {slugId(
                name,
                types.map((t) => t.id),
              )}{' '}
              (stays the same if renamed)
            </p>
          ) : null}
          <div className="actions">
            <button disabled={action.pending}>Add output type</button>
          </div>
        </form>
      </details>
    </section>
  );
}
