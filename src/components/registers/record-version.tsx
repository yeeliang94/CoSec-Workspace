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
        <p className="metadata">
          Effective {formatDate(snapshot.effectiveDate)} · register revision{' '}
          {snapshot.recordBaseRevision ?? 'Not prepared'}
        </p>
        <p className="prose">{snapshot.routeBasis}</p>
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
            <ul className="list-plain">
              {capital.allocations.map((a, i) => (
                <li key={i}>
                  {a.member.name} · {a.units} units · certificate {a.certificateNumber}
                  <p className="metadata">
                    {a.member.type} · {a.member.address}
                  </p>
                </li>
              ))}
            </ul>
            <p className="metadata">
              Issued amount {capital.shareClass.currency} {capital.issuedAmount} · paid-up amount{' '}
              {capital.shareClass.currency} {capital.paidAmount} · consideration{' '}
              {capital.shareClass.currency} {capital.consideration}
            </p>
            <p className="metadata">
              Stamping: {capital.stamping.disposition} · {capital.stamping.basis}
            </p>
            {snapshot.capitalReconciliation ? (
              <p className="metadata">
                Class units: {snapshot.capitalReconciliation.before?.units ?? '0'} →{' '}
                {snapshot.capitalReconciliation.after.units}
                {snapshot.capitalReconciliation.sourceCertificate
                  ? ` · source certificate ${snapshot.capitalReconciliation.sourceCertificate.number}`
                  : ''}
              </p>
            ) : null}
          </>
        ) : null}
        {bo ? (
          <>
            {bo.assessment ? (
              <>
                <h3 className="section">
                  {bo.assessment.personName} · {bo.assessment.kind}
                </h3>
                <p>{bo.assessment.criteria}</p>
                <p className="metadata">{bo.assessment.sourceVersion}</p>
                <p className="prose">{bo.assessment.ownershipChain}</p>
                <p className="metadata">
                  Register entry {formatDate(bo.assessment.registerEntryDate)} · next review{' '}
                  {formatDate(bo.assessment.nextReviewDate)}
                </p>
              </>
            ) : null}
            <ul className="list-plain section">
              {bo.notices.map((n) => (
                <li key={n.id}>
                  {n.recipient} · sent {formatDate(n.sentDate)} · reply{' '}
                  {n.reply ? formatDate(n.reply.date) : 'Outstanding'}
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
