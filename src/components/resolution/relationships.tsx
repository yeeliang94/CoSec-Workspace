'use client';
import { useState } from 'react';
import Link from 'next/link';
import type {
  CompanyRelationship,
  Person,
  PersonSnapshot,
  RelationshipRole,
} from '@/domain/resolution/model';
import { currentDate, formatDate, useWorkspace } from '@/components/workspace';
import { getJson, newRequestId, postJson } from './api';
import { LoadState, useLoad } from './use-load';
import { ActionFeedback, useAction } from './use-action';

type RelationshipView = CompanyRelationship & { personName: string };
const ROLE_NAMES: Record<RelationshipRole, string> = {
  director: 'Director',
  member: 'Member',
  secretary: 'Secretary',
  auditor: 'Auditor',
  other: 'Other',
};
export const roleName = (role: RelationshipRole) => ROLE_NAMES[role] || role;

/** Directors as at a date (from posted officer events) and other dated relationships. */
export function CompanyRelationships({ companyId }: { companyId: string }) {
  const { data } = useWorkspace();
  const [asAt, setAsAt] = useState(currentDate());
  const load = useLoad(
    () =>
      getJson<{ relationships: RelationshipView[]; directorsAsAt: PersonSnapshot[] }>(
        `/api/companies/${companyId}/relationships?asAt=${asAt}`,
      ),
    [companyId, asAt],
  );
  const canManage = Boolean(data?.actor.capabilities.includes('manage_people'));
  const active = (r: RelationshipView) =>
    (!r.startDate || r.startDate <= asAt) && (!r.endDate || r.endDate > asAt);
  return (
    <div className="relationships">
      <div className="page-header section-header">
        <h2>Relationships</h2>
        <label className="as-at">
          Record as at
          <input type="date" value={asAt} onChange={(event) => setAsAt(event.target.value)} />
        </label>
      </div>
      <LoadState
        loading={load.loading && !load.data}
        error={load.error}
        reload={() => void load.reload()}
        label="relationships"
      />
      {load.data ? (
        <>
          <h3>Directors</h3>
          {load.data.directorsAsAt.length ? (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Directors as at {asAt}</caption>
                <thead>
                  <tr>
                    <th>Director</th>
                    <th>Capacity</th>
                    <th>Appointed</th>
                  </tr>
                </thead>
                <tbody>
                  {load.data.directorsAsAt.map((person) => (
                    <tr key={person.id}>
                      <td>{person.name}</td>
                      <td>{person.capacity}</td>
                      <td className="nowrap">{formatDate(person.appointedOn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="metadata">No directors on record at this date.</p>
          )}
          <details className="advanced-filters">
            <summary>Director record source</summary>
            <p>From posted officer events. Record changes through a director change job.</p>
          </details>
          <h3 className="subsection">Other relationships</h3>
          <RelationshipTable
            rows={load.data.relationships.filter((r) => r.role !== 'director' && active(r))}
            companyId={companyId}
            canManage={canManage}
            onChanged={load.reload}
          />
          <details className="advanced-filters">
            <summary>Show ended and future relationships</summary>
            <RelationshipTable
              rows={load.data.relationships.filter((r) => !active(r))}
              companyId={companyId}
              canManage={false}
              onChanged={load.reload}
            />
          </details>
          {canManage ? <AddRelationship companyId={companyId} onAdded={load.reload} /> : null}
        </>
      ) : null}
    </div>
  );
}

function RelationshipTable({
  rows,
  companyId,
  canManage,
  onChanged,
}: {
  rows: RelationshipView[];
  companyId: string;
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const [ending, setEnding] = useState<string>('');
  const [endDate, setEndDate] = useState(currentDate());
  const [reason, setReason] = useState('');
  const action = useAction();
  if (!rows.length) return <p className="metadata">None.</p>;
  return (
    <>
      <ActionFeedback
        error={action.error}
        status={action.status}
        conflict={action.conflict}
        onReload={() => void onChanged()}
      />
      <div className="table-wrap">
        <table className="relationship-table">
          <caption className="sr-only">Relationships</caption>
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th>Capacity</th>
              <th>From</th>
              <th>Until</th>
              {canManage ? <th>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link href={`/people?person=${row.personId}`}>{row.personName}</Link>
                </td>
                <td>
                  {roleName(row.role)}
                  {row.projectedFrom ? (
                    <div className="metadata">From posted officer events</div>
                  ) : null}
                </td>
                <td>{row.capacity || '—'}</td>
                <td className="nowrap">{formatDate(row.startDate)}</td>
                <td className="nowrap">{formatDate(row.endDate)}</td>
                {canManage ? (
                  <td>
                    {!row.projectedFrom && !row.endDate ? (
                      ending === row.id ? (
                        <form
                          className="form-stack inline-form"
                          onSubmit={async (event) => {
                            event.preventDefault();
                            const ok = await action.run(
                              () =>
                                postJson(`/api/companies/${companyId}/relationships`, {
                                  action: 'end',
                                  id: row.id,
                                  expectedRevision: row.revision,
                                  requestId: newRequestId(),
                                  endDate,
                                  reason: reason.trim(),
                                }),
                              `Ended ${row.personName}'s relationship`,
                            );
                            if (ok) {
                              setEnding('');
                              await onChanged();
                            }
                          }}
                        >
                          <label>
                            End date
                            <input
                              type="date"
                              required
                              value={endDate}
                              onChange={(event) => setEndDate(event.target.value)}
                            />
                          </label>
                          <label>
                            Reason
                            <input
                              required
                              value={reason}
                              onChange={(event) => setReason(event.target.value)}
                            />
                          </label>
                          <div className="actions">
                            <button className="primary" disabled={action.pending}>
                              End
                            </button>
                            <button type="button" onClick={() => setEnding('')}>
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <button
                          type="button"
                          className="quiet"
                          aria-label={`End ${roleName(row.role)} relationship for ${row.personName}`}
                          onClick={() => {
                            setEnding(row.id);
                            setReason('');
                          }}
                        >
                          End…
                        </button>
                      )
                    ) : (
                      <span className="metadata">—</span>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AddRelationship({
  companyId,
  onAdded,
}: {
  companyId: string;
  onAdded: () => Promise<void>;
}) {
  const { data } = useWorkspace();
  const people = useLoad(() => getJson<{ people: Person[] }>('/api/people'), []);
  const action = useAction();
  const [form, setForm] = useState({
    personId: '',
    role: 'member' as Exclude<RelationshipRole, 'director'>,
    capacity: '',
    startDate: '',
    evidenceIds: [] as string[],
  });
  const evidence = data?.documents.filter((d) => d.companyId === companyId) ?? [];
  const dirty = Boolean(form.personId || form.capacity || form.startDate);
  return (
    <details className="disclosure">
      <summary>Add a relationship</summary>
      <form
        className="form-grid"
        data-dirty={dirty ? 'true' : 'false'}
        onSubmit={async (event) => {
          event.preventDefault();
          const ok = await action.run(
            () =>
              postJson(`/api/companies/${companyId}/relationships`, {
                action: 'add',
                requestId: newRequestId(),
                personId: form.personId,
                role: form.role,
                capacity: form.capacity.trim(),
                startDate: form.startDate || null,
                evidenceIds: form.evidenceIds,
              }),
            'Relationship added',
          );
          if (ok) {
            setForm({ personId: '', role: 'member', capacity: '', startDate: '', evidenceIds: [] });
            await onAdded();
          }
        }}
      >
        <label>
          Person
          <select
            required
            value={form.personId}
            onChange={(event) => setForm({ ...form, personId: event.target.value })}
          >
            <option value="">{people.loading ? 'Loading people…' : 'Select…'}</option>
            {(people.data?.people ?? []).map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Role
          <select
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value as typeof form.role })}
          >
            <option value="member">Member</option>
            <option value="secretary">Secretary</option>
            <option value="auditor">Auditor</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Capacity
          <input
            maxLength={200}
            value={form.capacity}
            onChange={(event) => setForm({ ...form, capacity: event.target.value })}
          />
        </label>
        <label>
          Start date
          <input
            type="date"
            value={form.startDate}
            onChange={(event) => setForm({ ...form, startDate: event.target.value })}
          />
        </label>
        {evidence.length ? (
          <fieldset className="full">
            <legend>Evidence</legend>
            {evidence.map((doc) => (
              <label className="inline" key={doc.id}>
                <input
                  type="checkbox"
                  checked={form.evidenceIds.includes(doc.id)}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      evidenceIds: event.target.checked
                        ? [...form.evidenceIds, doc.id]
                        : form.evidenceIds.filter((id) => id !== doc.id),
                    })
                  }
                />
                {doc.title}
              </label>
            ))}
          </fieldset>
        ) : null}
        <div className="full form-footer">
          <ActionFeedback error={action.error} status={action.status} />
          <div className="actions">
            <button disabled={action.pending}>Add relationship</button>
            <span className="metadata">Directors are added through a W04 director change.</span>
          </div>
        </div>
      </form>
    </details>
  );
}
