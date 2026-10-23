import { boBlockers } from './records';
import { today } from './access';
import type { Job, Officer, OfficerEvent, PackVersion, Review } from './model';

export function currentPack(job: Job): PackVersion {
  const pack = job.packs.at(-1);
  if (!pack) throw new Error('Job has no pack.');
  return pack;
}
export function approved(job: Job, scope: Review['scope']) {
  if (job.snapshotNeedsReview) return false;
  const decision = job.reviews
    .filter((r) => r.scope === scope && r.version === currentPack(job).version)
    .at(-1);
  return decision?.decision === 'Approved';
}
export function preparationBlockers(job: Job): string[] {
  const pack = currentPack(job),
    result: string[] = [];
  if (job.activity === 'W05') {
    if (!job.capitalProposal) result.push('Prepare the member/capital transaction.');
    if (job.capitalProposal?.kind !== 'opening' && !pack.requiredSigners.length)
      result.push('Specify the required signers for this share transaction.');
  }
  if (job.activity === 'W06') result.push(...boBlockers(job.boCase, today()));
  if (job.snapshotNeedsReview) result.push(job.snapshotNeedsReview.reason);
  if (job.activity === 'W03' && !job.snapshot)
    result.push(`Capture the historical anniversary snapshot on or after ${job.anniversaryDate}.`);
  for (const item of pack.checklist)
    if (item.required && !item.evidenceIds.length && !item.notApplicable)
      result.push(`${item.label}: evidence is missing.`);
  if (!pack.documentIds.length) result.push('Attach the prepared pack output.');
  if (job.activity === 'W03' && !job.clientConfirmed)
    result.push('Client confirmation evidence is missing.');
  if (job.activity === 'W04' && !job.sourceEvidenceIds.length)
    result.push('Director event source evidence is missing.');
  return result;
}
export function executionBlockers(job: Job): string[] {
  const pack = currentPack(job);
  return pack.requiredSigners
    .filter((s) => !pack.signatures.some((x) => x.signer === s))
    .map((s) => `${s}: signature evidence is missing for pack v${pack.version}.`);
}
export function readinessBlockers(job: Job): string[] {
  const result = preparationBlockers(job);
  if (!approved(job, 'pack'))
    result.push(`Pack v${currentPack(job).version} needs independent review.`);
  result.push(...executionBlockers(job));
  if (
    job.filingState !== 'Not required with reason' &&
    job.deadlineReviewRequired &&
    !approved(job, 'manual_date')
  )
    result.push('Manual statutory date needs evidence and independent review.');
  if (job.filingState !== 'Not required with reason' && !job.statutoryDue && !job.ruleVersionId)
    result.push('No approved deadline rule or reviewed manual date.');
  if (
    ['Queried', 'Rejected'].includes(job.filingState) &&
    job.filingAttempts.at(-1)?.messages.some((message) => !message.response)
  )
    result.push('Record the evidenced response to the authority query or rejection.');
  if (['W04', 'W05', 'W06'].includes(job.activity) && !approved(job, 'record'))
    result.push('Review the dated record basis for the current pack version.');
  if (['W04', 'W05', 'W06'].includes(job.activity) && !job.recordEventId)
    result.push('Confirm the independently reviewed dated record event.');
  return result;
}
export function blockers(job: Job): string[] {
  if (job.state === 'Complete') return [];
  const result = readinessBlockers(job);
  if (job.filingState !== 'Outcome confirmed' && job.filingState !== 'Not required with reason')
    result.push('Filing outcome is unresolved.');
  return [...new Set(result)];
}
export function nextAction(job: Job): string {
  if (job.state === 'Complete') return 'Retain completed file';
  if (job.state === 'Cancelled') return 'Retain cancelled file and history';
  if (job.filingState === 'Submitted' || job.filingState === 'Resubmitted')
    return 'Obtain filing outcome evidence';
  if (job.filingState === 'Queried' || job.filingState === 'Rejected')
    return 'Respond to authority and prepare resubmission';
  if (job.filingState === 'Ready') return 'Record external submission';
  const unanswered = job.boCase?.notices
    .filter((notice) => !notice.reply)
    .sort((a, b) => a.responseDue.localeCompare(b.responseDue))[0];
  if (unanswered) {
    if (unanswered.responseDue < today() && !unanswered.escalation)
      return `Escalate overdue BO response from ${unanswered.recipient}`;
    return `Obtain BO reply from ${unanswered.recipient}`;
  }
  if (job.state === 'Awaiting review') return `Review pack v${currentPack(job).version}`;
  const waiting = job.correspondence.find(
    (c) => c.direction === 'Outgoing' && !c.respondedOn && c.nextChaseDate,
  );
  if (waiting) return `Follow up with ${waiting.counterparty}`;
  if (job.filingState === 'Outcome confirmed') return 'Check closure requirements';
  return (
    preparationBlockers(job)[0] ??
    readinessBlockers(job)[0] ??
    'Authorise independent filing readiness'
  );
}
/** Date-effective history: entries retain recorded time but never rewrite earlier snapshots. */
export function officersAt(events: OfficerEvent[], asAt: string): Officer[] {
  const people = new Map<string, Officer>();
  for (const event of [...events]
    .filter((e) => e.effectiveDate <= asAt)
    .sort(
      (a, b) =>
        a.effectiveDate.localeCompare(b.effectiveDate) ||
        a.recordedAt.localeCompare(b.recordedAt) ||
        a.id.localeCompare(b.id),
    )) {
    if (event.route === 'appointment')
      people.set(event.personId, {
        personId: event.personId,
        personName: event.personName,
        appointedOn: event.effectiveDate,
        eventId: event.id,
      });
    else people.delete(event.personId);
  }
  return [...people.values()].sort((a, b) => a.personName.localeCompare(b.personName));
}
export function annualAnniversary(incorporationDate: string, year: number): string {
  const monthDay = incorporationDate.slice(5);
  const proposal = `${year}-${monthDay}`;
  if (
    monthDay === '02-29' &&
    new Date(`${proposal}T12:00:00Z`).toISOString().slice(0, 10) !== proposal
  )
    throw new Error('A leap-day anniversary needs an explicitly reviewed date.');
  return proposal;
}
