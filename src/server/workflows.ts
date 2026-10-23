import { validateJobEvidence } from './record-actions';
import { emptyBoCase } from '../domain/records';
import { randomUUID } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import type { Actor, Job, PackVersion, ChecklistItem } from '../domain/model';
import { assertCompany, assertCapability, DomainError, today } from '../domain/access';
import { officersAt } from '../domain/workflows';
import * as repo from './repository';
import { jobActions } from './job-actions';
import {
  assignee,
  evidence,
  fail,
  id,
  isFilingPreserved,
  optionalDate,
  shiftDate,
  validateDependencies,
  validation,
} from './job-actions/shared';

export { calendarDate } from './job-actions/shared';
export const createJobInput = z
  .object({
    companyId: id,
    activity: z.enum(['W03', 'W04', 'W05', 'W06']),
    ownerId: id,
    year: z.number().int().min(1900).max(2200).optional(),
    anniversaryDate: optionalDate,
    route: z.enum(['appointment', 'resignation', 'removal', 'other_cessation']).optional(),
    personId: id.optional(),
    personName: z.string().trim().min(1).max(200).optional(),
    effectiveDate: optionalDate,
    routeBasis: z.string().max(4000).optional(),
    internalTarget: optionalDate,
    statutoryDue: optionalDate,
    manualDateBasis: z.string().max(4000).optional(),
    manualDateEvidenceId: id.nullable().optional(),
    sourceEvidenceIds: z.array(id).max(100).default([]),
    dependencyIds: z.array(id).max(100).default([]),
    checklistVersionId: id.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.activity === 'W03' &&
      (!value.year ||
        !value.anniversaryDate ||
        Number(value.anniversaryDate.slice(0, 4)) !== value.year)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Annual returns require a reporting year and anniversary date in that year.',
      });
    if (
      value.activity === 'W04' &&
      (!value.route ||
        !value.personId ||
        !value.personName ||
        !value.effectiveDate ||
        !value.routeBasis?.trim())
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Director changes require a specific route, person, effective date and route basis.',
      });
    if (
      ['W05', 'W06'].includes(value.activity) &&
      (!value.effectiveDate || !value.routeBasis?.trim())
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Record jobs require a proposed effective date and authority basis.',
      });
    if (value.statutoryDue && (!value.manualDateBasis?.trim() || !value.manualDateEvidenceId))
      ctx.addIssue({
        code: 'custom',
        message: 'A manual statutory date requires its source evidence and basis.',
      });
  });
