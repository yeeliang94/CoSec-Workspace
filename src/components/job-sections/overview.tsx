'use client';
import type { JobSectionProps as Props } from './shared';
import Link from 'next/link';
import { formatDate } from '../workspace';
import { jobFields, JobAction, EvidenceLinks } from './shared';
export function Overview({ job, data }: Props) {
  const { evidence, users, version } = jobFields(job, data);
  const prepare = data.actor.capabilities.includes('prepare_job');
  const review = data.actor.capabilities.includes('review_pack');
  return (
    <>
      <section className="section">
        <h2>Next action</h2>
        <p>{job.nextAction || 'Prepare supporting evidence'}</p>
        {job.blockers?.some((blocker) => blocker !== job.nextAction) ? (
          <div className="warning">
            <ul>
              {job.blockers
                .filter((blocker) => blocker !== job.nextAction)
                .map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
            </ul>
          </div>
        ) : null}
        <dl className="facts">
          <div>
            <dt>Owner</dt>
            <dd>{data.users.find((u) => u.id === job.ownerId)?.name}</dd>
          </div>
          <div>
            <dt>Internal target</dt>
            <dd>{formatDate(job.internalTarget)}</dd>
          </div>
          <div>
            <dt>Statutory deadline</dt>
            <dd>{job.statutoryDue ? formatDate(job.statutoryDue) : 'No approved date'}</dd>
          </div>
        </dl>
        {job.deadlineReviewRequired ? (
          <div className="warning">
            Manual deadline requires review.
            {job.manualDateProposal
              ? ` Proposed ${formatDate(job.manualDateProposal.date)}. The existing operative date is retained.`
              : ''}
          </div>
        ) : null}
        {job.manualDateBasis ? (
          <details className="disclosure">
            <summary>Deadline basis</summary>
            <div>
              <p>{job.manualDateBasis}</p>
              <EvidenceLinks
                ids={job.manualDateEvidenceId ? [job.manualDateEvidenceId] : []}
                data={data}
              />
            </div>
          </details>
        ) : null}
      </section>
      {job.activity === 'W03' ? (
        <section className="section">
          <h2>Anniversary snapshot</h2>
          {!job.snapshot ? (
            <>
              <p className="warning">Snapshot pending until {formatDate(job.anniversaryDate)}.</p>
              {prepare ? (
                <JobAction
                  job={job}
                  action="capture_snapshot"
                  label="Capture anniversary snapshot"
                />
              ) : null}
            </>
          ) : null}
          {job.snapshotNeedsReview ? (
            <div className="warning">
              <p>{job.snapshotNeedsReview.reason}</p>
              {prepare && !job.filingAttempts.length ? (
                <JobAction
                  job={job}
                  action="refresh_snapshot"
                  label="Refresh snapshot for review"
                  confirmation="Archive this snapshot and capture the reviewed anniversary position again? A new pack version will require client confirmation and independent review."
                />
              ) : null}
            </div>
          ) : null}
          {job.snapshot ? (
            <>
              <p>
                As at {formatDate(job.snapshot?.asAt)} · captured{' '}
                {formatDate(job.snapshot?.capturedAt)}
              </p>
              <dl className="facts">
                <div>
                  <dt>Company</dt>
                  <dd>{job.snapshot?.company.name}</dd>
                </div>
                <div>
                  <dt>Registered address</dt>
                  <dd>{job.snapshot?.company.address}</dd>
                </div>
                <div>
                  <dt>Directors</dt>
                  <dd>
                    {job.snapshot?.officers.map((o) => o.personName).join(', ') ||
                      'No evidenced appointments'}
                  </dd>
                </div>
              </dl>
              <details className="disclosure">
                <summary>Captured member and capital position</summary>
                <div>
                  {job.snapshot.members ? (
                    <>
                      {job.snapshot.members.verification === 'Not established' ? (
                        <p>Opening member balances were not established at capture.</p>
                      ) : (
                        <ul className="list-plain">
                          {job.snapshot.members.classes.map((c) => (
                            <li key={c.id}>
                              {c.name} · {c.units} units · {c.currency} {c.issuedAmount} issued ·{' '}
                              {c.currency} {c.paidAmount} paid up
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : (
                    <p>Member position was not captured in this earlier snapshot.</p>
                  )}
                </div>
              </details>
            </>
          ) : null}
          {job.snapshotHistory?.length ? (
            <details className="disclosure">
              <summary>Previous anniversary snapshots ({job.snapshotHistory.length})</summary>
              <div>
                {job.snapshotHistory.map((entry, index) => (
                  <section className="section" key={index}>
                    <h3>
                      Pack v{entry.packVersion} · as at {formatDate(entry.snapshot.asAt)}
                    </h3>
                    <p>{entry.snapshot.company.name}</p>
                    <p>{entry.snapshot.company.address}</p>
                    <p>
                      {entry.snapshot.officers.map((o) => o.personName).join(', ') ||
                        'No evidenced appointments'}
                    </p>
                    <p className="metadata">Captured {formatDate(entry.snapshot.capturedAt)}</p>
                  </section>
                ))}
              </div>
            </details>
          ) : null}
          <p className={job.clientConfirmed ? 'success' : 'muted'}>
            {job.clientConfirmed
              ? 'Client confirmation evidenced'
              : 'Client confirmation outstanding'}
          </p>
          {job.clientConfirmationEvidenceId ? (
            <EvidenceLinks ids={[job.clientConfirmationEvidenceId]} data={data} />
          ) : null}
          {prepare && !!job.snapshot && !job.snapshotNeedsReview && !job.clientConfirmed ? (
            <div className="small-form">
              <JobAction
                job={job}
                action="confirm_client"
                label="Record client confirmation"
                fields={[
                  {
                    name: 'evidenceId',
                    label: 'Confirmation evidence',
                    type: 'select',
                    options: evidence,
                    required: true,
                  },
                ]}
              />
            </div>
          ) : null}
        </section>
      ) : null}
      <section className="section">
        <h2 className={job.dependencyIds.length ? undefined : 'sr-only'}>Dependencies</h2>
        {job.dependencyIds.length ? (
          <ul className="list-plain">
            {job.dependencyIds.map((id) => {
              const dep = data.jobs.find((j) => j.id === id);
              return (
                <li key={id}>
                  <Link href={'/jobs/' + id}>{dep?.title || 'Linked job'}</Link>
                  <p className="metadata">
                    {dep?.state} · filing {dep?.filingState}
                  </p>
                </li>
              );
            })}
          </ul>
        ) : null}
        {prepare ? (
          <details className="disclosure">
            <summary>Link a dependent job</summary>
            <div>
              <JobAction
                job={job}
                action="link_dependency"
                label="Link dependency"
                fields={[
                  {
                    name: 'dependencyId',
                    label: 'Job',
                    type: 'select',
                    required: true,
                    options: data.jobs
                      .filter(
                        (j) =>
                          j.companyId === job.companyId &&
                          j.id !== job.id &&
                          !job.dependencyIds.includes(j.id),
                      )
                      .map((j) => ({ value: j.id, label: j.title })),
                  },
                ]}
              />
            </div>
          </details>
        ) : null}
      </section>
      <section className="section">
        <h2>Review decisions</h2>
        {job.reviews.length ? (
          <ul className="list-plain">
            {[...job.reviews].reverse().map((r) => (
              <li key={r.id}>
                <strong>
                  {r.scope.replaceAll('_', ' ')} · v{r.version}
                </strong>{' '}
                · {r.decision}
                <p className="metadata">
                  {data.users.find((u) => u.id === r.actorId)?.name || r.actorId} ·{' '}
                  {formatDate(r.at)}
                  {r.version !== version ? ' · Earlier version' : ''}
                </p>
                <p>{r.reason}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No decisions recorded</p>
        )}
        {prepare ? (
          <JobAction job={job} action="request_review" label={'Request review of v' + version} />
        ) : null}
        {review ? (
          <div className="form-section">
            <h3>Review version {version}</h3>
            <JobAction
              job={job}
              action="review"
              label={'Record decision for v' + version}
              extra={{ version }}
              fields={[
                {
                  name: 'scope',
                  label: 'Decision scope',
                  type: 'select',
                  required: true,
                  value: 'pack',
                  options: [
                    { value: 'pack', label: 'Document pack' },
                    { value: 'record', label: 'Corporate record event' },
                    { value: 'manual_date', label: 'Manual statutory deadline' },
                  ],
                },
                {
                  name: 'decision',
                  label: 'Decision',
                  type: 'select',
                  required: true,
                  value: 'Approved',
                  options: [
                    { value: 'Approved', label: 'Approve' },
                    { value: 'Returned', label: 'Return for correction' },
                  ],
                },
                {
                  name: 'reason',
                  label: 'Decision basis',
                  type: 'textarea',
                  required: true,
                  full: true,
                },
              ]}
            />
          </div>
        ) : null}
      </section>
      {prepare ? (
        <section className="section">
          <h2>Case notes</h2>
          <ul className="list-plain">
            {job.notes.map((note) => (
              <li key={note.id}>
                <div className="prose" dangerouslySetInnerHTML={{ __html: note.html }} />
                <p className="metadata">
                  {data.users.find((u) => u.id === note.actorId)?.name} · {formatDate(note.at)}
                </p>
              </li>
            ))}
          </ul>
          <JobAction
            job={job}
            action="note"
            label="Save note"
            fields={[{ name: 'html', label: 'Note', type: 'rich', full: true }]}
          />
        </section>
      ) : null}
      <section className="section">
        <h2>Completion</h2>
        <p>
          Job: {job.state} · Filing: {job.filingState}
        </p>
        {prepare && !['Complete', 'Cancelled'].includes(job.state) ? (
          <JobAction
            job={job}
            action="complete"
            label="Complete job"
            extra={{ confirmed: true }}
            confirmation={`Complete ${job.title}? All required evidence, decisions and filing outcomes will be checked.`}
          />
        ) : null}
      </section>
      {prepare ? (
        <details className="disclosure">
          <summary>Assignment, dates and billing</summary>
          <div className="form-stack">
            <JobAction
              job={job}
              action="assign"
              label="Reassign job"
              fields={[
                {
                  name: 'ownerId',
                  label: 'Owner',
                  type: 'select',
                  value: job.ownerId,
                  options: users,
                  required: true,
                },
                { name: 'reason', label: 'Reassignment reason', required: true },
              ]}
            />
            <JobAction
              job={job}
              action="dates"
              label="Save dates"
              fields={[
                {
                  name: 'internalTarget',
                  label: 'Internal target',
                  type: 'date',
                  value: job.internalTarget || '',
                },
                {
                  name: 'statutoryDue',
                  label: 'Manual statutory deadline',
                  type: 'date',
                  value: job.statutoryDue || '',
                },
                {
                  name: 'manualDateBasis',
                  label: 'Source and calculation basis',
                  type: 'textarea',
                  value: job.manualDateBasis,
                },
                {
                  name: 'manualDateEvidenceId',
                  label: 'Deadline evidence',
                  type: 'select',
                  options: evidence,
                  value: job.manualDateEvidenceId || '',
                },
              ]}
            />
            <JobAction
              job={job}
              action="billing"
              label="Update billing handoff"
              fields={[
                {
                  name: 'state',
                  label: 'Billing state',
                  type: 'select',
                  value: job.billingState,
                  required: true,
                  options: ['Not ready', 'Ready to bill', 'Handed off', 'Invoiced'].map(
                    (value) => ({ value, label: value }),
                  ),
                },
                { name: 'reason', label: 'Reason or handoff reference', required: true },
              ]}
            />
            {!['Complete', 'Cancelled'].includes(job.state) ? (
              <JobAction
                job={job}
                action="cancel"
                label="Cancel job"
                fields={[{ name: 'reason', label: 'Cancellation reason', required: true }]}
                extra={{ confirmed: true }}
                confirmation={`Cancel ${job.title}? Effective records and incurred filing obligations are retained; unresolved obligations prevent cancellation.`}
              />
            ) : null}
          </div>
        </details>
      ) : null}
    </>
  );
}
