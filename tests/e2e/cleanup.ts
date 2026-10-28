import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { withDatabase } from './database';
/** Remove only the exact synthetic job created by this browser case; never reset the portfolio. */
export async function removeBrowserFixture(jobId: string) {
  if (!/^[0-9a-f-]{36}$/.test(jobId)) return;
  const files = withDatabase((db) => {
    const found: string[] = [];
    const rows = db
      .prepare("SELECT data FROM documents WHERE json_extract(data,'$.jobId')=?")
      .all(jobId) as { data: string }[];
    for (const row of rows) {
      const doc = JSON.parse(row.data) as { id: string; storageKey: string };
      if (/^[0-9a-f-]{36}\.(txt|pdf|png|jpe?g)$/.test(doc.storageKey))
        found.push(path.resolve(process.env.STORAGE_DIR || '.local/storage', doc.storageKey));
      db.prepare('DELETE FROM audit_events WHERE subject_id=?').run(doc.id);
    }
    for (const table of ['reminders', 'officer_events', 'documents'])
      db.prepare(`DELETE FROM ${table} WHERE json_extract(data,'$.jobId')=?`).run(jobId);
    db.prepare('DELETE FROM audit_events WHERE subject_id=?').run(jobId);
    db.prepare("DELETE FROM mutation_requests WHERE json_extract(result,'$.id')=?").run(jobId);
    db.prepare('DELETE FROM jobs WHERE id=?').run(jobId);
    return found;
  });
  for (const file of files) await unlink(file).catch(() => undefined);
}
