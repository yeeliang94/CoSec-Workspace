import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Capability, Company } from '../../src/domain/model';
import { withDatabase } from './database';
export async function createRecordFixture() {
  const companyId = randomUUID();
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
  const hashes = await Promise.all(accounts.map((a) => hashPassword(a.password)));
  withDatabase((db) => {
    const now = Date.now();
    db.prepare('INSERT INTO companies(id,data) VALUES(?,?)').run(
      companyId,
      JSON.stringify(company),
    );
    accounts.forEach((account, i) => {
      db.prepare(
        'INSERT INTO user(id,name,email,email_verified,created_at,updated_at,capabilities,company_ids,preferences,active) VALUES(?,?,?,1,?,?,?,?,?,1)',
      ).run(
        account.id,
        account.name,
        account.email,
        now,
        now,
        JSON.stringify(account.capabilities),
        JSON.stringify([companyId]),
        JSON.stringify({ textSize: 'default', density: 'comfortable', reducedMotion: false }),
      );
      db.prepare(
        "INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,'credential',?,?,?,?)",
      ).run(randomUUID(), account.id, account.id, hashes[i], now, now);
    });
  });
  return { companyId, preparer, reviewer, ordinary };
}
export type RecordFixture = Awaited<ReturnType<typeof createRecordFixture>>;
export async function removeRecordFixture(fixture: RecordFixture) {
  const files = withDatabase((db) => {
    const found: string[] = [];
    const documents = db
      .prepare('SELECT data FROM documents WHERE company_id=?')
      .all(fixture.companyId) as { data: string }[];
    for (const row of documents) {
      const storageKey = (JSON.parse(row.data) as { storageKey: string }).storageKey;
      if (/^[0-9a-f-]{36}\.(txt|pdf|png|jpe?g)$/.test(storageKey))
        found.push(path.resolve(process.env.STORAGE_DIR || '.local/storage', storageKey));
    }
    for (const table of [
      'reminders',
      'company_registers',
      'officer_events',
      'documents',
      'jobs',
      'audit_events',
    ])
      db.prepare(`DELETE FROM ${table} WHERE company_id=?`).run(fixture.companyId);
    for (const actor of [fixture.preparer, fixture.reviewer, fixture.ordinary]) {
      db.prepare('DELETE FROM mutation_requests WHERE id LIKE ?').run(actor.id + ':%');
      db.prepare('DELETE FROM audit_events WHERE actor_id=?').run(actor.id);
      db.prepare('DELETE FROM user WHERE id=?').run(actor.id);
    }
    db.prepare('DELETE FROM companies WHERE id=?').run(fixture.companyId);
    return found;
  });
  for (const file of files) await unlink(file).catch(() => undefined);
}
export async function saveInspectionFixture(fixture: RecordFixture) {
  await mkdir('.local/record-inspection', { recursive: true, mode: 0o700 });
  await writeFile('.local/record-inspection/accounts.json', JSON.stringify(fixture), {
    mode: 0o600,
  });
}
