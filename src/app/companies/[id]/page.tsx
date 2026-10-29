'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Company, Officer, OfficerEvent } from '@/domain/model';
import { useWorkspace, formatDate, currentDate, Empty, BackLink } from '@/components/workspace';
import {
  MembersRegister,
  BeneficialOwnershipRegister,
} from '@/components/registers/company-registers';
import { ActionForm } from '@/components/forms';
import { WorkTable } from '@/components/work-list';
import { CompanyRelationships } from '@/components/resolution/relationships';
import { formatYearEnd, industryLabel } from '@/domain/company';
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
      <BackLink href="/companies" label="Companies" />
      <div className="page-header">
        <h1>{company.name}</h1>
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
        {company.verification !== 'Unverified' ? (
          <div>
            <dt>Opening verification</dt>
            <dd>{company.verification}</dd>
          </div>
        ) : null}
        <div>
          <dt>Incorporation date</dt>
          <dd>{formatDate(company.incorporationDate)}</dd>
        </div>
        <div>
          <dt>Financial year end</dt>
          <dd>{formatYearEnd(company.financialYearEnd)}</dd>
        </div>
        <div>
          <dt>Industry</dt>
          <dd>
            {[industryLabel(company.industry), company.activity]
              .filter((value) => value && value !== '—')
              .join(' · ') || '—'}
          </dd>
        </div>
        <div>
          <dt>Registered address</dt>
          <dd>{company.address}</dd>
        </div>
      </dl>
      {company.verification === 'Unverified' ? (
        <div className="warning">
          Opening company information is unverified.
          {data.actor.capabilities.includes('confirm_record') ? (
            <details className="disclosure">
              <summary>Review opening record</summary>
              <ActionForm
                url={'/api/companies/' + company.id}
                action="review_opening"
                label="Confirm opening record review"
                primary
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
            </details>
          ) : null}
        </div>
      ) : null}
      <div className="toolbar record-as-at">
        <label>
          Record as at
          <input
            type="date"
            value={asAt}
            onChange={(event) => event.target.value && setAsAt(event.target.value)}
          />
        </label>
        {asAt !== currentDate() ? (
          <>
            <span className="metadata">Historical view · read only</span>
            <button type="button" className="quiet" onClick={() => setAsAt(currentDate())}>
              Back to today
            </button>
          </>
        ) : null}
      </div>
      {error ? (
        <div className="feedback error" role="alert">
          {error}
        </div>
      ) : null}
      <CompanyRelationships companyId={id} asAt={asAt} onAsAtChange={setAsAt} />
      <MembersRegister companyId={id} asAt={asAt} />
      {data.actor.capabilities.includes('view_bo') ? (
        <BeneficialOwnershipRegister companyId={id} asAt={asAt} />
      ) : null}
      <section className="section">
        <h2>Jobs</h2>
        {jobs.length ? (
          <WorkTable jobs={jobs} data={data} hideCompany />
        ) : (
          <p className="muted">No jobs</p>
        )}
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
