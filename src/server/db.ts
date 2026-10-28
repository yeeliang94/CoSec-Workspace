import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

// One SQLite file per deployment, on local disk next to the web process and worker.
// Each process holds one write connection and one read-only connection. Writes go through
// `transaction`, which queues them so only one runs per process; across processes SQLite's
// write lock and busy timeout serialise them. The read connection sees committed data only.
// Runtime data belongs to the deployment host, never to Next.js's deployment file trace.
export const databasePath = resolve(
  /* turbopackIgnore: true */ process.env.DATABASE_PATH ?? '.local/cosec.db',
);
const BUSY_TIMEOUT_MS = 5000;

function open(readonly: boolean) {
  const connection = new Database(databasePath, { readonly, timeout: BUSY_TIMEOUT_MS });
  if (!readonly) connection.pragma('journal_mode = WAL');
  connection.pragma('foreign_keys = ON');
  connection.pragma('synchronous = NORMAL');
  return connection;
}
type Connections = {
  writer: Database.Database;
  reader: Database.Database;
  queued: AsyncLocalStorage<true>;
  tail: Promise<unknown>;
};
const globalDb = globalThis as unknown as { cosecSqlite?: Connections };
function connect(): Connections {
  mkdirSync(dirname(databasePath), { recursive: true });
  // The writer opens first so the WAL files exist before the read-only connection needs them.
  const writer = open(false);
  return {
    writer,
    reader: open(true),
    queued: new AsyncLocalStorage<true>(),
    tail: Promise.resolve(),
  };
}
export const connections = globalDb.cosecSqlite ?? connect();
if (process.env.NODE_ENV !== 'production') globalDb.cosecSqlite = connections;

/** Read-only. Writes must go through `transaction`; a write here fails immediately. */
export const db = drizzle(connections.reader, { schema });
/**
 * The write connection outside any transaction. Use it only inside `exclusive`, or in scripts
 * and test fixtures that run on their own: a write here while a queued transaction is open
 * would join that transaction.
 */
export const writerDb = drizzle(connections.writer, { schema });
export type Transaction = BetterSQLite3Database<typeof schema>;

// The driver is synchronous, so a second connection waiting for the write lock would block the
// event loop that the lock holder needs to finish. Queuing every write in-process avoids that.
// Queue ownership follows the cached connections across development module reloads.
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  if (connections.queued.getStore())
    throw new Error('A write is already in progress here; pass its `tx` instead.');
  const run = connections.tail.then(() => connections.queued.run(true, fn));
  connections.tail = run.catch(() => undefined);
  return run;
}
/**
 * Runs `fn` in one write transaction (`BEGIN IMMEDIATE`), after any earlier write in this
 * process has finished. Everything `fn` reads through `tx` is current and locked against other
 * writers until commit. Keep slow work (rendering, file I/O) outside.
 */
export function transaction<T>(fn: (tx: Transaction) => Promise<T> | T): Promise<T> {
  return enqueue(async () => {
    connections.writer.exec('BEGIN IMMEDIATE');
    try {
      const result = await fn(writerDb);
      connections.writer.exec('COMMIT');
      return result;
    } catch (error) {
      if (connections.writer.inTransaction) connections.writer.exec('ROLLBACK');
      throw error;
    }
  });
}
/** Runs `fn` with sole use of `writerDb` in autocommit mode, for code that manages its own writes. */
export function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  return enqueue(fn);
}

export function closeDatabase() {
  connections.reader.close();
  connections.writer.close();
  delete globalDb.cosecSqlite;
}
