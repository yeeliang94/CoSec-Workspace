import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import mysql from 'mysql2/promise';
const db = await mysql.createConnection({
  uri: process.env.DATABASE_URL,
  multipleStatements: false,
});
try {
  await db.execute(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(255) PRIMARY KEY, checksum VARCHAR(64) NOT NULL, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB',
  );
  const [lock] = await db.query("SELECT GET_LOCK('cosec_schema_migrate', 20) AS acquired");
  if ((lock as { acquired: number }[])[0]?.acquired !== 1)
    throw new Error('Migration lock unavailable');
  for (const name of (await readdir('migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = await readFile(`migrations/${name}`, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const [rows] = await db.execute('SELECT checksum FROM schema_migrations WHERE name=?', [name]);
    const old = (rows as { checksum: string }[])[0];
    if (old) {
      if (old.checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
      continue;
    }
    for (const statement of sql
      .split('--> statement-breakpoint')
      .map((t) => t.trim())
      .filter(Boolean))
      await db.query(statement);
    await db.execute('INSERT INTO schema_migrations(name,checksum) VALUES(?,?)', [name, checksum]);
    console.log(`Applied ${name}`);
  }
} finally {
  await db.query("SELECT RELEASE_LOCK('cosec_schema_migrate')");
  await db.end();
}
