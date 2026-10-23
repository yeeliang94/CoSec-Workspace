'use client';
import type { Job, Workspace } from '@/domain/model';
import { ActionForm, type Field } from '../forms';
export type JobSectionProps = { job: Job; data: Workspace };
export function jobFields(job: Job, data: Workspace) {
  return {
    evidence: data.documents
      .filter(
        (d) =>
          d.companyId === job.companyId && (d.classification === 'BO') === (job.activity === 'W06'),
      )
      .map((d) => ({ value: d.id, label: d.title })),
    users: data.users.map((u) => ({ value: u.id, label: u.name })),
    version: job.packs.at(-1)?.version || 1,
  };
}
export function JobAction({
  job,
  action,
  fields,
  label,
  confirmation,
  extra,
  primary,
}: {
  job: Job;
  action: string;
  fields?: Field[];
  label: string;
  confirmation?: string;
  extra?: Record<string, unknown>;
  primary?: boolean;
}) {
  return (
    <ActionForm
      url={'/api/jobs/' + job.id}
      action={action}
      fields={fields}
      label={label}
      confirmation={confirmation}
      extra={{ expectedRevision: job.revision, ...extra }}
      primary={primary}
    />
  );
}
export function EvidenceLinks({ ids, data }: { ids: string[]; data: Workspace }) {
  return (
    <>
      {ids.map((id) => (
        <a href={'/api/documents/' + id} key={id} className="evidence-link">
          {data.documents.find((d) => d.id === id)?.title || 'Evidence'}
        </a>
      ))}
    </>
  );
}
