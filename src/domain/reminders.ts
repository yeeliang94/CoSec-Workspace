import { createHash } from 'node:crypto';
import type { Job, Reminder } from './model';

/** Deterministic occurrences survive restart; changing a date creates a new ledger occurrence. */
export function deriveReminders(jobs: Job[], activeBoJobs?: Set<string>): Reminder[] {
  const result: Reminder[] = [];
  const add = (
    job: Job,
    kind: Reminder['kind'],
    dueDate: string,
    key: string,
    ownerId = job.ownerId,
  ) => {
    result.push({
      id: createHash('sha256').update(`${job.id}|${kind}|${key}|${dueDate}`).digest('hex'),
      companyId: job.companyId,
      jobId: job.id,
      ownerId,
      kind,
      dueDate,
      resolved: false,
      createdAt: new Date().toISOString(),
    });
  };
  for (const job of jobs) {
    const operationalOpen = !['Complete', 'Cancelled'].includes(job.state);
    const filingOpen = !['Outcome confirmed', 'Not required with reason'].includes(job.filingState);
    if (operationalOpen && job.internalTarget)
      add(job, 'Internal target', job.internalTarget, 'target');
    if (filingOpen && job.statutoryDue) add(job, 'Statutory date', job.statutoryDue, 'statutory');
    if (job.activity === 'W06') {
      for (const notice of job.boCase?.notices ?? [])
        if (operationalOpen && !notice.reply) {
          add(job, 'BO response', notice.responseDue, notice.id, notice.ownerId);
          add(job, 'Client chase', notice.nextChaseDate, notice.id, notice.ownerId);
        }
      if (
        job.recordEventId &&
        job.boCase?.assessment?.kind !== 'cessation' &&
        (!activeBoJobs || activeBoJobs.has(job.id)) &&
        job.boCase?.assessment?.nextReviewDate
      )
        add(job, 'BO review', job.boCase.assessment.nextReviewDate, 'review');
    }
    if (operationalOpen)
      for (const entry of job.correspondence) {
        if (entry.direction === 'Outgoing' && entry.nextChaseDate && !entry.respondedOn)
          add(job, 'Client chase', entry.nextChaseDate, entry.id, entry.ownerId);
      }
    if (filingOpen) {
      const lastAttempt = job.filingAttempts.at(-1);
      if (lastAttempt && !lastAttempt.outcome)
        for (const message of lastAttempt.messages)
          if (!message.response)
            add(job, 'Query response', message.responseDue, `${lastAttempt.id}:${message.id}`);
    }
  }
  return result;
}
