import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import { closeDatabase, writerDb } from '../src/server/db';
import * as tables from '../src/server/schema';
import { defaultPreferences, type Actor, type Company } from '../src/domain/model';
import { createJob } from '../src/server/workflows';
import { getActorById, getJob } from '../src/server/repository';
import { readUsers } from '../src/server/users';

const companyIds = [randomUUID(), randomUUID()];
const actor: Actor = {
  id: randomUUID(),
  name: 'Security regression executive',
  email: `security-${randomUUID()}@example.test`,
  companyIds,
  capabilities: ['prepare_job'],
  preferences: defaultPreferences,
};
const company = (id: string, index: number): Company => ({
  id,
  name: `Fictional scope regression ${index}`,
  registrationNumber: `SEC-${randomUUID()}`,
  incorporationDate: '2020-01-15',
  financialYearEnd: '2026-12-31',
  legalStatus: 'Existing',
  engagementStatus: 'Active',
  address: `Private scoped address ${index}`,
  activity: 'Private scoped activity',
  verification: 'Unverified',
  sourceEvidenceId: null,
  revision: 1,
});
const companyFixtures = companyIds.map(company);
const input = (companyId: string) => ({
  companyId,
  activity: 'W03' as const,
  ownerId: actor.id,
  year: 2026,
  anniversaryDate: '2026-01-15',
});

describe.skipIf(!process.env.DATABASE_URL)('scope regression security against MySQL', () => {
  beforeAll(async () => {
    const now = new Date();
    await writerDb.insert(tables.user).values({
      id: actor.id,
      name: actor.name,
      email: actor.email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
      capabilities: actor.capabilities,
      companyIds: actor.companyIds,
      preferences: actor.preferences,
      active: true,
    });
    for (const data of companyFixtures)
      await writerDb.insert(tables.companies).values({ id: data.id, data });
  });
  afterAll(async () => {
    await writerDb.delete(tables.reminders).where(inArray(tables.reminders.companyId, companyIds));
    await writerDb.delete(tables.jobs).where(inArray(tables.jobs.companyId, companyIds));
    await writerDb.delete(tables.requests).where(like(tables.requests.id, `${actor.id}:%`));
    await writerDb.delete(tables.auditEvents).where(eq(tables.auditEvents.actorId, actor.id));
    await writerDb.delete(tables.companies).where(inArray(tables.companies.id, companyIds));
    await writerDb.delete(tables.user).where(eq(tables.user.id, actor.id));
    closeDatabase();
  });
  it('does not replay an out-of-scope company snapshot when a creation request id is reused', async () => {
    const requestId = randomUUID();
    const first = await createJob(actor, input(companyIds[0]), requestId);
    const replay = await createJob(actor, input(companyIds[0]), requestId);
    expect(replay.id).toBe(first.id);
    // Simulate the authoritative scope update, then establish the fresh actor used on every request.
    await writerDb
      .update(tables.user)
      .set({ companyIds: [companyIds[1]], updatedAt: new Date() })
      .where(eq(tables.user.id, actor.id));
    const restricted = await getActorById(actor.id);
    expect(restricted?.companyIds).toEqual([companyIds[1]]);
    const second = await createJob(restricted!, input(companyIds[1]), requestId);
    expect(second.id).not.toBe(first.id);
    expect(second.companyId).toBe(companyIds[1]);
    expect(second.snapshot?.company.address).toBe(companyFixtures[1].address);
    await expect(createJob(restricted!, input(companyIds[0]), requestId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(getJob(restricted!, first.id)).rejects.toMatchObject({ status: 404 });
  });
  it('exposes only minimal company picker identities to an administrator without company scope', async () => {
    const admin = {
      ...actor,
      capabilities: ['manage_users'] as Actor['capabilities'],
      companyIds: [],
    };
    const result = await readUsers(admin);
    for (const record of result.companies)
      expect(Object.keys(record).sort()).toEqual(['id', 'name']);
    const selected = result.companies.find((item) => item.id === companyIds[0]);
    expect(selected).toEqual({ id: companyIds[0], name: companyFixtures[0].name });
    expect(JSON.stringify(result.companies)).not.toContain(companyFixtures[0].address);
  });
});
