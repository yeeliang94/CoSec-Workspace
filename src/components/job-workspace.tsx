'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useWorkspace, useDocumentTitle, Empty, BackToWork, formatDate } from './workspace';
import { canLeaveEditing } from './forms';
import { markCompanyOrigin } from './work-list';
import { Overview, JobSettings } from './job-sections/overview';
import { Checklist } from './job-sections/checklist';
import { Documents } from './job-sections/documents';
import { RecordChanges } from './job-sections/record-changes';
import { Filing } from './job-sections/filing';
import { Correspondence } from './job-sections/correspondence';
import {
  JobAction,
  activityName,
  eventName,
  readableDates,
  reviewRequestReady,
} from './job-sections/shared';
const tabs = [
  'Overview',
  'Checklist',
  'Documents',
  'Record changes',
  'Filing',
  'Correspondence',
  'History',
];
/** Keeps the selected section in the address (?tab=Checklist) without adding history entries. */
function writeTab(tab: string) {
  const params = new URLSearchParams(window.location.search);
  if (tab === 'Overview') params.delete('tab');
  else params.set('tab', tab);
  window.history.replaceState(
    window.history.state,
    '',
    window.location.pathname + (params.size ? '?' + params.toString() : ''),
  );
}
export function JobWorkspace({ id }: { id: string }) {
  const { data } = useWorkspace();
  const [tab, setTab] = useState('Overview');
  useDocumentTitle(data?.jobs.find((j) => j.id === id)?.title);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    if (requested && tabs.includes(requested)) setTab(requested);
  }, [id]);
  if (!data) return null;
  const job = data.jobs.find((j) => j.id === id);
  if (!job) return <Empty>Job unavailable</Empty>;
  const company = data.companies.find((c) => c.id === job.companyId);
  const pack = job.packs.at(-1);
  const version = pack?.version || 1;
  async function openTab(item: string) {
    if (item === tab || !(await canLeaveEditing())) return;
    setTab(item);
    writeTab(item);
  }
  return (
    <>
      <BackToWork />
      <header className="page-header record-heading job-heading">
        <div>
          <h1>{job.title}</h1>
          <p className="record-number">
            <Link
              href={'/companies/' + job.companyId}
              onClick={() =>
                markCompanyOrigin({ companyId: job.companyId, from: 'job', jobId: job.id })
              }
            >
              {company?.name}
            </Link>{' '}
            {company?.registrationNumber}
          </p>
        </div>
        {reviewRequestReady(job, data) ? (
          <div className="job-primary">
            <JobAction
              job={job}
              action="request_review"
              label={'Request review of v' + version}
              primary
            />
          </div>
        ) : null}
      </header>
      <nav className="section-nav" aria-label="Job sections">
        {tabs.map((item) => (
          <button
            className={tab === item ? 'active' : ''}
            aria-current={tab === item ? 'page' : undefined}
            key={item}
            onClick={() => void openTab(item)}
          >
            {item}
          </button>
        ))}
      </nav>
      <div className="split record-split job-split">
        <div className="split-main section-content">
          {tab === 'Overview' ? (
            <Overview job={job} data={data} openTab={(item) => void openTab(item)} />
          ) : tab === 'Checklist' ? (
            <Checklist job={job} data={data} />
          ) : tab === 'Documents' ? (
            <Documents job={job} data={data} />
          ) : tab === 'Record changes' ? (
            <RecordChanges job={job} data={data} />
          ) : tab === 'Filing' ? (
            <Filing job={job} data={data} />
          ) : tab === 'Correspondence' ? (
            <Correspondence job={job} data={data} />
          ) : (
            <section>
              <h2>History</h2>
              <ul className="list-plain job-history">
                {[...job.history].reverse().map((event) => (
                  <li key={event.id}>
                    <strong>{eventName(event.action)}</strong>
                    <p className="metadata">
                      {data.users.find((u) => u.id === event.actorId)?.name || event.actorId},{' '}
                      {formatDate(event.at)}
                    </p>
                    {event.detail ? <p>{readableDates(event.detail)}</p> : null}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <aside className="detail-aside">
          <h2>Details</h2>
          <dl className="facts stacked job-facts">
            <div>
              <dt>Job</dt>
              <dd>{job.state}</dd>
            </div>
            <div>
              <dt>Document</dt>
              <dd>
                {pack?.state || 'Draft'} (version {version})
              </dd>
            </div>
            <div>
              <dt>Filing</dt>
              <dd>{job.filingState}</dd>
            </div>
            <div>
              <dt>Activity</dt>
              <dd>{activityName(job.activity)}</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{data.users.find((u) => u.id === job.ownerId)?.name || 'Unassigned'}</dd>
            </div>
            <div>
              <dt>Internal target</dt>
              <dd>{formatDate(job.internalTarget)}</dd>
            </div>
            <div>
              <dt>Statutory deadline</dt>
              <dd>{job.statutoryDue ? formatDate(job.statutoryDue) : 'No approved date'}</dd>
            </div>
            <div>
              <dt>Billing</dt>
              <dd>{job.billingState}</dd>
            </div>
          </dl>
          <JobSettings job={job} data={data} />
        </aside>
      </div>
    </>
  );
}
