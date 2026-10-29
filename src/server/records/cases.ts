import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, transaction, type Transaction } from '../db';
import * as s from '../schema';
import { getJob, prior, remember, requestKey } from '../repository';
import { auditChange, mutateCase, readCase } from '../resolution/shared';
import { generationView } from '../resolution/generation';
import { generationRequirements } from '../resolution/generation-signers';
import { appendCustomValue } from './custom-fields';
import {
  assertAny,
  assertAssignable,
  assertPersonVisible,
  companyEvidence,
  lockCompany,
} from './scope';
import { assertCompany, DomainError, today } from '../../domain/access';
import type { Actor } from '../../domain/model';
import type {
  CaseKind,
  CaseStep,
  DocumentGeneration,
  ResolutionCase,
  StepKind,
} from '../../domain/resolution/model';
import {
  assertCompletable,
  assertEditable,
  assertOpen,
  defaultSteps,
  emptyDecision,
  MAX_STEPS,
  routeMatches,
  updateStep,
  validateDependencies,
  type StepPatch,
} from '../../domain/resolution/cases';
import { omit } from '../../domain/objects';

const CASE_WRITERS = ['generate_documents', 'prepare_job'] as const;

/** Canonical company and route checks for a case's immutable W04 association. */
async function linkedJob(
  actor: Actor,
  companyId: string,
  kind: CaseKind,
  jobId: string,
  tx: Transaction,
) {
  const job = await getJob(actor, jobId, tx);
  if (job.companyId !== companyId || job.activity !== 'W04')
    throw new DomainError('Link a W04 director-change job of the same company.');
  if (job.state === 'Cancelled') throw new DomainError('A cancelled W04 job cannot be linked.');
  if (!routeMatches(kind, job.route))
    throw new DomainError(
      `This job's route (${job.route}) does not match a ${kind.replace('_', ' ')} case.`,
    );
  return job;
}

