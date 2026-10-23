'use client';
import { useState } from 'react';
import type { CapitalRegister, CapitalProposal, Member } from '@/domain/records';
import type { JobSectionProps } from '../job-sections/shared';
import { jobFields, JobAction, EvidenceLinks } from '../job-sections/shared';
import { formatDate, currentDate } from '../workspace';
import { RecordForm, RegisterState, fieldText, useRegister } from './shared';

type Row = {
  key: number;
  memberId: string;
  member: Member;
  units: string;
  certificateNumber: string;
};
const blankMember = (): Member => ({ id: '', name: '', type: 'Individual', address: '' });
function CapitalEditor({ job, data, records }: JobSectionProps & { records: CapitalRegister }) {
  const proposal = job.capitalProposal;
  const [kind, setKind] = useState<CapitalProposal['kind']>(
    proposal?.kind ?? (records.position.classes.length ? 'allotment' : 'opening'),
  );
  const [classId, setClassId] = useState(
    proposal
      ? records.position.classes.some((c) => c.id === proposal.shareClass.id)
        ? proposal.shareClass.id
        : ''
      : (records.position.classes[0]?.id ?? ''),
  );
  const [rows, setRows] = useState<Row[]>(
    proposal?.allocations.map((a, i) => ({
      key: i,
      memberId: records.position.members.some((m) => m.id === a.member.id) ? a.member.id : '',
      ...a,
    })) ?? [{ key: 0, memberId: '', member: blankMember(), units: '', certificateNumber: '' }],
  );
  const { evidence } = jobFields(job, data);
  const selectedClass = records.position.classes.find((c) => c.id === classId);
  const patch = (key: number, change: Partial<Row>) =>
    setRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...change } : r)));
  return (
    <RecordForm
      job={job}
      action="capital_proposal"
      label="Save transaction for review"
      onSaved={(saved) =>
        setRows(
          saved.capitalProposal!.allocations.map((a, index) => ({
            ...a,
            key: index,
            memberId: records.position.members.some((m) => m.id === a.member.id) ? a.member.id : '',
          })),
        )
      }
      build={(form) => {
        const shareClass =
          kind === 'opening' || (kind === 'allotment' && !selectedClass)
            ? {
                id:
                  proposal && !records.position.classes.some((c) => c.id === proposal.shareClass.id)
                    ? proposal.shareClass.id
                    : crypto.randomUUID(),
                name: fieldText(form, 'className'),
                currency: fieldText(form, 'currency').toUpperCase(),
              }
            : selectedClass;
        if (!shareClass) throw new Error('Select an existing share class.');
        const allocations = rows.map((row) => ({
          member: row.memberId
            ? records.position.members.find((m) => m.id === row.memberId)!
            : { ...row.member, id: row.member.id || crypto.randomUUID() },
          units: row.units,
          certificateNumber: row.certificateNumber,
        }));
        return {
          expectedRegisterRevision: records.revision,
          proposal: {
            kind,
            shareClass,
            allocations,
            sourceCertificateId:
              kind === 'transfer' ? fieldText(form, 'sourceCertificateId') : null,
            remainingCertificateNumber:
              kind === 'transfer' ? fieldText(form, 'remainingCertificateNumber') || null : null,
            issuedAmount: kind === 'transfer' ? '0.00' : fieldText(form, 'issuedAmount'),
            paidAmount: kind === 'transfer' ? '0.00' : fieldText(form, 'paidAmount'),
            consideration: fieldText(form, 'consideration'),
            stamping: {
              disposition: fieldText(form, 'stamping'),
              basis: fieldText(form, 'stampingBasis'),
              evidenceId: fieldText(form, 'stampingEvidenceId'),
            },
            authorityEvidenceIds: form.getAll('authorityEvidenceIds').filter(Boolean),
          },
        };
      }}
    >
      <div className="form-grid">
        <label>
          Transaction
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as CapitalProposal['kind']);
              if (e.target.value === 'transfer') setRows((r) => r.slice(0, 1));
            }}
          >
            <option value="opening">Opening balances</option>
            <option value="allotment">Allotment</option>
            <option value="transfer">Transfer</option>
          </select>
        </label>
        {kind !== 'opening' ? (
          <label>
            Share class
            <select
              required={kind === 'transfer'}
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
            >
              <option value="">{kind === 'allotment' ? 'New share class' : 'Select…'}</option>
              {records.position.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.currency}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {kind === 'opening' || (kind === 'allotment' && !selectedClass) ? (
          <>
            <label>
              Class name
              <input name="className" required defaultValue={proposal?.shareClass.name ?? ''} />
            </label>
            <label>
              Currency
              <input
                name="currency"
                required
                minLength={3}
                maxLength={3}
                defaultValue={proposal?.shareClass.currency ?? 'MYR'}
              />
            </label>
          </>
        ) : null}
        {kind === 'transfer' ? (
          <>
            <label className="full">
              Source certificate
              <select
                required
                name="sourceCertificateId"
                defaultValue={proposal?.sourceCertificateId ?? ''}
              >
                <option value="">Select…</option>
                {records.position.certificates
                  .filter((c) => !c.cancelledOn && c.classId === classId)
                  .map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.number} · {records.position.members.find((m) => m.id === c.memberId)?.name}{' '}
                      · {c.units} units
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Transferor replacement certificate
              <input
                name="remainingCertificateNumber"
                defaultValue={proposal?.remainingCertificateNumber ?? ''}
              />
            </label>
          </>
        ) : (
          <>
            <label>
              Issued amount
              <input
                name="issuedAmount"
                required
                inputMode="decimal"
                defaultValue={proposal?.issuedAmount ?? ''}
              />
            </label>
            <label>
              Paid-up amount
              <input
                name="paidAmount"
                required
                inputMode="decimal"
                defaultValue={proposal?.paidAmount ?? ''}
              />
            </label>
          </>
        )}
        <label>
          Consideration ({selectedClass?.currency ?? proposal?.shareClass.currency ?? 'MYR'})
          <input
            name="consideration"
            required
            inputMode="decimal"
            defaultValue={proposal?.consideration ?? '0.00'}
          />
        </label>
      </div>
      {rows.map((row, index) => (
        <fieldset key={row.key}>
          <legend>{kind === 'transfer' ? 'Transferee' : `Allocation ${index + 1}`}</legend>
          <div className="form-grid">
            <label className="full">
              Member
              <select
                value={row.memberId}
                onChange={(e) => patch(row.key, { memberId: e.target.value })}
              >
                <option value="">New member</option>
                {records.position.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            {!row.memberId ? (
              <>
                <label>
                  Member name
                  <input
                    required
                    value={row.member.name}
                    onChange={(e) =>
                      patch(row.key, { member: { ...row.member, name: e.target.value } })
                    }
                  />
                </label>
                <label>
                  Party type
                  <select
                    value={row.member.type}
                    onChange={(e) =>
                      patch(row.key, {
                        member: { ...row.member, type: e.target.value as Member['type'] },
                      })
                    }
                  >
                    <option>Individual</option>
                    <option>Organisation</option>
                  </select>
                </label>
                <label className="full">
                  Registered address
                  <textarea
                    required
                    value={row.member.address}
                    onChange={(e) =>
                      patch(row.key, { member: { ...row.member, address: e.target.value } })
                    }
                  />
                </label>
              </>
            ) : null}
            <label>
              Share units
              <input
                required
                inputMode="numeric"
                value={row.units}
                onChange={(e) => patch(row.key, { units: e.target.value })}
              />
            </label>
            <label>
              Certificate number
              <input
                required
                value={row.certificateNumber}
                onChange={(e) => patch(row.key, { certificateNumber: e.target.value })}
              />
            </label>
          </div>
          {rows.length > 1 ? (
            <div className="actions">
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.form!.dataset.dirty = 'true';
                  setRows((r) => r.filter((item) => item.key !== row.key));
                }}
              >
                Remove allocation {index + 1}
              </button>
            </div>
          ) : null}
        </fieldset>
      ))}
      {kind !== 'transfer' ? (
        <div>
          <button
            type="button"
            disabled={rows.length >= 50}
            onClick={(e) => {
              e.currentTarget.form!.dataset.dirty = 'true';
              setRows((r) => [
                ...r,
                {
                  key: Math.max(...r.map((row) => row.key)) + 1,
                  memberId: '',
                  member: blankMember(),
                  units: '',
                  certificateNumber: '',
                },
              ]);
            }}
          >
            Add allocation
          </button>
        </div>
      ) : null}
      <div className="form-grid">
        <label>
          Stamping disposition
          <select name="stamping" required defaultValue={proposal?.stamping.disposition ?? ''}>
            <option value="">Select…</option>
            <option>Evidence recorded</option>
            <option>Not applicable</option>
          </select>
        </label>
        <label>
          Stamping evidence
          <select
            required
            name="stampingEvidenceId"
            defaultValue={proposal?.stamping.evidenceId ?? ''}
          >
            <option value="">Select…</option>
            {evidence.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="full">
          Stamping basis
          <textarea name="stampingBasis" required defaultValue={proposal?.stamping.basis ?? ''} />
        </label>
        <label className="full">
          Decision and authority evidence
          <select
            multiple
            required
            name="authorityEvidenceIds"
            defaultValue={proposal?.authorityEvidenceIds ?? []}
          >
            {evidence.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </RecordForm>
  );
}
export function CapitalWorkspace({ job, data }: JobSectionProps) {
  const proposal = job.capitalProposal;
  const result = useRegister<CapitalRegister>(
    `/api/companies/${job.companyId}/registers?asAt=${job.effectiveDate}`,
    job.revision,
  );
  const records = result.value;
  return (
    <>
      <h2>Member and capital transaction</h2>
      <dl className="facts">
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
      <p className="prose">{job.routeBasis}</p>
      <RegisterState {...result} />
      <div className="actions">
        <button className="quiet" onClick={result.reload} disabled={result.loading}>
          Refresh register position
        </button>
      </div>
      {records ? (
        <>
          {proposal ? (
            <section className="section">
              <h3>
                {proposal.kind === 'opening'
                  ? 'Opening balances'
                  : proposal.kind === 'allotment'
                    ? 'Allotment'
                    : 'Transfer'}{' '}
                · {proposal.shareClass.name}
              </h3>
              {!job.recordEventId && job.recordBaseRevision !== records.revision ? (
                <p className="warning">
                  Company registers changed. Save a refreshed proposal and obtain new review.
                </p>
              ) : null}
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Proposed member allocations</caption>
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Units</th>
                      <th>Certificate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposal.allocations.map((a, i) => (
                      <tr key={i}>
                        <td>{a.member.name}</td>
                        <td>{a.units}</td>
                        <td>{a.certificateNumber}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {job.capitalReconciliation ? (
                <div className="section">
                  <h3>Class reconciliation</h3>
                  <div className="table-wrap">
                    <table>
                      <caption className="sr-only">Reviewed before and after class totals</caption>
                      <thead>
                        <tr>
                          <th>Position</th>
                          <th>Issued units</th>
                          <th>Issued capital</th>
                          <th>Paid-up capital</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['Before', job.capitalReconciliation.before],
                          ['After', job.capitalReconciliation.after],
                        ].map(([label, position]) => (
                          <tr key={String(label)}>
                            <td>{String(label)}</td>
                            <td>
                              {typeof position === 'object' && position ? position.units : '0'}
                            </td>
                            <td className="nowrap">
                              {proposal.shareClass.currency}{' '}
                              {typeof position === 'object' && position
                                ? position.issuedAmount
                                : '0.00'}
                            </td>
                            <td className="nowrap">
                              {proposal.shareClass.currency}{' '}
                              {typeof position === 'object' && position
                                ? position.paidAmount
                                : '0.00'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {job.capitalReconciliation.sourceCertificate ? (
                    <p className="metadata section">
                      Source: {job.capitalReconciliation.sourceCertificate.number} ·{' '}
                      {job.capitalReconciliation.sourceMember?.name} ·{' '}
                      {job.capitalReconciliation.sourceCertificate.units} units
                    </p>
                  ) : null}
                </div>
              ) : null}
              <p className="metadata section">
                Stamping: {proposal.stamping.disposition} · {proposal.stamping.basis}
              </p>
              <EvidenceLinks
                ids={[...proposal.authorityEvidenceIds, proposal.stamping.evidenceId]}
                data={data}
              />
            </section>
          ) : (
            <p className="muted section">Transaction not prepared</p>
          )}
          {!job.recordEventId && data.actor.capabilities.includes('prepare_job') ? (
            <details className="disclosure" open={!proposal}>
              <summary>{proposal ? 'Revise transaction' : 'Prepare transaction'}</summary>
              <div>
                <CapitalEditor job={job} data={data} records={records} />
              </div>
            </details>
          ) : null}
          {!job.recordEventId && data.actor.capabilities.includes('confirm_record') ? (
            <JobAction
              job={job}
              action="post_record"
              label="Post reviewed share transaction"
              extra={{ confirmed: true }}
              confirmation={`Post this reviewed transaction effective ${formatDate(job.effectiveDate)}? Holdings and certificates will be retained as an immutable dated record; filing remains separate.`}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}
