'use client';
import type { JobSectionProps as Props } from './shared';
import { formatDate, currentDate } from '../workspace';
import { jobFields, JobAction, EvidenceLinks } from './shared';
export function Correspondence({ job, data }: Props) {
  const { evidence, users } = jobFields(job, data);
  const prepare = data.actor.capabilities.includes('prepare_job');
  return (
    <>
      <section className="section">
        <h2 className="sr-only">External correspondence</h2>
        {job.correspondence.length ? (
          <ul className="list-plain">
            {[...job.correspondence].reverse().map((entry) => (
              <li key={entry.id}>
                <h3>
                  {entry.direction} · {entry.counterparty}
                </h3>
                <p className="metadata">
                  {entry.channel} · {formatDate(entry.date)} ·{' '}
                  {data.users.find((u) => u.id === entry.ownerId)?.name}
                </p>
                <p>{entry.summary}</p>
                <EvidenceLinks ids={entry.evidenceIds} data={data} />
                {entry.nextChaseDate ? (
                  <p
                    className={
                      entry.nextChaseDate < currentDate() && !entry.respondedOn
                        ? 'metadata danger'
                        : 'metadata'
                    }
                  >
                    {entry.respondedOn
                      ? 'Response received ' + formatDate(entry.respondedOn)
                      : 'Next chase ' + formatDate(entry.nextChaseDate)}
                  </p>
                ) : null}
                {prepare && entry.direction === 'Outgoing' && !entry.respondedOn ? (
                  <details className="disclosure">
                    <summary>Record received response</summary>
                    <div>
                      <JobAction
                        job={job}
                        action="correspondence_response"
                        label="Record response"
                        extra={{ correspondenceId: entry.id }}
                        fields={[
                          {
                            name: 'respondedOn',
                            label: 'Response received',
                            type: 'date',
                            required: true,
                            value: currentDate(),
                          },
                          {
                            name: 'evidenceId',
                            label: 'Response evidence',
                            type: 'select',
                            options: evidence,
                            required: true,
                          },
                        ]}
                      />
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No correspondence recorded</p>
        )}
      </section>
      {prepare ? (
        <section className="section">
          <h2>Record correspondence</h2>
          <JobAction
            job={job}
            action="correspondence"
            label="Record external correspondence"
            primary
            fields={[
              {
                name: 'direction',
                label: 'Direction',
                type: 'select',
                value: 'Outgoing',
                required: true,
                options: [
                  { value: 'Outgoing', label: 'Outgoing' },
                  { value: 'Incoming', label: 'Incoming' },
                ],
              },
              { name: 'counterparty', label: 'Client or counterparty', required: true },
              { name: 'channel', label: 'Channel', required: true },
              {
                name: 'date',
                label: 'Sent or received date',
                type: 'date',
                required: true,
                value: currentDate(),
              },
              {
                name: 'ownerId',
                label: 'Follow-up owner',
                type: 'select',
                options: users,
                value: job.ownerId,
                required: true,
              },
              { name: 'nextChaseDate', label: 'Next chase date', type: 'date' },
              {
                name: 'summary',
                label: 'Request or response',
                type: 'textarea',
                required: true,
                full: true,
              },
              {
                name: 'evidenceIds',
                label: 'Correspondence evidence',
                type: 'multi',
                options: evidence,
                full: true,
              },
            ]}
          />
        </section>
      ) : null}
    </>
  );
}
