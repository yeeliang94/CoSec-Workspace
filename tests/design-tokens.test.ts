import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const roots: string[] = [];
const checker = resolve('scripts/check-design-tokens.mjs');
function check(css: string) {
  const root = mkdtempSync(join(tmpdir(), 'cosec-design-'));
  roots.push(root);
  mkdirSync(join(root, 'src/app'), { recursive: true });
  writeFileSync(join(root, 'src/app/globals.css'), css);
  return spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8' });
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('design token quality gate', () => {
  it('rejects a self-referencing colour even when its consumers use token names', () => {
    const result = check(':root { --danger: var(--danger); }\n.error { color: var(--danger); }');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--danger → --danger');
  });

  it('rejects cycles through aliases', () => {
    const result = check(':root { --a: var(--b); --b: var(--c); --c: var(--a); }');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--a → --b → --c → --a');
  });

  it('accepts literal tokens and noncyclic aliases', () => {
    const result = check(':root { --danger: #a83230; --error: var(--danger); }');
    expect(result.status).toBe(0);
  });
});
