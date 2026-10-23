# Local evaluation

Requires Node 24 LTS (present on this Mac), npm and MySQL 8.4 LTS. No runtime internet calls are required. Dependencies install during development; fonts use the approved operating-system sans serif stack. Browser talks only to Next.js; MySQL binds to localhost.

## This workspace

An isolated MySQL 8.4.11 runtime is in ignored `.local/mysql`, with data in `.local/mysql-data`, socket `.local/mysql.sock`, port **3307**. It does not replace an existing database or register a system service. Archive downloaded from [Oracle MySQL Community Server](https://dev.mysql.com/downloads/mysql/8.4.html); published archive MD5 `6e89113f04f2af85d0a164573493db3a`. Root password is private in `.local/mysql-root-password`. Application credentials and session secret are in `.env`; never commit either. Generated staff passwords are in `.local/ACCOUNTS.md` (private).

```sh
npm run db:start
npm run dev
# In another terminal, while the host runs:
npm run worker
```

Open [local workspace](http://127.0.0.1:3000). Sign in with `owner@cosec.local` and its password from `.local/ACCOUNTS.md`. Owner has explicitly granted professional capabilities in this fictional fixture; independent review still prevents approving a version you prepared. Use Aina's executive account to prepare, Daniel's reviewer account to review/post and Mei's lodger account to record external filing evidence. Sign out and sign in normally for each identity. `admin` has account administration only; `limited` sees only one company.

The owner account can create companies, then explicitly grant preparers/reviewers/lodgers company access in Settings → Users. New companies start Unverified. Existing fixture opening appointments are labelled fictional, with evidence; do not treat them as approved live data.

## Fresh installation

1. Install dependencies using `npm ci`.
2. Use an existing **empty dedicated** MySQL database and scoped application user; copy `.env.example` to `.env` and fill credentials and a random session secret (at least 32 characters). Use `BETTER_AUTH_URL` matching the browser URL. Do not point the seed at live client data.
3. `npm run db:migrate` applies checksum-tracked SQL. MySQL DDL is not transactional; back up before future migrations, inspect SQL, and investigate partial failures before retrying.
4. `npm run db:seed` populates fictional fixtures only when no users exist. It does not erase data. It writes unique random passwords to `.local/ACCOUNTS.md`.
5. Run the app and worker as above. For production-mode local testing, run `npm run build`, then `npm start` (stop the dev process first).

On Apple silicon macOS, an alternative to a system MySQL installation is the official standalone archive. Extract it as `.local/mysql`, then initialise only a new `.local/mysql-data` using `mysqld --no-defaults --initialize-insecure --basedir="$PWD/.local/mysql" --datadir="$PWD/.local/mysql-data"`. Start with `npm run db:start`, then run `npx tsx scripts/provision-local.ts` **once** to create the database and random passwords. That script refuses to replace `.env` or an existing database. The initially passwordless root is local socket only during this short provisioning step; the provisioner immediately sets a generated root password. Use the exact compatible official architecture/version, validate the download, and retain its licence files.

## Verification

`npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`. MySQL integration tests require the configured dedicated fictional evaluation DB and create/clean their own fixtures; they never truncate tables. Playwright uses the installed Google Chrome (`channel: chrome`) and the generated local account file, with app running at 127.0.0.1:3000. Test output/traces stay ignored and may contain fictional entered values.

## Runtime and recovery

Every job change updates its company's reminders in the same transaction. The worker also sweeps every company every 60 seconds to catch date-driven changes, and prunes duplicate-submission records older than 30 days. Workspace reads never write. Host downtime prevents processing while off. Overdue dates survive and reappear at restart. Reconciliation is eventually consistent; no external notification or client message is sent. Stop services before coordinated backups; see [RECOVERY.md](RECOVERY.md). Do not copy only database metadata or only attachments.

## Evaluation limits

This is a local first build for fictional-data validation. No legal rules/templates, statutory deadlines or posting route is approved by this build. Published catalogue text records internal version review, not legal verification. Statutory dates require evidenced independent manual review; no deadline engine invents rules. Internal template output is illustrative text, not regulator-compatible filing output. Leap-day anniversary exceptions and backdated director changes affecting filed snapshots are blocked pending a reviewed consequence/correction route.

The build handles General and capability-restricted BO job evidence. BO access must be explicitly assigned in Settings → Users (`view_bo`); it is not added to existing accounts. W05 supports opening balances, allotments and transfers; W06 supports sourced notices/assessments and dated register entries. Restricted identity/compliance handling, external BO disclosure releases, malware scanning, real opening-record imports, broader corporate actions, production recovery/retention/holds, password recovery policy and shared-server HTTPS remain release gates. Do not put live sensitive evidence into this evaluation database. W01–W12 later delivery is tracked in IMPLEMENTATION_PLAN.md.
