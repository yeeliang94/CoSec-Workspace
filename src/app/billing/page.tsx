'use client';
import Link from 'next/link';
import { useWorkspace, PageHeader, Empty } from '@/components/workspace';
export default function Billing() {
  const { data } = useWorkspace();
  if (!data) return null;
  const jobs = data.jobs.filter((j) => j.billingState !== 'Not ready');
  return (
    <>
      <PageHeader title="Billing" />
      {jobs.length ? (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Independent billing handoff</caption>
            <thead>
              <tr>
                <th>Company</th>
                <th>Service</th>
                <th>Operational state</th>
                <th>Filing</th>
                <th>Billing</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>{data.companies.find((c) => c.id === j.companyId)?.name}</td>
                  <td>
                    <Link href={'/jobs/' + j.id}>{j.title}</Link>
                  </td>
                  <td>{j.state}</td>
                  <td>{j.filingState}</td>
                  <td>{j.billingState}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No work marked ready to bill</Empty>
      )}
    </>
  );
}
