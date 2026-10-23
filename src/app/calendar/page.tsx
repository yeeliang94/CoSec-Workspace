'use client';
import Link from 'next/link';
import { useWorkspace, PageHeader, formatDate, currentDate, Empty } from '@/components/workspace';
export default function Calendar() {
  const { data } = useWorkspace();
  if (!data) return null;
  const reminders = data.reminders
    .filter((r) => !r.resolved)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return (
    <>
      <PageHeader title="Calendar" />
      {reminders.length ? (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Upcoming and overdue internal work</caption>
            <thead>
              <tr>
                <th>Date</th>
                <th>Work</th>
                <th>Company</th>
                <th>Reminder</th>
                <th>Owner</th>
              </tr>
            </thead>
            <tbody>
              {reminders.map((reminder) => (
                <tr key={reminder.id}>
                  <td className={reminder.dueDate < currentDate() ? 'danger nowrap' : 'nowrap'}>
                    {formatDate(reminder.dueDate)}
                    {reminder.dueDate < currentDate() ? (
                      <div className="metadata danger">Overdue</div>
                    ) : null}
                  </td>
                  <td>
                    <Link href={'/jobs/' + reminder.jobId}>
                      {data.jobs.find((j) => j.id === reminder.jobId)?.title || 'Open job'}
                    </Link>
                  </td>
                  <td>
                    <Link href={'/companies/' + reminder.companyId}>
                      {data.companies.find((c) => c.id === reminder.companyId)?.name}
                    </Link>
                  </td>
                  <td>{reminder.kind}</td>
                  <td>{data.users.find((u) => u.id === reminder.ownerId)?.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No upcoming reminders</Empty>
      )}
    </>
  );
}
