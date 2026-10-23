'use client';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import type { Job, Workspace } from '@/domain/model';
import { currentDate, formatDate, Icon, Empty, PageHeader, useWorkspace } from './workspace';
export function WorkTable({ jobs, data }: { jobs: Job[]; data: Workspace }) {
  const { rememberWork } = useWorkspace();
  return (
    <div className="table-wrap">
      <table className="work-table">
        <caption className="sr-only">Company work and next actions</caption>
        <thead>
          <tr>
            <th>Company</th>
            <th>Job</th>
            <th>Next action</th>
            <th>Due</th>
            <th>Owner</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const company = data.companies.find((c) => c.id === job.companyId);
            const due = job.statutoryDue || job.internalTarget;
            return (
              <tr key={job.id}>
                <td>
                  <Link
                    id={'work-company-' + job.id}
                    onClick={() => rememberWork('work-company-' + job.id)}
                    href={'/companies/' + job.companyId}
                  >
                    {company?.name || 'Company'}
                  </Link>
                  <div className="metadata">{company?.registrationNumber}</div>
                </td>
                <td>
                  <Link
                    id={'work-job-' + job.id}
                    onClick={() => rememberWork('work-job-' + job.id)}
                    href={'/jobs/' + job.id}
                  >
                    {job.title}
                  </Link>
                  <div className="state">{job.state}</div>
                </td>
                <td>
                  {job.nextAction || 'Prepare supporting evidence'}
                  <div className="metadata">
                    {job.filingState === 'Ready' ? (
                      <span className="success">Ready for filing</span>
                    ) : job.filingState === 'Submitted' || job.filingState === 'Resubmitted' ? (
                      'Outcome outstanding'
                    ) : job.filingState === 'Queried' || job.filingState === 'Rejected' ? (
                      <span className="danger">{job.filingState}</span>
                    ) : job.blockers?.length && job.blockers[0] !== job.nextAction ? (
                      job.blockers[0]
                    ) : (
                      ''
                    )}
                  </div>
                </td>
                <td>
                  <span
                    className={
                      due && due < currentDate() && job.state !== 'Complete'
                        ? 'danger nowrap'
                        : 'nowrap'
                    }
                  >
                    {formatDate(due)}
                  </span>
                  <div className="metadata">
                    {job.statutoryDue
                      ? 'Manual statutory date'
                      : job.internalTarget
                        ? 'Internal target'
                        : 'Rule missing'}
                  </div>
                </td>
                <td>{data.users.find((u) => u.id === job.ownerId)?.name || 'Unassigned'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
const filters = ['All work', 'Assigned to me', 'Overdue', 'Review', 'Filing', 'Waiting'];
function matches(job: Job, filter: string, actorId: string) {
  if (filter === 'Assigned to me') return job.ownerId === actorId;
  if (filter === 'Overdue')
    return Boolean(
      (job.statutoryDue || job.internalTarget) &&
      (job.statutoryDue || job.internalTarget)! < currentDate() &&
      !['Complete', 'Cancelled'].includes(job.state),
    );
  if (filter === 'Review') return job.state === 'Awaiting review';
  if (filter === 'Filing')
    return ['Ready', 'Submitted', 'Resubmitted', 'Queried', 'Rejected'].includes(job.filingState);
  if (filter === 'Waiting') return job.state === 'Waiting on external information';
  return true;
}
export function WorkList({ mode = 'work' }: { mode?: 'work' | 'reviews' }) {
  const { data } = useWorkspace();
  const [filter, setFilter] = useState(mode === 'reviews' ? 'Review' : 'All work');
  const [query, setQuery] = useState('');
  const [activity, setActivity] = useState('');
  const [owner, setOwner] = useState('');
  const [sort, setSort] = useState('due');
  const [dueBefore, setDueBefore] = useState('');
  const [blocker, setBlocker] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setFilter(params.get('filter') || (mode === 'reviews' ? 'Review' : 'All work'));
    setQuery(params.get('q') || '');
    setActivity(params.get('activity') || '');
    setOwner(params.get('owner') || '');
    setSort(params.get('sort') || 'due');
    setDueBefore(params.get('before') || '');
    setBlocker(params.get('blocked') === '1');
  }, [mode]);
  function change(values: Record<string, string | boolean>) {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(values)) {
      if (value) params.set(key, String(value));
      else params.delete(key);
    }
    window.history.replaceState(
      null,
      '',
      window.location.pathname + (params.size ? '?' + params.toString() : ''),
    );
  }
  if (!data) return null;
  const base = data.jobs.filter((job) => {
    const company = data.companies.find((c) => c.id === job.companyId);
    return (
      (!query ||
        [job.title, company?.name, company?.registrationNumber]
          .join(' ')
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!activity || job.activity === activity) &&
      (!owner || job.ownerId === owner) &&
      (!dueBefore ||
        Boolean(
          (job.statutoryDue || job.internalTarget) &&
          (job.statutoryDue || job.internalTarget)! <= dueBefore,
        )) &&
      (!blocker || Boolean(job.blockers?.length))
    );
  });
  const jobs = base
    .filter((job) => matches(job, filter, data.actor.id))
    .sort((a, b) =>
      sort === 'company'
        ? (data.companies.find((c) => c.id === a.companyId)?.name || '').localeCompare(
            data.companies.find((c) => c.id === b.companyId)?.name || '',
          )
        : (a.statutoryDue || a.internalTarget || '9999').localeCompare(
            b.statutoryDue || b.internalTarget || '9999',
          ),
    );
  return (
    <>
      <PageHeader title={mode === 'reviews' ? 'Reviews' : 'My work'}>
        {data.actor.capabilities.includes('prepare_job') ? (
          <Link href="/jobs/new" className="button primary">
            <Icon kind="plus" />
            New job
          </Link>
        ) : null}
      </PageHeader>
      <div className="filters" aria-label="Work filters">
        {filters.map((item) => (
          <button
            className={'filter ' + (filter === item ? 'active' : '')}
            aria-pressed={filter === item}
            onClick={() => {
              setFilter(item);
              change({ filter: item });
            }}
            key={item}
          >
            {item}
            <small>{base.filter((job) => matches(job, item, data.actor.id)).length}</small>
          </button>
        ))}
      </div>
      <div className="toolbar">
        <label className="search">
          <span className="sr-only">Search jobs and companies</span>
          <Icon kind="search" />
          <input
            type="search"
            value={query}
            placeholder="Search company or job"
            onChange={(e) => {
              setQuery(e.target.value);
              change({ q: e.target.value });
            }}
          />
        </label>
        <label>
          <span className="sr-only">Activity</span>
          <select
            value={activity}
            onChange={(e) => {
              setActivity(e.target.value);
              change({ activity: e.target.value });
            }}
          >
            <option value="">All activities</option>
            <option value="W03">Annual returns</option>
            <option value="W04">Director changes</option>
            <option value="W05">Members and capital</option>
            {data.actor.capabilities.includes('view_bo') ? (
              <option value="W06">Beneficial ownership</option>
            ) : null}
          </select>
        </label>
        <label>
          <span className="sr-only">Owner</span>
          <select
            value={owner}
            onChange={(e) => {
              setOwner(e.target.value);
              change({ owner: e.target.value });
            }}
          >
            <option value="">All owners</option>
            {data.users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Sort work</span>
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              change({ sort: e.target.value });
            }}
          >
            <option value="due">Due date</option>
            <option value="company">Company name</option>
          </select>
        </label>
      </div>
      <details className="advanced-filters">
        <summary>More filters</summary>
        <div className="toolbar">
          <label>
            Due on or before
            <input
              type="date"
              value={dueBefore}
              onChange={(e) => {
                setDueBefore(e.target.value);
                change({ before: e.target.value });
              }}
            />
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={blocker}
              onChange={(e) => {
                setBlocker(e.target.checked);
                change({ blocked: e.target.checked });
              }}
            />
            With blockers
          </label>
        </div>
      </details>
      {jobs.length ? (
        <WorkTable jobs={jobs} data={data} />
      ) : (
        <Empty>
          <p>No matching jobs</p>
          <button
            onClick={() => {
              setQuery('');
              setActivity('');
              setOwner('');
              setFilter('All work');
              setDueBefore('');
              setBlocker(false);
              window.history.replaceState(null, '', window.location.pathname);
            }}
          >
            Clear filters
          </button>
        </Empty>
      )}
      <p className="caption" style={{ marginTop: 18 }}>
        {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}
      </p>
    </>
  );
}
