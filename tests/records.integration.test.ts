import 'dotenv/config';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import { closeDatabase, db, writerDb } from '../src/server/db';
import * as s from '../src/server/schema';
import * as repo from '../src/server/repository';
import { defaultPreferences, type Actor, type Company } from '../src/domain/model';
const companyId = randomUUID(),
  docId = randomUUID();
const preparer: Actor = {
  id: randomUUID(),
  name: 'Opening preparer',
  email: `opening-${randomUUID()}@example.invalid`,
  capabilities: ['prepare_job', 'confirm_record'],
  companyIds: [companyId],
  preferences: defaultPreferences,
};
const reviewer: Actor = {
  ...preparer,
  id: randomUUID(),
  name: 'Opening reviewer',
  email: `opening-${randomUUID()}@example.invalid`,
};
const company: Company = {
  id: companyId,
  name: 'Opening review fictional Sdn. Bhd.',
  registrationNumber: randomUUID(),
  incorporationDate: '2020-01-01',
  financialYearEnd: '2026-12-31',
  legalStatus: 'Existing',
  engagementStatus: 'Active',
  address: 'Fictional',
  activity: 'Fictional',
  verification: 'Unverified',
  sourceEvidenceId: null,
  createdBy: preparer.id,
  revision: 1,
};
beforeAll(async () => {
  await writerDb.insert(s.companies).values({ id: companyId, data: company });
  for (const actor of [preparer, reviewer])
    await writerDb.insert(s.user).values({
      id: actor.id,
      name: actor.name,
      email: actor.email,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      capabilities: actor.capabilities,
      companyIds: actor.companyIds,
      preferences: actor.preferences,
      active: true,
    });
  await repo.insertDocument(preparer, {
    id: docId,
    companyId,
    jobId: null,
    title: 'Fictional opening source',
    originalName: 'source.txt',
    mimeType: 'text/plain',
    size: 1,
    sha256: '0'.repeat(64),
    storageKey: 'unused-test-fixture',
    createdBy: preparer.id,
    createdAt: new Date().toISOString(),
    classification: 'General',
  });
});
afterAll(async () => {
  await writerDb.delete(s.auditEvents).where(eq(s.auditEvents.companyId, companyId));
  await writerDb.delete(s.requests).where(like(s.requests.id, `${reviewer.id}:%`));
  await writerDb.delete(s.documents).where(eq(s.documents.companyId, companyId));
  await writerDb.delete(s.companies).where(eq(s.companies.id, companyId));
  await writerDb.delete(s.user).where(inArray(s.user.id, [preparer.id, reviewer.id]));
  closeDatabase();
});
it('reviews exact opening identity with source, independent actor, revision and idempotent audit', async () => {
  const input = {
    expectedRevision: 1,
    requestId: randomUUID(),
    sourceEvidenceId: docId,
    basis: 'Fictional opening source checked against exact identity',
  };
  await expect(repo.reviewOpening(preparer, companyId, input)).rejects.toThrow('independent');
  await expect(
    repo.reviewOpening({ ...reviewer, companyIds: [] }, companyId, input),
  ).rejects.toThrow('unavailable');
  const result = await repo.reviewOpening(reviewer, companyId, input);
  expect(result.verification).toBe('Reviewed');
  expect(result.name).toBe(company.name);
  expect(result.sourceEvidenceId).toBe(docId);
  expect(result.openingReview?.reviewerId).toBe(reviewer.id);
  expect(await repo.reviewOpening(reviewer, companyId, input)).toEqual(result);
  await expect(
    repo.reviewOpening(reviewer, companyId, { ...input, requestId: randomUUID() }),
  ).rejects.toThrow('changed');
  const audit = await db
    .select()
    .from(s.auditEvents)
    .where(eq(s.auditEvents.action, 'company.opening_review'));
  expect(audit.filter((e) => e.companyId === companyId)).toHaveLength(1);
});
