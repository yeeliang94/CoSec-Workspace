'use client';
import { useState } from 'react';
import type { Person, RelationshipRole } from '@/domain/resolution/model';
import { INDUSTRIES, MONTHS } from '@/domain/company';
import { getJson } from '@/components/resolution/api';
import { useLoad } from '@/components/resolution/use-load';
import { request } from './workspace';
import { emptyPick, PersonField, resolvePick, type PersonPick } from './person-field';

type Row = { key: string; pick: PersonPick; role: RelationshipRole; startDate: string };
const ROLES: { value: RelationshipRole; label: string }[] = [
  { value: 'director', label: 'Director' },
  { value: 'member', label: 'Shareholder' },
  { value: 'secretary', label: 'Secretary' },
  { value: 'auditor', label: 'Auditor' },
  { value: 'other', label: 'Other' },
];
const newRow = (role: RelationshipRole = 'director'): Row => ({
  key: crypto.randomUUID(),
  pick: emptyPick(),
  role,
  startDate: '',
});

/** Opening company record with its people, saved together. */
export function NewCompany({ onSaved }: { onSaved: () => Promise<void> }) {
  const existing = useLoad(() => getJson<{ people: Person[] }>('/api/people'), []);
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [month, setMonth] = useState('12');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const days = new Date(2024, Number(month), 0).getDate();
  const update = (key: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  return (
    <section className="form-section" style={{ marginTop: 0, marginBottom: 24 }}>
      <h2>New company</h2>
      <form
        inert={pending}
        aria-busy={pending}
        onChange={(event) => {
          event.currentTarget.dataset.dirty = 'true';
        }}
        onSubmit={async (event) => {
          event.preventDefault();
          setError('');
          setPending(true);
          const form = event.currentTarget;
          const values = Object.fromEntries(new FormData(form)) as Record<string, string>;
          const people = existing.data?.people ?? [];
          try {
            await request('/api/companies', {
              name: values.name,
              registrationNumber: values.registrationNumber,
              incorporationDate: values.incorporationDate,
              financialYearEnd: `${values.yearEndMonth}-${values.yearEndDay}`,
              address: values.address,
              industry: values.industry,
              activity: values.activity,
              people: rows
                .filter((row) => row.pick.name.trim())
                .map((row) => ({
                  ...resolvePick(people, row.pick),
                  role: row.role,
                  startDate: row.startDate || values.incorporationDate,
                })),
              requestId: crypto.randomUUID(),
            });
            form.dataset.dirty = 'false';
            await onSaved();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Company could not be created');
          } finally {
            setPending(false);
          }
        }}
      >
        <div className="form-grid">
          <label>
            Legal name
            <input name="name" required />
          </label>
          <label>
            Registration number
            <input name="registrationNumber" required />
          </label>
          <label>
            Incorporation date
            <input name="incorporationDate" type="date" required />
          </label>
          <fieldset className="year-end">
            <legend>Financial year end</legend>
            <label>
              <span className="sr-only">Day</span>
              <select name="yearEndDay" defaultValue="31" required>
                {Array.from({ length: days }, (_, i) => String(i + 1).padStart(2, '0')).map(
                  (day) => (
                    <option key={day} value={day}>
                      {Number(day)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              <span className="sr-only">Month</span>
              <select
                name="yearEndMonth"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                required
              >
                {MONTHS.map((name, i) => (
                  <option key={name} value={String(i + 1).padStart(2, '0')}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
          <label>
            Registered address
            <textarea name="address" required />
          </label>
          <div className="form-stack">
            <label>
              Industry
              <select name="industry" required defaultValue="">
                <option value="">Select…</option>
                {INDUSTRIES.map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Business activity (optional)
              <input name="activity" placeholder="e.g. Software consultancy" />
            </label>
          </div>
        </div>
        <fieldset className="opening-people">
          <legend>People</legend>
          {rows.map((row, index) => (
            <div className="opening-person" key={row.key}>
              <PersonField
                people={existing.data?.people ?? []}
                pick={row.pick}
                onChange={(pick) => update(row.key, { pick })}
                listId={`existing-people-${row.key}`}
                hideLabel={index > 0}
              />
              <label>
                <span className={index ? 'sr-only' : undefined}>Role</span>
                <select
                  value={row.role}
                  onChange={(event) =>
                    update(row.key, { role: event.target.value as RelationshipRole })
                  }
                >
                  {ROLES.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className={index ? 'sr-only' : undefined}>From</span>
                <input
                  type="date"
                  value={row.startDate}
                  title="Leave blank to use the incorporation date"
                  onChange={(event) => update(row.key, { startDate: event.target.value })}
                />
              </label>
              <button
                type="button"
                className="quiet"
                aria-label={`Remove ${row.pick.name || 'this person'}`}
                onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setRows((current) => [...current, newRow()])}>
            Add person
          </button>
        </fieldset>
        {error ? (
          <div className="feedback error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="actions">
          <button className="primary" disabled={pending}>
            {pending ? 'Saving…' : 'Create company'}
          </button>
        </div>
      </form>
    </section>
  );
}
