'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Company, Officer, OfficerEvent } from '@/domain/model';
import type { ResolutionCase } from '@/domain/resolution/model';
import { caseStatus } from '@/domain/resolution/cases';
import {
  useWorkspace,
  formatDate,
  formatDay,
  currentDate,
  Empty,
  BackLink,
  useDocumentTitle,
  Icon,
} from '@/components/workspace';
import { ActionForm } from '@/components/forms';
import { CompanyRelationships } from '@/components/resolution/relationships';
import { getJson, kindLabel } from '@/components/resolution/api';
import { LoadState, useLoad } from '@/components/resolution/use-load';
import { NewResolution } from '@/components/resolution/new-resolution';
import { formatYearEnd, industryLabel } from '@/domain/company';
export default function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data } = useWorkspace();
  useDocumentTitle(data?.companies.find((c) => c.id === id)?.name);
  const [asAt, setAsAt] = useState(currentDate());
  const [record, setRecord] = useState<{
    company: Company;
    officers: Officer[];
    events?: OfficerEvent[];
  } | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  // Bumped after a people change so officer history reloads with it.
  const [recordVersion, setRecordVersion] = useState(0);
  const resolutions = useLoad(
    () =>
      getJson<{ cases: ResolutionCase[] }>(
        '/api/resolution-cases?companyId=' + encodeURIComponent(id),
      ),
    [id],
  );
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
  }, [id, asAt, recordVersion]);
  if (!data) return null;
  const company = data.companies.find((c) => c.id === id);
  if (!company) return <Empty>Company unavailable</Empty>;
  return (
    <>
      <BackLink href="/companies" label="Companies" />
      <div className="page-header">
        <div>
          <h1 className="company-title">{company.name}</h1>
          <p className="record-number">{company.registrationNumber}</p>
        </div>
        {data.actor.capabilities.some((c) => c === 'generate_documents' || c === 'prepare_job') ? (
          <button type="button" className="primary" onClick={() => setCreating(true)}>
            <Icon kind="plus" />
            New resolution
          </button>
        ) : null}
      </div>
      {creating ? <NewResolution companyId={id} onCancel={() => setCreating(false)} /> : null}
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
            <span className="metadata">Historical view, read only</span>
            <button type="button" className="quiet" onClick={() => setAsAt(currentDate())}>
              Back to today
            </button>
          </>
        ) : null}
      </div>
      <div className="split record-split">
        <div className="split-main">
          {error ? (
            <div className="feedback error" role="alert">
              {error}
            </div>
          ) : null}
          <CompanyRelationships
            companyId={id}
            asAt={asAt}
            onAsAtChange={setAsAt}
            onChanged={() => setRecordVersion((v) => v + 1)}
          />
          <section className="section">
            <h2>Resolutions</h2>
            <LoadState
              loading={resolutions.loading && !resolutions.data}
              error={resolutions.error}
              reload={() => void resolutions.reload()}
              label="resolutions"
            />
            {resolutions.data ? (
              resolutions.data.cases.length ? (
                <div className="table-wrap">
                  <table className="resolution-table stack-table">
                    <caption className="sr-only">Resolutions for {company.name}</caption>
                    <thead>
                      <tr>
                        <th>Resolution</th>
                        <th>Kind</th>
                        <th>Status</th>
                        <th>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resolutions.data.cases.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <Link href={'/resolutions/' + item.id}>{item.title}</Link>
                          </td>
                          <td>{kindLabel(item.kind)}</td>
                          <td data-label="Status">
                            {caseStatus(
                              item,
                              (userId) => data.users.find((u) => u.id === userId)?.name || userId,
                            )}
                          </td>
                          <td data-label="Updated" className="nowrap">
                            {formatDay(item.updatedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted">No resolutions</p>
              )
            ) : null}
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
                    <strong>{event.personName}</strong>,{' '}
                    <span className="event-route">{event.route.replaceAll('_', ' ')}</span>
                    <p className="metadata">
                      Effective {formatDate(event.effectiveDate)}, entered{' '}
                      {formatDay(event.recordedAt)}
                    </p>
                    {event.evidenceIds
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
                      ))}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
        <aside className="detail-aside">
          <h2>Details</h2>
          <dl className="facts stacked">
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
              <dd>{industryLabel(company.industry)}</dd>
            </div>
            {company.activity ? (
              <div>
                <dt>Business activity</dt>
                <dd>{company.activity}</dd>
              </div>
            ) : null}
            <div>
              <dt>Registered address</dt>
              <dd>{company.address}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </>
  );
}
