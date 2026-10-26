'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import {
  CITATION_KEYS,
  type CitationKey,
  type CompanyProfile,
  type DatedValue,
  type RecordFieldDefinition,
} from '@/domain/resolution/model';
import { currentDate, Empty, formatDate, Icon, useWorkspace } from '@/components/workspace';
import { getJson, newRequestId, postJson } from '@/components/resolution/api';
import { CompanyRelationships } from '@/components/resolution/relationships';
import { CustomValueInput } from '@/components/resolution/custom-value';
import { LoadState, useLoad } from '@/components/resolution/use-load';
import { ActionFeedback, useAction } from '@/components/resolution/use-action';

const CITATION_LABELS: Record<CitationKey, string> = {
  directorAuthority: "Directors' authority",
  memberAuthority: "Members' authority",
  electionAuthority: 'Election of directors',
};

function current(values: DatedValue[] | undefined, asAt = currentDate()) {
  return [...(values ?? [])]
    .filter((value) => value.effectiveDate <= asAt)
    .sort(
      (a, b) =>
        a.effectiveDate.localeCompare(b.effectiveDate) || a.recordedAt.localeCompare(b.recordedAt),
    )
    .at(-1);
}

export default function CompanyResolutionSettings({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data } = useWorkspace();
  const profile = useLoad(() => getJson<CompanyProfile>(`/api/companies/${id}/profile`), [id]);
  const definitions = useLoad(
    () => getJson<{ definitions: RecordFieldDefinition[] }>('/api/record-fields?scope=company'),
    [],
  );
  if (!data) return null;
  const company = data.companies.find((c) => c.id === id);
  if (!company) return <Empty>Company unavailable</Empty>;
  const caps = data.actor.capabilities;
  const canEdit = caps.includes('manage_people') || caps.includes('confirm_record');
  return (
    <>
      <Link href="/resolutions" className="back-link">
        <Icon kind="back" />
        Resolutions
      </Link>
      <header className="record-heading">
        <Link href={'/companies/' + id}>{company.name}</Link>
        <h1>Company resolution settings</h1>
        <p className="metadata">{company.registrationNumber}</p>
      </header>
      <LoadState
        loading={profile.loading && !profile.data}
        error={profile.error}
        reload={() => void profile.reload()}
        label="company settings"
      />
      {profile.data ? (
        <>
          <section className="section" aria-labelledby="citations">
            <h2 id="citations">Constitution citations</h2>
            <p className="metadata section-intro">
              Dated citations from this company&apos;s constitution, used in resolution wording.
              Record the source in the reason.
            </p>
            <ul className="list-plain citation-list">
              {CITATION_KEYS.map((key) => (
                <DatedEntry
                  key={key}
                  label={CITATION_LABELS[key]}
                  values={profile.data!.citations[key]}
                  canEdit={canEdit}
                  onSave={(value, effectiveDate, reason) =>
                    postJson<CompanyProfile>(`/api/companies/${id}/profile`, {
                      action: 'set_citation',
                      key,
                      value,
                      effectiveDate,
                      reason,
                      expectedRevision: profile.data!.revision,
                      requestId: newRequestId(),
                    }).then((next) => {
                      profile.setData(next);
                      return next;
                    })
                  }
                />
              ))}
            </ul>
          </section>
          <section className="section" aria-labelledby="custom-values">
            <h2 id="custom-values">Company custom values</h2>
            {(definitions.data?.definitions ?? []).filter((d) => !d.archived).length ? (
              <ul className="list-plain citation-list">
                {(definitions.data?.definitions ?? [])
                  .filter((d) => !d.archived)
                  .map((definition) => (
                    <DatedEntry
                      key={definition.id}
                      label={definition.label}
                      definition={definition}
                      values={profile.data!.customValues[definition.id]}
                      canEdit={canEdit}
                      onSave={(value, effectiveDate, reason) =>
                        postJson<CompanyProfile>(`/api/companies/${id}/profile`, {
                          action: 'set_custom',
                          definitionId: definition.id,
                          value: definition.valueType === 'boolean' ? value === 'true' : value,
                          effectiveDate,
                          reason,
                          expectedRevision: profile.data!.revision,
                          requestId: newRequestId(),
                        }).then((next) => {
                          profile.setData(next);
                          return next;
                        })
                      }
                    />
                  ))}
              </ul>
            ) : (
              <p className="metadata">
                No company custom fields are defined. Template managers can add them.
              </p>
            )}
          </section>
        </>
      ) : null}
      <section className="section">
        <CompanyRelationships companyId={id} />
      </section>
    </>
  );
}

function DatedEntry({
  label,
  values,
  canEdit,
  definition,
  onSave,
}: {
  label: string;
  values: DatedValue[] | undefined;
  canEdit: boolean;
  definition?: RecordFieldDefinition;
  onSave: (value: string, effectiveDate: string, reason: string) => Promise<unknown>;
}) {
  const now = current(values);
  const action = useAction();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(currentDate());
  const [reason, setReason] = useState('');
  const display = (v: DatedValue['value'] | undefined) =>
    v === undefined || v === null || v === ''
      ? 'Not recorded'
      : typeof v === 'boolean'
        ? v
          ? 'Yes'
          : 'No'
        : definition?.options?.find((o) => o.id === v)?.label || String(v);
  return (
    <li>
      <div className="dated-entry">
        <div>
          <h3>{label}</h3>
          <p className={now ? undefined : 'muted'}>{display(now?.value)}</p>
          {now ? (
            <p className="metadata">
              From {formatDate(now.effectiveDate)} · {now.reason}
            </p>
          ) : null}
        </div>
        {canEdit && !open ? (
          <button
            type="button"
            aria-label={`Record ${label}`}
            onClick={() => {
              setOpen(true);
              setValue(typeof now?.value === 'string' ? now.value : '');
            }}
          >
            Record new value
          </button>
        ) : null}
      </div>
      {open ? (
        <form
          className="form-grid dated-form"
          data-dirty="true"
          onSubmit={async (event) => {
            event.preventDefault();
            const ok = await action.run(
              () => onSave(value.trim(), effectiveDate, reason.trim()),
              `${label} recorded`,
            );
            if (ok !== undefined) {
              setOpen(false);
              setReason('');
            }
          }}
        >
          {definition ? (
            <CustomValueInput definition={definition} value={value} onChange={setValue} />
          ) : (
            <label className="full">
              Citation
              <input required value={value} onChange={(event) => setValue(event.target.value)} />
            </label>
          )}
          <label>
            Applies from
            <input
              type="date"
              required
              value={effectiveDate}
              onChange={(event) => setEffectiveDate(event.target.value)}
            />
          </label>
          <label>
            Reason and source
            <input required value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <div className="full form-footer">
            <ActionFeedback error={action.error} status="" conflict={action.conflict} />
            <div className="actions">
              <button className="primary" disabled={action.pending}>
                Record {label.toLowerCase()}
              </button>
              <button type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </form>
      ) : null}
      {action.status ? (
        <p className="success" role="status">
          {action.status}
        </p>
      ) : null}
      {(values?.length ?? 0) > 1 ? (
        <details className="advanced-filters">
          <summary>Earlier values</summary>
          <ul className="compact-list">
            {[...values!].reverse().map((v, i) => (
              <li key={i}>
                {display(v.value)} · from {formatDate(v.effectiveDate)} · recorded{' '}
                {formatDate(v.recordedAt)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}
