// Starts CoSec on this computer: prepares dependencies and the database when needed, then runs
// the web app and the reminder worker together and opens the browser. Ctrl+C stops both.
// Plain JavaScript with Node built-ins only, because it runs before dependencies are installed.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
  if (env.includes('BETTER_AUTH_URL=http://127.0.0.1:3000')) {
    writeFileSync('.env', env.replace('http://127.0.0.1:3000', URL));
    console.log(`Updated BETTER_AUTH_URL in .env to ${URL}.`);
  } else if (/^DATABASE_URL=mysql/m.test(env)) {
    console.error('.env is from the old MySQL setup. Delete it, then run this again.');
    process.exit(1);
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
const edited =
  head.status === 0 && git(['status', '--porcelain', '--untracked-files=no']).stdout.trim() !== '';
const marker = '.next/cosec-build-commit';
const built =
  existsSync('.next/BUILD_ID') && existsSync(marker) && readFileSync(marker, 'utf8') === commit;
if (!built || edited) {
  step('Building the app (first run or after an update; this takes a minute)');
  run('npm run build');
  writeFileSync(marker, commit);
}

step(`Starting CoSec at ${URL}`);
const children = ['start', 'worker'].map((script) =>
  spawn(`npm run ${script}`, { stdio: 'inherit', shell: true }),
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    // On Windows npm runs inside cmd.exe, so the whole process tree has to go.
    if (windows)
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  process.exit(code);
}
for (const child of children) child.once('exit', (code) => stop(code ?? 1));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

for (let i = 0; i < 120 && !stopping; i++) {
  if (await portInUse()) {
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
