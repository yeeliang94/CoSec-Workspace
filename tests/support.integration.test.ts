import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eq, like } from 'drizzle-orm';
import { closeDatabase, db, writerDb } from '../src/server/db';
import * as schema from '../src/server/schema';
import type { Actor, Company } from '../src/domain/model';
import { defaultPreferences } from '../src/domain/model';
import { getActorById, getDocument, listDocuments } from '../src/server/repository';
import { readDownload, storeUpload } from '../src/server/storage';
import { savePreferences } from '../src/server/support';

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
  });
  afterAll(async () => {
    await writerDb.delete(schema.documents).where(eq(schema.documents.companyId, companyId));
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
  it('persists personal preferences without touching operational document settings', async () => {
    await savePreferences(actor, { textSize: 'larger', density: 'compact', reducedMotion: true });
    expect((await getActorById(actor.id))?.preferences).toEqual({
      textSize: 'larger',
      density: 'compact',
      reducedMotion: true,
    });
  });
});
