'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Company, Officer, OfficerEvent } from '@/domain/model';
import { useWorkspace, formatDate, currentDate, Empty, BackToWork } from '@/components/workspace';
import {
  MembersRegister,
  BeneficialOwnershipRegister,
} from '@/components/registers/company-registers';
import { ActionForm } from '@/components/forms';
import { WorkTable } from '@/components/work-list';
export default function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data } = useWorkspace();
  const [asAt, setAsAt] = useState(currentDate());
  const [record, setRecord] = useState<{
    company: Company;
    officers: Officer[];
    events?: OfficerEvent[];
  } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setError('');
    fetch('/api/companies/' + id + '?asAt=' + asAt, { cache: 'no-store' })
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || 'Company unavailable');
        if (active) setRecord(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id, asAt]);
  if (!data) return null;
  const company = data.companies.find((c) => c.id === id);
  if (!company) return <Empty>Company unavailable</Empty>;
  const jobs = data.jobs.filter((j) => j.companyId === id);
  return (
    <>
      <BackToWork />
      <div className="page-header">
        <div>
          <h1 className="company-title">{company.name}</h1>
        </div>
        {data.actor.capabilities.includes('prepare_job') ? (
          <Link className="button" href={'/jobs/new?company=' + id}>
            New job
          </Link>
        ) : null}
      </div>
      <dl className="facts">
        <div>
          <dt>Registration number</dt>
          <dd>{company.registrationNumber}</dd>
        </div>
        <div>
          <dt>Legal status</dt>
          <dd>{company.legalStatus}</dd>
        </div>
        <div>
          <dt>Engagement status</dt>
          <dd>{company.engagementStatus}</dd>
        </div>
        <div>
          <dt>Opening verification</dt>
          <dd>{company.verification}</dd>
        </div>
        <div>
          <dt>Incorporation date</dt>
          <dd>{formatDate(company.incorporationDate)}</dd>
        </div>
        <div>
          <dt>Financial year end</dt>
          <dd>{formatDate(company.financialYearEnd)}</dd>
        </div>
        <div>
          <dt>Registered address</dt>
          <dd>{company.address}</dd>
        </div>
      </dl>
      {company.verification === 'Unverified' ? (
        <div className="warning">Opening company information is unverified.</div>
      ) : null}
      {data.actor.capabilities.includes('confirm_record') &&
      company.verification === 'Unverified' ? (
        <details className="disclosure">
          <summary>Review opening record</summary>
          <div>
            <ActionForm
              url={'/api/companies/' + company.id}
              action="review_opening"
              label="Confirm opening record review"
              confirmation={
                'Confirm review of opening company record revision ' +
                company.revision +
                '? The source and decision will be retained.'
              }
              extra={{ expectedRevision: company.revision, confirmed: true }}
              fields={[
                {
                  name: 'sourceEvidenceId',
                  label: 'Opening source evidence',
                  type: 'select',
                  required: true,
                  options: data.documents
                    .filter((d) => d.companyId === company.id && d.classification === 'General')
                    .map((d) => ({ value: d.id, label: d.title })),
                },
                { name: 'basis', label: 'Review basis', type: 'textarea', required: true },
              ]}
            />
          </div>
        </details>
      ) : null}
      <section className="section">
        <div className="page-header section-header">
          <h2>Officers as at {formatDate(asAt)}</h2>
          <label>
            Record as at
            <input
              type="date"
              value={asAt}
              onChange={(e) => e.target.value && setAsAt(e.target.value)}
            />
          </label>
        </div>
        {asAt !== currentDate() ? <p className="warning">Historical view · read only</p> : null}
        {error ? (
          <div className="feedback error" role="alert">
            {error}
          </div>
        ) : record?.officers?.length ? (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Dated director appointments</caption>
              <thead>
                <tr>
                  <th>Director</th>
                  <th>Appointed</th>
                  <th>Record event</th>
                </tr>
              </thead>
              <tbody>
                {record.officers.map((officer) => (
                  <tr key={officer.personId}>
                    <td>{officer.personName}</td>
                    <td className="nowrap">{formatDate(officer.appointedOn)}</td>
                    <td>
                      <details className="file-details">
                        <summary>Record references</summary>
                        <dl className="record-meta">
                          <div>
                            <dt>Person</dt>
                            <dd>{officer.personId}</dd>
                          </div>
                          <div>
                            <dt>Event</dt>
                            <dd>{officer.eventId}</dd>
                          </div>
                        </dl>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No evidenced director appointments at this date.</p>
        )}
      </section>
      <MembersRegister companyId={id} asAt={asAt} />
      {data.actor.capabilities.includes('view_bo') ? (
        <BeneficialOwnershipRegister companyId={id} asAt={asAt} />
      ) : null}
      <section className="section">
        <h2>Jobs</h2>
        {jobs.length ? <WorkTable jobs={jobs} data={data} /> : <p className="muted">No jobs</p>}
      </section>
      <section className="section">
        <h2>Documents</h2>
        <ul className="document-list">
          {data.documents
            .filter((d) => d.companyId === id)
            .map((document) => (
              <li key={document.id}>
                <div>
                  <a href={'/api/documents/' + document.id}>{document.title}</a>
                  <details className="file-details">
                    <summary>File details</summary>
                    <dl className="record-meta">
                      <div>
                        <dt>Filename</dt>
                        <dd>{document.originalName}</dd>
                      </div>
                      <div>
                        <dt>Uploaded</dt>
                        <dd>{formatDate(document.createdAt)}</dd>
                      </div>
                    </dl>
                  </details>
                </div>
              </li>
            ))}
        </ul>
      </section>
      {record?.events?.length ? (
        <section className="section">
          <h2>Officer record history</h2>
          <ul className="list-plain">
            {record.events.map((event) => (
              <li key={event.id}>
                <strong>{event.personName}</strong> ·{' '}
                <span className="event-route">{event.route.replaceAll('_', ' ')}</span>
                <p className="metadata">
                  Effective {formatDate(event.effectiveDate)} · entered{' '}
                  {formatDate(event.recordedAt)}
                </p>
                {data.jobs.some((job) => job.id === event.jobId) ? (
                  <Link href={'/jobs/' + event.jobId}>Open event job</Link>
                ) : (
                  event.evidenceIds
                    .filter((evidenceId) =>
                      data.documents.some((document) => document.id === evidenceId),
                    )
                    .map((evidenceId) => (
                      <a
                        className="evidence-link"
                        key={evidenceId}
                        href={'/api/documents/' + evidenceId}
                      >
                        View source evidence
                      </a>
                    ))
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
