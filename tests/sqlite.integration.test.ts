import 'dotenv/config';
import { afterAll, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import {
  closeDatabase,
  databasePath,
  db,
  readSnapshot,
  transaction,
  writerDb,
} from '../src/server/db';
import { isBusy, isUniqueViolation } from '../src/server/db-errors';
import * as s from '../src/server/schema';
import { defaultPreferences } from '../src/domain/model';

const userIds: string[] = [];
afterAll(async () => {
  await writerDb.delete(s.user).where(inArray(s.user.id, userIds));
  closeDatabase();
});

/** Another process (like the reminder worker) holding the write lock for `ms`. */
function holdWriteLock(ms: number) {
  const child = spawn(
    process.execPath,
    [
      '-e',
      `const D = require('better-sqlite3');
       const c = new D(process.argv[1]);
       c.exec('BEGIN IMMEDIATE');
       console.log('locked');
       setTimeout(() => { c.exec('COMMIT'); c.close(); }, ${ms});`,
      databasePath,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const locked = new Promise<void>((resolve, reject) => {
    child.stdout.on('data', (d: Buffer) => d.toString().includes('locked') && resolve());
    child.on('exit', (code) => reject(new Error(`lock holder exited early (${code})`)));
  });
  const done = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  return { locked, done };
}
function user(email: string) {
  const id = randomUUID();
  userIds.push(id);
  const now = new Date();
  return {
    id,
    name: 'Fictional SQLite check',
    email,
    createdAt: now,
    updatedAt: now,
    capabilities: [],
    companyIds: [],
    preferences: defaultPreferences,
  };
}

it('waits for another process to release the write lock, then commits', async () => {
  const holder = holdWriteLock(400);
  await holder.locked;
  const started = Date.now();
  const row = user(`wait-${randomUUID()}@example.test`);
  await transaction((tx) => tx.insert(s.user).values(row));
  expect(Date.now() - started).toBeGreaterThanOrEqual(300);
  expect(await db.select().from(s.user).where(eq(s.user.id, row.id))).toHaveLength(1);
  await holder.done;
});

it('reports a busy database as retryable when the lock outlasts the timeout', async () => {
  const holder = holdWriteLock(6500);
  await holder.locked;
  const error = await transaction((tx) =>
    tx.insert(s.user).values(user(`busy-${randomUUID()}@example.test`)),
  ).catch((e: unknown) => e);
  expect(isBusy(error)).toBe(true);
  await holder.done;
  // The connection is usable again once the other process lets go.
  await transaction((tx) => tx.insert(s.user).values(user(`after-${randomUUID()}@example.test`)));
}, 20000);

it('serialises overlapping writes in one process without losing updates', async () => {
  const row = user(`count-${randomUUID()}@example.test`);
  await transaction((tx) => tx.insert(s.user).values({ ...row, name: '0' }));
  await Promise.all(
    Array.from({ length: 10 }, () =>
      transaction(async (tx) => {
        const [u] = await tx.select().from(s.user).where(eq(s.user.id, row.id));
        await new Promise((resolve) => setTimeout(resolve, 5));
        await tx
          .update(s.user)
          .set({ name: String(Number(u.name) + 1) })
          .where(eq(s.user.id, row.id));
      }),
    ),
  );
  const [u] = await db.select().from(s.user).where(eq(s.user.id, row.id));
  expect(u.name).toBe('10');
});

it('keeps transactions and auth-style writes isolated across module reloads', async () => {
  vi.resetModules();
  const reloaded = await import('../src/server/db');
  const original = user(`reload-rollback-${randomUUID()}@example.test`);
  const saved = user(`reload-save-${randomUUID()}@example.test`);
  const session = user(`reload-auth-${randomUUID()}@example.test`);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const ready = new Promise<void>((resolve) => (started = resolve));
  const first = transaction(async (tx) => {
    await tx.insert(s.user).values(original);
    started();
    await gate;
    throw new Error('rollback before reload');
  });
  const rolledBack = expect(first).rejects.toThrow('rollback before reload');
  await ready;
  let entered = false;
  const second = reloaded.transaction(async (tx) => {
    entered = true;
    await tx.insert(s.user).values(saved);
  });
  const authWrite = reloaded.exclusive(async () => {
    expect(reloaded.connections.writer.inTransaction).toBe(false);
    await reloaded.writerDb.insert(s.user).values(session);
  });
  // Attach handlers before yielding so broken serialization cannot cause an unhandled rejection.
  const writes = Promise.allSettled([second, authWrite]);
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(entered).toBe(false);
  } finally {
    release();
    await rolledBack;
  }
  expect((await writes).map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
  const rows = await db
    .select()
    .from(s.user)
    .where(inArray(s.user.id, [original.id, saved.id, session.id]));
  expect(rows.map((r) => r.id).sort()).toEqual([saved.id, session.id].sort());
  await expect(transaction(() => reloaded.transaction(async () => undefined))).rejects.toThrow(
    'already in progress',
  );
});

it('rolls back every write when the transaction fails, and refuses nested transactions', async () => {
  const row = user(`rollback-${randomUUID()}@example.test`);
  await expect(
    transaction(async (tx) => {
      await tx.insert(s.user).values(row);
      throw new Error('fictional failure');
    }),
  ).rejects.toThrow('fictional failure');
  expect(await db.select().from(s.user).where(eq(s.user.id, row.id))).toHaveLength(0);
  await expect(transaction(() => transaction(async () => undefined))).rejects.toThrow(
    'already in progress',
  );
});

it('keeps one account per email address regardless of case', async () => {
  const email = `case-${randomUUID()}@example.test`;
  await transaction((tx) => tx.insert(s.user).values(user(email)));
  const error = await transaction((tx) =>
    tx.insert(s.user).values(user(email.toUpperCase())),
  ).catch((e: unknown) => e);
  expect(isUniqueViolation(error)).toBe(true);
});

it('refuses writes on the read connection', async () => {
  await expect(
    db.insert(s.user).values(user(`readonly-${randomUUID()}@example.test`)),
  ).rejects.toThrow('readonly');
});

it('round-trips timestamps to the millisecond in UTC', async () => {
  const row = {
    ...user(`time-${randomUUID()}@example.test`),
    createdAt: new Date('2026-10-28T23:59:59.123Z'),
  };
  await transaction((tx) => tx.insert(s.user).values(row));
  const [u] = await db.select().from(s.user).where(eq(s.user.id, row.id));
  expect(u.createdAt.toISOString()).toBe('2026-10-28T23:59:59.123Z');
});

it('keeps independent read snapshots stable while writers and other readers proceed', async () => {
  const row = user(`snapshot-${randomUUID()}@example.test`);
  await transaction((tx) => tx.insert(s.user).values({ ...row, name: 'before' }));
  await readSnapshot(async (snapshot) => {
    const read = async () => (await snapshot.select().from(s.user).where(eq(s.user.id, row.id)))[0];
    expect((await read()).name).toBe('before');
    await transaction((tx) =>
      tx.update(s.user).set({ name: 'after' }).where(eq(s.user.id, row.id)),
    );
    await readSnapshot(async (other) => {
      const [latest] = await other.select().from(s.user).where(eq(s.user.id, row.id));
      expect(latest.name).toBe('after');
    });
    expect((await read()).name).toBe('before');
    await expect(
      snapshot.insert(s.user).values(user(`forbidden-${randomUUID()}@example.test`)),
    ).rejects.toThrow('readonly');
  });
  await expect(
    readSnapshot(async () => {
      throw new Error('read failed');
    }),
  ).rejects.toThrow('read failed');
  await readSnapshot(async (snapshot) => {
    const [latest] = await snapshot.select().from(s.user).where(eq(s.user.id, row.id));
    expect(latest.name).toBe('after');
  });
});
