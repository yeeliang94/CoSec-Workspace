import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eq, like } from 'drizzle-orm';
import { closeDatabase, db, writerDb } from '../src/server/db';
import * as schema from '../src/server/schema';
import type { Actor, Company, Job } from '../src/domain/model';
import { defaultPreferences } from '../src/domain/model';
import {
  createJob,
  getActorById,
  getDocument,
  listDocuments,
  listReminders,
} from '../src/server/repository';
import { readDownload, storeUpload } from '../src/server/storage';
import { reconcileReminders, savePreferences } from '../src/server/support';

const actor: Actor = {
  id: randomUUID(),
  name: 'Support integration executive',
  email: `support-${randomUUID()}@example.test`,
  capabilities: ['prepare_job'],
  companyIds: [randomUUID()],
  preferences: defaultPreferences,
};
const outsider: Actor = { ...actor, id: randomUUID(), companyIds: [] };
const companyId = actor.companyIds[0];
const jobId = randomUUID();
let storageDirectory = '';
const previousStorage = process.env.STORAGE_DIR;
const company: Company = {
  id: companyId,
  name: 'Support integration fictional company',
  registrationNumber: `TEST-${randomUUID()}`,
  incorporationDate: '2020-10-22',
  financialYearEnd: '2026-12-31',
  legalStatus: 'Existing',
  engagementStatus: 'Active',
  address: 'Fictional',
  activity: 'Integration fixture',
  verification: 'Unverified',
  sourceEvidenceId: null,
  revision: 1,
};
const job: Job = {
  id: jobId,
  companyId,
  activity: 'W03',
  title: 'Support integration annual return',
  year: 2026,
  anniversaryDate: '2026-10-22',
  snapshot: { asAt: '2026-10-22', company, officers: [], capturedAt: new Date().toISOString() },
  route: null,
  personId: null,
  personName: null,
  effectiveDate: null,
  routeBasis: '',
  sourceEvidenceIds: [],
  recordEventId: null,
  ownerId: actor.id,
  createdBy: actor.id,
  state: 'Waiting on external information',
  revision: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  internalTarget: '2020-01-01',
  statutoryDue: null,
  manualDateBasis: '',
  manualDateEvidenceId: null,
  deadlineReviewRequired: false,
  ruleVersionId: null,
  dependencyIds: [],
  packs: [],
  reviews: [],
  correspondence: [
    {
      id: randomUUID(),
      direction: 'Outgoing',
      counterparty: 'Fictional client',
      channel: 'External email',
      date: '2020-01-01',
      summary: 'Fictional confirmation request',
      ownerId: actor.id,
      evidenceIds: [],
      nextChaseDate: '2020-01-08',
      respondedOn: null,
    },
  ],
  clientConfirmed: false,
  clientConfirmationEvidenceId: null,
  filingState: 'Not ready',
  filingNotRequiredReason: null,
  filingAttempts: [],
  billingState: 'Not ready',
  notes: [],
  history: [],
};

describe('support operations against SQLite', () => {
  beforeAll(async () => {
    storageDirectory = await mkdtemp(path.join(os.tmpdir(), 'cosec-support-db-'));
    process.env.STORAGE_DIR = storageDirectory;
    const now = new Date();
    await writerDb.insert(schema.user).values({
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
    await writerDb.insert(schema.companies).values({ id: companyId, data: company });
    await createJob(actor, job, randomUUID());
  });
  afterAll(async () => {
    await writerDb.delete(schema.documents).where(eq(schema.documents.companyId, companyId));
    await writerDb.delete(schema.reminders).where(eq(schema.reminders.companyId, companyId));
    await writerDb.delete(schema.jobs).where(eq(schema.jobs.companyId, companyId));
    await writerDb.delete(schema.auditEvents).where(eq(schema.auditEvents.actorId, actor.id));
    await writerDb.delete(schema.requests).where(like(schema.requests.id, `${actor.id}:%`));
    await writerDb.delete(schema.companies).where(eq(schema.companies.id, companyId));
    await writerDb.delete(schema.user).where(eq(schema.user.id, actor.id));
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
    if (previousStorage === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = previousStorage;
    closeDatabase();
  });
  it('atomically persists private file metadata and audit, enforces scope and detects tampering', async () => {
    const uploaded = await storeUpload(actor, {
      companyId,
      jobId,
      title: 'Fictional client evidence',
      file: new File(['Fictional DB integration evidence'], 'evidence.txt', { type: 'text/plain' }),
    });
    expect(uploaded).not.toHaveProperty('storageKey');
    const doc = await getDocument(actor, uploaded.id);
    const [audit] = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.subjectId, uploaded.id));
    expect(audit.action).toBe('document.stored');
    expect(audit.companyId).toBe(companyId);
    expect(audit.actorId).toBe(actor.id);
    const downloaded = await readDownload(actor, uploaded.id);
    expect(downloaded.bytes.toString()).toBe('Fictional DB integration evidence');
    await expect(readDownload(outsider, uploaded.id)).rejects.toMatchObject({ status: 404 });
    expect((await listDocuments(outsider)).some((item) => item.id === uploaded.id)).toBe(false);
    await writeFile(path.join(storageDirectory, doc.storageKey), 'tampered');
    await expect(readDownload(actor, uploaded.id)).rejects.toMatchObject({
      code: 'STORAGE',
      status: 503,
    });
  });
  it('reconstructs missed reminder occurrences repeatedly without duplicates or losing original creation timestamps', async () => {
    await reconcileReminders();
    const first = (await listReminders(actor)).filter((item) => item.jobId === jobId);
    expect(first.map((item) => item.kind).sort()).toEqual(['Client chase', 'Internal target']);
    expect(first.every((item) => item.dueDate < '2026-01-01')).toBe(true);
    await reconcileReminders();
    const second = (await listReminders(actor)).filter((item) => item.jobId === jobId);
    expect(
      second
        .map((item) => ({ id: item.id, createdAt: item.createdAt }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(
      first
        .map((item) => ({ id: item.id, createdAt: item.createdAt }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect((await listReminders(outsider)).some((item) => item.jobId === jobId)).toBe(false);
  });
  it('persists personal preferences without touching operational document settings', async () => {
    await savePreferences(actor, { textSize: 'larger', density: 'compact', reducedMotion: true });
    expect((await getActorById(actor.id))?.preferences).toEqual({
      textSize: 'larger',
      density: 'compact',
      reducedMotion: true,
    });
  });
});
