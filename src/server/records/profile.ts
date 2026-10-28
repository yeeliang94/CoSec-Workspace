import { eq } from 'drizzle-orm';
import { db, transaction, type Transaction } from '../db';
import * as s from '../schema';
import { prior, remember, requestKey } from '../repository';
import { auditChange } from '../resolution/shared';
import { appendCustomValue } from './custom-fields';
import { assertAny, lockCompany } from './scope';
import { assertCompany, DomainError } from '../../domain/access';
import type { Actor } from '../../domain/model';
import type { CitationKey, CompanyProfile } from '../../domain/resolution/model';

export const emptyProfile = (companyId: string): CompanyProfile => ({
  companyId,
  revision: 0,
  citations: {},
  customValues: {},
});

export async function readProfile(companyId: string, tx?: Transaction) {
  const query = (tx ?? db)
    .select()
    .from(s.companyProfiles)
    .where(eq(s.companyProfiles.companyId, companyId));
  const [row] = await query;
  return row?.data ?? emptyProfile(companyId);
}

export async function getProfile(actor: Actor, companyId: string) {
  assertCompany(actor, companyId);
  return readProfile(companyId);
}

export type ProfileInput = { expectedRevision: number; requestId: string; reason: string } & (
  | { action: 'set_citation'; key: CitationKey; value: string; effectiveDate: string }
  | { action: 'set_custom'; definitionId: string; value: unknown; effectiveDate: string }
);

/**
 * Dated company particulars kept beside the immutable companies row. Each change appends a
 * dated value, so an as-at read before the effective date still returns the earlier value.
 */
export async function changeProfile(actor: Actor, companyId: string, input: ProfileInput) {
  assertCompany(actor, companyId);
  assertAny(actor, ['confirm_record', 'manage_people']);
  const key = requestKey(actor, `profile:${companyId}`, input.requestId);
  return transaction(async (tx) => {
    await lockCompany(companyId, tx);
    const before = await readProfile(companyId, tx);
    if (await prior(tx, key)) return before;
    if (before.revision !== input.expectedRevision)
      throw new DomainError('The company profile changed. Refresh and try again.', 'STALE', 409);
    const next = structuredClone(before);
    if (input.action === 'set_citation') {
      const value = input.value.trim();
      if (!value) throw new DomainError('Enter the constitution citation.');
      next.citations[input.key] = [
        ...(before.citations[input.key] ?? []),
        {
          value,
          effectiveDate: input.effectiveDate,
          recordedAt: new Date().toISOString(),
          actorId: actor.id,
          reason: input.reason.trim(),
        },
      ];
    } else
      next.customValues = await appendCustomValue(actor, before.customValues, input, 'company', tx);
    next.revision = before.revision + 1;
    await tx
      .insert(s.companyProfiles)
      .values({ companyId, revision: next.revision, data: next })
      .onConflictDoUpdate({
        target: s.companyProfiles.companyId,
        set: { revision: next.revision, data: next },
      });
    await auditChange(tx, actor, {
      companyId,
      entityType: 'company_profile',
      entityId: companyId,
      action: `company_profile.${input.action}`,
      before,
      after: next,
      reason: input.reason,
      requestId: input.requestId,
      detail: {
        fromRevision: before.revision,
        toRevision: next.revision,
        key: input.action === 'set_citation' ? input.key : input.definitionId,
        effectiveDate: input.effectiveDate,
      },
    });
    await remember(tx, key, { id: companyId, revision: next.revision });
    return next;
  });
}
