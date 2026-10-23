import { z } from 'zod';
import type { Actor, Job, Review } from '../../domain/model';
import { assertCapability, DomainError } from '../../domain/access';
import { currentPack } from '../../domain/workflows';
import * as repo from '../repository';
import type { Transaction } from '../db';

export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date as YYYY-MM-DD.')
  .refine((value) => {
    const date = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Enter a valid calendar date.');
export const id = z.string().min(1).max(100),
  text = z.string().trim().min(1).max(4000),
  optionalDate = calendarDate.nullable().optional();

/** Everything a handler may touch. Reads must go through `tx`; see repository.ts. */
export type ActionContext = {
  actor: Actor;
  job: Job;
  input: unknown;
  tx: Transaction;
  now: string;
};
type Handler<T> = {
  /** Omitted only for record actions, which parse their own input. */
  schema?: z.ZodType<T>;
  /** Requires `prepare_job`. */
  preparer?: true;
  /** Rejected once a package has been submitted, so the filed version stays intact. */
  preservedAfterSubmission?: true;
  /** Still permitted on a completed or cancelled job. */
  allowedWhenClosed?: true;
  /** Applies the change to `job` and returns the history detail. */
  run: (ctx: ActionContext, data: T) => Promise<string> | string;
};
export type JobAction = Handler<unknown>;
export function action<T>(handler: Handler<T>): JobAction {
  return handler as JobAction;
}

export function fail(message: string): never {
  throw new DomainError(message);
}
export function validation<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new DomainError(result.error.issues.map((i) => i.message).join(' '));
  return result.data;
}
export function requireChecks(messages: string[]) {
  if (messages.length) fail(messages.join(' '));
}
export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function isFilingPreserved(job: Job) {
  return ['Submitted', 'Resubmitted', 'Outcome confirmed'].includes(job.filingState);
}
export function isBeyondReadiness(job: Job) {
  return isFilingPreserved(job) || job.filingState === 'Not required with reason';
}

export async function assignee(companyId: string, userId: string, tx?: Transaction) {
  const assigned = await repo.getActorById(userId, tx);
  if (
    !assigned ||
    !assigned.companyIds.includes(companyId) ||
    !assigned.capabilities.includes('prepare_job')
  )
    fail('Choose an active preparer with access to this company.');
  return assigned;
}
export async function evidence(
  tx: Transaction | undefined,
  actor: Actor,
  companyId: string,
  ids: string[],
) {
  const documents = await repo.getDocuments(actor, ids, tx);
  if (documents.some((doc) => doc.companyId !== companyId))
    fail('Evidence must belong to this company.');
}
export function independent(actor: Actor, job: Job, scope: Review['scope']) {
  assertCapability(actor, scope === 'record' ? 'confirm_record' : 'review_pack');
  if (actor.id === job.createdBy || actor.id === currentPack(job).createdBy)
    throw new DomainError(
      'Independent review is required; the preparer cannot approve their own version.',
      'FORBIDDEN',
      403,
    );
}
export async function validateDependencies(
  tx: Transaction | undefined,
  actor: Actor,
  job: Job,
  requireResolved = false,
) {
  for (const dependencyId of job.dependencyIds) {
    const dependency = await repo.getJob(actor, dependencyId, tx);
    if (
      !dependency ||
      dependency.companyId !== job.companyId ||
      (job.activity !== 'W06' && dependency.activity === 'W06')
    )
      fail('A linked dependency is unavailable.');
    if (requireResolved && dependency.state !== 'Complete')
      fail(`Resolve linked job ${dependency.title} before proceeding.`);
  }
}
