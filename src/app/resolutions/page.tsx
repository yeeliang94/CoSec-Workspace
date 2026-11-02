'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ResolutionCase } from '@/domain/resolution/model';
import { caseStatus } from '@/domain/resolution/cases';
import { Empty, formatDay, Icon, PageHeader, useWorkspace } from '@/components/workspace';
import { CASE_KINDS, getJson, kindLabel } from '@/components/resolution/api';
import { LoadState, useLoad } from '@/components/resolution/use-load';
import { NewResolution } from '@/components/resolution/new-resolution';

export default function ResolutionsPage() {
  const { data } = useWorkspace();
  const [query, setQuery] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [kind, setKind] = useState('');
  const [state, setState] = useState('Open');
  const [ownerId, setOwnerId] = useState('');
  const [creating, setCreating] = useState(false);
  const cases = useLoad(
    () =>
      getJson<{ cases: ResolutionCase[] }>(
        '/api/resolution-cases' + (companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''),
      ),
    [companyId],
  );
  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (cases.data?.cases ?? [])
      .filter(
        (item) =>
          (!kind || item.kind === kind) &&
          (!state || item.state === state) &&
          (!ownerId || item.ownerId === ownerId) &&
          (!term ||
            [item.title, data?.companies.find((c) => c.id === item.companyId)?.name]
              .join(' ')
              .toLowerCase()
              .includes(term)),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [cases.data, query, kind, state, ownerId, data]);
  if (!data) return null;
  const caps = data.actor.capabilities;
  const canCreate = caps.includes('generate_documents') || caps.includes('prepare_job');
  const filtered = Boolean(query || kind || ownerId || companyId || state !== 'Open');
  const clearFilters = () => {
    setQuery('');
    setKind('');
    setOwnerId('');
    setCompanyId('');
    setState('Open');
  };
  // Filters other than the default "Open" state, which the empty text names instead.
  const narrowed = Boolean(query || kind || ownerId || companyId);
  const emptyText = narrowed
    ? 'No matching resolutions'
    : state === 'Open'
      ? 'No open resolutions'
      : state === 'Complete'
        ? 'No complete resolutions'
        : state === 'Cancelled'
          ? 'No cancelled resolutions'
          : 'No resolutions yet';
  const userName = (id: string) => data.users.find((user) => user.id === id)?.name || id;
  return (
    <>
      <PageHeader title="Resolutions">
        <div className="header-actions">
          <Link className="section-link" href="/templates">
            Templates
          </Link>
          {canCreate ? (
            <button type="button" className="primary" onClick={() => setCreating(true)}>
              <Icon kind="plus" />
              New resolution
            </button>
          ) : null}
        </div>
      </PageHeader>
      {creating ? <NewResolution onCancel={() => setCreating(false)} /> : null}
      <div className="toolbar">
        <label className="search">
          <span className="sr-only">Search resolutions</span>
          <Icon kind="search" />
          <input
            type="search"
            value={query}
            placeholder="Search resolutions"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Company</span>
          <select value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
            <option value="">All companies</option>
            {data.companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Kind</span>
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="">All kinds</option>
            {CASE_KINDS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">State</span>
          <select value={state} onChange={(event) => setState(event.target.value)}>
            <option value="">All states</option>
            <option>Open</option>
            <option>Complete</option>
            <option>Cancelled</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Owner</span>
          <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
            <option value="">All owners</option>
            {data.users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
        {filtered ? (
          <button type="button" className="quiet" onClick={clearFilters}>
            Clear filters
          </button>
        ) : null}
      </div>
      <LoadState
        loading={cases.loading && !cases.data}
        error={cases.error}
        reload={() => void cases.reload()}
        label="resolutions"
      />
      {cases.data ? (
        rows.length ? (
          <div className="table-wrap">
            <table className="resolution-table stack-table">
              <caption className="sr-only">Resolution cases</caption>
              <thead>
                <tr>
                  <th>Resolution</th>
                  <th>Kind</th>
                  <th>Company</th>
                  <th>Status</th>
                  <th>Owner</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const waitingOnMe =
                    item.state === 'Open' &&
                    item.review?.status === 'With reviewer' &&
                    item.review.reviewerId === data.actor.id;
                  return (
                    <tr key={item.id}>
                      <td>
                        <Link href={'/resolutions/' + item.id}>{item.title}</Link>
                      </td>
                      <td data-label="Kind">{kindLabel(item.kind)}</td>
                      <td data-label="Company">
                        <Link href={'/companies/' + item.companyId}>
                          {data.companies.find((c) => c.id === item.companyId)?.name || 'Company'}
                        </Link>
                      </td>
                      <td data-label="Status">
                        {waitingOnMe ? (
                          <strong>Waiting for your review</strong>
                        ) : (
                          caseStatus(item, userName)
                        )}
                      </td>
                      <td data-label="Owner">{userName(item.ownerId)}</td>
                      <td data-label="Updated" className="nowrap">
                        {formatDay(item.updatedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>
            {emptyText}
            {narrowed ? (
              <div>
                <button type="button" onClick={clearFilters}>
                  Clear filters
                </button>
              </div>
            ) : state ? (
              <div>
                <button type="button" onClick={() => setState('')}>
                  Show all states
                </button>
              </div>
            ) : null}
          </Empty>
        )
      ) : null}
    </>
  );
}
