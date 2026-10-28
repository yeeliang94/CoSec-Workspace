# Local evaluation

Requires Node 24 LTS (present on this Mac) and npm. The database is one SQLite file opened by the app and worker through `better-sqlite3`; there is no database server to install or start. No runtime internet calls are required. Dependencies install during development; fonts use the approved operating-system sans serif stack. Browser talks only to Next.js.

## This workspace

The database is `.local/cosec.db` (with its `-wal` and `-shm` companions while in use), set by `DATABASE_PATH`. `.local` is ignored by git; keep it off synced folders such as iCloud Drive or Dropbox, which can corrupt a live SQLite file. The session secret is in `.env`; never commit it. Generated staff passwords are in `.local/ACCOUNTS.md` (private).

The previous MySQL data, its document files and its account list are kept in `.local/backups/mysql-final-20261028/` for reference. The standalone MySQL runtime in `.local/mysql` is no longer used.

Run `start.bat` (Windows) or `./start.sh` (macOS) to prepare and start everything in production mode; see the README. For development:

```sh
npm run dev
# In another terminal, while the host runs:
npm run worker
```

Open [local workspace](http://127.0.0.1:4300). Sign in with `owner@cosec.local` and its password from `.local/ACCOUNTS.md`. Owner has explicitly granted professional capabilities in this fictional fixture; independent review still prevents approving a version you prepared. Use Aina's executive account to prepare, Daniel's reviewer account to review/post and Mei's lodger account to record external filing evidence. Sign out and sign in normally for each identity. `admin` has account administration only; `limited` sees only one company.

The owner account can create companies, then explicitly grant preparers/reviewers/lodgers company access in Settings → Users. New companies start Unverified. Existing fixture opening appointments are labelled fictional, with evidence; do not treat them as approved live data.

## Fresh installation

1. Install dependencies using `npm ci`. The project `.npmrc` turns off install scripts, so `better-sqlite3` uses its bundled build for your platform and no C++ build tools (Xcode, Visual Studio) are needed. npm would otherwise compile it from source, despite its `"gypfile": false`.
2. `npm run db:provision` writes a private `.env` with a random session secret and creates the empty database. It refuses to replace an existing `.env`; a copy from the MySQL era (with `DATABASE_URL`) should be deleted first. Alternatively copy `.env.example` to `.env` and fill the secret (at least 32 characters). Use `BETTER_AUTH_URL` matching the browser URL. Do not point the seed at live client data.
3. `npm run db:migrate` applies checksum-tracked SQL. Each migration runs in one transaction, so a failed migration leaves no partial schema. Back up before future migrations all the same.
4. `npm run db:seed` populates fictional fixtures only when no users exist. It does not erase data. It writes unique random passwords to `.local/ACCOUNTS.md`.
5. Run the app and worker as above. For production-mode local testing, run `npm run build`, then `npm start` (stop the dev process first).
6. Optionally, `npx tsx scripts/seed-resolution-samples.ts` adds the fictional sample clauses and resolution assemblies.

## Verification

`npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`. Integration tests create and migrate their own throwaway database at `.local/test/cosec-test.db` on every run; they never touch `.local/cosec.db`. Playwright uses the installed Google Chrome (`channel: chrome`) and the generated local account file, with app running at 127.0.0.1:4300. Test output/traces stay ignored and may contain fictional entered values.

## Runtime and recovery

The app and worker must run on the same machine as the database file. Each process queues its own writes; across the two, SQLite lets one write at a time and the other waits up to five seconds. A save that still cannot get in returns "The workspace is busy" and can be retried. Reads never wait for writes.

Every job change updates its company's reminders in the same transaction. The worker also sweeps every company every 60 seconds to catch date-driven changes, and prunes duplicate-submission records older than 30 days. Workspace reads never write. Host downtime prevents processing while off. Overdue dates survive and reappear at restart. Reconciliation is eventually consistent; no external notification or client message is sent. Stop services before coordinated backups; see [RECOVERY.md](RECOVERY.md). Do not copy only database metadata or only attachments.

## Evaluation limits

This is a local first build for fictional-data validation. No legal rules/templates, statutory deadlines or posting route is approved by this build. Published catalogue text records internal version review, not legal verification. Statutory dates require evidenced independent manual review; no deadline engine invents rules. Internal template output is illustrative text, not regulator-compatible filing output. Leap-day anniversary exceptions and backdated director changes affecting filed snapshots are blocked pending a reviewed consequence/correction route.

The build handles General and capability-restricted BO job evidence. BO access must be explicitly assigned in Settings → Users (`view_bo`); it is not added to existing accounts. W05 supports opening balances, allotments and transfers; W06 supports sourced notices/assessments and dated register entries. Restricted identity/compliance handling, external BO disclosure releases, malware scanning, real opening-record imports, broader corporate actions, production recovery/retention/holds, password recovery policy and shared-server HTTPS remain release gates. Do not put live sensitive evidence into this evaluation database. W01–W12 later delivery is tracked in IMPLEMENTATION_PLAN.md.
