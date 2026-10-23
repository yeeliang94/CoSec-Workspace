'use client';
import type { JobSectionProps as Props } from './shared';
import { jobFields, JobAction, EvidenceLinks } from './shared';
export function Checklist({ job, data }: Props) {
  const pack = job.packs.at(-1);
  const { evidence } = jobFields(job, data);
  return (
    <section>
      <h2>Checklist · v{pack?.version}</h2>
      {pack?.checklist.map((item) => (
        <div className="checklist-item" key={item.id}>
          <h3>{item.label}</h3>
          <p className="check-state">
            {item.notApplicable
              ? 'Not applicable · ' + item.notApplicable.reason
              : item.evidenceIds.length
                ? 'Evidence linked'
                : item.required
                  ? 'Required evidence outstanding'
                  : 'Optional'}
          </p>
          <EvidenceLinks ids={item.evidenceIds} data={data} />
          {data.actor.capabilities.includes('prepare_job') ? (
            <JobAction
              job={job}
              action="checklist_evidence"
              label="Link evidence"
              extra={{ itemId: item.id }}
              fields={[
                {
                  name: 'evidenceIds',
                  label: 'Evidence',
                  type: 'multi',
                  options: evidence,
                  required: true,
                },
              ]}
            />
          ) : null}
          {data.actor.capabilities.includes('review_pack') &&
          ![
            'source',
            'consent',
            'authority',
            'route',
            'particulars',
            'client',
            'validation',
          ].includes(item.id) ? (
            <details className="disclosure">
              <summary>Assess not applicable</summary>
              <div>
                <JobAction
                  job={job}
                  action="checklist_na"
                  label="Record not applicable decision"
                  extra={{ itemId: item.id }}
                  fields={[
                    { name: 'reason', label: 'Reviewer reason', required: true },
                    {
                      name: 'evidenceIds',
                      label: 'Supporting evidence',
                      type: 'multi',
                      options: evidence,
                    },
                  ]}
                />
              </div>
            </details>
          ) : null}
        </div>
      ))}
    </section>
  );
}
