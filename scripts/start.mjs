// Starts CoSec on this computer: prepares dependencies and the database when needed, then runs
// the web app and the reminder worker together and opens the browser. Ctrl+C stops both.
// Plain JavaScript with Node built-ins only, because it runs before dependencies are installed.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = 'http://127.0.0.1:4300';
const PORT = 4300;
const windows = process.platform === 'win32';
process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..'));

function step(message) {
  console.log(`\n== ${message}`);
}
function run(command) {
  const result = spawnSync(command, { stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error(`\n"${command}" failed. CoSec was not started.`);
    process.exit(1);
  }
}
function portInUse() {
  return new Promise((resolve) => {
    const socket = connect(PORT, '127.0.0.1');
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
  });
}

if (await portInUse()) {
  console.error(`Port ${PORT} is already in use. CoSec may already be running: open ${URL}`);
  process.exit(1);
}

// npm records the installed set in node_modules/.package-lock.json; reinstall after a pull
// changes package-lock.json.
const installed = 'node_modules/.package-lock.json';
if (!existsSync(installed) || statSync('package-lock.json').mtimeMs > statSync(installed).mtimeMs) {
  step('Installing dependencies (first run or after an update)');
  run('npm ci');
}

if (!existsSync('.env')) {
  step('Creating private settings and the database');
  run('npm run db:provision');
} else {
  // Settings created before the move to port 4300 would make every sign-in fail.
  const env = readFileSync('.env', 'utf8');
  if (/^\s*DATABASE_URL\s*=\s*['\"]?mysql(?:2)?:/m.test(env)) {
    console.error('.env is from the old MySQL setup. Delete it, then run this again.');
    process.exit(1);
  }
  if (env.includes('BETTER_AUTH_URL=http://127.0.0.1:3000')) {
    writeFileSync('.env', env.replace('http://127.0.0.1:3000', URL));
    console.log(`Updated BETTER_AUTH_URL in .env to ${URL}.`);
  }
}

step('Updating the database');
run('npm run db:migrate');
run('npm run db:seed');
run('npx tsx scripts/seed-resolution-samples.ts');

// Staff use the faster production build. Rebuild when the code has changed since the last
// build: a different commit, or uncommitted edits. Without git, build only once.
const git = (args) => spawnSync('git', args, { encoding: 'utf8' });
const head = git(['rev-parse', 'HEAD']);
const commit = head.status === 0 ? head.stdout.trim() : 'no-git';
const edited = head.status === 0 && git(['status', '--porcelain']).stdout.trim() !== '';
const marker = '.next/cosec-build-commit';
const built =
  existsSync('.next/BUILD_ID') && existsSync(marker) && readFileSync(marker, 'utf8') === commit;
if (!built || edited) {
  // Invalidate before building too: a failed build must never retain a reusable marker.
  rmSync(marker, { force: true });
  step('Building the app (first run or after an update; this takes a minute)');
  run('npm run build');
  // A dirty build cannot be reused after its source edits are reverted.
  writeFileSync(marker, edited ? 'dirty' : commit);
}

step(`Starting CoSec at ${URL}`);
const children = ['start', 'worker'].map((script) =>
  spawn(`npm run ${script}`, { stdio: 'inherit', shell: true, detached: !windows }),
);
let stopping = false;
function signalGroup(child, signal) {
  if (!child.pid) return;
  try {
    // The shell may have exited while its descendants are still running.
    process.kill(-child.pid, signal);
  } catch (error) {
    // macOS can report EPERM for a group containing only unreaped zombies.
    if (!['ESRCH', 'EPERM'].includes(error.code)) throw error;
  }
}
function groupAlive(child) {
  if (!child.pid) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if (['ESRCH', 'EPERM'].includes(error.code)) return false;
    throw error;
  }
}
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (windows) {
      if (child.pid)
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else signalGroup(child, 'SIGTERM');
  }
  if (!windows) {
    const deadline = Date.now() + 5000;
    while (children.some(groupAlive) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    for (const child of children) signalGroup(child, 'SIGKILL');
  }
  process.exit(code);
}
for (const child of children) {
  child.once('exit', (code) => void stop(code ?? 1));
  child.once('error', (error) => {
    console.error(`Could not start CoSec: ${error.message}`);
    void stop(1);
  });
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => void stop(0));

let ready = false;
for (let i = 0; i < 120 && !stopping; i++) {
  if (await portInUse()) {
    ready = true;
    const opener = windows
      ? `start "" ${URL}`
      : process.platform === 'darwin'
        ? `open ${URL}`
        : `xdg-open ${URL}`;
    spawn(opener, { shell: true, stdio: 'ignore' });
    console.log(`\nCoSec is running at ${URL}. Sign-in details are in .local/ACCOUNTS.md.`);
    console.log('Press Ctrl+C, or close this window, to stop it.');
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

if (!ready && !stopping) {
  console.error('CoSec did not become ready within two minutes. Stopping the app and worker.');
  await stop(1);
}
