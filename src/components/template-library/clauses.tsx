'use client';
import { canLeaveEditing } from '@/components/edit-guard';
import { Drawer } from '@/components/resolution/drawer';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CLAUSE_CATEGORIES,
  type ClauseCategory,
  type UsageContext,
} from '@/domain/resolution/model';
import { Empty, formatDate, Icon } from '@/components/workspace';
import {
  newRequestId,
  postJson,
  USAGE_CONTEXTS,
  type ClauseWithVersions,
  statusOf,
} from '@/components/resolution/api';
import { ActionFeedback, useAction } from '@/components/resolution/use-action';

export function ClauseLibrary({
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
            placeholder="Search standard wording"
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
        <div className="table-wrap">
          <table className="library-table stack-table">
            <caption className="sr-only">Standard wording by category</caption>
            <thead>
              <tr>
                <th>Paragraph</th>
                <th>Version</th>
                <th>Act</th>
                {canManage ? <th>Actions</th> : null}
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.name}>
                <tr className="group-row">
                  <th scope="colgroup" colSpan={canManage ? 4 : 3}>
                    {group.name}
                  </th>
                </tr>
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
                        ) : null}
                        {clause.description || last ? (
                          <details className="file-details">
                            <summary>Details</summary>
                            <dl className="record-meta">
                              {clause.description ? (
                                <div>
                                  <dt>Description</dt>
                                  <dd>{clause.description}</dd>
                                </div>
                              ) : null}
                              {last ? (
                                <div>
                                  <dt>Updated</dt>
                                  <dd>{formatDate(last.updatedAt.slice(0, 10))}</dd>
                                </div>
                              ) : null}
                            </dl>
                          </details>
                        ) : null}
                      </td>
                      <td data-label="Version">
                        {last ? `v${last.version} · ${last.status}` : '—'}
                        {published && published.id !== last?.id ? (
                          <dl className="record-meta">
                            <div>
                              <dt>Published</dt>
                              <dd>v{published.version}</dd>
                            </div>
                          </dl>
                        ) : null}
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
                                        reason: 'Archived from standard wording',
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
            ))}
          </table>
        </div>
      ) : (
        <Empty>
          {filtered ? 'No matching paragraphs' : 'No paragraphs yet'}
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

export function UsageChecks({
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
  const initialForm = {
    name: '',
    category: 'Director' as ClauseCategory,
    governingAct: 'Companies Act 2016',
    displayOrder: '100',
    description: '',
    usageContexts: ['board'] as UsageContext[],
  };
  const [form, setForm] = useState(initialForm);
  return (
    <Drawer title="New paragraph" onClose={onCancel}>
      <form
        className="form-grid"
        data-dirty={JSON.stringify(form) !== JSON.stringify(initialForm) ? 'true' : 'false'}
        onChange={() => setRequestId(newRequestId())}
        onSubmit={async (event) => {
          event.preventDefault();
          const formElement = event.currentTarget;
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
            formElement.setAttribute('data-dirty', 'false');
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
            <button
              type="button"
              onClick={async () => {
                if (await canLeaveEditing()) onCancel();
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </form>
    </Drawer>
  );
}
