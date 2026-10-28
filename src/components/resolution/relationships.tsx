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
  member: 'Shareholder',
  secretary: 'Secretary',
  auditor: 'Auditor',
  other: 'Other',
};
export const roleName = (role: RelationshipRole) => ROLE_NAMES[role] || role;

const ROLE_ORDER: RelationshipRole[] = ['director', 'secretary', 'member', 'auditor', 'other'];

/** Everyone linked to a company as at a date, with add and end actions. */
export function CompanyRelationships({
  companyId,
  asAt: pageAsAt,
  onAsAtChange,
}: {
  companyId: string;
  /** The page's record-as-at date, when the page shares one date across its sections. */
  asAt?: string;
  onAsAtChange?: (asAt: string) => void;
}) {
  const { data } = useWorkspace();
  const [ownAsAt, setOwnAsAt] = useState(currentDate());
  const asAt = pageAsAt ?? ownAsAt;
  const setAsAt = onAsAtChange ?? setOwnAsAt;
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
  const sorted = [...(load.data?.relationships ?? [])].sort(
    (a, b) =>
      ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
      a.personName.localeCompare(b.personName),
  );
  const ended = sorted.filter((r) => !active(r));
  return (
    <section className="section relationships" aria-labelledby="company-people">
      <div className="page-header section-header">
        <h2 id="company-people">People</h2>
        <label className="as-at">
          Record as at
          <input
            type="date"
            value={asAt}
            onChange={(event) => event.target.value && setAsAt(event.target.value)}
          />
        </label>
      </div>
      <LoadState
        loading={load.loading && !load.data}
        error={load.error}
        reload={() => void load.reload()}
        label="people"
      />
      {load.data ? (
        <>
          <RelationshipTable
            rows={sorted.filter(active)}
            companyId={companyId}
            canManage={canManage && asAt === currentDate()}
            onChanged={load.reload}
          />
          {ended.length ? (
            <details className="advanced-filters">
              <summary>Former and future ({ended.length})</summary>
              <RelationshipTable
                rows={ended}
                companyId={companyId}
                canManage={false}
                onChanged={load.reload}
              />
            </details>
          ) : null}
          {canManage ? <AddRelationship companyId={companyId} onAdded={load.reload} /> : null}
        </>
      ) : null}
    </section>
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
  if (!rows.length) return <p className="metadata">No one on record at this date.</p>;
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
                <td>{roleName(row.role)}</td>
                <td>{row.capacity || '—'}</td>
                <td className="nowrap">{formatDate(row.startDate)}</td>
                <td className="nowrap">{formatDate(row.endDate)}</td>
                {canManage ? (
                  <td>
                    {!row.endDate ? (
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
    role: 'director' as RelationshipRole,
    capacity: '',
    startDate: '',
    evidenceIds: [] as string[],
  });
  const evidence = data?.documents.filter((d) => d.companyId === companyId) ?? [];
  const dirty = Boolean(form.personId || form.capacity || form.startDate);
  return (
    <details className="disclosure">
      <summary>Add a person</summary>
      <form
        className="form-grid"
        data-dirty={dirty ? 'true' : 'false'}
        onSubmit={async (event) => {
          event.preventDefault();
          const typed = form.personId.trim();
          const match = (people.data?.people ?? []).find(
            (p) => p.fullName.toLowerCase() === typed.toLowerCase(),
          );
          const ok = await action.run(
            async () =>
              postJson(`/api/companies/${companyId}/relationships`, {
                action: 'add',
                requestId: newRequestId(),
                personId:
                  match?.id ??
                  (
                    await postJson<Person>('/api/people', {
                      action: 'create',
                      requestId: newRequestId(),
                      fullName: typed,
                    })
                  ).id,
                role: form.role,
                capacity: form.capacity.trim(),
                startDate: form.startDate || null,
                evidenceIds: form.evidenceIds,
              }),
            'Person added',
          );
          if (ok) {
            setForm({
              personId: '',
              role: 'director',
              capacity: '',
              startDate: '',
              evidenceIds: [],
            });
            await onAdded();
          }
        }}
      >
        <label>
          Name
          <input
            required
            list={`people-${companyId}`}
            autoComplete="off"
            placeholder="Type a name"
            value={form.personId}
            onChange={(event) => setForm({ ...form, personId: event.target.value })}
          />
          <datalist id={`people-${companyId}`}>
            {(people.data?.people ?? []).map((person) => (
              <option key={person.id} value={person.fullName} />
            ))}
          </datalist>
        </label>
        <label>
          Role
          <select
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value as typeof form.role })}
          >
            <option value="director">Director</option>
            <option value="member">Shareholder</option>
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
            <button disabled={action.pending}>Add person</button>
          </div>
        </div>
      </form>
    </details>
  );
}
