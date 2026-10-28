'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useWorkspace, PageHeader, Icon, formatDate, Empty } from '@/components/workspace';
import { NewCompany } from '@/components/new-company';
import { canLeaveEditing } from '@/components/edit-guard';
export default function Companies() {
  const { data, refresh } = useWorkspace();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  if (!data) return null;
  const companies = data.companies.filter((c) =>
    [c.name, c.registrationNumber].join(' ').toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeader title="Companies">
        <div className="header-actions">
          {data.actor.capabilities.includes('prepare_job') ? (
            <button
              className="primary"
              onClick={async () => {
                if (adding && !(await canLeaveEditing())) return;
                setAdding(!adding);
              }}
            >
              {adding ? null : <Icon kind="plus" />}
              {adding ? 'Close form' : 'New company'}
            </button>
          ) : null}
        </div>
      </PageHeader>
      {adding ? (
        <NewCompany
          onSaved={async () => {
            await refresh();
            setAdding(false);
          }}
        />
      ) : null}
      <div className="toolbar">
        <label className="search">
          <span className="sr-only">Search companies</span>
          <Icon kind="search" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or registration number"
          />
        </label>
      </div>
      {companies.length ? (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Accessible companies</caption>
            <thead>
              <tr>
                <th>Company</th>
                <th>Legal status</th>
                <th>Engagement</th>
                <th>Opening record</th>
                <th>Incorporated</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr key={company.id}>
                  <td>
                    <Link href={'/companies/' + company.id}>{company.name}</Link>
                    <div className="metadata">{company.registrationNumber}</div>
                  </td>
                  <td>{company.legalStatus}</td>
                  <td>{company.engagementStatus}</td>
                  <td>{company.verification}</td>
                  <td className="nowrap">{formatDate(company.incorporationDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No matching companies</Empty>
      )}
    </>
  );
}
