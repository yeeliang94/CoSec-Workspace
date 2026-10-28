# SQLite migration plan

Prepared 28 October 2026 and carried out the same day on branch `build/sqlite`, which builds on PR #7. Results are in [VERIFICATION.md](VERIFICATION.md#sqlite-migration-28-october-2026).

**What changed from this plan when it was carried out:**

- **Driver.** The spike rejected libsql: once one save timed out under contention, that connection failed every later save. The app uses `better-sqlite3` instead. Its synchronous calls run inside the existing async transaction bodies through an in-process write queue (`transaction()` in `src/server/db.ts`), so no transaction needed rewriting as synchronous code.
- **Connections.** Each process holds one write connection and one read-only connection. A write attempted on the read connection fails at once. That is how stray writes were found.
- **Better Auth** writes sessions itself, so its route handler and `getSession` run through `exclusive()`, the same queue.
- **Timestamps** are stored as epoch milliseconds (`integer`, `timestamp_ms` mode), which the code reads as `Date`, the same as before. The audit page cursor now carries milliseconds.
- **Email uniqueness** uses a unique index on `lower(email)`.
- **Default output types**, which the old 0003 migration inserted, are part of the new baseline.
- **Old migration files** were removed rather than archived; git history keeps them.
- **The one-time upgrade scripts** (`migrate-people.ts`, `grant-resolution-capabilities.ts`) were ported but are only needed for older databases; the seed already does both.

It builds on the external assessment of 28 October ("SQLite feasibility for CoSec"). That assessment inspected an older worktree (`codex/resolution-handoff-docs` at `f620510`). This plan rechecks it against `main` at `114eaa2` plus open PR #7 (`build/local-workspace-app`), which is the code the migration will actually change.

## Verdict

**Feasible, with one go/no-go spike first.**

[ARCHITECTURE.md](../ARCHITECTURE.md) describes one shared application server, a web process plus a worker on the same host, and fewer than ten concurrent staff. That is within SQLite's normal range. Records are mostly typed JSON documents keyed by ID. The schema uses only basic column types: `varchar`, `text`, `int`, `boolean`, `json` and `timestamp`. It has no decimals, enums, generated columns or stored procedures.

