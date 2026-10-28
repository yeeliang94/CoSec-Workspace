import type { PackVersion } from '@/domain/model';
import { formatDate } from '../workspace';
export function RecordVersion({ snapshot }: { snapshot: PackVersion['recordSnapshot'] }) {
  if (!snapshot) return null;
  const capital = snapshot.capitalProposal,
    bo = snapshot.boCase;
  return (
    <details className="disclosure">
      <summary>Record proposal at this version</summary>
      <div>
        <dl className="record-meta">
          <div>
            <dt>Effective</dt>
            <dd>{formatDate(snapshot.effectiveDate)}</dd>
          </div>
          <div>
            <dt>Register revision</dt>
            <dd>{snapshot.recordBaseRevision ?? 'Not prepared'}</dd>
          </div>
        </dl>
        <dl className="source-versions">
          <dt>Route basis</dt>
          <dd className="prose">{snapshot.routeBasis}</dd>
        </dl>
        {capital ? (
          <>
            <h3 className="section">
              {capital.kind === 'opening'
                ? 'Opening balances'
                : capital.kind === 'allotment'
                  ? 'Allotment'
                  : 'Transfer'}{' '}
              · {capital.shareClass.name}
            </h3>
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Member allocations at this version</caption>
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Type</th>
                    <th>Address</th>
                    <th>Units</th>
                    <th>Certificate</th>
                  </tr>
                </thead>
                <tbody>
                  {capital.allocations.map((a, i) => (
                    <tr key={i}>
                      <td>{a.member.name}</td>
                      <td>{a.member.type}</td>
                      <td>{a.member.address}</td>
                      <td>{a.units}</td>
                      <td>{a.certificateNumber}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="record-meta">
              <div>
                <dt>Issued amount</dt>
                <dd>
                  {capital.shareClass.currency} {capital.issuedAmount}
                </dd>
              </div>
              <div>
                <dt>Paid-up amount</dt>
                <dd>
                  {capital.shareClass.currency} {capital.paidAmount}
                </dd>
              </div>
              <div>
                <dt>Consideration</dt>
                <dd>
                  {capital.shareClass.currency} {capital.consideration}
                </dd>
              </div>
            </dl>
            <dl className="source-versions">
              <dt>Stamping</dt>
              <dd>{capital.stamping.disposition}</dd>
              <dt>Stamping basis</dt>
              <dd className="prose">{capital.stamping.basis}</dd>
            </dl>
            {snapshot.capitalReconciliation ? (
              <dl className="record-meta">
                <div>
                  <dt>Class units before</dt>
                  <dd>{snapshot.capitalReconciliation.before?.units ?? '0'}</dd>
                </div>
                <div>
                  <dt>Class units after</dt>
                  <dd>{snapshot.capitalReconciliation.after.units}</dd>
                </div>
                {snapshot.capitalReconciliation.sourceCertificate ? (
                  <div>
                    <dt>Source certificate</dt>
                    <dd>{snapshot.capitalReconciliation.sourceCertificate.number}</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </>
        ) : null}
        {bo ? (
          <>
            {bo.assessment ? (
              <>
                <h3 className="section">{bo.assessment.personName}</h3>
                <dl className="record-meta">
                  <div>
                    <dt>Record change</dt>
                    <dd>{bo.assessment.kind}</dd>
                  </div>
                  <div>
                    <dt>Register entry</dt>
                    <dd>{formatDate(bo.assessment.registerEntryDate)}</dd>
                  </div>
                  <div>
                    <dt>Next review</dt>
                    <dd>{formatDate(bo.assessment.nextReviewDate)}</dd>
                  </div>
                </dl>
                <dl className="source-versions">
                  <dt>Criteria</dt>
                  <dd className="prose">{bo.assessment.criteria}</dd>
                  <dt>Source version</dt>
                  <dd>{bo.assessment.sourceVersion}</dd>
                  <dt>Ownership chain</dt>
                  <dd className="prose">{bo.assessment.ownershipChain}</dd>
                </dl>
              </>
            ) : null}
            <ul className="list-plain section">
              {bo.notices.map((n) => (
                <li key={n.id}>
                  <strong>{n.recipient}</strong>
                  <dl className="record-meta">
                    <div>
                      <dt>Sent</dt>
                      <dd>{formatDate(n.sentDate)}</dd>
                    </div>
                    <div>
                      <dt>Reply</dt>
                      <dd>{n.reply ? formatDate(n.reply.date) : 'Outstanding'}</dd>
                    </div>
                  </dl>
                  {n.escalation ? (
                    <p className="metadata">Escalated: {n.escalation.reason}</p>
                  ) : null}
                </li>
              ))}
            </ul>
            <ul className="list-plain section">
              {bo.discrepancies.map((d) => (
                <li key={d.id}>
                  {d.wording}
                  <p className="metadata">{d.resolution?.basis ?? 'Unresolved'}</p>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </details>
  );
}
