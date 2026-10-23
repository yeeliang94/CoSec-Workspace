import 'dotenv/config';
import mysql from 'mysql2/promise';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
/** Remove only the exact synthetic job created by this browser case; never reset the portfolio. */
export async function removeBrowserFixture(jobId: string) {
  if (!/^[0-9a-f-]{36}$/.test(jobId)) return;
  const c = await mysql.createConnection(process.env.DATABASE_URL!);
  const files: string[] = [];
  try {
    await c.beginTransaction();
    const [rows] = await c.query<mysql.RowDataPacket[]>(
      "SELECT data FROM documents WHERE JSON_UNQUOTE(JSON_EXTRACT(data,'$.jobId'))=?",
      [jobId],
    );
    for (const row of rows) {
      const doc = row.data as { id: string; storageKey: string };
      if (/^[0-9a-f-]{36}\.(txt|pdf|png|jpe?g)$/.test(doc.storageKey))
        files.push(path.resolve(process.env.STORAGE_DIR || '.local/storage', doc.storageKey));
      await c.execute('DELETE FROM audit_events WHERE subject_id=?', [doc.id]);
    }
    await c.execute("DELETE FROM reminders WHERE JSON_UNQUOTE(JSON_EXTRACT(data,'$.jobId'))=?", [
      jobId,
    ]);
    await c.execute(
      "DELETE FROM officer_events WHERE JSON_UNQUOTE(JSON_EXTRACT(data,'$.jobId'))=?",
      [jobId],
    );
    await c.execute("DELETE FROM documents WHERE JSON_UNQUOTE(JSON_EXTRACT(data,'$.jobId'))=?", [
      jobId,
    ]);
    await c.execute('DELETE FROM audit_events WHERE subject_id=?', [jobId]);
    await c.execute(
      "DELETE FROM mutation_requests WHERE JSON_UNQUOTE(JSON_EXTRACT(result,'$.id'))=?",
      [jobId],
    );
    await c.execute('DELETE FROM jobs WHERE id=?', [jobId]);
    await c.commit();
    for (const file of files) await unlink(file).catch(() => undefined);
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    await c.end();
  }
}
