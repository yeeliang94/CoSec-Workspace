import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertCapability, DomainError, today } from '../../domain/access';
import { approved, currentPack, readinessBlockers } from '../../domain/workflows';
import { validateRecordEvidence } from '../record-actions';
import {
  action,
  calendarDate,
  evidence,
  fail,
  id,
  independent,
  requireChecks,
  text,
  validateDependencies,
} from './shared';

export const filingActions = {
  filing_not_required: action({
    schema: z.object({ reason: text, evidenceId: id }),
    async run({ actor, job, tx }, data) {
      independent(actor, job, 'readiness');
      await validateRecordEvidence(actor, job, [data.evidenceId], tx);
      if (job.filingAttempts.length)
        fail('A recorded submission cannot be erased by marking filing not required.');
      job.filingState = 'Not required with reason';
      job.filingNotRequiredReason = `${data.reason} [Evidence ${data.evidenceId}; reviewer ${actor.id}]`;
      return `Filing not required: ${data.reason}`;
    },
  }),
  submit: action({
    schema: z.object({
      version: z.number().int().min(1),
      documentIds: z.array(id).min(1).max(100),
      submittedDate: calendarDate,
      reference: text,
      channel: text,
      evidenceId: id,
      paymentEvidenceId: id.nullable().optional(),
    }),
    async run({ actor, job, tx, now }, data) {
      assertCapability(actor, 'record_filing');
      if (job.filingState !== 'Ready' || !approved(job, 'readiness'))
        fail('Independent filing readiness for the current version is required.');
      requireChecks(readinessBlockers(job));
      await validateDependencies(tx, actor, job, true);
      if (data.version !== currentPack(job).version)
        throw new DomainError('The submitted package version is stale.', 'CONFLICT', 409);
      if (data.submittedDate > today()) fail('Submission cannot be future dated.');
      const expected = currentPack(job).documentIds;
      if (
        expected.length !== new Set(data.documentIds).size ||
        !expected.every((x) => data.documentIds.includes(x))
      )
        fail('The submitted documents must match the reviewed package exactly.');
      await evidence(tx, actor, job.companyId, [
        ...data.documentIds,
        data.evidenceId,
        ...(data.paymentEvidenceId ? [data.paymentEvidenceId] : []),
      ]);
      job.filingAttempts.push({
        id: randomUUID(),
        version: data.version,
        documentIds: data.documentIds,
        submittedDate: data.submittedDate,
        reference: data.reference,
        channel: data.channel,
        evidenceId: data.evidenceId,
        paymentEvidenceId: data.paymentEvidenceId ?? null,
        lodgerId: actor.id,
        at: now,
        messages: [],
        outcome: null,
      });
      job.filingState = job.filingAttempts.length > 1 ? 'Resubmitted' : 'Submitted';
      job.state = 'Action in progress';
      return `Recorded external submission ${data.reference}; outcome outstanding.`;
    },
  }),
  filing_response: action({
    schema: z.object({
      summary: text,
      date: calendarDate,
      evidenceId: id,
      messageId: id.optional(),
    }),
    async run({ actor, job, tx }, data) {
      assertCapability(actor, 'record_filing');
      const messages = job.filingAttempts.at(-1)?.messages;
      const message = data.messageId
        ? messages?.find((message) => message.id === data.messageId)
        : messages?.find((message) => !message.response);
      if (!message || !['Queried', 'Rejected'].includes(job.filingState))
        fail('There is no open authority query or rejection.');
      if (message.response) fail('The authority response is already recorded.');
      if (data.date < message.date || data.date > today())
        fail('Response date must follow the authority message and cannot be in the future.');
      await evidence(tx, actor, job.companyId, [data.evidenceId]);
      message.response = {
        summary: data.summary,
        date: data.date,
        evidenceId: data.evidenceId,
        actorId: actor.id,
      };
      return `Recorded external authority response: ${data.summary}`;
    },
  }),
  filing_message: action({
    schema: z.object({
      kind: z.enum(['Query', 'Rejection']),
      wording: text,
      date: calendarDate,
      responseDue: calendarDate,
      evidenceId: id,
    }),
    async run({ actor, job, tx }, data) {
      assertCapability(actor, 'record_filing');
      const attempt = job.filingAttempts.at(-1);
      if (
        !attempt ||
        !['Submitted', 'Resubmitted', 'Queried', 'Rejected'].includes(job.filingState)
      )
        fail('Record a submission before its query or rejection.');
      if (data.date > today()) fail('Authority correspondence cannot be future dated.');
      if (data.date < attempt.submittedDate || data.responseDue < data.date)
        fail('Authority message and response dates must follow submission and message dates.');
      await evidence(tx, actor, job.companyId, [data.evidenceId]);
      attempt.messages.push({ id: randomUUID(), ...data });
      job.filingState = data.kind === 'Query' ? 'Queried' : 'Rejected';
      job.state = 'Blocked';
      return `${data.kind}: ${data.wording}. Response due ${data.responseDue}.`;
    },
  }),
  confirm_outcome: action({
    schema: z.object({
      wording: text,
      date: calendarDate,
      evidenceId: id,
      confirmed: z.literal(true),
    }),
    async run({ actor, job, tx }, data) {
      assertCapability(actor, 'record_filing');
      const attempt = job.filingAttempts.at(-1);
      if (!attempt || !['Submitted', 'Resubmitted'].includes(job.filingState))
        fail('An unresolved query or rejection needs an evidenced response and resubmission.');
      if (data.date > today() || data.date < attempt.submittedDate)
        fail('Outcome date must be between submission and today.');
      await evidence(tx, actor, job.companyId, [data.evidenceId]);
      attempt.outcome = {
        wording: data.wording,
        date: data.date,
        evidenceId: data.evidenceId,
        actorId: actor.id,
      };
      job.filingState = 'Outcome confirmed';
      return `Authority outcome: ${data.wording}.`;
    },
  }),
};
