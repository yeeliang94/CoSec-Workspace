import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Actor, Job } from '../domain/model';
import type { CapitalEvent, BoEvent, CapitalProposal, BoAssessment } from '../domain/records';
import { capitalAt, beneficialOwnersAt, emptyBoCase } from '../domain/records';
import { assertCapability, DomainError, today } from '../domain/access';
import { approved, currentPack, preparationBlockers, executionBlockers } from '../domain/workflows';
import { getActorById, getDocuments, markSnapshotConsequences, audit } from './repository';
import { readRegisters, writeRegisters } from './record-store';
import { appendVersion } from './pack-versions';
import type { Transaction } from './db';

const id = z.string().min(1).max(100),
  text = z.string().trim().min(1).max(4000),
  date = z.iso.date();
const quantity = z.string().regex(/^[1-9]\d{0,17}$/, 'Enter positive whole share units.');
const amount = z
  .string()
  .regex(/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/, 'Enter an amount with up to two decimal places.');
const party = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  type: z.enum(['Individual', 'Organisation']),
  address: z.string().trim().min(1).max(1000),
});
const capitalSchema = z.object({
  kind: z.enum(['opening', 'allotment', 'transfer']),
  shareClass: z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(100),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  allocations: z
    .array(
      z.object({
        member: party,
        units: quantity,
        certificateNumber: z.string().trim().min(1).max(80),
      }),
    )
    .min(1)
    .max(50),
  sourceCertificateId: id.nullable(),
  remainingCertificateNumber: z.string().trim().min(1).max(80).nullable(),
  issuedAmount: amount,
  paidAmount: amount,
  consideration: amount,
  stamping: z.object({
    disposition: z.enum(['Evidence recorded', 'Not applicable']),
    basis: text,
    evidenceId: id,
  }),
  authorityEvidenceIds: z.array(id).min(1).max(30),
});
const assessmentSchema = z.object({
  personId: z.string().uuid(),
  personName: z.string().trim().min(1).max(200),
  kind: z.enum(['entry', 'review', 'cessation']),
  effectiveDate: date,
  registerEntryDate: date,
  criteria: text,
  sourceVersion: text,
  ownershipChain: text,
  evidenceIds: z.array(id).min(1).max(30),
  nextReviewDate: date,
  predecessorId: id.nullable(),
});
export const recordActionSchemas = {
  capital_proposal: z.object({
    proposal: capitalSchema,
    expectedRegisterRevision: z.number().int().positive(),
  }),
  bo_assessment: z.object({
    assessment: assessmentSchema,
    expectedRegisterRevision: z.number().int().positive(),
  }),
  bo_notice: z.object({
    recipient: z.string().trim().min(1).max(200),
    sentDate: date,
    responseDue: date,
    nextChaseDate: date,
    evidenceId: id,
    ownerId: id,
  }),
  bo_reply: z.object({ noticeId: id, date, evidenceId: id, summary: text }),
  bo_escalate: z.object({ noticeId: id, evidenceId: id, reason: text }),
  bo_discrepancy: z.object({ wording: text, evidenceId: id }),
  bo_resolve: z.object({ discrepancyId: id, basis: text, evidenceId: id }),
};
const fail = (message: string): never => {
  throw new DomainError(message);
};
export async function validateRecordEvidence(
  actor: Actor,
  job: Job,
  ids: string[],
  tx?: Transaction,
) {
  for (const document of await getDocuments(actor, ids, tx))
    if (
      document.companyId !== job.companyId ||
      (job.activity === 'W06') !== (document.classification === 'BO')
    )
      fail('Choose evidence in this company and the same access classification as the job.');
}
/** Prevent a privileged reader from attaching restricted evidence to an ordinary job. */
export async function validateJobEvidence(actor: Actor, job: Job, tx?: Transaction) {
  const ids = [
    ...job.sourceEvidenceIds,
    ...job.packs.flatMap((p) => [
      ...p.documentIds,
      ...p.checklist.flatMap((i) => [...i.evidenceIds, ...(i.notApplicable?.evidenceIds ?? [])]),
      ...p.signatures.map((s) => s.evidenceId),
    ]),
    ...(job.manualDateEvidenceId ? [job.manualDateEvidenceId] : []),
    ...(job.manualDateProposal ? [job.manualDateProposal.evidenceId] : []),
    ...job.correspondence.flatMap((c) => c.evidenceIds),
    ...job.filingAttempts.flatMap((a) => [
      a.evidenceId,
      ...a.documentIds,
      ...(a.paymentEvidenceId ? [a.paymentEvidenceId] : []),
      ...a.messages.flatMap((m) => [m.evidenceId, ...(m.response ? [m.response.evidenceId] : [])]),
      ...(a.outcome ? [a.outcome.evidenceId] : []),
    ]),
  ];
  await validateRecordEvidence(actor, job, ids, tx);
}
export async function applyRecordCommand(
  actor: Actor,
  job: Job,
  action: string,
  input: unknown,
  tx: Transaction,
): Promise<string> {
  if (!['W05', 'W06'].includes(job.activity))
    fail('This action applies to a members/capital or BO job.');
  if (job.activity === 'W06') assertCapability(actor, 'view_bo');
  if (job.recordEventId) fail('The posted record is immutable. Create a linked correction job.');
  const now = new Date().toISOString();
  if (action === 'post_record') {
    assertCapability(actor, 'confirm_record');
    if (actor.id === job.createdBy || actor.id === currentPack(job).createdBy)
      throw new DomainError('Independent record posting is required.', 'FORBIDDEN', 403);
    if (!approved(job, 'record') || !approved(job, 'pack'))
      fail('Review the exact pack and record proposal independently before posting.');
    const blockers = [...preparationBlockers(job), ...executionBlockers(job)];
    if (blockers.length) fail(blockers.join(' '));
    const records = await readRegisters(job.companyId, tx);
    if (job.recordBaseRevision !== records.revision)
      fail('Company registers changed. Refresh the proposal and obtain fresh review.');
    const eventId = randomUUID();
    if (job.activity === 'W05') {
      const proposal = job.capitalProposal ?? fail('Prepare the capital transaction.');
      const effectiveDate = job.effectiveDate ?? fail('Record the effective date.');
      const event: CapitalEvent = {
        ...structuredClone(proposal),
        id: eventId,
        companyId: job.companyId,
        jobId: job.id,
        effectiveDate,
        recordedAt: now,
        sequence: records.capitalEvents.length + 1,
        packVersion: currentPack(job).version,
        reviewerId: actor.id,
        basis: job.routeBasis,
      };
      const events = [...records.capitalEvents, event];
      capitalAt(events, '9999-12-31');
      await markSnapshotConsequences(
        actor,
        job.companyId,
        effectiveDate,
        eventId,
        tx,
        'Member/capital event',
      );
      records.capitalEvents = events;
    } else {
      const assessment = job.boCase?.assessment ?? fail('Prepare the sourced BO assessment.');
      if (assessment.registerEntryDate > today())
        fail('Register-entry date cannot be in the future.');
      const event: BoEvent = {
        ...structuredClone(assessment),
        id: eventId,
        companyId: job.companyId,
        jobId: job.id,
        recordedAt: now,
        sequence: records.boEvents.length + 1,
        packVersion: currentPack(job).version,
        reviewerId: actor.id,
      };
      beneficialOwnersAt([...records.boEvents, event], '9999-12-31');
      if (event.kind !== 'entry') {
        const prior = records.boEvents.find((e) => e.id === event.predecessorId);
        if (!prior || prior.personName !== event.personName)
          fail('The cessation must preserve the existing person identity.');
      }
      records.boEvents.push(event);
    }
    await writeRegisters(job.companyId, records, tx);
    job.recordEventId = eventId;
    await audit(
      actor,
      job.companyId,
      'record.posted',
      job.id,
      { eventId, activity: job.activity, packVersion: currentPack(job).version },
      tx,
    );
    return `Posted the reviewed dated record; filing remains ${job.filingState}.`;
  }
  const reviewing = ['bo_escalate', 'bo_resolve'].includes(action);
  assertCapability(actor, reviewing ? 'confirm_record' : 'prepare_job');
  if (reviewing && (actor.id === job.createdBy || actor.id === currentPack(job).createdBy))
    throw new DomainError(
      'An independent reviewer must resolve or escalate this item.',
      'FORBIDDEN',
      403,
    );
  if (action === 'capital_proposal') {
    if (job.activity !== 'W05') fail('This job has no capital instruction.');
    const { proposal, expectedRegisterRevision } =
      recordActionSchemas.capital_proposal.parse(input);
    await validateRecordEvidence(
      actor,
      job,
      [...proposal.authorityEvidenceIds, proposal.stamping.evidenceId],
      tx,
    );
    const records = await readRegisters(job.companyId, tx);
    if (records.revision !== expectedRegisterRevision)
      fail('Company registers changed. Reload the current position.');
    job.recordBaseRevision = records.revision;
    const sample: CapitalEvent = {
      ...proposal,
      id: randomUUID(),
      companyId: job.companyId,
      jobId: job.id,
      effectiveDate: job.effectiveDate!,
      recordedAt: now,
      sequence: records.capitalEvents.length + 1,
      packVersion: currentPack(job).version + 1,
      reviewerId: actor.id,
      basis: job.routeBasis,
    };
    capitalAt([...records.capitalEvents, sample], '9999-12-31');
    const before = capitalAt(records.capitalEvents, job.effectiveDate!);
    const after = capitalAt([...records.capitalEvents, sample], job.effectiveDate!);
    const source = before.certificates.find((c) => c.id === proposal.sourceCertificateId) ?? null;
    job.capitalReconciliation = {
      before: before.classes.find((c) => c.id === proposal.shareClass.id) ?? null,
      after: after.classes.find((c) => c.id === proposal.shareClass.id)!,
      sourceCertificate: source,
      sourceMember: before.members.find((m) => m.id === source?.memberId) ?? null,
    };
    job.capitalProposal = proposal as CapitalProposal;
    job.title = `${proposal.kind === 'opening' ? 'Opening member balances' : proposal.kind === 'allotment' ? 'Share allotment' : 'Share transfer'} — ${proposal.shareClass.name}`;
  } else {
    if (job.activity !== 'W06') fail('This action applies to BO casework.');
    const record = job.boCase ?? (job.boCase = emptyBoCase());
    if (action === 'bo_assessment') {
      const { assessment, expectedRegisterRevision } =
        recordActionSchemas.bo_assessment.parse(input);
      const records = await readRegisters(job.companyId, tx);
      if (records.revision !== expectedRegisterRevision)
        fail('Company registers changed. Reload the current position.');
      job.recordBaseRevision = records.revision;
      if (assessment.registerEntryDate > today())
        fail('Register-entry date cannot be in the future.');
      if (assessment.nextReviewDate < assessment.registerEntryDate)
        fail('Next review must not precede register entry.');
      const evidence = await getDocuments(actor, assessment.evidenceIds, tx);
      if (evidence.some((d) => d.companyId !== job.companyId || d.classification !== 'BO'))
        fail('Use restricted BO evidence from this company.');
      record.assessment = assessment as BoAssessment;
      job.effectiveDate = assessment.effectiveDate;
      job.title = `BO ${assessment.kind === 'entry' ? 'assessment' : assessment.kind === 'review' ? 'review' : 'cessation'} — ${assessment.personName}`;
    } else if (action === 'bo_notice') {
      const notice = recordActionSchemas.bo_notice.parse(input);
      if (
        notice.sentDate > today() ||
        notice.responseDue < notice.sentDate ||
        notice.nextChaseDate < notice.sentDate
      )
        fail('Notice and chase dates must follow the sent date; sent date cannot be future dated.');
      const owner = await getActorById(notice.ownerId, tx);
      if (
        !owner?.companyIds.includes(job.companyId) ||
        !owner.capabilities.includes('view_bo') ||
        !owner.capabilities.includes('prepare_job')
      )
        fail('Choose a BO-authorised preparer for the notice.');
      await validateRecordEvidence(actor, job, [notice.evidenceId], tx);
      record.notices.push({ ...notice, id: randomUUID(), reply: null, escalation: null });
      job.state = 'Waiting on external information';
    } else if (action === 'bo_reply') {
      const data = recordActionSchemas.bo_reply.parse(input);
      const notice =
        record.notices.find((n) => n.id === data.noticeId) ?? fail('Notice is unavailable.');
      if (notice.reply) fail('Reply already recorded; use a discrepancy or a linked correction.');
      if (data.date < notice.sentDate || data.date > today())
        fail('Reply must follow the notice and cannot be future dated.');
      await validateRecordEvidence(actor, job, [data.evidenceId], tx);
      notice.reply = { date: data.date, evidenceId: data.evidenceId, summary: data.summary };
    } else if (action === 'bo_escalate') {
      const data = recordActionSchemas.bo_escalate.parse(input);
      const notice =
        record.notices.find((n) => n.id === data.noticeId) ?? fail('Notice is unavailable.');
      if (notice.reply || notice.escalation || notice.responseDue >= today())
        fail('Only an overdue unanswered notice can be escalated once.');
      await validateRecordEvidence(actor, job, [data.evidenceId], tx);
      notice.escalation = {
        at: now,
        actorId: actor.id,
        reason: data.reason,
        evidenceId: data.evidenceId,
      };
      job.state = 'Blocked';
    } else if (action === 'bo_discrepancy') {
      const data = recordActionSchemas.bo_discrepancy.parse(input);
      await validateRecordEvidence(actor, job, [data.evidenceId], tx);
      record.discrepancies.push({ ...data, id: randomUUID(), resolution: null });
    } else if (action === 'bo_resolve') {
      const data = recordActionSchemas.bo_resolve.parse(input);
      const discrepancy =
        record.discrepancies.find((d) => d.id === data.discrepancyId) ??
        fail('Discrepancy is unavailable.');
      if (discrepancy.resolution) fail('The discrepancy already has an immutable resolution.');
      await validateRecordEvidence(actor, job, [data.evidenceId], tx);
      discrepancy.resolution = {
        basis: data.basis,
        evidenceId: data.evidenceId,
        actorId: actor.id,
        at: now,
      };
    } else fail('Unknown record action.');
  }
  const previousState = job.state;
  appendVersion(job, actor);
  if (action === 'bo_notice' || action === 'bo_escalate') job.state = previousState;
  return `Recorded ${action.replaceAll('_', ' ')}; review pack v${currentPack(job).version}.`;
}
