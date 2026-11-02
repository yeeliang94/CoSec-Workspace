'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useWorkspace, PageHeader, Icon, formatDay, Empty } from '@/components/workspace';
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
      <PageHeader title="Documents">
        <div className="header-actions header-links">
          <Link className="section-link" href="/resolutions">
            Resolutions
          </Link>
          {data.actor.capabilities.includes('manage_templates') ? (
            <Link className="section-link" href="/templates">
              Templates
            </Link>
          ) : null}
        </div>
      </PageHeader>
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
                <th>File name</th>
                <th>Company</th>
                <th>Uploaded</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id}>
                  <td>
                    <a href={'/api/documents/' + d.id}>{d.title}</a>
                  </td>
                  <td className="muted file-name">{d.originalName}</td>
                  <td>
                    <Link href={'/companies/' + d.companyId}>
                      {data.companies.find((c) => c.id === d.companyId)?.name}
                    </Link>
                  </td>
                  <td className="nowrap tabular">{formatDay(d.createdAt)}</td>
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
