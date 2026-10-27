import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '../../domain/access';
import {
  approved,
  currentPack,
  executionBlockers,
  officersAt,
  preparationBlockers,
  readinessBlockers,
} from '../../domain/workflows';
import { applyRecordCommand } from '../record-actions';
import { readRegisters } from '../record-store';
import * as repo from '../repository';
import { assertDirectorChangePerson, syncDirectorProjection } from '../records/relationships';
import {
  action,
  evidence,
  fail,
  independent,
  isBeyondReadiness,
  isFilingPreserved,
  requireChecks,
  text,
  validateDependencies,
} from './shared';

export const reviewActions = {
  request_review: action({
    schema: z.object({}),
    preparer: true,
    async run({ actor, job, tx }) {
      if (isFilingPreserved(job))
        fail(
          'Submitted or confirmed packages retain their review history. Use the authority query or linked correction route.',
        );
      requireChecks(preparationBlockers(job));
      await validateDependencies(tx, actor, job);
      job.state = 'Awaiting review';
      return `Requested review of pack v${currentPack(job).version}.`;
    },
  }),
  review: action({
    schema: z.object({
      scope: z.enum(['pack', 'record', 'manual_date', 'readiness']),
      decision: z.enum(['Approved', 'Returned']),
      reason: text,
      version: z.number().int().min(1),
    }),
    async run({ actor, job, tx, now }, data) {
      if (isFilingPreserved(job))
        fail(
          'Submitted or confirmed packages retain their review history. Use the authority query or linked correction route.',
        );
      independent(actor, job, data.scope);
      if (data.version !== currentPack(job).version)
        throw new DomainError(
          `This pack changed. Review version ${currentPack(job).version}.`,
          'CONFLICT',
          409,
        );
      if (data.decision === 'Approved') {
        if (
          data.scope === 'record' &&
          !job.recordEventId &&
          ['W05', 'W06'].includes(job.activity)
        ) {
          if (job.recordBaseRevision !== (await readRegisters(job.companyId, tx)).revision)
            fail('Company registers changed. Refresh the proposal before review.');
        }
        if (data.scope === 'pack') requireChecks(preparationBlockers(job));
        if (data.scope === 'record') {
          if (!['W04', 'W05', 'W06'].includes(job.activity))
            fail('Record review requires a dated record job.');
          if (
            !job.routeBasis.trim() ||
            (job.activity === 'W04' && !job.sourceEvidenceIds.length) ||
            !job.effectiveDate
          )
            fail('Dated record source and route basis are required.');
          requireChecks(preparationBlockers(job));
        }
        if (data.scope === 'manual_date') {
          const proposal = job.manualDateProposal;
          const date = proposal?.date ?? job.statutoryDue,
            basis = proposal?.basis ?? job.manualDateBasis,
            evidenceId = proposal?.evidenceId ?? job.manualDateEvidenceId;
          if (!date || !evidenceId || !basis.trim())
            fail('Manual statutory date, source evidence and basis are required.');
          await evidence(tx, actor, job.companyId, [evidenceId]);
          job.statutoryDue = date;
          job.manualDateBasis = basis;
          job.manualDateEvidenceId = evidenceId;
          job.deadlineHistory ??= [];
          job.deadlineHistory.push({ date, basis, evidenceId, reviewerId: actor.id, at: now });
          job.manualDateProposal = null;
          job.deadlineReviewRequired = false;
        }
        if (data.scope === 'readiness') {
          if (isBeyondReadiness(job)) fail('This filing has progressed beyond readiness.');
          requireChecks(readinessBlockers(job));
          await validateDependencies(tx, actor, job, true);
        }
      }
      job.reviews.push({
        id: randomUUID(),
        version: data.version,
        scope: data.scope,
        decision: data.decision,
        actorId: actor.id,
        at: now,
        reason: data.reason,
      });
      if (data.scope === 'pack') {
        currentPack(job).state =
          data.decision === 'Approved'
            ? executionBlockers(job).length
              ? 'Reviewed'
              : currentPack(job).requiredSigners.length
                ? 'Fully signed'
                : 'Reviewed'
            : 'Draft';
        job.state = data.decision === 'Approved' ? 'Action in progress' : 'Preparing';
      }
      if (data.scope === 'readiness' && data.decision === 'Approved') job.filingState = 'Ready';
      if (data.decision === 'Returned') {
        if (data.scope === 'manual_date') job.deadlineReviewRequired = true;
        if (job.filingState === 'Ready' || job.filingState === 'Not required with reason') {
          job.filingState = 'Not ready';
          job.filingNotRequiredReason = null;
        }
        job.state = 'Preparing';
      }
      return `${data.decision} ${data.scope} v${data.version}: ${data.reason}`;
    },
  }),
  authorise_readiness: action({
    schema: z.object({}),
    async run({ actor, job, tx, now }) {
      independent(actor, job, 'readiness');
      requireChecks(readinessBlockers(job));
      await validateDependencies(tx, actor, job, true);
      if (isBeyondReadiness(job)) fail('This filing has already progressed beyond readiness.');
      job.reviews.push({
        id: randomUUID(),
        version: currentPack(job).version,
        scope: 'readiness',
        decision: 'Approved',
        actorId: actor.id,
        at: now,
        reason: 'Independently checked current package, execution, dates and dependencies.',
      });
      job.filingState = 'Ready';
      job.state = 'Action in progress';
      return `Authorised filing readiness for pack v${currentPack(job).version}.`;
    },
  }),
  post_record: action({
    schema: z.object({ confirmed: z.literal(true) }),
    async run({ actor, job, input, tx, now }) {
      independent(actor, job, 'record');
      if (job.activity === 'W05' || job.activity === 'W06') {
        return await applyRecordCommand(actor, job, 'post_record', input, tx);
      }
      if (
        job.activity !== 'W04' ||
        !job.route ||
        !job.personId ||
        !job.personName ||
        !job.effectiveDate
      )
        fail('This job has no director event proposal.');
      if (job.recordEventId) fail('The director event is already recorded.');
      if (!approved(job, 'record') || !approved(job, 'pack'))
        fail('Review the exact pack and dated record separately before posting.');
      requireChecks([...preparationBlockers(job), ...executionBlockers(job)]);
      await evidence(tx, actor, job.companyId, job.sourceEvidenceIds);
      // Access may have changed since the job was created; re-check before linking the person.
      await assertDirectorChangePerson(
        actor,
        {
          companyId: job.companyId,
          route: job.route,
          personId: job.personId,
          personName: job.personName,
        },
        tx,
        true,
      );
      const affectedFiled = (await repo.listJobs(actor, tx)).filter(
        (other) =>
          other.companyId === job.companyId &&
          other.activity === 'W03' &&
          other.snapshot &&
          other.snapshot.asAt >= job.effectiveDate! &&
          other.filingAttempts.length > 0,
      );
      if (affectedFiled.length)
        fail(
          `This effective date affects a preserved filed annual return (${affectedFiled.map((j) => j.year).join(', ')}). A practising secretary must open and approve the linked correction and consequence review before posting; this first-build route cannot rewrite filed history.`,
        );
      const events = await repo.listOfficerEvents(job.companyId, tx),
        personEvents = events
          .filter((e) => e.personId === job.personId)
          .sort(
            (a, b) =>
              a.effectiveDate.localeCompare(b.effectiveDate) ||
              a.recordedAt.localeCompare(b.recordedAt),
          );
      if (personEvents.some((e) => e.effectiveDate >= job.effectiveDate!))
        fail(
          'An existing event on or after this effective date requires a linked correction and consequence review.',
        );
      const current = officersAt(events, job.effectiveDate).find(
        (o) => o.personId === job.personId,
      );
      if (job.route === 'appointment' && current)
        fail('This person already holds an appointment on the effective date.');
      if (job.route !== 'appointment' && !current)
        fail('No active appointment exists on the proposed cessation date.');
      const eventId = randomUUID();
      await repo.insertOfficerEvent(
        {
          id: eventId,
          companyId: job.companyId,
          jobId: job.id,
          personId: job.personId,
          personName: job.personName,
          route: job.route,
          effectiveDate: job.effectiveDate,
          recordedAt: now,
          evidenceIds: job.sourceEvidenceIds,
          basis: job.routeBasis,
          reviewerId: actor.id,
          predecessorId: current?.eventId ?? null,
        },
        tx,
      );
      job.recordEventId = eventId;
      // Director relationships are projections of posted events; refresh them in the same lock.
      await syncDirectorProjection(job.companyId, tx);
      await repo.markSnapshotConsequences(actor, job.companyId, job.effectiveDate, eventId, tx);
      return `Recorded ${job.route} effective ${job.effectiveDate}; filing remains ${job.filingState}.`;
    },
  }),
};
