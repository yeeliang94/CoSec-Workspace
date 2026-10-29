'use client';
import Link from 'next/link';
import type { CapitalRegister, BoRegister } from '@/domain/records';
import { useWorkspace, formatDate } from '../workspace';
import { RegisterState, useRegister } from './shared';

export function MembersRegister({ companyId, asAt }: { companyId: string; asAt: string }) {
  const { data } = useWorkspace();
  const result = useRegister<CapitalRegister>(
    `/api/companies/${companyId}/registers?asAt=${asAt}`,
    data,
  );
  const records = result.value;
  return (
    <section className="section">
      <div className="page-header section-header">
        <h2>Members and capital</h2>
        {data?.actor.capabilities.includes('prepare_job') ? (
          <Link className="button" href={`/jobs/new?company=${companyId}&activity=W05`}>
            New share transaction
          </Link>
        ) : null}
      </div>
      <RegisterState {...result} />
      {!result.loading && !result.error && records ? (
        <>
          {records.position.verification === 'Not established' ? (
            <p className="muted">Opening member balances not established</p>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Share class totals</caption>
                  <thead>
                    <tr>
                      <th>Class</th>
                      <th>Issued units</th>
                      <th>Issued capital</th>
                      <th>Paid-up capital</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.position.classes.map((c) => (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td className="tabular">{c.units}</td>
                        <td className="nowrap">
                          {c.currency} {c.issuedAmount}
                        </td>
                        <td className="nowrap">
                          {c.currency} {c.paidAmount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="section">
                <h3>Member holdings</h3>
                <div className="table-wrap">
                  <table>
                    <caption className="sr-only">Members by share class</caption>
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Class</th>
                        <th>Units</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.position.holdings.map((h) => (
                        <tr key={`${h.memberId}:${h.classId}`}>
                          <td>{records.position.members.find((m) => m.id === h.memberId)?.name}</td>
                          <td>{records.position.classes.find((c) => c.id === h.classId)?.name}</td>
                          <td>{h.units}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
          {records.position.certificates.length ? (
            <details className="disclosure">
              <summary>Certificates</summary>
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Immutable certificate history</caption>
                  <thead>
                    <tr>
                      <th>Certificate</th>
                      <th>Member</th>
                      <th>Units</th>
                      <th>Issued</th>
                      <th>Cancelled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.position.certificates.map((c) => (
                      <tr key={c.id}>
                        <td>{c.number}</td>
                        <td>{records.position.members.find((m) => m.id === c.memberId)?.name}</td>
                        <td>{c.units}</td>
                        <td className="nowrap">{formatDate(c.issuedOn)}</td>
                        <td>{c.cancelledOn ? formatDate(c.cancelledOn) : 'Active'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
          {records.events.length ? (
            <details className="disclosure">
              <summary>Share transaction history</summary>
              <div>
                <ul className="list-plain">
                  {[...records.events].reverse().map((e) => (
                    <li key={e.id}>
                      <Link href={'/jobs/' + e.jobId}>
                        {e.kind === 'opening'
                          ? 'Opening balances'
                          : e.kind === 'allotment'
                            ? 'Allotment'
                            : 'Transfer'}{' '}
                        · {e.shareClass.name}
                      </Link>
                      <dl className="record-meta">
                        <div>
                          <dt>Effective</dt>
                          <dd>{formatDate(e.effectiveDate)}</dd>
                        </div>
                        <div>
                          <dt>Entered</dt>
                          <dd>{formatDate(e.recordedAt)}</dd>
                        </div>
                        <div>
                          <dt>Pack</dt>
                          <dd>v{e.packVersion}</dd>
                        </div>
                      </dl>
                      {e.effectiveDate > asAt ? <p>Approved and future dated</p> : null}
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
export function BeneficialOwnershipRegister({
  companyId,
  asAt,
}: {
  companyId: string;
  asAt: string;
}) {
  const { data } = useWorkspace();
  const result = useRegister<BoRegister>(`/api/companies/${companyId}/bo?asAt=${asAt}`, data);
  const records = result.value;
  return (
    <section className="section">
      <div className="page-header section-header">
        <h2>Beneficial ownership</h2>
        {data?.actor.capabilities.includes('prepare_job') ? (
          <Link href={`/jobs/new?company=${companyId}&activity=W06`} className="button">
            New BO assessment
          </Link>
        ) : null}
      </div>
      <RegisterState {...result} />
      {!result.loading && !result.error && records ? (
        <>
          {records.owners.length ? (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Reviewed beneficial ownership register</caption>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Effective</th>
                    <th>Register entry</th>
                    <th>Next review</th>
                    <th>Source case</th>
                  </tr>
                </thead>
                <tbody>
                  {records.owners.map((e) => (
                    <tr key={e.id}>
                      <td>{e.personName}</td>
                      <td className="nowrap">{formatDate(e.effectiveDate)}</td>
                      <td className="nowrap">{formatDate(e.registerEntryDate)}</td>
                      <td className="nowrap">{formatDate(e.nextReviewDate)}</td>
                      <td>
                        <Link href={'/jobs/' + e.jobId}>View assessment</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No reviewed BO entries at this date</p>
          )}
          {records.events.length ? (
            <details className="disclosure">
              <summary>BO register history</summary>
              <div>
                <ul className="list-plain">
                  {[...records.events].reverse().map((e) => (
                    <li key={e.id}>
                      <Link href={'/jobs/' + e.jobId}>
                        {e.personName} ·{' '}
                        {e.kind === 'entry'
                          ? 'Entry'
                          : e.kind === 'review'
                            ? 'Review/update'
                            : 'Cessation'}
                      </Link>
                      <dl className="record-meta">
                        <div>
                          <dt>Effective</dt>
                          <dd>{formatDate(e.effectiveDate)}</dd>
                        </div>
                        <div>
                          <dt>Register entry</dt>
                          <dd>{formatDate(e.registerEntryDate)}</dd>
                        </div>
                        <div>
                          <dt>Entered</dt>
                          <dd>{formatDate(e.recordedAt)}</dd>
                        </div>
                        <div>
                          <dt>Source version</dt>
                          <dd>{e.sourceVersion}</dd>
                        </div>
                      </dl>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
