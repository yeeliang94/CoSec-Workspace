import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from './schema';
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to the dedicated MySQL database.');
const globalDb = globalThis as unknown as { cosecPool?: mysql.Pool };
export const pool =
  globalDb.cosecPool ??
  mysql.createPool({
    uri: process.env.DATABASE_URL,
    connectionLimit: 8,
    timezone: 'Z',
    dateStrings: true,
  });
if (!globalDb.cosecPool)
  pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'");
  });
if (process.env.NODE_ENV !== 'production') globalDb.cosecPool = pool;
export const db = drizzle(pool, { schema, mode: 'default' });
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
