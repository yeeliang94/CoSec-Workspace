'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useWorkspace, PageHeader, Icon, formatDate, Empty } from '@/components/workspace';
import { UploadForm } from '@/components/forms';
import { canLeaveEditing } from '@/components/edit-guard';
export default function Documents() {
  const { data } = useWorkspace();
  const [query, setQuery] = useState('');
  const [companyId, setCompanyId] = useState('');
  if (!data) return null;
  const documents = data.documents.filter(
    (d) =>
      (!companyId || d.companyId === companyId) &&
      [d.title, d.originalName, data.companies.find((c) => c.id === d.companyId)?.name]
        .join(' ')
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeader title="Documents" />
      <div className="toolbar">
        <label className="search">
          <span className="sr-only">Search documents</span>
          <Icon kind="search" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documents"
          />
        </label>
        <label>
          <span className="sr-only">Company</span>
          <select
            value={companyId}
            onChange={async (e) => {
              const next = e.target.value;
              if (await canLeaveEditing()) setCompanyId(next);
            }}
          >
            <option value="">All companies</option>
            {data.companies.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {companyId && data.actor.capabilities.includes('prepare_job') ? (
        <details className="disclosure" style={{ marginBottom: 24 }}>
          <summary>Upload company evidence</summary>
          <div>
            <UploadForm key={companyId} companyId={companyId} />
          </div>
        </details>
      ) : null}
      {documents.length ? (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Private company evidence</caption>
            <thead>
              <tr>
                <th>Document</th>
                <th>Company</th>
                <th>Linked job</th>
                <th>Uploaded</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id}>
                  <td>
                    <a href={'/api/documents/' + d.id}>{d.title}</a>
                    {d.originalName !== d.title ? (
                      <details className="file-details">
                        <summary>Filename</summary>
                        <span>{d.originalName}</span>
                      </details>
                    ) : null}
                  </td>
                  <td>
                    <Link href={'/companies/' + d.companyId}>
                      {data.companies.find((c) => c.id === d.companyId)?.name}
                    </Link>
                  </td>
                  <td>
                    {d.jobId ? (
                      <Link href={'/jobs/' + d.jobId}>
                        {data.jobs.find((j) => j.id === d.jobId)?.title || 'Open job'}
                      </Link>
                    ) : (
                      'Company file'
                    )}
                  </td>
                  <td>{formatDate(d.createdAt)}</td>
                  <td className="nowrap">{Math.max(1, Math.round(d.size / 1024))} KB</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No matching documents</Empty>
      )}
    </>
  );
}
