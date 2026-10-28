import 'dotenv/config';
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
/**
 * Runs `fn` in one write transaction on the app's database, from the browser-test process.
 * The running app is another process, so SQLite's busy timeout makes each side wait its turn.
 */
export function withDatabase<T>(fn: (db: Database.Database) => T): T {
  const db = new Database(resolve(process.env.DATABASE_PATH ?? '.local/cosec.db'), {
    timeout: 5000,
  });
  try {
    db.pragma('foreign_keys = ON');
    return db.transaction(fn).immediate(db);
  } finally {
    db.close();
  }
}
