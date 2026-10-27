import { randomUUID } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import { today } from '../../domain/access';
import { currentPack, readinessBlockers } from '../../domain/workflows';
import { generatedExecutionStatus } from '../resolution/execution';
import { appendVersion } from '../pack-versions';
import * as repo from '../repository';
import {
  action,
  assignee,
  calendarDate,
  evidence,
  fail,
  id,
  optionalDate,
  requireChecks,
  shiftDate,
  text,
  validateDependencies,
} from './shared';

export const caseworkActions = {
  correspondence: action({
    schema: z.object({
      direction: z.enum(['Incoming', 'Outgoing']),
      counterparty: text,
      channel: text,
      date: calendarDate,
      summary: text,
      ownerId: id,
      evidenceIds: z.array(id).max(100),
      nextChaseDate: optionalDate,
    }),
    preparer: true,
    async run({ actor, job, tx }, data) {
      const workDefaults = await repo.getSettings(tx);
      const nextChaseDate =
        data.nextChaseDate === undefined && data.direction === 'Outgoing'
          ? shiftDate(data.date, workDefaults.chaseIntervalDays)
          : (data.nextChaseDate ?? null);
      await assignee(job.companyId, data.ownerId, tx);
      await evidence(tx, actor, job.companyId, data.evidenceIds);
      if (data.date > today()) fail('Record the actual sent or received date.');
      if (nextChaseDate && nextChaseDate < data.date)
        fail('Next chase date cannot precede correspondence.');
      job.correspondence.push({ id: randomUUID(), ...data, nextChaseDate, respondedOn: null });
      if (data.direction === 'Outgoing' && nextChaseDate)
        job.state = 'Waiting on external information';
      return `Recorded ${data.direction.toLowerCase()} correspondence with ${data.counterparty}.`;
    },
  }),
  correspondence_response: action({
    schema: z.object({
      correspondenceId: id,
      respondedOn: calendarDate,
      evidenceId: id,
    }),
    preparer: true,
    async run({ actor, job, tx }, data) {
      const item = job.correspondence.find((c) => c.id === data.correspondenceId);
      if (!item) fail('Correspondence request is unavailable.');
      if (item.respondedOn) fail('This request already has a recorded response.');
      if (data.respondedOn < item.date || data.respondedOn > today())
        fail('Response date must follow the request and cannot be in the future.');
      await evidence(tx, actor, job.companyId, [data.evidenceId]);
      item.respondedOn = data.respondedOn;
      item.evidenceIds.push(data.evidenceId);
      if (
        job.state === 'Waiting on external information' &&
        !job.correspondence.some(
          (c) => c.direction === 'Outgoing' && c.nextChaseDate && !c.respondedOn,
        )
      )
        job.state = 'Preparing';
      return `Response received from ${item.counterparty}.`;
    },
  }),
  assign: action({
    schema: z.object({ ownerId: id, reason: text }),
    preparer: true,
    async run({ job, tx }, data) {
      await assignee(job.companyId, data.ownerId, tx);
      const detail = `Reassigned from ${job.ownerId} to ${data.ownerId}: ${data.reason}`;
      job.ownerId = data.ownerId;
      return detail;
    },
  }),
  dates: action({
    schema: z.object({
      internalTarget: optionalDate,
      statutoryDue: optionalDate,
      manualDateBasis: z.string().max(4000).optional(),
      manualDateEvidenceId: id.nullable().optional(),
    }),
    preparer: true,
    preservedAfterSubmission: true,
    async run({ actor, job, tx }, data) {
      if (data.internalTarget !== undefined) job.internalTarget = data.internalTarget;
      if (data.statutoryDue !== undefined) {
        if (!data.statutoryDue && job.statutoryDue)
          fail('An incurred statutory date cannot be removed.');
        if (data.statutoryDue) {
          if (!data.manualDateBasis?.trim() || !data.manualDateEvidenceId)
            fail('Manual statutory dates require source evidence and basis.');
          await evidence(tx, actor, job.companyId, [data.manualDateEvidenceId]);
          job.manualDateProposal = {
            date: data.statutoryDue,
            basis: data.manualDateBasis,
            evidenceId: data.manualDateEvidenceId,
          };
          job.deadlineReviewRequired = true;
          appendVersion(job, actor);
        }
      }
      return `Dates updated; manual statutory dates require renewed independent review. ${data.manualDateBasis ?? ''}`;
    },
  }),
  link_dependency: action({
    schema: z.object({ dependencyId: id }),
    preparer: true,
    preservedAfterSubmission: true,
    async run({ actor, job, tx }, data) {
      if (data.dependencyId === job.id) fail('A job cannot depend on itself.');
      const seen = new Set<string>();
      async function visit(id: string): Promise<void> {
        if (id === job.id) fail('This dependency would create a cycle.');
        if (seen.has(id)) return;
        seen.add(id);
        const linked = await repo.getJob(actor, id, tx);
        if (!linked || linked.companyId !== job.companyId)
          fail('Dependencies must belong to this company.');
        for (const next of linked.dependencyIds) await visit(next);
      }
      await visit(data.dependencyId);
      if (!job.dependencyIds.includes(data.dependencyId)) job.dependencyIds.push(data.dependencyId);
      if (job.filingState === 'Ready') job.filingState = 'Not ready';
      await validateDependencies(tx, actor, job);
      return `Linked dependency ${data.dependencyId}.`;
    },
  }),
  note: action({
    schema: z.object({ html: z.string().trim().min(1).max(30000) }),
    preparer: true,
    allowedWhenClosed: true,
    run({ actor, job, now }, data) {
      const html = sanitizeHtml(data.html, {
        allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'blockquote'],
        allowedAttributes: {},
      });
      if (!sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).trim())
        fail('Enter a note.');
      job.notes.push({ id: randomUUID(), html, actorId: actor.id, at: now });
      return 'Added case note.';
    },
  }),
  billing: action({
    schema: z.object({
      state: z.enum(['Not ready', 'Ready to bill', 'Handed off', 'Invoiced']),
      reason: text,
    }),
    preparer: true,
    allowedWhenClosed: true,
    run({ job }, data) {
      job.billingState = data.state;
      return `Billing ${data.state}: ${data.reason}`;
    },
  }),
  complete: action({
    schema: z.object({ confirmed: z.literal(true) }),
    preparer: true,
    async run({ actor, job, tx }) {
      requireChecks(readinessBlockers(job));
      requireChecks((await generatedExecutionStatus(actor, job, tx)).blockers);
      await validateDependencies(tx, actor, job, true);
      if (!['Outcome confirmed', 'Not required with reason'].includes(job.filingState))
        fail('Confirm the filing outcome or record a reviewed not-required reason.');
      if (
        job.filingState === 'Outcome confirmed' &&
        job.filingAttempts.at(-1)?.version !== currentPack(job).version
      )
        fail(
          'The current pack differs from the confirmed filing package; create a linked correction job.',
        );
      if (
        job.correspondence.some(
          (c) => c.direction === 'Outgoing' && c.nextChaseDate && !c.respondedOn,
        )
      )
        fail('Resolve outstanding client requests before closure.');
      job.state = 'Complete';
      return 'Closed operational work; billing retains its independent state.';
    },
  }),
  cancel: action({
    schema: z.object({ reason: text, confirmed: z.literal(true) }),
    preparer: true,
    run({ job }, data) {
      if (
        job.activity === 'W06' &&
        (job.boCase?.notices.some((n) => !n.reply) ||
          job.boCase?.discrepancies.some((d) => !d.resolution))
      )
        fail('Resolve or hand off outstanding BO notices and discrepancies before cancellation.');
      if (
        (job.activity === 'W03' ||
          job.statutoryDue ||
          job.manualDateProposal ||
          job.recordEventId ||
          job.filingAttempts.length) &&
        !['Outcome confirmed', 'Not required with reason'].includes(job.filingState)
      )
        fail(
          'Resolve filing obligations from effective events or submitted attempts before cancellation.',
        );
      job.state = 'Cancelled';
      return `Cancelled: ${data.reason}. Existing records and filing history retained.`;
    },
  }),
};
