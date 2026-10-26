import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, type Transaction } from '../db';
import * as s from '../schema';
import { assertCompany, DomainError } from '../../domain/access';
import type { Actor } from '../../domain/model';
import type { ClauseVersion, ResolutionCase } from '../../domain/resolution/model';
import { prior, remember, requestKey } from '../repository';

export type Change = { path: string; before: unknown; after: unknown };
const MAX_CHANGES = 200;
const MAX_VALUE = 2000;
function clip(value: unknown) {
  if (typeof value === 'string' && value.length > MAX_VALUE) return value.slice(0, MAX_VALUE) + '…';
  return value;
}
/** Leaf-level differences between two JSON-compatible values, bounded in size. */
export function diff(before: unknown, after: unknown, path = '', out: Change[] = []): Change[] {
  if (out.length >= MAX_CHANGES) return out;
  const isObject = (v: unknown) => v !== null && typeof v === 'object';
  if (isObject(before) && isObject(after) && Array.isArray(before) === Array.isArray(after)) {
    const keys = new Set([...Object.keys(before as object), ...Object.keys(after as object)]);
    for (const key of keys)
      diff(
        (before as Record<string, unknown>)[key],
        (after as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
        out,
      );
    return out;
  }
  if (JSON.stringify(before) !== JSON.stringify(after))
    out.push({ path: path || '(value)', before: clip(before), after: clip(after) });
  return out;
}

export type AuditInput = {
  /** Primary company, or null for firm-level records such as templates and people. */
  companyId: string | null;
  /** Companies whose authorised staff may read this entry, fixed at the time of change. */
  scopeCompanyIds?: string[];
  entityType: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  /** Extra structured detail (ids, versions, hashes). Never document bytes or secrets. */
  detail?: Record<string, unknown>;
  reason?: string | null;
  requestId?: string | null;
  sensitivity?: 'General' | 'BO';
};
/**
 * Writes one before/after audit entry inside the caller's transaction, so the business change
 * and its audit commit or roll back together. Paths listed in `redact` are recorded as changed
 * without their values.
 */
export async function auditChange(
  tx: Transaction,
  actor: Actor,
  input: AuditInput,
  redact: string[] = [],
) {
  const changes =
    input.before === undefined && input.after === undefined
      ? []
      : diff(input.before ?? null, input.after ?? null).map((c) =>
          redact.some((r) => c.path === r || c.path.startsWith(r + '.'))
            ? { path: c.path, before: '[redacted]', after: '[redacted]' }
            : c,
        );
  await tx.insert(s.auditEvents).values({
    id: randomUUID(),
    actorId: actor.id,
    companyId: input.companyId,
    action: input.action,
    subjectId: input.entityId,
    entityType: input.entityType,
    requestId: input.requestId ?? null,
    reason: input.reason ?? null,
    sensitivity: input.sensitivity ?? 'General',
    scopeCompanyIds: input.scopeCompanyIds ?? (input.companyId ? [input.companyId] : null),
    detail: { changes, ...(input.detail ?? {}) },
    createdAt: new Date(),
  });
}

export async function readCase(actor: Actor, id: string, tx?: Transaction, lock = false) {
  const query = (tx ?? db).select().from(s.resolutionCases).where(eq(s.resolutionCases.id, id));
  const [row] = await (tx && lock ? query.for('update') : query);
  if (!row) throw new DomainError('Resolution case access is unavailable.', 'NOT_FOUND', 404);
  assertCompany(actor, row.companyId);
  return row.data;
}

/**
 * The single write path for resolution cases. Locks the company then the case (the same order
 * as jobs), replays a repeated request, rejects stale revisions and audits before/after.
 * `operation` returns the new case plus a short history detail.
 */
export async function mutateCase(
  actor: Actor,
  id: string,
  expectedRevision: number,
  requestId: string,
  action: string,
  operation: (
    current: ResolutionCase,
    tx: Transaction,
  ) => Promise<{ next: ResolutionCase; detail: string; reason?: string }>,
) {
  const key = requestKey(actor, `case:${id}`, requestId);
  // Company identity is immutable. Resolve it before the transaction so a plain identity
  // read cannot establish a repeatable-read snapshot before we wait for the company lock.
  const identity = await readCase(actor, id);
  return db.transaction(async (tx) => {
    await tx.select().from(s.companies).where(eq(s.companies.id, identity.companyId)).for('update');
    const current = await readCase(actor, id, tx, true);
    if (await prior(tx, key)) return current;
    if (current.revision !== expectedRevision)
      throw new DomainError(
        'This resolution case changed. Refresh and review the current version.',
        'STALE',
        409,
      );
    const { next, detail, reason } = await operation(structuredClone(current), tx);
    if (next.id !== id || next.companyId !== current.companyId)
      throw new DomainError('Resolution case identity cannot change.');
    next.revision = current.revision + 1;
    next.updatedAt = new Date().toISOString();
    next.history = [
      ...next.history,
      { id: randomUUID(), action, actorId: actor.id, at: next.updatedAt, detail },
    ];
    await tx
      .update(s.resolutionCases)
      .set({ data: next, revision: next.revision, jobId: next.jobId })
      .where(eq(s.resolutionCases.id, id));
    const { history: _before, ...beforeRest } = current;
    const { history: _after, ...afterRest } = next;
    void _before;
    void _after;
    await auditChange(tx, actor, {
      companyId: next.companyId,
      entityType: 'resolution_case',
      entityId: id,
      action: `resolution_case.${action}`,
      before: beforeRest,
      after: afterRest,
      detail: { fromRevision: current.revision, toRevision: next.revision },
      reason: reason ?? null,
      requestId,
    });
    await remember(tx, key, { id, revision: next.revision });
    return next;
  });
}

export type Lifecycle = Pick<ClauseVersion, 'id' | 'status' | 'effectiveDate' | 'version'>;
/**
 * The version of a lineage in force on `asAt`: the highest-numbered Published or Superseded
 * version whose effective date has arrived. Publishing a future-dated successor marks the
 * predecessor Superseded at once, but the predecessor stays in force until the successor's date.
 */
export function inForce<V extends Lifecycle>(lineage: V[], asAt: string): V | null {
  let best: V | null = null;
  for (const v of lineage)
    if (
      (v.status === 'Published' || v.status === 'Superseded') &&
      v.effectiveDate &&
      v.effectiveDate <= asAt &&
      (!best || v.version > best.version)
    )
      best = v;
  return best;
}
