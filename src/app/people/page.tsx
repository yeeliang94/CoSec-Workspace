'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { CompanyRelationship, Person, RecordFieldDefinition } from '@/domain/resolution/model';
import type { AuditEntryView } from '@/domain/resolution/records';
import {
  currentDate,
  Empty,
  formatDate,
  humanize,
  Icon,
  PageHeader,
  useWorkspace,
} from '@/components/workspace';
import { getJson, newRequestId, postJson } from '@/components/resolution/api';
import { Drawer } from '@/components/resolution/drawer';
import { roleName } from '@/components/resolution/relationships';
import { LoadState, useLoad } from '@/components/resolution/use-load';
import { ActionFeedback, useAction } from '@/components/resolution/use-action';
import { CustomValueInput } from '@/components/resolution/custom-value';
import { canLeaveEditing } from '@/components/edit-guard';

type PersonRow = Person & { relationships: CompanyRelationship[] };

export default function PeoplePage() {
  return (
    <Suspense fallback={null}>
      <PeopleDirectory />
    </Suspense>
  );
}

function PeopleDirectory() {
  const { data } = useWorkspace();
  const router = useRouter();
  // Read reactively so same-route `?person=` links (relationship rows) open the person.
  const personParam = useSearchParams().get('person');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [open, setOpen] = useState('');
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (personParam) setOpen(personParam);
  }, [personParam]);
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  const people = useLoad(() => {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (companyId) params.set('companyId', companyId);
    return getJson<{ people: PersonRow[] }>('/api/people?' + params);
  }, [search, companyId]);
  if (!data) return null;
  const canManage = data.actor.capabilities.includes('manage_people');
  const companyName = (id: string) => data.companies.find((c) => c.id === id)?.name || 'Company';
  return (
    <>
      <PageHeader title="People">
        {canManage ? (
          <button type="button" className="primary" onClick={() => setCreating(true)}>
            <Icon kind="plus" />
            New person
          </button>
        ) : null}
      </PageHeader>
      {creating ? (
        <NewPerson
          onDone={async (id) => {
            setCreating(false);
            await people.reload();
            if (id) setOpen(id);
          }}
        />
      ) : null}
      <div className="toolbar">
        <label className="search">
          <span className="sr-only">Search people</span>
          <Icon kind="search" />
          <input
            type="search"
            placeholder="Search by name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Company</span>
          <select
            value={companyId}
            onChange={async (event) => {
              const next = event.target.value;
              if (await canLeaveEditing()) setCompanyId(next);
            }}
          >
            <option value="">All companies</option>
            {data.companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <>
        <LoadState
          loading={people.loading && !people.data}
          error={people.error}
          reload={() => void people.reload()}
          label="people"
        />
        {people.data ? (
          people.data.people.length ? (
            <div className="table-wrap">
              <table className="people-table stack-table">
                <caption className="sr-only">People you can see</caption>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Relationships</th>
                    <th>Email</th>
                  </tr>
                </thead>
                <tbody>
                  {people.data.people.map((person) => (
                    <tr key={person.id}>
                      <td>
                        <button
                          type="button"
                          className="text-button record-button"
                          onClick={() => setOpen(person.id)}
                        >
                          {person.fullName}
                        </button>
                        {person.migrationNote ? (
                          <div className="metadata">Needs identity review</div>
                        ) : null}
                      </td>
                      <td data-label="Relationships">
                        {person.relationships.length ? (
                          <ul className="compact-list">
                            {person.relationships.map((r) => (
                              <li key={r.id}>
                                {companyName(r.companyId)} · {roleName(r.role)}
                                {r.endDate ? ` · ended ${formatDate(r.endDate)}` : ''}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="muted">Not linked yet</span>
                        )}
                      </td>
                      <td data-label="Email">{person.email || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>{search || companyId ? 'No matching people' : 'No people yet'}</Empty>
          )
        ) : null}
      </>
      {open ? (
        <PersonDrawer
          id={open}
          onClose={() => {
            setOpen('');
            // Clear the parameter so following the same person link again reopens the drawer.
            if (personParam) router.replace('/people', { scroll: false });
          }}
          onChanged={() => void people.reload()}
        />
      ) : null}
    </>
  );
}

function NewPerson({ onDone }: { onDone: (id?: string) => Promise<void> }) {
  const action = useAction();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [requestId, setRequestId] = useState(newRequestId);
  return (
    <Drawer title="New person" onClose={() => void onDone()}>
      <form
        className="form-grid"
        data-dirty={fullName || email || notes ? 'true' : 'false'}
        onChange={() => setRequestId(newRequestId())}
        onSubmit={async (event) => {
          event.preventDefault();
          const person = await action.run(
            () =>
              postJson<Person>('/api/people', {
                action: 'create',
                requestId,
                fullName: fullName.trim(),
                email: email.trim() || null,
                notes,
              }),
            'Person created',
          );
          if (person) await onDone(person.id);
        }}
      >
        <label>
          Full name
          <input
            required
            maxLength={255}
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="full">
          Notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <div className="full form-footer">
          <ActionFeedback error={action.error} status={action.status} />
          <div className="actions">
            <button className="primary" disabled={action.pending}>
              Create person
            </button>
            <button
              type="button"
              onClick={async () => {
                if (await canLeaveEditing()) await onDone();
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </form>
    </Drawer>
  );
}

function PersonDrawer({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data } = useWorkspace();
  const load = useLoad(
    () =>
      getJson<{ person: Person; relationships: CompanyRelationship[]; audit: AuditEntryView[] }>(
        '/api/people/' + id,
      ),
    [id],
  );
  const definitions = useLoad(
    () => getJson<{ definitions: RecordFieldDefinition[] }>('/api/record-fields?scope=person'),
    [],
  );
  const person = load.data?.person;
  return (
    <Drawer title={person?.fullName || 'Person'} onClose={onClose}>
      <LoadState
        loading={load.loading && !load.data}
        error={load.error}
        reload={() => void load.reload()}
        label="person"
      />
      {person && data ? (
        <>
          <dl className="record-meta">
            <div>
              <dt>Email</dt>
              <dd>{person.email || '—'}</dd>
            </div>
          </dl>
          {person.migrationNote ? <p className="warning">{person.migrationNote}</p> : null}
          {person.notes ? <p className="prose">{person.notes}</p> : null}
          <section className="section">
            <h3>Relationships</h3>
            {load.data!.relationships.length ? (
              <ul className="list-plain">
                {load.data!.relationships.map((r) => (
                  <li key={r.id}>
                    <Link href={'/companies/' + r.companyId}>
                      {data.companies.find((c) => c.id === r.companyId)?.name || 'Company'}
                    </Link>
                    <dl className="record-meta">
                      <div>
                        <dt>Role</dt>
                        <dd>
                          {roleName(r.role)}
                          {r.capacity ? ` · ${r.capacity}` : ''}
                        </dd>
                      </div>
                      <div>
                        <dt>From</dt>
                        <dd>{formatDate(r.startDate)}</dd>
                      </div>
                      <div>
                        <dt>Until</dt>
                        <dd>{r.endDate ? formatDate(r.endDate) : 'Present'}</dd>
                      </div>
                    </dl>
                    {r.projectedFrom ? (
                      <p className="metadata">From the posted officer record</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="metadata">No relationships with companies you can see.</p>
            )}
          </section>
          {person.nameHistory.length ? (
            <section className="section">
              <h3>Name history</h3>
              <ul className="list-plain">
                {person.nameHistory.map((entry, i) => (
                  <li key={i}>
                    {entry.name}
                    <p className="metadata">
                      Until {formatDate(entry.until)} · {entry.reason}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {Object.keys(person.customValues).length ? (
            <section className="section">
              <h3>Custom values</h3>
              <dl className="custom-values">
                {Object.entries(person.customValues).map(([key, values]) => {
                  const current = values.at(-1);
                  return (
                    <div key={key}>
                      <dt>
                        {definitions.data?.definitions.find((d) => d.id === key)?.label || key}
                      </dt>
                      <dd>
                        {String(current?.value ?? '—')}
                        <span className="metadata">
                          {' '}
                          · from {formatDate(current?.effectiveDate)}
                        </span>
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          ) : null}
          {data.actor.capabilities.includes('manage_people') ? (
            <PersonEdit
              person={person}
              definitions={(definitions.data?.definitions ?? []).filter((d) => !d.archived)}
              onSaved={async () => {
                await load.reload();
                onChanged();
              }}
            />
          ) : null}
          <details className="disclosure">
            <summary>Record history</summary>
            <dl className="record-meta">
              <div>
                <dt>Created</dt>
                <dd>{formatDate(person.createdAt)}</dd>
              </div>
              <div>
                <dt>Revision</dt>
                <dd>{person.revision}</dd>
              </div>
            </dl>
            <ul className="list-plain">
              {load.data!.audit.map((entry) => (
                <li key={entry.id}>
                  {humanize(entry.action)}
                  <p className="metadata">
                    {entry.actorName} · {formatDate(entry.at)}
                    {entry.reason ? ` · ${entry.reason}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : null}
    </Drawer>
  );
}

function PersonEdit({
  person,
  definitions,
  onSaved,
}: {
  person: Person;
  definitions: RecordFieldDefinition[];
  onSaved: () => Promise<void>;
}) {
  const edit = useAction();
  const custom = useAction();
  const [form, setForm] = useState({
    fullName: person.fullName,
    email: person.email || '',
    notes: person.notes,
    reason: '',
  });
  const [value, setValue] = useState({
    definitionId: '',
    value: '',
    effectiveDate: currentDate(),
    reason: '',
  });
  const definition = definitions.find((d) => d.id === value.definitionId);
  const dirty =
    form.fullName !== person.fullName ||
    form.email !== (person.email || '') ||
    form.notes !== person.notes;
  return (
    <>
      <details className="disclosure">
        <summary>Correct details</summary>
        <form
          className="form-stack"
          data-dirty={dirty ? 'true' : 'false'}
          onSubmit={async (event) => {
            event.preventDefault();
            const ok = await edit.run(
              () =>
                postJson('/api/people', {
                  action: 'update',
                  id: person.id,
                  expectedRevision: person.revision,
                  requestId: newRequestId(),
                  fullName: form.fullName.trim(),
                  email: form.email.trim() || null,
                  notes: form.notes,
                  reason: form.reason.trim(),
                }),
              'Details corrected',
            );
            if (ok) {
              setForm((current) => ({ ...current, reason: '' }));
              await onSaved();
            }
          }}
        >
          <label>
            Full name
            <input
              required
              value={form.fullName}
              onChange={(event) => setForm({ ...form, fullName: event.target.value })}
            />
          </label>
          <details className="advanced-filters">
            <summary>Name changes</summary>
            <p>Earlier documents keep the name they were generated with.</p>
          </details>
          <label>
            Email
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </label>
          <label>
            Notes
            <textarea
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </label>
          <label>
            Reason for the correction
            <input
              required
              value={form.reason}
              onChange={(event) => setForm({ ...form, reason: event.target.value })}
            />
          </label>
          <ActionFeedback error={edit.error} status={edit.status} conflict={edit.conflict} />
          <div className="actions">
            <button disabled={edit.pending || !dirty}>Save correction</button>
          </div>
        </form>
      </details>
      {definitions.length ? (
        <details className="disclosure">
          <summary>Set a custom value</summary>
          <form
            className="form-stack"
            onSubmit={async (event) => {
              event.preventDefault();
              const ok = await custom.run(
                () =>
                  postJson('/api/people', {
                    action: 'set_custom',
                    id: person.id,
                    expectedRevision: person.revision,
                    requestId: newRequestId(),
                    definitionId: value.definitionId,
                    value:
                      definition?.valueType === 'boolean' ? value.value === 'true' : value.value,
                    effectiveDate: value.effectiveDate,
                    reason: value.reason.trim(),
                  }),
                'Value recorded',
              );
              if (ok) await onSaved();
            }}
          >
            <label>
              Field
              <select
                required
                value={value.definitionId}
                onChange={(event) =>
                  setValue({ ...value, definitionId: event.target.value, value: '' })
                }
              >
                <option value="">Select…</option>
                {definitions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <CustomValueInput
              definition={definition}
              value={value.value}
              onChange={(v) => setValue({ ...value, value: v })}
            />
            <label>
              Applies from
              <input
                type="date"
                required
                value={value.effectiveDate}
                onChange={(event) => setValue({ ...value, effectiveDate: event.target.value })}
              />
            </label>
            <label>
              Reason
              <input
                required
                value={value.reason}
                onChange={(event) => setValue({ ...value, reason: event.target.value })}
              />
            </label>
            <ActionFeedback
              error={custom.error}
              status={custom.status}
              conflict={custom.conflict}
            />
            <div className="actions">
              <button disabled={custom.pending}>Record value</button>
            </div>
          </form>
        </details>
      ) : null}
    </>
  );
}
