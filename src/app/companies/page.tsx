'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useWorkspace, PageHeader, Icon, formatDate, Empty, request } from '@/components/workspace';
import { FormFields } from '@/components/forms';
import { canLeaveEditing } from '@/components/edit-guard';
export default function Companies() {
  const { data, refresh } = useWorkspace();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  if (!data) return null;
  const companies = data.companies.filter((c) =>
    [c.name, c.registrationNumber].join(' ').toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeader title="Companies">
        <div className="header-actions">
          <Link className="button" href="/people">
            People
          </Link>
          {data.actor.capabilities.includes('manage_users') ? (
            <button
              className="primary"
              onClick={() => {
                if (!adding || canLeaveEditing()) setAdding(!adding);
              }}
            >
              <Icon kind="plus" />
              {adding ? 'Close form' : 'New company'}
            </button>
          ) : null}
        </div>
      </PageHeader>
      {adding ? (
        <section className="form-section" style={{ marginTop: 0, marginBottom: 24 }}>
          <h2>Opening company record</h2>
          <form
            inert={pending}
            aria-busy={pending}
            onChange={(event) => {
              event.currentTarget.dataset.dirty = 'true';
            }}
            onSubmit={async (e) => {
              e.preventDefault();
              setError('');
              setPending(true);
              const values = Object.fromEntries(new FormData(e.currentTarget));
              const form = e.currentTarget;
              try {
                await request('/api/companies', { ...values, requestId: crypto.randomUUID() });
                form.dataset.dirty = 'false';
                await refresh();
                setAdding(false);
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Company could not be created');
              } finally {
                setPending(false);
              }
            }}
          >
            <FormFields
              fields={[
                { name: 'name', label: 'Legal name', required: true },
                { name: 'registrationNumber', label: 'Registration number', required: true },
                {
                  name: 'incorporationDate',
                  label: 'Incorporation date',
                  type: 'date',
                  required: true,
                },
                {
                  name: 'financialYearEnd',
                  label: 'Financial year end',
                  type: 'date',
                  required: true,
                },
                { name: 'address', label: 'Registered address', type: 'textarea', required: true },
                { name: 'activity', label: 'Business activity', required: true },
              ]}
            />
            {error ? (
              <div className="feedback error" role="alert">
                {error}
              </div>
            ) : null}
            <div className="actions">
              <button className="primary" disabled={pending}>
                {pending ? 'Saving…' : 'Save opening record'}
              </button>
            </div>
          </form>
        </section>
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
