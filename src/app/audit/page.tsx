'use client';
import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AuditEntryView } from '@/domain/resolution/records';
import { Empty, Icon, PageHeader, useWorkspace } from '@/components/workspace';
import { download, errorText, getJson } from '@/components/resolution/api';

const ENTITY_TYPES = [
  ['person', 'Person'],
  ['company_relationship', 'Company relationship'],
  ['company_profile', 'Company profile'],
  ['record_field', 'Custom field definition'],
  ['resolution_case', 'Resolution'],
  ['clause_template', 'Clause'],
  ['clause_version', 'Clause version'],
  ['assembly', 'Assembly'],
  ['assembly_version', 'Assembly version'],
  ['output_type', 'Output type'],
  ['document_generation', 'Generated document'],
  ['audit', 'Audit export'],
  ['user', 'User'],
] as const;

const klTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuala_Lumpur',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

type Filters = {
  companyId: string;
  entityType: string;
  action: string;
  actorId: string;
  from: string;
  to: string;
};
const empty: Filters = { companyId: '', entityType: '', action: '', actorId: '', from: '', to: '' };

function show(value: unknown) {
  if (value === undefined) return '—';
  if (value === null) return 'empty';
  if (typeof value === 'string') return value || 'empty';
  return JSON.stringify(value);
}

export default function AuditPage() {
  const { data } = useWorkspace();
  const [filters, setFilters] = useState<Filters>(empty);
  const [applied, setApplied] = useState<Filters | null>(null);
  const [entries, setEntries] = useState<AuditEntryView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState('');

  const query = (value: Filters, next?: string | null) => {
    const params = new URLSearchParams();
    for (const [key, v] of Object.entries(value)) if (v.trim()) params.set(key, v.trim());
    if (next) params.set('cursor', next);
    return params.toString();
  };
  async function search(value: Filters, more = false) {
    setLoading(true);
    setError('');
    try {
      const result = await getJson<{
        entries: AuditEntryView[];
        nextCursor: string | null;
        total?: number;
      }>('/api/audit?' + query(value, more ? cursor : null));
      setEntries(more ? [...entries, ...result.entries] : result.entries);
      setCursor(result.nextCursor);
      if (!more) setTotal(result.total ?? null);
      setApplied(value);
      if (!more) setOpen([]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }
  const allowed = Boolean(data?.actor.capabilities.includes('view_audit'));
  useEffect(() => {
    if (allowed) void search(empty);
  }, [allowed]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return null;
  const caps = data.actor.capabilities;
  if (!allowed)
    return (
      <>
        <PageHeader title="Audit log" />
        <Empty>You do not have access to the audit log.</Empty>
      </>
    );
  const set = (key: keyof Filters, value: string) => setFilters({ ...filters, [key]: value });
  return (
    <>
      <Link href="/resolutions" className="back-link">
        <Icon kind="back" />
        Resolutions
      </Link>
      <PageHeader title="Audit log">
        {caps.includes('export_audit') ? (
          <button
            type="button"
            disabled={exporting}
            onClick={async () => {
              setExporting(true);
              setStatus('');
              setError('');
              try {
                const body = Object.fromEntries(
                  Object.entries(applied ?? empty).filter(([, v]) => v.trim()),
                );
                await download(
                  '/api/audit/export',
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                  },
                  'audit.csv',
                );
                setStatus('CSV exported. The export itself is recorded in the audit log.');
              } catch (e) {
                setError(errorText(e));
              } finally {
                setExporting(false);
              }
            }}
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        ) : null}
      </PageHeader>
      <form
        className="toolbar audit-filters"
        onSubmit={(event) => {
          event.preventDefault();
          void search(filters);
        }}
      >
        <label>
          Company
          <select value={filters.companyId} onChange={(e) => set('companyId', e.target.value)}>
            <option value="">All companies</option>
            {data.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Record type
          <select value={filters.entityType} onChange={(e) => set('entityType', e.target.value)}>
            <option value="">All types</option>
            {ENTITY_TYPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Action
          <input value={filters.action} onChange={(e) => set('action', e.target.value)} />
        </label>
        <label>
          Actor
          <select value={filters.actorId} onChange={(e) => set('actorId', e.target.value)}>
            <option value="">Anyone</option>
            {data.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} />
        </label>
        <button className="primary" disabled={loading}>
          Apply filters
        </button>
        {JSON.stringify(filters) !== JSON.stringify(empty) ? (
          <button
            type="button"
            className="quiet"
            onClick={() => {
              setFilters(empty);
              void search(empty);
            }}
          >
            Clear filters
          </button>
        ) : null}
      </form>
      {error ? (
        <div className="feedback error" role="alert">
          {error}
        </div>
      ) : null}
      <p className="sr-only" role="status">
        {status || (loading ? 'Loading audit entries' : `${entries.length} entries shown`)}
      </p>
      {status ? <p className="success">{status}</p> : null}
      {total !== null ? (
        <p className="metadata">
          {entries.length} of {total} entries
        </p>
      ) : null}
      {entries.length ? (
        <div className="table-wrap">
          <table className="audit-table">
            <caption className="sr-only">Audit entries, newest first</caption>
            <thead>
              <tr>
                <th>Time (Malaysia, UTC+8)</th>
                <th>Actor</th>
                <th>Company</th>
                <th>Action</th>
                <th>Record</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const expanded = open.includes(entry.id);
                return (
                  <Fragment key={entry.id}>
                    <tr>
                      <td className="nowrap">
                        <time dateTime={entry.at}>{klTime.format(new Date(entry.at))}</time>
                      </td>
                      <td>{entry.actorName}</td>
                      <td>{entry.companyName || '—'}</td>
                      <td>
                        {entry.action.replaceAll('_', ' ')}
                        {entry.changes.length || entry.summary ? (
                          <div>
                            <button
                              type="button"
                              className="text-button"
                              aria-expanded={expanded}
                              onClick={() =>
                                setOpen(
                                  expanded
                                    ? open.filter((id) => id !== entry.id)
                                    : [...open, entry.id],
                                )
                              }
                            >
                              {expanded ? 'Hide changes' : `Show changes (${entry.changes.length})`}
                            </button>
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {entry.entityType ? entry.entityType.replaceAll('_', ' ') : '—'}
                        <div className="metadata">
                          <code>{entry.entityId.slice(0, 12)}</code>
                        </div>
                      </td>
                      <td>{entry.reason || '—'}</td>
                    </tr>
                    {expanded ? (
                      <tr className="audit-changes">
                        <td colSpan={6}>
                          {entry.summary ? <p>{entry.summary}</p> : null}
                          {entry.changes.length ? (
                            <table>
                              <caption className="sr-only">Changes</caption>
                              <thead>
                                <tr>
                                  <th>Field</th>
                                  <th>Before</th>
                                  <th>After</th>
                                </tr>
                              </thead>
                              <tbody>
                                {entry.changes.map((change, i) => (
                                  <tr key={i}>
                                    <td>
                                      <code>{change.path}</code>
                                    </td>
                                    <td className="change-value">{show(change.before)}</td>
                                    <td className="change-value">{show(change.after)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : !loading && applied ? (
        <Empty>No matching audit entries</Empty>
      ) : null}
      {cursor ? (
        <div className="actions">
          <button
            type="button"
            disabled={loading}
            onClick={() => void search(applied ?? empty, true)}
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      ) : null}
    </>
  );
}
