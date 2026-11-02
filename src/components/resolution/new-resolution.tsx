'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CaseKind, ResolutionCase } from '@/domain/resolution/model';
import { useWorkspace } from '@/components/workspace';
import { canLeaveEditing } from '@/components/edit-guard';
import { GuidedForm } from '@/components/guided-form';
import { CASE_KINDS, errorText, newRequestId, postJson } from './api';

/** The guided new-resolution form; `companyId` preselects a company (for example from its page). */
export function NewResolution({
  onCancel,
  companyId: initialCompanyId = '',
}: {
  onCancel: () => void;
  companyId?: string;
}) {
  const { data } = useWorkspace();
  const router = useRouter();
  const [companyId, setCompanyId] = useState(initialCompanyId);
  const [kind, setKind] = useState<CaseKind>('board');
  const [title, setTitle] = useState('');
  const [instructionDate, setInstructionDate] = useState('');
  const [resolutionDate, setResolutionDate] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState(newRequestId);
  if (!data) return null;
  return (
    <section className="new-resolution" aria-labelledby="new-resolution-title">
      <h2 id="new-resolution-title">New resolution</h2>
      <GuidedForm
        submitLabel="Create resolution"
        pending={pending}
        secondaryAction={
          <button
            type="button"
            onClick={async () => {
              if (await canLeaveEditing()) onCancel();
            }}
          >
            Cancel
          </button>
        }
        data-dirty={
          companyId !== initialCompanyId ||
          title ||
          kind !== 'board' ||
          instructionDate ||
          resolutionDate ||
          effectiveDate
            ? 'true'
            : 'false'
        }
        onChange={() => setRequestId(newRequestId())}
        onSubmit={async (event) => {
          event.preventDefault();
          const formElement = event.currentTarget;
          setPending(true);
          setError('');
          try {
            const created = await postJson<ResolutionCase>('/api/resolution-cases', {
              requestId,
              companyId,
              kind,
              title: title.trim(),
              instructionDate: instructionDate || null,
              resolutionDate: resolutionDate || null,
              effectiveDate: effectiveDate || null,
            });
            formElement.setAttribute('data-dirty', 'false');
            router.push('/resolutions/' + created.id);
          } catch (e) {
            setError(errorText(e));
            setPending(false);
          }
        }}
        steps={[
          {
            title: 'Resolution details',
            content: (
              <>
                <label>
                  Company
                  <select
                    required
                    value={companyId}
                    onChange={(event) => setCompanyId(event.target.value)}
                  >
                    <option value="">Select…</option>
                    {data.companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Kind
                  <select
                    value={kind}
                    onChange={(event) => setKind(event.target.value as CaseKind)}
                  >
                    {CASE_KINDS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="full">
                  Title
                  <input
                    required
                    maxLength={300}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
              </>
            ),
          },
          {
            title: 'Dates',
            content: (
              <>
                <label>
                  Instruction date
                  <input
                    type="date"
                    value={instructionDate}
                    onChange={(event) => setInstructionDate(event.target.value)}
                  />
                </label>
                <div className="form-grid form-pair compact-pair">
                  <label>
                    Resolution date
                    <input
                      type="date"
                      value={resolutionDate}
                      onChange={(event) => setResolutionDate(event.target.value)}
                    />
                  </label>
                  <label>
                    Effective date
                    <input
                      type="date"
                      value={effectiveDate}
                      onChange={(event) => setEffectiveDate(event.target.value)}
                    />
                  </label>
                </div>
              </>
            ),
          },
        ]}
      >
        {error ? (
          <div className="feedback error" role="alert">
            {error}
          </div>
        ) : null}
      </GuidedForm>
    </section>
  );
}
