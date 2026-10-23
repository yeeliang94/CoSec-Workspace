import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { fileParallelism: false, include: ['tests/**/*.test.ts'], testTimeout: 30000 },
  // fileURLToPath decodes the path, so folders with spaces resolve correctly.
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
});
