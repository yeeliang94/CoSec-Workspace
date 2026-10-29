'use client';
import { CapitalWorkspace } from '../registers/capital-workspace';
import { BoWorkspace } from '../registers/bo-workspace';
import type { JobSectionProps as Props } from './shared';
import Link from 'next/link';
import { formatDate, currentDate } from '../workspace';
import { JobAction, EvidenceLinks } from './shared';
export function RecordChanges({ job, data }: Props) {
  if (job.activity === 'W05') return <CapitalWorkspace job={job} data={data} />;
  if (job.activity === 'W06') return <BoWorkspace job={job} data={data} />;
  if (job.activity !== 'W04')
    return (
      <>
        <h2 className="sr-only">Corporate record changes</h2>
        {!job.dependencyIds.length ? <p className="muted">No linked director changes</p> : null}
        {job.dependencyIds.map((id) => (
          <p key={id}>
            <Link href={'/jobs/' + id}>
              {data.jobs.find((j) => j.id === id)?.title || 'Linked job'}
            </Link>
          </p>
        ))}
      </>
    );
  return (
    <>
      <h2>Director event</h2>
      <dl className="facts">
        <div>
          <dt>Route</dt>
          <dd className="event-route">{job.route?.replaceAll('_', ' ')}</dd>
        </div>
        <div>
          <dt>Director</dt>
          <dd>{job.personName}</dd>
        </div>
        <div>
          <dt>Effective date</dt>
          <dd>{formatDate(job.effectiveDate)}</dd>
        </div>
        <div>
          <dt>Corporate record</dt>
          <dd>
            {job.recordEventId
              ? job.effectiveDate! > currentDate()
                ? 'Approved and future dated'
                : 'Effective'
              : 'Proposed'}
          </dd>
        </div>
        <div>
          <dt>Filing</dt>
          <dd>{job.filingState}</dd>
        </div>
      </dl>
      <h3>Route and authority basis</h3>
      <p className="prose">{job.routeBasis}</p>
      <div className="section">
        <h3>Source evidence</h3>
        <EvidenceLinks ids={job.sourceEvidenceIds} data={data} />
      </div>
      {job.recordEventId ? (
        <p className="feedback status">
          Record event posted. Filing remains {job.filingState.toLowerCase()}.
        </p>
      ) : data.actor.capabilities.includes('confirm_record') ? (
        <JobAction
          job={job}
          action="post_record"
          label={'Post ' + job.route?.replaceAll('_', ' ') + ' record'}
          extra={{ confirmed: true }}
          confirmation={`Post the reviewed ${job.route?.replaceAll('_', ' ')} for ${job.personName}, effective ${formatDate(job.effectiveDate)}? This creates a dated corporate record independently of filing.`}
        />
      ) : null}
    </>
  );
}
