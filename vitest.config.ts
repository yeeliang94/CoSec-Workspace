import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { migrate } from './scripts/migrate';
// Integration tests use their own database, recreated and migrated at the start of every run.
const databasePath = resolve('.local/test/cosec-test.db');
export default defineConfig(async () => {
  for (const suffix of ['', '-wal', '-shm']) await rm(databasePath + suffix, { force: true });
  await migrate(databasePath);
  return {
    test: {
      fileParallelism: false,
      include: ['tests/**/*.test.ts'],
      testTimeout: 30000,
      env: { DATABASE_PATH: databasePath },
    },
    // fileURLToPath decodes the path, so folders with spaces resolve correctly.
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  };
});
