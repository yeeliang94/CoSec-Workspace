'use client';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import type { Job, Workspace } from '@/domain/model';
import { currentDate, formatDate, Icon, Empty, PageHeader, useWorkspace } from './workspace';
import { readableDates } from './job-sections/shared';
const companyOriginKey = 'cosec.companyOrigin';
export type CompanyOrigin = { companyId: string; from: 'work' | 'job'; jobId?: string; at: number };
/** Notes where a company file was opened from, so its back link can return there. */
export function markCompanyOrigin(origin: Omit<CompanyOrigin, 'at'>) {
  try {
    sessionStorage.setItem(companyOriginKey, JSON.stringify({ ...origin, at: Date.now() }));
  } catch {}
}
/** The origin noted by the click that just opened this company, if any. */
export function readCompanyOrigin(companyId: string): CompanyOrigin | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(companyOriginKey) || 'null') as CompanyOrigin;
    return value && value.companyId === companyId && Date.now() - value.at < 10000 ? value : null;
  } catch {
    return null;
  }
}
function dueOf(job: Job) {
  return job.statutoryDue || job.internalTarget || '';
}
function isOpen(job: Job) {
  return !['Complete', 'Cancelled'].includes(job.state);
}
function addDays(date: string, days: number) {
  const value = new Date(date + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function daysBetween(from: string, to: string) {
  return Math.round(
    (new Date(to + 'T00:00:00Z').getTime() - new Date(from + 'T00:00:00Z').getTime()) / 86400000,
  );
}
function dueNote(job: Job, today: string) {
  const due = dueOf(job);
  if (!due || !isOpen(job)) return '';
  const days = daysBetween(due, today);
  if (days > 0) return days === 1 ? ' (1 day overdue)' : ` (${days} days overdue)`;
  if (days === 0) return ' (today)';
  return '';
}
function statusOf(job: Job): { text: string; tone: string } {
  if (job.filingState === 'Ready') return { text: 'Ready for filing', tone: 'success' };
  if (job.filingState === 'Submitted' || job.filingState === 'Resubmitted')
    return { text: 'Outcome outstanding', tone: '' };
  if (job.filingState === 'Queried' || job.filingState === 'Rejected')
    return { text: 'Filing ' + job.filingState.toLowerCase(), tone: 'danger' };
  return { text: job.state, tone: '' };
}
export function groupByDue(jobs: Job[]) {
  const today = currentDate();
  const week = addDays(today, 7);
  const groups: { label: string; jobs: Job[] }[] = [
    { label: 'Overdue', jobs: [] },
    { label: 'Due this week', jobs: [] },
    { label: 'Later', jobs: [] },
  ];
  for (const job of jobs) {
    const due = dueOf(job);
    if (due && due < today && isOpen(job)) groups[0].jobs.push(job);
    else if (due && due <= week) groups[1].jobs.push(job);
    else groups[2].jobs.push(job);
  }
  return groups.filter((group) => group.jobs.length);
}
export function WorkTable({
  jobs,
  data,
  grouped = false,
  showCompany = true,
}: {
  jobs: Job[];
  data: Workspace;
  grouped?: boolean;
  showCompany?: boolean;
}) {
  const { rememberWork } = useWorkspace();
  const today = currentDate();
  const columns = showCompany ? 7 : 5;
  const groups = grouped ? groupByDue(jobs) : [{ label: '', jobs }];
  return (
    <div className="table-wrap">
      <table className={'work-table' + (showCompany ? '' : ' compact')}>
        <caption className="sr-only">Company work and next actions</caption>
        <thead>
          <tr>
            {showCompany ? (
              <>
                <th>Company</th>
                <th>Registration no.</th>
              </>
            ) : null}
            <th>Job</th>
            <th>Status</th>
            <th>Next action</th>
            <th>Due</th>
            <th>Owner</th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.label || 'all'}>
            {group.label ? (
              <tr className="work-group">
                <th colSpan={columns} scope="colgroup">
                  {group.label}
                </th>
              </tr>
            ) : null}
            {group.jobs.map((job) => {
              const company = data.companies.find((c) => c.id === job.companyId);
              const due = dueOf(job);
              const overdue = Boolean(due && due < today && isOpen(job));
              const status = statusOf(job);
              return (
                <tr key={job.id}>
                  {showCompany ? (
                    <>
                      <td>
                        <Link
                          id={'work-company-' + job.id}
                          onClick={() => {
                            rememberWork('work-company-' + job.id);
                            markCompanyOrigin({ companyId: job.companyId, from: 'work' });
                          }}
                          href={'/companies/' + job.companyId}
                        >
                          {company?.name || 'Company'}
                        </Link>
                      </td>
                      <td className="muted nowrap">{company?.registrationNumber}</td>
                    </>
                  ) : null}
                  <td>
                    <Link
                      id={'work-job-' + job.id}
                      onClick={() => rememberWork('work-job-' + job.id)}
                      href={'/jobs/' + job.id}
                    >
                      {job.title}
                    </Link>
                  </td>
                  <td className={status.tone}>{status.text}</td>
                  <td>{readableDates(job.nextAction || 'Prepare supporting evidence')}</td>
                  <td className={overdue ? 'danger due-cell' : 'due-cell'}>
                    <span className="nowrap">{formatDate(due)}</span>
                    {dueNote(job, today) ? (
                      <>
                        {' '}
                        <span className="nowrap">{dueNote(job, today).trim()}</span>
                      </>
                    ) : null}
                  </td>
                  <td className="nowrap">
                    {data.users.find((u) => u.id === job.ownerId)?.name || 'Unassigned'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
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
  const defaultFilter = mode === 'reviews' ? 'Review' : 'All work';
  const untouched =
    filter === defaultFilter && !query && !activity && !owner && !dueBefore && !blocker;
  return (
    <>
      <PageHeader title={mode === 'reviews' ? 'Reviews' : 'My work'}>
        {mode !== 'reviews' && data.actor.capabilities.includes('prepare_job') ? (
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
            {data.users
              .filter((u) => u.id === data.actor.id || data.jobs.some((j) => j.ownerId === u.id))
              .map((user) => (
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
        <p className="results-line" role="status">
          {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}
        </p>
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
        <WorkTable jobs={jobs} data={data} grouped={sort === 'due'} />
      ) : untouched ? (
        <Empty>
          <p>{mode === 'reviews' ? 'Nothing awaiting review' : 'No work yet'}</p>
        </Empty>
      ) : (
        <Empty>
          <p>No matching jobs</p>
          <button
            onClick={() => {
              setQuery('');
              setActivity('');
              setOwner('');
              setFilter(defaultFilter);
              setDueBefore('');
              setBlocker(false);
              window.history.replaceState(null, '', window.location.pathname);
            }}
          >
            Clear filters
          </button>
        </Empty>
      )}
    </>
  );
}
