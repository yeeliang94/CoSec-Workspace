'use client';
import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspace, PageHeader, request, currentDate, Icon } from '@/components/workspace';
import { FormFields, Field } from '@/components/forms';
import type { Person } from '@/domain/resolution/model';
export default function NewJob() {
  const { data, refresh } = useWorkspace();
  const router = useRouter();
  const [activity, setActivity] = useState('W03');
  const [companyId, setCompanyId] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const requestKey = useRef('');
  const [people, setPeople] = useState<Person[]>([]);
  const [personId, setPersonId] = useState('');
  const [personName, setPersonName] = useState('');
  // The director event route lives inside FormFields; mirror it so the person picker can
  // offer a new appointee only for appointments.
  const [route, setRoute] = useState('');
  const resetPerson = () => {
    setPersonId('');
    setPersonName('');
  };
  useEffect(() => {
    if (activity !== 'W04' || !companyId) return setPeople([]);
    let current = true;
    // A person chosen against an earlier list must never carry into a reloaded one.
    const loaded = (list: Person[]) => {
      if (!current) return;
      setPeople(list);
      setPersonId('');
      setPersonName('');
    };
    request<{ people: Person[] }>(
      '/api/people?companyId=' + encodeURIComponent(companyId),
      undefined,
      'GET',
    )
      .then((result) => loaded(result.people))
      .catch(() => loaded([]));
    return () => {
      current = false;
    };
  }, [activity, companyId]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setCompanyId(params.get('company') || '');
    const initial = params.get('activity');
    if (initial === 'W05' || initial === 'W06') setActivity(initial);
  }, []);
  if (!data) return null;
  const documents = data.documents
    .filter(
      (d) => d.companyId === companyId && (d.classification === 'BO') === (activity === 'W06'),
    )
    .map((d) => ({ value: d.id, label: d.title }));
  const fields: Field[] = [
    {
      name: 'checklistVersionId',
      label: 'Additional approved checklist',
      type: 'select',
      options: data.settings.catalogue
        .filter(
          (v) =>
            v.kind === 'checklist' &&
            v.status === 'Published' &&
            v.effectiveDate &&
            v.effectiveDate <= currentDate(),
        )
        .map((v) => ({ value: v.id, label: v.name + ' v' + v.version })),
    },
    {
      name: 'ownerId',
      label: 'Owner',
      type: 'select',
      required: true,
      value: activity === 'W06' ? data.actor.id : data.settings.defaultOwnerId || data.actor.id,
      options: data.users.map((u) => ({ value: u.id, label: u.name })),
    },
    { name: 'internalTarget', label: 'Internal preparation target', type: 'date' },
    ...((activity === 'W03'
      ? [
          {
            name: 'year',
            label: 'Reporting year',
            type: 'number',
            value: Number(currentDate().slice(0, 4)),
            required: true,
            min: 1900,
            max: 2200,
          },
          {
            name: 'anniversaryDate',
            label: 'Anniversary snapshot date',
            type: 'date',
            required: true,
          },
        ]
      : activity === 'W04'
        ? [
            {
              name: 'route',
              label: 'Director event route',
              type: 'select',
              required: true,
              options: [
                { value: 'appointment', label: 'Appointment' },
                { value: 'resignation', label: 'Resignation' },
                { value: 'removal', label: 'Removal' },
                { value: 'other_cessation', label: 'Other cessation' },
              ],
            },
            {
              name: 'effectiveDate',
              label: 'Proposed effective date',
              type: 'date',
              required: true,
            },
            {
              name: 'routeBasis',
              label: 'Route and authority basis',
              type: 'textarea',
              required: true,
              full: true,
            },
            {
              name: 'sourceEvidenceIds',
              label: 'Source evidence',
              type: 'multi',
              options: documents,
              full: true,
            },
          ]
        : [
            {
              name: 'effectiveDate',
              label: 'Proposed effective date',
              type: 'date',
              required: true,
            },
            {
              name: 'routeBasis',
              label: 'Instruction and authority basis',
              type: 'textarea',
              required: true,
              full: true,
            },
          ]) as Field[]),
  ];
  return (
    <>
      <Link href="/work" className="back-link">
        <Icon kind="back" />
        My work
      </Link>
      <PageHeader title="New job" />
      <form
        inert={pending}
        aria-busy={pending}
        className="form-stack"
        data-dirty={dirty ? 'true' : 'false'}
        onChange={(e) => {
          const target = e.target as HTMLElement & { name?: string; value?: string };
          if (target.name === 'route') {
            setRoute(target.value || '');
            if (target.value !== 'appointment') setPersonName('');
          }
          setDirty(true);
          requestKey.current = '';
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          const f = new FormData(e.currentTarget);
          const selectedRoute = String(f.get('route') || '');
          if (activity === 'W04') {
            if (personId && !people.some((p) => p.id === personId)) {
              resetPerson();
              setError('The selected person is not linked to this company. Choose again.');
              return;
            }
            if (!personId && selectedRoute !== 'appointment') {
              setError('Choose an existing person for a resignation, removal or other cessation.');
              return;
            }
            if (!personId && !personName.trim()) {
              setError('Enter the new director’s full name.');
              return;
            }
          }
          setPending(true);
          const payload: Record<string, unknown> = {
            companyId,
            activity,
            requestId: requestKey.current || (requestKey.current = crypto.randomUUID()),
          };
          for (const field of fields) {
            const value = f.get(field.name);
            if (field.type === 'multi') payload[field.name] = f.getAll(field.name).filter(Boolean);
            else if (value) payload[field.name] = field.type === 'number' ? Number(value) : value;
          }
          if (activity === 'W04') {
            // A new appointee gets a fresh identity; names never merge people implicitly.
            payload.personId = personId || crypto.randomUUID();
            payload.personName = personId
              ? people.find((p) => p.id === personId)?.fullName
              : personName.trim();
          }
          try {
            const job = await request<{ id: string }>('/api/jobs', payload);
            setDirty(false);
            requestKey.current = '';
            await refresh();
            router.push('/jobs/' + job.id);
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Job could not be created');
          } finally {
            setPending(false);
          }
        }}
      >
        <div className="form-grid">
          <label>
            Company
            <select
              required
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                resetPerson();
              }}
            >
              <option value="">Select company…</option>
              {data.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Activity
            <select
              value={activity}
              onChange={(e) => {
                setActivity(e.target.value);
                setRoute('');
                resetPerson();
              }}
            >
              <option value="W03">Annual return · W03</option>
              <option value="W04">Director change · W04</option>
              <option value="W05">Members and capital · W05</option>
              {data.actor.capabilities.includes('view_bo') ? (
                <option value="W06">Beneficial ownership · W06</option>
              ) : null}
            </select>
          </label>
        </div>
        {activity === 'W04' ? (
          <div className="form-grid">
            <label>
              Person
              <select
                value={personId}
                required={route !== 'appointment'}
                onChange={(e) => setPersonId(e.target.value)}
              >
                <option value="">
                  {route === 'appointment' ? 'New person (enter name)' : 'Select person…'}
                </option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName}
                  </option>
                ))}
              </select>
            </label>
            {personId || route !== 'appointment' ? null : (
              <label>
                Director full name
                <input
                  required
                  value={personName}
                  onChange={(e) => setPersonName(e.target.value)}
                />
              </label>
            )}
          </div>
        ) : null}
        <FormFields key={activity} fields={fields} />
        <div className="warning">
          No approved statutory deadline rule is configured. A reviewed manual date can be recorded
          in the job.
        </div>
        {error ? (
          <div className="feedback error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="actions">
          <button className="primary" disabled={pending}>
            {pending ? 'Creating…' : 'Create job'}
          </button>
          <Link href="/work" className="button">
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