The work is real but bounded. It concentrates in four places: transaction locking, about a dozen raw MySQL JSON/date expressions, error and result handling, and tooling. The one open question is the driver (see [Spike](#phase-1--driver-spike-go--no-go)). If the spike fails, stay on MySQL.

Keep MySQL if the deployment later needs more than one application host, or if measured simultaneous writes cause waits that staff notice.

## What the assessment got right

All of its main points hold. They are WAL mode, foreign keys and a busy timeout on every connection. Consequential changes and their audit events must commit together. Revision checks and request keys stay in place. The rewrites it names are needed: the JSON functions, `DATE_FORMAT`, `onDuplicateKeyUpdate`, `affectedRows` and `GET_LOCK`. Backups need the SQLite backup API, and slow work stays outside transactions. Its warning about synchronous drivers is also correct and important.

## Corrections and additions

| # | Finding | Why it matters |
| --- | --- | --- |
| 1 | **Scope is larger than stated.** Row locks (`.for('update')`, 36 uses) appear in 15 files, and `.for('share')` in 2 more. There are 34 `db.transaction(...)` call sites. | Sizing. Every call site moves to one shared write-transaction helper. |
| 2 | **Drizzle's libsql driver ignores the transaction mode.** `libsql/session.js` calls `client.transaction()` without passing `behavior`. The begin mode is whatever `@libsql/client` defaults to. | If that turns out to be `DEFERRED`, a transaction that reads first and writes later can fail immediately with `SQLITE_BUSY`, and the busy timeout does not retry it. The spike must confirm `BEGIN IMMEDIATE`. |
| 3 | **Same-process deadlock risk.** Local SQLite drivers wait for locks synchronously. Suppose one request holds the write lock across an `await` while another request in the same Node process blocks waiting for it. The holder then cannot resume until the wait times out. | In-process write transactions need an async queue (mutex), so only one runs at a time per process. The busy timeout then only has to cover web-versus-worker contention. |
| 4 | **Case-insensitive comparisons disappear.** The MySQL database uses `utf8mb4_0900_ai_ci`, so equality and `UNIQUE` ignore case and accents. SQLite compares exactly. | `user.email` uniqueness and any lookup on human-entered text could change behaviour. `users.ts` lowercases email on create. Better Auth's sign-in path and every other unique text key must be checked, adding `COLLATE NOCASE` where required. |
| 5 | **Timestamps come back as strings today.** The pool uses `dateStrings: true` and `timezone: 'Z'`, so reads return `'YYYY-MM-DD HH:MM:SS.mmm'` strings while writes pass `Date`. | The SQLite column mapping must reproduce the exact shape the code reads, or callers break silently. Audit pagination depends on millisecond ordering. |
| 6 | **Two tests deliberately hold a MySQL row lock** from a second connection (`tests/resolution-template.integration.test.ts:866`, `tests/e2e/record-fixture.ts:79`). E2E cleanup (`tests/e2e/cleanup.ts`) uses MySQL JSON SQL. | These need SQLite rewrites. A second connection holding `BEGIN IMMEDIATE` is the equivalent of the row lock. |
| 7 | **The data is fictional evaluation data** ([LOCAL_SETUP.md](LOCAL_SETUP.md), [VERIFICATION.md](VERIFICATION.md)). | A fresh seed may replace export/import. That is the owner's decision; see [Decisions](#decisions-needed). |

## Approach

- **Driver:** `@libsql/client` in local file mode (`file:.local/cosec.db`) with `drizzle-orm/libsql`. Drizzle 0.45.4 already ships this adapter. It keeps the existing async transaction bodies unchanged. `better-sqlite3` would mean rewriting all 34 transactions as synchronous code. Node's built-in `node:sqlite` has no Drizzle adapter in this version.
- **Concurrency model:** every write runs through one helper, `withWrite(fn)`. It joins an in-process queue, then opens a transaction that must begin `IMMEDIATE`. Inside, the code re-reads state, checks revision and request keys, writes, and appends audit records. While a write runs, the whole database is locked for other writers, which is stronger than today's row locks. So `.for('update')` is removed only once the helper is in place. Read-only paths that used `.for('share')` become plain reads, because WAL gives each read a consistent snapshot.
- **Replace, not dual-support.** Remove MySQL completely rather than supporting both, because every rule would otherwise need testing twice.
- **Branching:** the work starts after PR #7 merges, on a new branch from `main`. Doing it earlier would conflict with PR #7's people, audit and resolution changes.

## Phases

### Phase 0 — Baseline

1. Merge PR #7. Branch `build/sqlite` from `main`.
2. Run `typecheck`, `test`, `build` and `test:e2e` against MySQL. Record the pass/fail list in `docs/VERIFICATION.md` as the baseline to match.
3. Back up the MySQL database and `.local/storage` together, following [RECOVERY.md](RECOVERY.md).

### Phase 1 — Driver spike (go / no-go)

Write a small throwaway script outside `src/` to test the driver against a scratch database file. All of the following must pass:

1. **Settings on every connection.** `foreign_keys=ON`, `journal_mode=WAL` and `busy_timeout=5000` must hold on every connection libsql opens, including the fresh ones it opens after each transaction.
2. **Begin mode.** Transactions begin `IMMEDIATE`, checked by having a second process hold a write lock.
3. **Same process.** Two overlapping write transactions in one process both complete in order through the queue, with no stall and no `SQLITE_BUSY`.
4. **Two processes.** A web-like process and a worker-like process each write in a loop for 60 seconds. Report the wait times. Any `SQLITE_BUSY` must surface as a clean, retryable error rather than a crash.
5. **Rollback.** A thrown error inside the transaction rolls back both the record change and its audit row.
6. **Better Auth.** Better Auth with `provider: 'sqlite'` on the pinned version can sign in, keep the session alive, expire it and sign out against the SQLite user, session and account tables.
7. **Text matching.** Unique-key violations report as `SQLITE_CONSTRAINT_UNIQUE`, and `NOCASE` uniqueness rejects `A@x.test` after `a@x.test`.

**Go:** all seven pass. **No-go:** stop and keep MySQL; record why in ARCHITECTURE.md.

### Phase 2 — Connection layer

- Rewrite `src/server/db.ts`. It opens the libsql client, applies the settings, exports `db`, `Transaction` and `withWrite`, and makes the database path come from configuration (`DATABASE_URL=file:.local/cosec.db`).
- Add `isUniqueViolation(e)`. Use it in place of the `ER_DUP_ENTRY` checks in `http.ts`, `repository.ts` and `resolution/generation.ts`.
- Change `pruneRequests` (`repository.ts:108`) to read `rowsAffected`.
- Move all 34 `db.transaction(...)` call sites that write onto `withWrite`. Leave read-only ones as plain reads.

### Phase 3 — Schema and migrations

- Convert `src/server/schema.ts` to `sqlite-core`. Map types as follows:
  - `json` becomes `text({ mode: 'json' })`.
  - `boolean` becomes `integer({ mode: 'boolean' })`.
  - `timestamp(fsp:3)` becomes a text column in UTC millisecond form. It must match finding 5, with a custom type if needed.
  - `varchar` becomes `text`. The length limits move to the Zod validation, which already checks input.
  - Every index, unique index, foreign key and `onDelete: 'cascade'` stays as it is.
  - Add `COLLATE NOCASE` on email and any other human-entered unique text.
- Start a fresh migration history: archive the MySQL `migrations/` folder as `migrations-mysql/` and generate a single SQLite baseline `0000` with drizzle-kit.
- Rewrite `scripts/migrate.ts`. Apply migrations inside `BEGIN IMMEDIATE`, re-check `schema_migrations` under the lock, and keep the SHA-256 checksum protection. SQLite DDL is transactional, so a failed migration now rolls back cleanly. Update LOCAL_SETUP's warning about partial migrations.

### Phase 4 — MySQL-only SQL

| File | Change |
| --- | --- |
| `src/server/records/audit.ts` (7 expressions) | Rewrite each one: `JSON_UNQUOTE(JSON_EXTRACT(x,'$.k'))` becomes `json_extract(x,'$.k')`. `JSON_LENGTH` becomes `json_array_length`. `JSON_OVERLAPS` and `JSON_CONTAINS` become `EXISTS (SELECT 1 FROM json_each(...) WHERE value IN (...))`. `DATE_FORMAT` becomes `strftime('%Y-%m-%d %H:%M:%f', ...)`. Audit visibility and sensitive-data filtering are permission rules, so each one needs a positive and a negative test. |
| `src/server/records/scope.ts:70` | Change the `json_extract` expression. |
| `src/server/resolution/generation.ts:558,561` | Change the `json_extract` expression. Keep the `LIKE` behaviour as it is. |
| `record-store.ts`, `records/profile.ts`, `records/relationships.ts` | Change `onDuplicateKeyUpdate` to `onConflictDoUpdate({ target, set })`. |
| 15 files with `.for('update')`, 2 with `.for('share')` | Remove the locks once each call site runs inside `withWrite`. Do not remove the permission checks or revision checks around them. |
| `scripts/grant-resolution-capabilities.ts`, `scripts/migrate-people.ts` | Same lock and transaction treatment. |

### Phase 5 — Tooling and tests

- Delete `scripts/local-mysql.sh` and `npm run db:start` / `db:stop`. Rewrite `scripts/provision-local.ts` so it creates the `.local` folder and runs the migrations.
- Port the seeds (`scripts/seed.ts`, `seed-resolution-samples.ts`), the worker and the test fixtures.
- Integration tests use a throwaway database file for each run, so they never touch the dev database. Rewrite the two lock tests from finding 6 so the second connection holds `BEGIN IMMEDIATE`, and port the JSON SQL in `tests/e2e/cleanup.ts`.
- Add new tests:
  - A web and a worker process writing concurrently.
  - A busy timeout that expires and reports a retryable error.
  - Case-insensitive email uniqueness.
  - Timestamps keep their shape and ordering after a round trip.
  - Money and share amounts round-trip exactly.
- Remove `mysql2`. Add `@libsql/client` at an exact version and commit the lockfile.

### Phase 6 — Data

Pick one of these (see [Decisions](#decisions-needed)):

- **Reseed (recommended for fictional data):** build a new database from the seeds and check the document references in `.local/storage`.
- **Export/import:** write a one-off script that reads a consistent MySQL snapshot and inserts the data in dependency order. Then compare the copy with the original: row counts, IDs, JSON values, timestamps, foreign keys, account and password rows, request receipts and audit events. Also reconcile against `.local/storage`.

### Phase 7 — Documents and recovery

- Update [ARCHITECTURE.md](../ARCHITECTURE.md) with the database row, the reason for the switch and when to return to MySQL.
- Update [LOCAL_SETUP.md](LOCAL_SETUP.md) and `.env.example`.
- Rewrite [RECOVERY.md](RECOVERY.md). Take backups with `VACUUM INTO` or the backup API, never by copying a live `.db` file. Keep the database file and `STORAGE_DIR` together as one recoverable set, and rehearse a restore.
- Keep the database file out of git and out of synced folders. Add `.local/*.db*` to `.gitignore`.

### Phase 8 — Verification and cutover

1. Re-run the Phase 0 suite against SQLite. Every baseline pass must still pass.
2. Run the user paths in the browser:
   - Sign in, session expiry and sign out.
   - Company and beneficial-owner permission boundaries, using separate role accounts.
   - Audit filtering and export.
   - A stale edit is rejected and a double submit is ignored.
   - Approvals stay tied to immutable versions.
   - Share postings are atomic.
   - Document generation recovers after a forced render failure.
   - The worker runs reminder reconciliation while a user is saving.
3. Rehearse a restore from the Phase 7 backup.
4. Open a PR. Keep the MySQL backup until the owner signs off.

## Rollback

Until cutover, `main` still runs on MySQL. After cutover, roll back by reverting the PR and restoring the Phase 0 MySQL backup. Any data entered after cutover would be lost in a rollback unless it is exported. That is another reason to keep the first SQLite period on fictional data.

## Decisions needed

1. **Proceed?** ARCHITECTURE.md chose MySQL partly because it matches the owner's experience. Switching is the owner's call.
2. **Data:** reseed fresh fictional data (recommended), or export and import the current MySQL contents.
3. **MySQL afterwards:** remove it completely (recommended), or keep it as a supported option at the cost of running every test twice.
