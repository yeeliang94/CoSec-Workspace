/** One-time private .env and empty SQLite database. No existing file is overwritten. */
import { randomBytes } from 'node:crypto';
import { access, writeFile, mkdir } from 'node:fs/promises';
import { migrate } from './migrate';
await mkdir('.local', { recursive: true, mode: 0o700 });
try {
  await access('.env');
  throw new Error('.env already exists; preserve it and configure manually.');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
await writeFile(
  '.env',
  `DATABASE_PATH=.local/cosec.db\nBETTER_AUTH_SECRET=${randomBytes(40).toString('hex')}\nBETTER_AUTH_URL=http://127.0.0.1:4300\nSTORAGE_DIR=.local/storage\nNEXT_TELEMETRY_DISABLED=1\n`,
  { mode: 0o600, flag: 'wx' },
);
process.env.DATABASE_PATH = '.local/cosec.db';
await migrate();
console.log('Created a private .env and the local database. The session secret was not printed.');
