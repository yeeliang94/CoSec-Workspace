import 'dotenv/config';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Capability, Company } from '../../src/domain/model';
export async function createRecordFixture() {
  const companyId = randomUUID(),
    db = await mysql.createConnection(process.env.DATABASE_URL!);
  const account = (name: string, capabilities: Capability[]) => ({
    id: randomUUID(),
    name,
    email: `${randomUUID()}@example.invalid`,
    password: randomUUID() + '!Records1',
    capabilities,
  });
  const preparer = account('Fictional browser preparer', ['prepare_job', 'view_bo']),
    reviewer = account('Fictional browser reviewer', [
      'review_pack',
      'confirm_record',
      'record_filing',
      'view_bo',
    ]),
    ordinary = account('Fictional browser ordinary', ['prepare_job']);
  const accounts = [preparer, reviewer, ordinary];
  const company: Company = {
    id: companyId,
    name: 'Fictional browser register Sdn. Bhd.',
    registrationNumber: 'TEST-' + companyId,
    incorporationDate: '2020-10-01',
    financialYearEnd: '2026-12-31',
    legalStatus: 'Existing',
    engagementStatus: 'Active',
    address: 'Fictional browser address',
    activity: 'Fictional evaluation',
    verification: 'Unverified',
    sourceEvidenceId: null,
    revision: 1,
  };
  try {
    await db.beginTransaction();
    await db.execute('INSERT INTO companies(id,data) VALUES(?,?)', [
      companyId,
      JSON.stringify(company),
    ]);
    for (const account of accounts) {
      await db.execute(
        'INSERT INTO user(id,name,email,email_verified,created_at,updated_at,capabilities,company_ids,preferences,active) VALUES(?,?,?,true,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),?,?,?,true)',
        [
          account.id,
          account.name,
          account.email,
          JSON.stringify(account.capabilities),
          JSON.stringify([companyId]),
          JSON.stringify({ textSize: 'default', density: 'comfortable', reducedMotion: false }),
        ],
      );
      await db.execute(
        "INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,'credential',?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [randomUUID(), account.id, account.id, await hashPassword(account.password)],
      );
    }
    await db.commit();
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    await db.end();
  }
  return { companyId, preparer, reviewer, ordinary };
}
export type RecordFixture = Awaited<ReturnType<typeof createRecordFixture>>;
export async function removeRecordFixture(fixture: RecordFixture) {
  const db = await mysql.createConnection(process.env.DATABASE_URL!);
  const files: string[] = [];
  try {
    await db.beginTransaction();
    await db.execute('SELECT id FROM companies WHERE id=? FOR UPDATE', [fixture.companyId]);
    const [documents] = await db.query<mysql.RowDataPacket[]>(
      'SELECT data FROM documents WHERE company_id=?',
      [fixture.companyId],
    );
    for (const row of documents) {
      const storageKey = (row.data as { storageKey: string }).storageKey;
      if (/^[0-9a-f-]{36}\.(txt|pdf|png|jpe?g)$/.test(storageKey))
        files.push(path.resolve(process.env.STORAGE_DIR || '.local/storage', storageKey));
    }
    for (const table of [
      'reminders',
      'company_registers',
      'officer_events',
      'documents',
      'jobs',
      'audit_events',
    ])
      await db.execute(`DELETE FROM ${table} WHERE company_id=?`, [fixture.companyId]);
    for (const actor of [fixture.preparer, fixture.reviewer, fixture.ordinary]) {
      await db.execute('DELETE FROM mutation_requests WHERE id LIKE ?', [actor.id + ':%']);
      await db.execute('DELETE FROM audit_events WHERE actor_id=?', [actor.id]);
      await db.execute('DELETE FROM user WHERE id=?', [actor.id]);
    }
    await db.execute('DELETE FROM companies WHERE id=?', [fixture.companyId]);
    await db.commit();
    for (const file of files) await unlink(file).catch(() => undefined);
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    await db.end();
  }
}
export async function saveInspectionFixture(fixture: RecordFixture) {
  await mkdir('.local/record-inspection', { recursive: true, mode: 0o700 });
  await writeFile('.local/record-inspection/accounts.json', JSON.stringify(fixture), {
    mode: 0o600,
  });
}
