'use client';
import type { JobSectionProps as Props } from './shared';
import { formatDate, currentDate } from '../workspace';
import { jobFields, JobAction, EvidenceLinks } from './shared';
export function Filing({ job, data }: Props) {
  const { evidence, version } = jobFields(job, data);
  const review = data.actor.capabilities.includes('review_pack');
  const lodger = data.actor.capabilities.includes('record_filing');
  const attempts = job.filingAttempts;
  return (
    <>
      <section className="section">
        <h2>Filing · {job.filingState}</h2>
        <p>Current package: v{version}</p>
        {job.blockers?.length && job.filingState !== 'Outcome confirmed' ? (
          <div className="warning">
            <ul>
              {job.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {review ? (
          <JobAction
            job={job}
            action="authorise_readiness"
            label={'Authorise filing readiness for v' + version}
          />
        ) : null}
        {review ? (
          <details className="disclosure">
            <summary>Assess filing not required</summary>
            <div>
              <JobAction
                job={job}
                action="filing_not_required"
                label="Record filing not required"
                fields={[
                  { name: 'reason', label: 'Assessment reason', type: 'textarea', required: true },
                  {
                    name: 'evidenceId',
                    label: 'Assessment evidence',
                    type: 'select',
                    required: true,
                    options: evidence,
                  },
                ]}
              />
            </div>
          </details>
        ) : null}
        {job.filingNotRequiredReason ? (
          <p className="feedback">{job.filingNotRequiredReason}</p>
        ) : null}
      </section>
      {lodger ? (
        <section className="section">
          <h2>Record external submission</h2>
          <JobAction
            job={job}
            action="submit"
            label="Record external submission"
            extra={{ version }}
            fields={[
              {
                name: 'submittedDate',
                label: 'Actual submission date',
                type: 'date',
                required: true,
                value: currentDate(),
              },
              { name: 'reference', label: 'External submission reference', required: true },
              { name: 'channel', label: 'Filing channel', required: true },
              {
                name: 'evidenceId',
                label: 'Submission evidence',
                type: 'select',
                required: true,
                options: evidence,
              },
              {
                name: 'documentIds',
                label: 'Exact submitted documents',
                type: 'multi',
                required: true,
                options: evidence,
                full: true,
              },
              {
                name: 'paymentEvidenceId',
                label: 'Payment evidence',
                type: 'select',
                options: evidence,
              },
            ]}
            primary
          />
          {attempts.length ? (
            <>
              <div className="form-section">
                <h3>Record authority query or rejection</h3>
                <JobAction
                  job={job}
                  action="filing_message"
                  label="Record authority message"
                  fields={[
                    {
                      name: 'kind',
                      label: 'Message type',
                      type: 'select',
                      required: true,
                      value: 'Query',
                      options: [
                        { value: 'Query', label: 'Query' },
                        { value: 'Rejection', label: 'Rejection' },
                      ],
                    },
                    {
                      name: 'date',
                      label: 'Message date',
                      type: 'date',
                      required: true,
                      value: currentDate(),
                    },
                    { name: 'responseDue', label: 'Response due', type: 'date', required: true },
                    {
                      name: 'evidenceId',
                      label: 'Authority message evidence',
                      type: 'select',
                      required: true,
                      options: evidence,
                    },
                    {
                      name: 'wording',
                      label: 'Actual authority wording',
                      type: 'textarea',
                      required: true,
                      full: true,
                    },
                  ]}
                />
              </div>
              <div className="form-section">
                <h3>Record query response</h3>
                <JobAction
                  job={job}
                  action="filing_response"
                  label="Record external query response"
                  fields={[
                    {
                      name: 'date',
                      label: 'Response date',
                      type: 'date',
                      required: true,
                      value: currentDate(),
                    },
                    {
                      name: 'evidenceId',
                      label: 'Response evidence',
                      type: 'select',
                      required: true,
                      options: evidence,
                    },
                    {
                      name: 'summary',
                      label: 'Response summary',
                      type: 'textarea',
                      required: true,
                      full: true,
                    },
                  ]}
                />
              </div>
              <div className="form-section">
                <h3>Confirm external outcome</h3>
                <JobAction
                  job={job}
                  action="confirm_outcome"
                  label="Confirm filing outcome"
                  extra={{ confirmed: true }}
                  confirmation={`Record the separately evidenced external outcome for ${job.title}? Submission and outcome will remain distinct in history.`}
                  fields={[
                    {
                      name: 'date',
                      label: 'Outcome date',
                      type: 'date',
                      required: true,
                      value: currentDate(),
                    },
                    {
                      name: 'evidenceId',
                      label: 'Outcome evidence',
                      type: 'select',
                      required: true,
                      options: evidence,
                    },
                    {
                      name: 'wording',
                      label: 'Actual authority outcome wording',
                      type: 'textarea',
                      required: true,
                      full: true,
                    },
                  ]}
                />
              </div>
            </>
          ) : null}
        </section>
      ) : null}
      <section className="section">
        <h2>Submission history</h2>
        {attempts.length ? (
          <ul className="list-plain">
            {[...attempts].reverse().map((attempt) => (
              <li key={attempt.id}>
                <h3>
                  {attempt.reference} · package v{attempt.version}
                </h3>
                <p>
                  {attempt.channel} · {formatDate(attempt.submittedDate)}
                </p>
                <p className="metadata">
                  Lodger: {data.users.find((u) => u.id === attempt.lodgerId)?.name}
                </p>
                <EvidenceLinks
                  ids={[
                    ...attempt.documentIds,
                    attempt.evidenceId,
                    ...(attempt.paymentEvidenceId ? [attempt.paymentEvidenceId] : []),
                  ]}
                  data={data}
                />
                {attempt.messages.map((message) => (
                  <div className="warning" key={message.id}>
                    <strong>{message.kind}</strong> · {formatDate(message.date)}
                    <p>{message.wording}</p>
                    <p>Response due {formatDate(message.responseDue)}</p>
                    <EvidenceLinks ids={[message.evidenceId]} data={data} />
                    {message.response ? (
                      <>
                        <p>
                          Response {formatDate(message.response.date)} · {message.response.summary}
                        </p>
                        <EvidenceLinks ids={[message.response.evidenceId]} data={data} />
                      </>
                    ) : null}
                  </div>
                ))}
                {attempt.outcome ? (
                  <div className="feedback status">
                    <strong>{attempt.outcome.wording}</strong>
                    <p>{formatDate(attempt.outcome.date)}</p>
                    <EvidenceLinks ids={[attempt.outcome.evidenceId]} data={data} />
                  </div>
                ) : (
                  <p className="metadata">Outcome confirmation outstanding</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No external submissions recorded</p>
        )}
      </section>
    </>
  );
}
