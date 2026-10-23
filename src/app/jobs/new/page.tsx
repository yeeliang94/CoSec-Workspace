'use client';
import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspace, PageHeader, request, currentDate, Icon } from '@/components/workspace';
import { FormFields, Field } from '@/components/forms';
export default function NewJob() {
  const { data, refresh } = useWorkspace();
  const router = useRouter();
  const [activity, setActivity] = useState('W03');
  const [companyId, setCompanyId] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const requestKey = useRef('');
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
            { name: 'personName', label: 'Director full name', required: true },
            { name: 'personId', label: 'Existing person reference (blank for a new appointment)' },
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
        onChange={() => {
          setDirty(true);
          requestKey.current = '';
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          setPending(true);
          const f = new FormData(e.currentTarget);
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
          if (activity === 'W04' && !payload.personId && payload.route === 'appointment')
            payload.personId = crypto.randomUUID();
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
            <select required value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
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
            <select value={activity} onChange={(e) => setActivity(e.target.value)}>
              <option value="W03">Annual return · W03</option>
              <option value="W04">Director change · W04</option>
              <option value="W05">Members and capital · W05</option>
              {data.actor.capabilities.includes('view_bo') ? (
                <option value="W06">Beneficial ownership · W06</option>
              ) : null}
            </select>
          </label>
        </div>
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
