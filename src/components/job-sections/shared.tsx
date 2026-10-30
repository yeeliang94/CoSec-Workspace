'use client';
import type { Job, Workspace } from '@/domain/model';
import { ActionForm, type Field } from '../forms';
import { formatDate } from '../workspace';
import { approved, preparationBlockers } from '@/domain/workflows';
export type JobSectionProps = { job: Job; data: Workspace; openTab?: (tab: string) => void };
export const activityNames: Record<string, string> = {
  W03: 'Annual return',
  W04: 'Director change',
  W05: 'Members and capital',
  W06: 'Beneficial ownership',
};
export function activityName(code: string) {
  return activityNames[code] || code;
}
const eventNames: Record<string, string> = {
  create: 'Job created',
  created: 'Job created',
  Created: 'Job created',
  correspondence: 'Correspondence recorded',
  correspondence_response: 'Correspondence response recorded',
  assign: 'Job reassigned',
  dates: 'Dates updated',
  link_dependency: 'Dependency linked',
  note: 'Note added',
  billing: 'Billing handoff updated',
  complete: 'Job completed',
  cancel: 'Job cancelled',
  filing_not_required: 'Filing marked not required',
  submit: 'Submission recorded',
  filing_response: 'Filing response recorded',
  filing_message: 'Authority message recorded',
  confirm_outcome: 'Filing outcome confirmed',
  revise_pack: 'New pack version prepared',
  checklist_evidence: 'Checklist evidence linked',
  checklist_na: 'Checklist item marked not applicable',
  capture_snapshot: 'Anniversary snapshot captured',
  refresh_snapshot: 'Anniversary snapshot refreshed',
  confirm_client: 'Client confirmation recorded',
  sign: 'Signature recorded',
  request_review: 'Review requested',
  review: 'Review decision recorded',
  authorise_readiness: 'Filing readiness authorised',
  post_record: 'Record event posted',
  snapshot_consequence: 'Snapshot affected by a record change',
  resolution_attached: 'Resolution attached',
  capital_proposal: 'Share transaction prepared',
  bo_assessment: 'Beneficial ownership assessment prepared',
  bo_notice: 'Beneficial ownership notice recorded',
  bo_reply: 'Notice reply recorded',
  bo_escalate: 'Notice escalated',
  bo_discrepancy: 'Discrepancy recorded',
  bo_resolve: 'Discrepancy resolved',
};
/** A readable, sentence-case label for a job history action code. */
export function eventName(action: string) {
  if (eventNames[action]) return eventNames[action];
  const words = action.replaceAll('_', ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
/** Replaces ISO dates (YYYY-MM-DD) in server-written text with the display date format. */
export function readableDates(text: string) {
  return text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (value) => formatDate(value));
}
/** Whether requesting review of the current pack is the obvious next step for this actor. */
export function reviewRequestReady(job: Job, data: Workspace) {
  if (!data.actor.capabilities.includes('prepare_job')) return false;
  if (['Awaiting review', 'Complete', 'Cancelled'].includes(job.state)) return false;
  if (job.filingAttempts.length || !job.packs.length) return false;
  if (approved(job, 'pack')) return false;
  return preparationBlockers(job).length === 0;
}
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
