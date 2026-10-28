'use client';
import type { CompanyRelationship, Person } from '@/domain/resolution/model';
import { useWorkspace } from '@/components/workspace';

/** People as the people list returns them, with their visible company links. */
type ListedPerson = Person & { relationships?: CompanyRelationship[] };
const ROLE_NAMES: Record<string, string> = {
  director: 'Director',
  member: 'Shareholder',
  secretary: 'Secretary',
  auditor: 'Auditor',
  other: 'Linked',
};

/** A typed name plus, when it matches existing people, which of them (or someone new) is meant. */
export type PersonPick = { name: string; choice: string };
export const NEW_PERSON = 'new';
export const emptyPick = (): PersonPick => ({ name: '', choice: '' });

export function namesakes(people: Person[], name: string) {
  const typed = name.trim().toLowerCase();
  return typed ? people.filter((p) => p.fullName.toLowerCase() === typed) : [];
}

/** The person to link, or the name of a new one. A name shared with existing people needs a choice. */
export function resolvePick(
  people: Person[],
  pick: PersonPick,
): { personId: string } | { fullName: string } {
  const matches = namesakes(people, pick.name);
  if (!matches.length || pick.choice === NEW_PERSON) return { fullName: pick.name.trim() };
  const chosen = matches.find((p) => p.id === pick.choice);
  if (!chosen) throw new Error(`Choose which ${pick.name.trim()} you mean, or someone new.`);
  return { personId: chosen.id };
}

/** Enough to tell namesakes apart: their company links, email, and a short reference. */
function describe(person: ListedPerson, companyName: (id: string) => string) {
  const links = (person.relationships ?? [])
    .filter((r) => !r.endDate)
    .slice(0, 2)
    .map((r) => `${ROLE_NAMES[r.role] ?? 'Linked'}, ${companyName(r.companyId)}`);
  return [
    ...(links.length ? links : ['No current company']),
    person.email,
    `ref ${person.id.slice(-6)}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function PersonField({
  people,
  pick,
  onChange,
  listId,
  label = 'Name',
  hideLabel = false,
  required = false,
}: {
  people: ListedPerson[];
  pick: PersonPick;
  onChange: (pick: PersonPick) => void;
  listId: string;
  label?: string;
  hideLabel?: boolean;
  required?: boolean;
}) {
  const { data } = useWorkspace();
  const companyName = (id: string) => data?.companies.find((c) => c.id === id)?.name ?? 'a company';
  const matches = namesakes(people, pick.name);
  return (
    <div className="person-field">
      <label>
        <span className={hideLabel ? 'sr-only' : undefined}>{label}</span>
        <input
          required={required}
          list={listId}
          autoComplete="off"
          placeholder="Type a name"
          value={pick.name}
          onChange={(event) => onChange({ name: event.target.value, choice: '' })}
        />
        <datalist id={listId}>
          {[...new Set(people.map((person) => person.fullName))].map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </label>
      {matches.length ? (
        <label>
          <span className="sr-only">Which {pick.name.trim()}</span>
          <select
            required
            value={pick.choice}
            onChange={(event) => onChange({ ...pick, choice: event.target.value })}
          >
            <option value="">
              {matches.length > 1 ? `${matches.length} people have this name…` : 'Existing or new?'}
            </option>
            {matches.map((person) => (
              <option key={person.id} value={person.id}>
                Existing: {describe(person, companyName)}
              </option>
            ))}
            <option value={NEW_PERSON}>Someone new with this name</option>
          </select>
        </label>
      ) : null}
    </div>
  );
}
