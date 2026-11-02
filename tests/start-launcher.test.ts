import { afterEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const roots: string[] = [];
const launchers: ChildProcess[] = [];
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error('Launcher did not reach the expected state');
}
async function listening() {
  return new Promise<boolean>((resolve) => {
    const socket = connect(4300, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cosec-launcher-'));
  roots.push(root);
  for (const folder of ['scripts', 'bin', 'node_modules', '.next']) mkdirSync(join(root, folder));
  copyFileSync(resolve('scripts/start.mjs'), join(root, 'scripts/start.mjs'));
  writeFileSync(join(root, 'package-lock.json'), '{}');
  writeFileSync(join(root, 'node_modules/.package-lock.json'), '{}');
  writeFileSync(join(root, '.env'), 'BETTER_AUTH_URL=http://127.0.0.1:4300\n');
  writeFileSync(
    join(root, '.gitignore'),
    'node_modules/\n.next/\n.env\nbin/\ncommands\npids\ndev-types-at-build\n',
  );
  writeFileSync(
    join(root, 'bin/npm'),
    `#!${process.execPath}
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const command = process.argv.slice(2).join(' ');
fs.appendFileSync('commands', command + '\\n');
if (process.env.CHECK_WEB_STORAGE) {
  let storage;
  try { storage = typeof globalThis.localStorage; } catch { storage = 'unavailable'; }
  fs.appendFileSync('storage-checks', JSON.stringify({ command, storage, options: process.env.NODE_OPTIONS }) + '\\n');
}
if (command === 'run build') {
  fs.writeFileSync('dev-types-at-build', fs.existsSync('.next/dev/types/validator.ts') ? 'present' : 'missing');
  fs.mkdirSync('.next', { recursive: true });
  fs.writeFileSync('.next/BUILD_ID', 'fixture');
}
if (command === 'run start' || command === 'run worker') {
  const code = command === 'run start'
    ? "require('node:net').createServer().listen(4300, '127.0.0.1')"
    : "setInterval(() => {}, 1000)";
  const child = spawn(process.execPath, ['-e', code], { stdio: 'ignore' });
  fs.appendFileSync('pids', child.pid + '\\n');
  setInterval(() => {}, 1000);
  if (command === 'run worker' && process.env.FAIL_WORKER) setTimeout(() => process.exit(7), 1500);
}
`,
    { mode: 0o755 },
  );
  for (const name of ['npx', 'open', 'xdg-open'])
    writeFileSync(join(root, 'bin', name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Fixture');
  return { root, git };
}
function launch(root: string, extraEnv = {}) {
  const child = spawn(process.execPath, ['scripts/start.mjs'], {
    cwd: root,
    env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, ...extraEnv },
    stdio: 'ignore',
  });
  launchers.push(child);
  return child;
}
async function stop(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM') {
  child.kill(signal);
  await waitFor(() => child.exitCode !== null || child.signalCode !== null);
}
afterEach(async () => {
  for (const child of launchers.splice(0))
    if (child.exitCode === null && child.signalCode === null) await stop(child);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// The fixture uses POSIX executables and process groups. Windows needs a native smoke test.
describe.skipIf(process.platform === 'win32')('one-step launcher', () => {
  it('disables server Web Storage for setup, app and worker while preserving other Node options', async () => {
    const { root } = fixture();
    const child = launch(root, {
      CHECK_WEB_STORAGE: '1',
      NODE_OPTIONS: '--experimental-webstorage --trace-warnings',
    });
    await waitFor(listening);
    await stop(child);
    const checks = readFileSync(join(root, 'storage-checks'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(checks.map((check) => check.command)).toEqual(
      expect.arrayContaining([
        'run db:migrate',
        'run db:seed',
        'run build',
        'run start',
        'run worker',
      ]),
    );
    for (const check of checks) {
      expect(check.storage).toBe('undefined');
      expect(check.options).toContain('--trace-warnings');
    }
  });

  it('rejects MySQL settings before rewriting the old auth URL or migrating', async () => {
    const { root } = fixture();
    const settings =
      'DATABASE_URL="mysql://localhost/old"\nBETTER_AUTH_URL=http://127.0.0.1:3000\n';
    writeFileSync(join(root, '.env'), settings);
    const child = launch(root);
    await waitFor(() => child.exitCode !== null);
    expect(child.exitCode).toBe(1);
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe(settings);
    expect(() => readFileSync(join(root, 'commands'))).toThrow();
  });

  it.each(['SIGTERM', 'SIGHUP'] as const)(
    'stops the full web and worker trees on %s',
    async (signal) => {
      expect(await listening()).toBe(false);
      const { root } = fixture();
      const child = launch(root);
      await waitFor(listening);
      await stop(child, signal);
      expect(await listening()).toBe(false);
      const pids = readFileSync(join(root, 'pids'), 'utf8').trim().split('\n').map(Number);
      for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
    },
  );

  it('stops the web tree and preserves failure status when the worker exits', async () => {
    const { root } = fixture();
    const child = launch(root, { FAIL_WORKER: '1' });
    await waitFor(listening);
    await waitFor(() => child.exitCode !== null);
    expect(child.exitCode).toBe(7);
    expect(await listening()).toBe(false);
  });

  it('removes leftover development route types before building', async () => {
    const { root } = fixture();
    mkdirSync(join(root, '.next/dev/types'), { recursive: true });
    mkdirSync(join(root, '.next/dev/cache'), { recursive: true });
    writeFileSync(join(root, '.next/dev/types/validator.ts'), 'import "./deleted-route.js";\n');
    writeFileSync(join(root, '.next/dev/cache/entry'), 'kept');
    const child = launch(root);
    await waitFor(listening);
    await stop(child);
    expect(readFileSync(join(root, 'dev-types-at-build'), 'utf8')).toBe('missing');
    expect(readFileSync(join(root, '.next/dev/cache/entry'), 'utf8')).toBe('kept');
  });

  it('rebuilds after reverting a dirty build and when adding untracked source', async () => {
    const { root, git } = fixture();
    const builds = () =>
      readFileSync(join(root, 'commands'), 'utf8')
        .split('\n')
        .filter((line) => line === 'run build').length;
    const cycle = async () => {
      const child = launch(root);
      await waitFor(listening);
      // Let readiness polling finish before shutting down.
      await delay(1100);
      await stop(child);
    };
    await cycle();
    expect(builds()).toBe(1);
    await cycle();
    expect(builds()).toBe(1);
    writeFileSync(
      join(root, 'scripts/start.mjs'),
      readFileSync(join(root, 'scripts/start.mjs'), 'utf8') + '\n// edit\n',
    );
    await cycle();
    expect(builds()).toBe(2);
    git('restore', 'scripts/start.mjs');
    await cycle();
    expect(builds()).toBe(3);
    writeFileSync(join(root, 'new-route.ts'), 'export {};\n');
    await cycle();
    expect(builds()).toBe(4);
  });
});
