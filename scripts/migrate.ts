import 'dotenv/config';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

// Applies checksum-tracked SQL files in order. Each file runs in one IMMEDIATE transaction, so a
// failed migration leaves no partial schema, and a second migrator waits rather than racing.
export async function migrate(path = resolve(process.env.DATABASE_PATH ?? '.local/cosec.db')) {
  await mkdir(dirname(path), { recursive: true });
  const db = new Database(path, { timeout: 20000 });
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    );
    for (const name of (await readdir('migrations')).filter((n) => n.endsWith('.sql')).sort()) {
      const sql = await readFile(`migrations/${name}`, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      db.exec('BEGIN IMMEDIATE');
      try {
        // Re-checked under the write lock in case another migrator applied it meanwhile.
        const old = db.prepare('SELECT checksum FROM schema_migrations WHERE name=?').get(name) as
          { checksum: string } | undefined;
        if (old) {
          if (old.checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
          db.exec('COMMIT');
          continue;
        }
        for (const statement of sql
          .split('--> statement-breakpoint')
          .map((t) => t.trim())
          .filter(Boolean))
          db.exec(statement);
        db.prepare('INSERT INTO schema_migrations(name,checksum) VALUES(?,?)').run(name, checksum);
        db.exec('COMMIT');
        console.log(`Applied ${name}`);
      } catch (error) {
        if (db.inTransaction) db.exec('ROLLBACK');
        throw error;
      }
    }
    const problems = db.pragma('foreign_key_check') as unknown[];
    if (problems.length) throw new Error(`Foreign key check failed: ${problems.length} rows`);
  } finally {
    db.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await migrate();