const envelope = z.object({
  expectedRevision: z.number().int().min(1),
  requestId: z.string().min(8).max(100),
  action: z.string(),
});
function checklist(activity: Job['activity'], route: Job['route']): ChecklistItem[] {
  const recordChecks =
    activity === 'W05'
      ? [
          ['capital_source', 'Instruction and opening position verified'],
          ['capital_authority', 'Executed decision and authority verified'],
          ['capital_stamp', 'Stamping disposition evidenced'],
          ['capital_reconcile', 'Units, capital and certificates reconciled'],
        ]
      : activity === 'W06'
        ? [
            ['bo_source', 'Ownership chain and criteria evidenced'],
            ['bo_reply', 'Notice replies reconciled'],
            ['bo_discrepancy', 'Discrepancies assessed'],
            ['bo_validation', 'External prepared output validated'],
          ]
        : null;
  if (recordChecks)
    return recordChecks.map(([id, label]) => ({ id, label, required: true, evidenceIds: [] }));
  const checks =
    activity === 'W03'
      ? [
          ['particulars', 'Anniversary particulars verified'],
          ['client', 'Client confirmation reconciled'],
          ['bo', 'BO applicability assessed'],
          ['validation', 'External prepared output validated'],
        ]
      : [
          ['source', 'Instruction and source verified'],
          ...(route === 'appointment'
            ? [['consent', 'Signed consent and eligibility checked']]
            : []),
          ['authority', 'Decision and authority verified'],
          [
            'route',
            `${route === 'appointment' ? 'Appointment' : route === 'resignation' ? 'Resignation' : route === 'removal' ? 'Removal' : 'Cessation'} route and posting basis assessed`,
          ],
        ];
  return checks.map(([itemId, label]) => ({ id: itemId, label, required: true, evidenceIds: [] }));
}
export async function createJob(actor: Actor, input: unknown, requestId: string): Promise<Job> {
  const data = validation(createJobInput, input);
  assertCompany(actor, data.companyId, 'prepare_job');
  const assigned = await assignee(data.companyId, data.ownerId);
  if (data.activity === 'W06') {
    assertCapability(actor, 'view_bo');
    if (!assigned.capabilities.includes('view_bo')) fail('Choose a BO-authorised preparer.');
  }
  const company = await repo.getCompany(data.companyId);
  if (!company) throw new DomainError('Company access is unavailable.', 'NOT_FOUND', 404);
  await evidence(undefined, actor, data.companyId, [
    ...data.sourceEvidenceIds,
    ...(data.manualDateEvidenceId ? [data.manualDateEvidenceId] : []),
  ]);
  if (data.activity === 'W03' && data.anniversaryDate! < company.incorporationDate)
    fail('The anniversary cannot precede incorporation.');
  if (data.activity === 'W03' && company.incorporationDate.slice(5) === '02-29')
    fail(
      'Leap-day anniversary requires a practising secretary reviewed exception route; automatic annual creation is unavailable.',
    );
  if (
    data.activity === 'W03' &&
    data.anniversaryDate!.slice(5) !== company.incorporationDate.slice(5)
  )
    fail('The annual return snapshot date must match the incorporation anniversary.');
  const now = new Date().toISOString(),
    jobId = randomUUID(),
    settings = await repo.getSettings();
  let additionalChecks: ChecklistItem[] = [];
  if (data.checklistVersionId) {
    const selected = settings.catalogue.find(
      (c) =>
        c.id === data.checklistVersionId &&
        c.kind === 'checklist' &&
        c.status === 'Published' &&
        c.effectiveDate &&
        c.effectiveDate <= today(),
    );
    if (!selected) fail('Choose a published checklist version effective on or before today.');
    const content = selected.content
      .replace(/<\/(?:p|li|div|h[1-6])>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n');
    const labels = sanitizeHtml(content, { allowedTags: [], allowedAttributes: {} })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (labels.length < 1 || labels.length > 30 || labels.some((label) => label.length > 500))
      fail('A checklist version must have 1 to 30 items, each at most 500 characters.');
    additionalChecks = labels.map((label, index) => ({
      id: `custom-${index + 1}`,
      label,
      required: true,
      evidenceIds: [],
    }));
  }
  const pack: PackVersion = {
    version: 1,
    createdAt: now,
    createdBy: actor.id,
    notes: '',
    documentIds: [],
    checklist: [...checklist(data.activity, data.route ?? null), ...additionalChecks],
    requiredSigners: [],
    signatures: [],
    templateVersionId: null,
    state: 'Draft',
  };
  const job: Job = {
    id: jobId,
    companyId: data.companyId,
    activity: data.activity,
    title:
      data.activity === 'W03'
        ? `Annual return ${data.year}`
        : data.activity === 'W04'
          ? `Director ${data.route?.replace('_', ' ')} — ${data.personName}`
          : data.activity === 'W05'
            ? 'Members and capital'
            : 'Beneficial ownership assessment',
    ...(data.activity === 'W06' ? { boCase: emptyBoCase() } : {}),
    year: data.activity === 'W03' ? data.year! : null,
    anniversaryDate: data.activity === 'W03' ? data.anniversaryDate! : null,
    snapshot:
      data.activity === 'W03' && data.anniversaryDate! <= today()
        ? {
            asAt: data.anniversaryDate!,
            company: structuredClone(company),
            officers: officersAt(
              await repo.listOfficerEvents(data.companyId),
              data.anniversaryDate!,
            ),
            capturedAt: now,
          }
        : null,
    route: data.activity === 'W04' ? data.route! : null,
    personId: data.activity === 'W04' ? data.personId! : null,
    personName: data.activity === 'W04' ? data.personName! : null,
    effectiveDate: data.activity !== 'W03' ? data.effectiveDate! : null,
    routeBasis: data.routeBasis ?? '',
    sourceEvidenceIds: data.sourceEvidenceIds,
    recordEventId: null,
    ownerId: data.ownerId,
    createdBy: actor.id,
    state: 'Preparing',
    revision: 1,
    createdAt: now,
    updatedAt: now,
    internalTarget:
      data.internalTarget === undefined
        ? shiftDate(
            data.activity === 'W03' ? data.anniversaryDate! : data.effectiveDate!,
            -settings.preparationLeadDays,
          )
        : data.internalTarget,
    statutoryDue: data.statutoryDue ?? null,
    manualDateBasis: data.manualDateBasis ?? '',
    manualDateEvidenceId: data.manualDateEvidenceId ?? null,
    deadlineReviewRequired: !!data.statutoryDue,
    ruleVersionId: null,
    dependencyIds: data.dependencyIds,
    checklistVersionId: data.checklistVersionId ?? null,
    packs: [pack],
    reviews: [],
    correspondence: [],
    clientConfirmed: false,
    clientConfirmationEvidenceId: null,
    filingState: 'Not ready',
    filingNotRequiredReason: null,
    filingAttempts: [],
    billingState: 'Not ready',
    notes: [],
    history: [
      {
        id: randomUUID(),
        action: 'Created',
        actorId: actor.id,
        at: now,
        detail:
          data.activity === 'W03'
            ? `Historical snapshot as at ${data.anniversaryDate}`
            : `${data.activity === 'W04' ? data.route : data.activity} proposed effective ${data.effectiveDate}`,
      },
    ],
  };
  await validateDependencies(undefined, actor, job);
  await validateJobEvidence(actor, job);
  return repo.createJob(actor, job, requestId);
}
/** Shared guards run first; each handler in ./job-actions then applies its own rules. */
export async function applyJobAction(actor: Actor, jobId: string, input: unknown): Promise<Job> {
  const command = validation(envelope, input);
  const handler = Object.hasOwn(jobActions, command.action)
    ? jobActions[command.action]
    : fail('Unknown job action.');
  return repo.mutateJob(
    actor,
    jobId,
    command.expectedRevision,
    command.requestId,
    async (job, tx) => {
      assertCompany(actor, job.companyId);
      if (handler.preparer) assertCapability(actor, 'prepare_job');
      if (handler.preservedAfterSubmission && isFilingPreserved(job))
        fail(
          'A submitted or confirmed package stays preserved. Record an authority query, or create a linked correction job.',
        );
      if ((job.state === 'Complete' || job.state === 'Cancelled') && !handler.allowedWhenClosed)
        fail(
          'Closed work retains its history. Create a linked correction job for material changes.',
        );
      const now = new Date().toISOString();
      const data = handler.schema ? validation(handler.schema, input) : input;
      const detail = await handler.run({ actor, job, input, tx, now }, data);
      if (job.activity === 'W06') {
        const assigned = await assignee(job.companyId, job.ownerId, tx);
        if (!assigned.capabilities.includes('view_bo')) fail('Choose a BO-authorised preparer.');
      }
      await validateJobEvidence(actor, job, tx);
      job.updatedAt = now;
      job.history.push({
        id: randomUUID(),
        action: command.action,
        actorId: actor.id,
        at: now,
        detail,
      });
      return job;
    },
  );
}