export async function listCases(actor: Actor, companyId?: string) {
  if (companyId) assertCompany(actor, companyId);
  const companies = companyId ? [companyId] : actor.companyIds;
  if (!companies.length) return [];
  return (
    await db
      .select({ data: s.resolutionCases.data })
      .from(s.resolutionCases)
      .where(inArray(s.resolutionCases.companyId, companies))
  )
    .map((r) => r.data)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** One call for the case screen: the case, its generations (without resolved content) and records. */
export async function getCaseDetail(actor: Actor, id: string) {
  const resolutionCase = await readCase(actor, id);
  const generations = await Promise.all(
    (
      await db
        .select({ data: s.documentGenerations.data })
        .from(s.documentGenerations)
        .where(
          and(
            eq(s.documentGenerations.caseId, id),
            eq(s.documentGenerations.companyId, resolutionCase.companyId),
          ),
        )
        .orderBy(desc(s.documentGenerations.createdAt))
    ).map(async ({ data }) => {
      // Older rows stored the full selector pools; the view keeps only referenced people.
      const rest = omit(
        { ...generationView(data), executionRequirements: await generationRequirements(data, db) },
        'resolved',
      );
      return rest as Omit<DocumentGeneration, 'resolved'>;
    }),
  );
  const records = generations.length
    ? (
        await db
          .select({ data: s.generationRecords.data })
          .from(s.generationRecords)
          .where(
            inArray(
              s.generationRecords.generationId,
              generations.map((g) => g.id),
            ),
          )
          .orderBy(s.generationRecords.createdAt)
      ).map((r) => r.data)
    : [];
  return { case: resolutionCase, generations, records };
}

export type CreateCaseInput = {
  requestId: string;
  companyId: string;
  kind: CaseKind;
  title: string;
  jobId?: string | null;
  personId?: string | null;
  instructionDate?: string | null;
  resolutionDate?: string | null;
  effectiveDate?: string | null;
};

export async function createCase(actor: Actor, input: CreateCaseInput): Promise<ResolutionCase> {
  assertCompany(actor, input.companyId);
  assertAny(actor, [...CASE_WRITERS]);
  const key = requestKey(actor, `case:create:${input.companyId}`, input.requestId);
  return transaction(async (tx) => {
    await lockCompany(input.companyId, tx);
    const old = await prior(tx, key);
    if (old) return readCase(actor, old.id, tx);
    let personId = input.personId ?? null;
    let effectiveDate = input.effectiveDate ?? null;
    if (input.jobId) {
      const job = await linkedJob(actor, input.companyId, input.kind, input.jobId, tx);
      if (personId && job.personId && personId !== job.personId)
        throw new DomainError('The person must be the person named in the linked W04 job.');
      personId = job.personId;
      effectiveDate = effectiveDate ?? job.effectiveDate;
    } else if (personId) await assertPersonVisible(actor, personId, tx);
    const now = new Date().toISOString();
    const resolutionCase: ResolutionCase = {
      id: randomUUID(),
      companyId: input.companyId,
      kind: input.kind,
      title: input.title.trim(),
      jobId: input.jobId ?? null,
      personId,
      ownerId: actor.id,
      state: 'Open',
      cancellationReason: null,
      instructionDate: input.instructionDate ?? null,
      resolutionDate: input.resolutionDate ?? null,
      effectiveDate,
      customValues: {},
      steps: defaultSteps(input.kind, actor.id, randomUUID),
      selection: null,
      answers: { selectionRevision: 0, shared: {}, clauses: {} },
      signers: { directors: [], members: [], certifiers: [] },
      decision: emptyDecision(),
      families: [],
      history: [
        { id: randomUUID(), action: 'created', actorId: actor.id, at: now, detail: 'Case opened.' },
      ],
      createdBy: actor.id,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
    await tx.insert(s.resolutionCases).values({
      id: resolutionCase.id,
      companyId: resolutionCase.companyId,
      jobId: resolutionCase.jobId,
      revision: 1,
      data: resolutionCase,
    });
    const after = omit(resolutionCase, 'history');
    await auditChange(tx, actor, {
      companyId: resolutionCase.companyId,
      entityType: 'resolution_case',
      entityId: resolutionCase.id,
      action: 'resolution_case.created',
      before: null,
      after,
      detail: { kind: resolutionCase.kind, jobId: resolutionCase.jobId },
      requestId: input.requestId,
    });
    await remember(tx, key, { id: resolutionCase.id, revision: 1 });
    return resolutionCase;
  });
}

type Base = { expectedRevision: number; requestId: string };
export type CaseAction = Base &
  (
    | { action: 'link_job'; jobId: string }
    | {
        action: 'update_details';
        title?: string;
        instructionDate?: string | null;
        resolutionDate?: string | null;
        effectiveDate?: string | null;
        ownerId?: string;
        personId?: string | null;
      }
    | {
        action: 'add_step';
        kind: Exclude<StepKind, 'registration'>;
        label: string;
        ownerId?: string;
        dueDate?: string | null;
        dependsOn?: string[];
      }
    | ({ action: 'update_step'; stepId: string } & StepPatch)
    | {
        action: 'record_decision';
        status: 'Not recorded' | 'Passed' | 'Not passed';
        date: string | null;
        evidenceIds: string[];
        note?: string;
      }
    | { action: 'cancel'; reason: string }
    | { action: 'complete' }
    | { action: 'send_for_review'; reviewerId: string }
    | { action: 'review'; decision: 'Approved' | 'Returned'; comment: string }
    | { action: 'reopen' }
    | {
        action: 'set_custom';
        definitionId: string;
        value: unknown;
        effectiveDate: string;
        reason: string;
      }
  );

export async function changeCase(actor: Actor, id: string, input: CaseAction) {
  assertAny(actor, [...CASE_WRITERS]);
  return mutateCase(
    actor,
    id,
    input.expectedRevision,
    input.requestId,
    input.action,
    async (c, tx) => {
      const now = new Date().toISOString();
      switch (input.action) {
        case 'link_job': {
          assertEditable(c);
          if (c.jobId) throw new DomainError('This case is already linked to a W04 job.');
          const job = await linkedJob(actor, c.companyId, c.kind, input.jobId, tx);
          c.jobId = job.id;
          c.personId = job.personId;
          c.effectiveDate = job.effectiveDate;
          return {
            next: c,
            detail: `Linked W04 job ${job.id}; person and effective date taken from the job.`,
          };
        }
        case 'update_details': {
          assertEditable(c);
          if (input.title !== undefined) c.title = input.title.trim();
          if (input.instructionDate !== undefined) c.instructionDate = input.instructionDate;
          if (input.resolutionDate !== undefined) c.resolutionDate = input.resolutionDate;
          if (input.effectiveDate !== undefined) c.effectiveDate = input.effectiveDate;
          if (input.ownerId !== undefined) {
            await assertAssignable(input.ownerId, c.companyId, tx);
            c.ownerId = input.ownerId;
          }
          if (input.personId !== undefined && input.personId !== c.personId) {
            if (c.jobId)
              throw new DomainError('The person of a W04-linked case comes from the job.');
            if (input.personId) await assertPersonVisible(actor, input.personId, tx);
            c.personId = input.personId;
          }
          return { next: c, detail: 'Updated case details.' };
        }
        case 'add_step': {
          assertOpen(c);
          if (c.steps.length >= MAX_STEPS)
            throw new DomainError(`A case has at most ${MAX_STEPS} steps.`);
          const ownerId = input.ownerId ?? actor.id;
          await assertAssignable(ownerId, c.companyId, tx);
          const step: CaseStep = {
            id: randomUUID(),
            kind: input.kind,
            label: input.label.trim(),
            ownerId,
            state: 'Pending',
            reason: null,
            dueDate: input.dueDate ?? null,
            completedAt: null,
            dependsOn: [...new Set(input.dependsOn ?? [])],
            evidenceIds: [],
          };
          c.steps.push(step);
          validateDependencies(c.steps);
          return { next: c, detail: `Added step "${step.label}".` };
        }
        case 'update_step': {
          const { stepId, ...patch } = input as Extract<CaseAction, { action: 'update_step' }>;
          const fields: StepPatch = {
            label: patch.label,
            state: patch.state,
            ownerId: patch.ownerId,
            dueDate: patch.dueDate,
            reason: patch.reason,
            evidenceIds: patch.evidenceIds,
            dependsOn: patch.dependsOn,
          };
          if (fields.ownerId !== undefined) await assertAssignable(fields.ownerId, c.companyId, tx);
          if (fields.evidenceIds !== undefined)
            fields.evidenceIds = await companyEvidence(actor, c.companyId, fields.evidenceIds, tx);
          // Read inside the write transaction, so a record event the job posted is visible.
          const [jobRow] = c.jobId
            ? await tx.select().from(s.jobs).where(eq(s.jobs.id, c.jobId))
            : [];
          const job = jobRow?.data ?? null;
          const before = c.steps.find((st) => st.id === stepId)?.state;
          const step = updateStep(c, stepId, fields, {
            recordEventId: job?.recordEventId ?? null,
            now,
          });
          return {
            next: c,
            detail:
              before !== step.state
                ? `Step "${step.label}": ${before} → ${step.state}.`
                : `Updated step "${step.label}".`,
            reason: step.state === 'Not applicable' ? (step.reason ?? undefined) : undefined,
          };
        }
        case 'record_decision': {
          assertOpen(c);
          if (input.status === 'Not recorded') c.decision = emptyDecision();
          else {
            if (!input.date || input.date > today())
              throw new DomainError('Enter the date the decision was made (not a future date).');
            if (!input.evidenceIds.length)
              throw new DomainError('Attach the signed resolution or minutes as evidence.');
            c.decision = {
              status: input.status,
              date: input.date,
              evidenceIds: await companyEvidence(actor, c.companyId, input.evidenceIds, tx),
              actorId: actor.id,
              note: input.note?.trim() ?? '',
            };
          }
          return { next: c, detail: `Decision recorded: ${c.decision.status}.` };
        }
        case 'cancel': {
          assertOpen(c);
          c.state = 'Cancelled';
          c.cancellationReason = input.reason.trim();
          return { next: c, detail: 'Case cancelled.', reason: c.cancellationReason };
        }
        case 'complete': {
          assertCompletable(c);
          c.state = 'Complete';
          return { next: c, detail: 'Case completed.' };
        }
        case 'send_for_review': {
          assertEditable(c);
          if (!c.selection) throw new DomainError('Choose the wording before sending for review.');
          if (input.reviewerId === actor.id)
            throw new DomainError('Choose someone else to review your work.');
          await assertAssignable(input.reviewerId, c.companyId, tx);
          c.review = {
            status: 'With reviewer',
            reviewerId: input.reviewerId,
            sentBy: actor.id,
            sentAt: now,
            decidedAt: null,
            comment: '',
          };
          return { next: c, detail: 'Sent for review.' };
        }
        case 'review': {
          assertOpen(c);
          if (c.review?.status !== 'With reviewer')
            throw new DomainError('This resolution is not waiting for review.');
          if (c.review.reviewerId !== actor.id)
            throw new DomainError('Only the chosen reviewer can review this.', 'FORBIDDEN', 403);
          if (input.decision === 'Returned' && !input.comment)
            throw new DomainError('Say what needs changing.');
          c.review = {
            ...c.review,
            status: input.decision,
            decidedAt: now,
            comment: input.comment,
          };
          return {
            next: c,
            detail: input.decision === 'Approved' ? 'Approved.' : 'Returned for changes.',
            reason: input.comment || undefined,
          };
        }
        case 'reopen': {
          assertOpen(c);
          if (!c.review) throw new DomainError('This resolution is already a draft.');
          if (actor.id !== c.review.sentBy && actor.id !== c.review.reviewerId)
            throw new DomainError(
              'Only the person who sent it or the reviewer can take this back.',
              'FORBIDDEN',
              403,
            );
          c.review = null;
          return { next: c, detail: 'Taken back for changes.' };
        }
        case 'set_custom': {
          assertEditable(c);
          c.customValues = await appendCustomValue(actor, c.customValues, input, 'case', tx);
          return { next: c, detail: `Set ${input.definitionId}.`, reason: input.reason };
        }
      }
    },
  );
}
