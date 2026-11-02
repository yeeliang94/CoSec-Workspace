'use client';
import { useRef, useState } from 'react';
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
import { canLeaveEditing } from '@/components/edit-guard';
import { emptyPick, PersonField, resolvePick } from '@/components/person-field';

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
            onChange={async (event) => {
              const next = event.target.value;
              if (next && next !== asAt && (await canLeaveEditing())) setAsAt(next);
            }}
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
            key={asAt}
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
          {canManage && asAt === currentDate() ? (
            <AddRelationship companyId={companyId} onAdded={load.reload} />
          ) : null}
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
  const [ending, setEnding] = useState<{ id: string; initialDate: string } | null>(null);
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
                      ending?.id === row.id ? (
                        <form
                          className="form-stack inline-form"
                          inert={action.pending}
                          aria-busy={action.pending}
                          data-dirty={reason || endDate !== ending.initialDate ? 'true' : 'false'}
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
                              setEnding(null);
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
                            <button
                              type="button"
                              onClick={async () => {
                                if (await canLeaveEditing()) setEnding(null);
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <button
                          type="button"
                          className="quiet"
                          aria-label={`End ${roleName(row.role)} relationship for ${row.personName}`}
                          onClick={async () => {
                            if (!(await canLeaveEditing())) return;
                            const today = currentDate();
                            setEnding({ id: row.id, initialDate: today });
                            setEndDate(today);
                            setReason('');
                          }}
                        >
                          End role
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
  const creationRequest = useRef<{ name: string; requestId: string } | null>(null);
  const action = useAction();
  const [form, setForm] = useState({
    pick: emptyPick(),
    role: 'director' as RelationshipRole,
    capacity: '',
    startDate: '',
    evidenceIds: [] as string[],
  });
  const evidence = data?.documents.filter((d) => d.companyId === companyId) ?? [];
  const dirty = Boolean(
    form.pick.name ||
    form.role !== 'director' ||
    form.capacity ||
    form.startDate ||
    form.evidenceIds.length,
  );
  return (
    <details className="disclosure">
      <summary>Add a person</summary>
      <form
        className="form-grid"
        inert={action.pending}
        aria-busy={action.pending}
        data-dirty={dirty ? 'true' : 'false'}
        onSubmit={async (event) => {
          event.preventDefault();
          const ok = await action.run(async () => {
            if (!people.data) throw new Error('Wait for the people list to load, then try again.');
            const pick = resolvePick(people.data.people, form.pick);
            let personId: string;
            if ('personId' in pick) personId = pick.personId;
            else {
              // Retain the creation key and identity so a retry cannot create another person.
              if (creationRequest.current?.name !== pick.fullName)
                creationRequest.current = { name: pick.fullName, requestId: newRequestId() };
              const person = await postJson<Person>('/api/people', {
                action: 'create',
                requestId: creationRequest.current.requestId,
                fullName: pick.fullName,
              });
              personId = person.id;
              people.setData((current) => ({
                people: [...(current?.people ?? []).filter((p) => p.id !== person.id), person],
              }));
              setForm((current) => ({
                ...current,
                pick: { name: person.fullName, choice: person.id },
              }));
              creationRequest.current = null;
            }
            return postJson(`/api/companies/${companyId}/relationships`, {
              action: 'add',
              requestId: newRequestId(),
              personId,
              role: form.role,
              capacity: form.capacity.trim(),
              startDate: form.startDate || null,
              evidenceIds: form.evidenceIds,
            });
          }, 'Person added');
          if (ok) {
            setForm({
              pick: emptyPick(),
              role: 'director',
              capacity: '',
              startDate: '',
              evidenceIds: [],
            });
            await onAdded();
          }
        }}
      >
        <PersonField
          required
          people={people.data?.people ?? []}
          pick={form.pick}
          onChange={(pick) => setForm({ ...form, pick })}
          listId={`people-${companyId}`}
        />
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
          <ActionFeedback error={action.error || people.error} status={action.status} />
          <div className="actions">
            <button disabled={action.pending}>Add person</button>
          </div>
        </div>
      </form>
    </details>
  );
}
