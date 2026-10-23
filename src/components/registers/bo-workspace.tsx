'use client';
import { useState } from 'react';
import type { BoRegister, BoAssessment } from '@/domain/records';
import type { JobSectionProps } from '../job-sections/shared';
import { JobAction, jobFields, EvidenceLinks } from '../job-sections/shared';
import { formatDate, currentDate } from '../workspace';
import { RecordForm, RegisterState, fieldText, useRegister } from './shared';

function AssessmentEditor({ job, data, records }: JobSectionProps & { records: BoRegister }) {
  const assessment = job.boCase?.assessment;
  const [kind, setKind] = useState<BoAssessment['kind']>(assessment?.kind ?? 'entry');
  const { evidence } = jobFields(job, data);
  return (
    <RecordForm
      job={job}
      action="bo_assessment"
      label="Save assessment for review"
      build={(form) => {
        const previous =
          kind !== 'entry'
            ? records.owners.find((e) => e.id === fieldText(form, 'predecessorId'))
            : null;
        if (kind !== 'entry' && !previous) throw new Error('Select an active BO entry.');
        return {
          expectedRegisterRevision: records.revision,
          assessment: {
            kind,
            personId: previous?.personId ?? assessment?.personId ?? crypto.randomUUID(),
            personName: previous?.personName ?? fieldText(form, 'personName'),
            effectiveDate: fieldText(form, 'effectiveDate'),
            registerEntryDate: fieldText(form, 'registerEntryDate'),
            criteria: fieldText(form, 'criteria'),
            sourceVersion: fieldText(form, 'sourceVersion'),
            ownershipChain: fieldText(form, 'ownershipChain'),
            evidenceIds: form.getAll('evidenceIds').filter(Boolean),
            nextReviewDate: fieldText(form, 'nextReviewDate'),
            predecessorId: previous?.id ?? null,
          },
        };
      }}
    >
      <div className="form-grid">
        <label>
          Record change
          <select value={kind} onChange={(e) => setKind(e.target.value as BoAssessment['kind'])}>
            <option value="entry">BO entry</option>
            <option value="review">BO review/update</option>
            <option value="cessation">BO cessation</option>
          </select>
        </label>
        {kind === 'entry' ? (
          <label>
            Person full name
            <input name="personName" required defaultValue={assessment?.personName ?? ''} />
          </label>
        ) : (
          <label>
            Current BO entry
            <select name="predecessorId" required defaultValue={assessment?.predecessorId ?? ''}>
              <option value="">Select…</option>
              {records.owners.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.personName}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Effective date
          <input
            name="effectiveDate"
            type="date"
            required
            defaultValue={assessment?.effectiveDate ?? job.effectiveDate ?? ''}
          />
        </label>
        <label>
          Register-entry date
          <input
            name="registerEntryDate"
            type="date"
            required
            defaultValue={assessment?.registerEntryDate ?? currentDate()}
          />
        </label>
        <label className="full">
          Assessed criteria
          <textarea name="criteria" required defaultValue={assessment?.criteria ?? ''} />
        </label>
        <label className="full">
          Source and version
          <input name="sourceVersion" required defaultValue={assessment?.sourceVersion ?? ''} />
        </label>
        <label className="full">
          Ownership chain and decision basis
          <textarea
            name="ownershipChain"
            required
            defaultValue={assessment?.ownershipChain ?? ''}
          />
        </label>
        <label className="full">
          Chain and criteria evidence
          <select name="evidenceIds" multiple required defaultValue={assessment?.evidenceIds ?? []}>
            {evidence.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Next review date
          <input
            name="nextReviewDate"
            type="date"
            required
            defaultValue={assessment?.nextReviewDate ?? ''}
          />
        </label>
      </div>
    </RecordForm>
  );
}
export function BoWorkspace({ job, data }: JobSectionProps) {
  const result = useRegister<BoRegister>(
    `/api/companies/${job.companyId}/bo?asAt=${job.effectiveDate}`,
    job.revision,
  );
  const records = result.value,
    record = job.boCase,
    assessment = record?.assessment;
  const { evidence, users } = jobFields(job, data);
  const prepare = data.actor.capabilities.includes('prepare_job') && !job.recordEventId;
  const review = data.actor.capabilities.includes('confirm_record') && !job.recordEventId;
  const evidenceField = {
    name: 'evidenceId',
    label: 'BO evidence',
    type: 'select' as const,
    required: true,
    options: evidence,
  };
  return (
    <>
      <h2>Beneficial ownership assessment</h2>
      <RegisterState {...result} />
      <div className="actions">
        <button className="quiet" onClick={result.reload} disabled={result.loading}>
          Refresh register position
        </button>
      </div>
      <section className="section">
        <h3>Information notices</h3>
        {record?.notices.length ? (
          <ul className="list-plain">
            {record.notices.map((notice) => (
              <li key={notice.id}>
                <strong>{notice.recipient}</strong>
                <p className="metadata">
                  Sent {formatDate(notice.sentDate)} · response due {formatDate(notice.responseDue)}{' '}
                  · chase {formatDate(notice.nextChaseDate)} ·{' '}
                  {data.users.find((u) => u.id === notice.ownerId)?.name}
                </p>
                <p
                  className={
                    notice.reply
                      ? 'success'
                      : notice.responseDue < currentDate()
                        ? 'danger'
                        : 'muted'
                  }
                >
                  {notice.reply
                    ? 'Reply received ' + formatDate(notice.reply.date)
                    : 'Reply outstanding'}
                </p>
                <EvidenceLinks
                  ids={[notice.evidenceId, ...(notice.reply ? [notice.reply.evidenceId] : [])]}
                  data={data}
                />
                {notice.reply ? (
                  <p>{notice.reply.summary}</p>
                ) : prepare ? (
                  <details className="disclosure">
                    <summary>Record reply</summary>
                    <div>
                      <JobAction
                        job={job}
                        action="bo_reply"
                        label="Record notice reply"
                        extra={{ noticeId: notice.id }}
                        fields={[
                          { name: 'date', label: 'Reply date', type: 'date', required: true },
                          evidenceField,
                          {
                            name: 'summary',
                            label: 'Reply summary',
                            type: 'textarea',
                            required: true,
                            full: true,
                          },
                        ]}
                      />
                    </div>
                  </details>
                ) : null}
                {notice.escalation ? (
                  <div className="warning">
                    <p>Escalation recorded {formatDate(notice.escalation.at)}</p>
                    <p>{notice.escalation.reason}</p>
                    <EvidenceLinks ids={[notice.escalation.evidenceId]} data={data} />
                  </div>
                ) : !notice.reply && notice.responseDue < currentDate() && review ? (
                  <details className="disclosure">
                    <summary>Escalate nonresponse</summary>
                    <div>
                      <JobAction
                        job={job}
                        action="bo_escalate"
                        label="Record nonresponse escalation"
                        extra={{ noticeId: notice.id }}
                        fields={[
                          {
                            name: 'reason',
                            label: 'Escalation decision',
                            type: 'textarea',
                            required: true,
                            full: true,
                          },
                          evidenceField,
                        ]}
                      />
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No information notices recorded</p>
        )}
        {prepare ? (
          <details className="disclosure" open={!record?.notices.length}>
            <summary>Record an information notice</summary>
            <div>
              <JobAction
                job={job}
                action="bo_notice"
                label="Record external notice"
                fields={[
                  { name: 'recipient', label: 'Recipient', required: true },
                  {
                    name: 'sentDate',
                    label: 'Sent date',
                    type: 'date',
                    required: true,
                    value: currentDate(),
                  },
                  { name: 'responseDue', label: 'Response due', type: 'date', required: true },
                  { name: 'nextChaseDate', label: 'Next chase', type: 'date', required: true },
                  {
                    name: 'ownerId',
                    label: 'Notice owner',
                    type: 'select',
                    options: users,
                    required: true,
                    value: job.ownerId,
                  },
                  evidenceField,
                ]}
              />
            </div>
          </details>
        ) : null}
      </section>
      <section className="section">
        <h3>Sourced assessment</h3>
        {assessment ? (
          <>
            <dl className="facts">
              <div>
                <dt>Person</dt>
                <dd>{assessment.personName}</dd>
              </div>
              <div>
                <dt>Record change</dt>
                <dd>
                  {assessment.kind === 'entry'
                    ? 'BO entry'
                    : assessment.kind === 'review'
                      ? 'BO review/update'
                      : 'BO cessation'}
                </dd>
              </div>
              <div>
                <dt>Effective date</dt>
                <dd>{formatDate(assessment.effectiveDate)}</dd>
              </div>
              <div>
                <dt>Register-entry date</dt>
                <dd>{formatDate(assessment.registerEntryDate)}</dd>
              </div>
              <div>
                <dt>Next review</dt>
                <dd>{formatDate(assessment.nextReviewDate)}</dd>
              </div>
              <div>
                <dt>Corporate record</dt>
                <dd>
                  {job.recordEventId
                    ? assessment.effectiveDate > currentDate()
                      ? 'Approved and future dated'
                      : 'Effective'
                    : 'Proposed'}
                </dd>
              </div>
            </dl>
            <h3>Criteria and source</h3>
            <p className="prose">{assessment.criteria}</p>
            <p className="metadata">{assessment.sourceVersion}</p>
            <p className="prose">{assessment.ownershipChain}</p>
            <EvidenceLinks ids={assessment.evidenceIds} data={data} />
          </>
        ) : (
          <p className="muted">Assessment not prepared</p>
        )}
        {records &&
        assessment &&
        !job.recordEventId &&
        job.recordBaseRevision !== records.revision ? (
          <p className="warning">
            Company registers changed. Refresh the assessment and obtain new review.
          </p>
        ) : null}
        {prepare && records ? (
          <details className="disclosure" open={!assessment}>
            <summary>{assessment ? 'Revise assessment' : 'Prepare assessment'}</summary>
            <div>
              <AssessmentEditor job={job} data={data} records={records} />
            </div>
          </details>
        ) : null}
      </section>
      <section className="section">
        <h3>Discrepancies</h3>
        {record?.discrepancies.length ? (
          <ul className="list-plain">
            {record.discrepancies.map((d) => (
              <li key={d.id}>
                <p>{d.wording}</p>
                <EvidenceLinks ids={[d.evidenceId]} data={data} />
                {d.resolution ? (
                  <>
                    <p className="success">Resolved {formatDate(d.resolution.at)}</p>
                    <p>{d.resolution.basis}</p>
                    <EvidenceLinks ids={[d.resolution.evidenceId]} data={data} />
                  </>
                ) : review ? (
                  <JobAction
                    job={job}
                    action="bo_resolve"
                    label="Record reviewed resolution"
                    extra={{ discrepancyId: d.id }}
                    fields={[
                      {
                        name: 'basis',
                        label: 'Resolution basis',
                        type: 'textarea',
                        full: true,
                        required: true,
                      },
                      evidenceField,
                    ]}
                  />
                ) : (
                  <p className="danger">Unresolved</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No discrepancies recorded</p>
        )}
        {prepare ? (
          <details className="disclosure">
            <summary>Record a discrepancy</summary>
            <div>
              <JobAction
                job={job}
                action="bo_discrepancy"
                label="Record discrepancy"
                fields={[
                  {
                    name: 'wording',
                    label: 'Discrepancy',
                    type: 'textarea',
                    required: true,
                    full: true,
                  },
                  evidenceField,
                ]}
              />
            </div>
          </details>
        ) : null}
      </section>
      {review ? (
        <JobAction
          job={job}
          action="post_record"
          label="Post reviewed BO register entry"
          extra={{ confirmed: true }}
          confirmation="Post this independently reviewed BO assessment to the dated register? Notices, replies and discrepancies must be resolved. External e-BOS filing remains separate."
        />
      ) : null}
      {job.recordEventId ? (
        <p className="feedback status">BO register entry recorded · Filing: {job.filingState}</p>
      ) : null}
    </>
  );
}
