'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useWorkspace, Empty, BackToWork, formatDate, formatDatesIn, humanize } from './workspace';
import { canLeaveEditing } from './forms';
import { Overview } from './job-sections/overview';
import { Checklist } from './job-sections/checklist';
import { Documents } from './job-sections/documents';
import { RecordChanges } from './job-sections/record-changes';
import { Filing } from './job-sections/filing';
import { Correspondence } from './job-sections/correspondence';
const tabs = [
  'Overview',
  'Checklist',
  'Documents',
  'Record changes',
  'Filing',
  'Correspondence',
  'History',
];
export function JobWorkspace({ id }: { id: string }) {
  const { data } = useWorkspace();
  const [tab, setTab] = useState('Overview');
  if (!data) return null;
  const job = data.jobs.find((j) => j.id === id);
  if (!job) return <Empty>Job unavailable</Empty>;
  const company = data.companies.find((c) => c.id === job.companyId);
  return (
    <>
      <BackToWork />
      <div className="page-header">
        <h1>{job.title}</h1>
      </div>
      <dl className="facts track-facts">
        <div>
          <dt>Company</dt>
          <dd>
            <Link href={'/companies/' + job.companyId}>{company?.name}</Link>
          </dd>
        </div>
        <div>
          <dt>Job</dt>
          <dd>{job.state}</dd>
        </div>
        <div>
          <dt>Document</dt>
          <dd>
            {job.packs.at(-1)?.state || 'Draft'} · v{job.packs.at(-1)?.version || 1}
          </dd>
        </div>
        <div>
          <dt>Filing</dt>
          <dd>{job.filingState}</dd>
        </div>
      </dl>
      <nav className="section-nav" aria-label="Job sections">
        {tabs.map((item) => (
          <button
            className={tab === item ? 'active' : ''}
            aria-current={tab === item ? 'page' : undefined}
            key={item}
            onClick={async () => {
              if (await canLeaveEditing()) setTab(item);
            }}
          >
            {item}
          </button>
        ))}
      </nav>
      <div className="section-content">
        {tab === 'Overview' ? (
          <Overview job={job} data={data} />
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
            <h2 className="sr-only">History</h2>
            <ul className="list-plain">
              {[...job.history].reverse().map((event) => (
                <li key={event.id}>
                  <strong>{humanize(event.action)}</strong>
                  <p className="metadata">
                    {data.users.find((u) => u.id === event.actorId)?.name || event.actorId} ·{' '}
                    {formatDate(event.at)}
                  </p>
                  <p>{formatDatesIn(event.detail)}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
