# Local milestone verification — 22 October 2026

## Review corrections — 23 October 2026

Returned readiness decisions now retain authority query/rejection state, and unanswered authority messages block readiness independently of the filing label. Returning a manual-date approval restores the independent date-review requirement while retaining the operative date and its history. Service regressions cover blocked readiness, recording the response, resubmission and renewed manual-date approval.

Company creation visibility now matches the server's `manage_users` permission. Opening-company edits participate in discard protection, including Close form. Changing an upload's company requires confirmation for unsaved evidence and resets the title/file after discard. Browser Back/Forward preserves drafts when navigation is cancelled; native skip-link history entries retain the router state needed for the same protection.

Verification: all 75 service/integration tests and 14 production-browser tests passed, alongside strict TypeScript, production build, formatting and diff-whitespace checks. The five added browser cases exercise cancellation and confirmed discard, repeated Back/Forward, native fragment history, upload context reset, and administrator/preparer visibility. Independent workflow and UI reviews approved the fixes. The live-use limits recorded below still apply.

Fictional-data evaluation on the owner's Apple silicon Mac, Node 24.11.1 and isolated MySQL Community 8.4.11 at localhost:3307. The official archive checksum matches the published MD5. The app runs at localhost:3000; document bytes and generated staff credentials are private ignored local files. Original source brief and prototype remain unchanged. Existing owner design/specification changes were preserved.

## Checks run

| Check | Result and scope |
| --- | --- |
| `npm run typecheck` | Passed strict TypeScript, unused locals and unused parameters |
| `npm test` | 66 tests in nine files passed, including 20 real MySQL integration cases; remaining tests exercise workflow/support services with isolated repositories |
| `npm run build` | Production compilation, TypeScript, page generation and route build passed without warnings |
| `npm run test:e2e` | Passed all nine actual-browser cases against the production server in installed Google Chrome (including a dedicated layout regression case); fixtures clean up their exact generated jobs/documents |
| `npm run format:check` | All application source/config/scripts/tests checked by Prettier |
| `npm audit` | Zero reported vulnerabilities after replacing the affected development esbuild transitive dependency through a targeted override; migration generation/build/tests verified |
| Migration replay | Applied checksum-verified SQL, then reran without reapplying; no destructive reset |
| Reminder process restart | Stopped and restarted the worker; persisted occurrences reconciled with stable IDs. Tests assert unchanged creation times and no duplicate ledger entries |
| Visual inspection | Work at 1440/1280/768/390/320; job and settings at desktop/mobile, larger text and reduced motion. Screenshots inspected from ignored `.local/previews/` and `.local/ui-review/` |
| Impeccable source detector | Returned no findings over app/components during UI completion; final small focus/dirty-guard refinements were browser checked |

## Observed user paths

1. Real password login; role/company-scoped work queues, searches, counts, detail, mutations and private downloads. Zero-scope account administrator sees no company work and only minimal company-picker identity. No role-switch bypass exists.
2. W03 creation, unique company/year conflict with retained values, historical anniversary snapshot and future anniversary capture restriction. Upload, immutable pack revision, checklist/client evidence, review request and independent exact-version review work through the browser.
3. W04 prepared route, exact-version pack/manual-date/record decisions, execution evidence, independently posted dated appointment, readiness, manual external submission and separate actual-wording outcome work through the browser. Posting does not imply filing completion; outcome does not automatically close the job. Database tests also cover resignation, future-effective appointments and unsafe backdated history guards.
4. Query/rejection preserves attempts; all authority messages need individual response evidence before renewed readiness/resubmission. Missing evidence, partial execution, self-approval, stale revisions, duplicate period races, cross-scope access and transactional rollback are tested.
5. Material pack revision invalidates relevant review/readiness. A director event affecting an open anniversary snapshot atomically flags its consequence; refresh archives the exact earlier snapshot/pack link and demands new output, client confirmation and review. Filed history cannot be silently revised.
6. Internal preparation/chase settings affect new work; explicit existing dates stay retained. Proposed replacement statutory dates leave the operative date until independent source review. A reasoned evidenced not-required assessment can resolve filing applicability without inventing a deadline.
7. Work URL filters, returning focus and list context survive job inspection. Browser tests check cancelled navigation/sign-out retains plain inputs and rich notes, while confirmed discard changes sections. Larger-text/reduced-motion preferences persist across reload and reset.
8. No remote requests were observed from the tested application pages; system fonts/assets and business operations work without runtime external services. Development dependency downloads remain separate.

## Review fixes

The independent five-axis pass identified and resolved cross-company idempotency-cache scope, excessive administrator company metadata, returned reviews resetting submitted/confirmed filings, cancellation stranding dated obligations, prematurely hidden authority-response reminders and unused operational defaults. Regression tests were added. Final integration also enforced UTC database sessions, protected rich/plain unsaved edits, and split large UI sections. Fictional fixture timestamp storage was corrected once to preserve its intended UTC values before handoff.

## Honest limits and live-use gates

These checks are not a full WCAG/security audit, performance benchmark or restored-backup rehearsal. Ordinary content reflows at 320 CSS pixels; larger text, keyboard navigation and reduced-motion settings were checked. A representative workbench was also inspected at actual 200% Chrome zoom with no horizontal overflow, then restored to 100%. Target office hardware/team usability and comprehensive zoom coverage still need the owner walkthrough.

No approved legal rules, deadlines, templates or posting routes ship. Runtime catalogue publication records internal review; legal approval remains a practising-secretary decision. Annual snapshots structure identity/address/activity/directors and, for newly captured snapshots, reviewed member/capital positions; earlier snapshots remain unchanged. W05 member/capital transactions and W06 capability-restricted BO records are implemented as described below. Broader corporate actions, restricted ID/compliance handling, external BO disclosure releases, malware scanning, Office-format fidelity, actual opening-data migration and production retention/holds are not delivered.

Leap-day anniversaries and corrections affecting filed snapshots stop with a specific specialist-route blocker. Real statutory operation needs approved sources/versions and representative exception validation. Shared deployment additionally needs HTTPS, production credential/recovery policy, coordinated backup destination/retention and successful recovery rehearsal. [RECOVERY.md](RECOVERY.md) describes the coordinated database-plus-attachment procedure; it is not a claim that a restore was completed.

The design preview sidecar predates the approved DESIGN.md edits. DESIGN.md governed this implementation; refreshing that optional preview metadata can be done separately through Impeccable document. No unrelated design metadata was rewritten.

Final handoff retains six fictional companies and the original six seeded jobs; synthetic browser fixtures were removed. The application, MySQL and reminder worker are running locally. A separate development-mode login smoke also returned HTTP 200 without the earlier reload churn after removing redundant runtime environment-file loading.

## Live browser inspection follow-up

Interactive inspection in the in-app browser and installed Chrome covered credential login, empty search and clear filters, annual-return blockers and correspondence, director preparation, historical officer views, private evidence downloads, and settings draft discard. Desktop (1440), tablet (768), mobile (390), narrow layout (320), larger-text preview and actual Chrome 200% zoom were inspected. Screenshots are in ignored `.local/browser-audit/`. Browser confirmation automation stalled in the in-app browser; native Chrome controls completed the discard check. No display preference was saved during this inspection.

Two defects were found and fixed: opening-history events without a real job now link to authorized source evidence instead of a nonexistent job; discarding a personal display preview restores saved display classes. Company detail also takes its current identity from the refreshed workspace data. Both fixes have browser regression assertions; the full browser suite passed again, alongside all 50 service/integration tests, strict typecheck and production build.

## Spacing and concise-copy pass

The next interactive pass inspected the workbench, company lists and opening form, company file, case overview/checklist/documents/filing/record changes, personal and user settings, documents, calendar, and review/billing empty states. Representative screenshots at 1440, 768, 390 and 320 CSS pixels are in ignored `.local/spacing-audit/`.

Shared fixes separate company identity from header actions; align section headings with controls; standardize section/form/action gaps; remove stacked checklist/upload margins and redundant section separators; constrain checkbox dimensions; align case tab content and state columns; keep staff statuses, dates and sizes intact; stack the officer date control on phones; and constrain the sign-in card to its narrow viewport. Routine captions/help copy were removed from sign-in, the navigation footer, work defaults, empty preparation notes and annual-record guidance. Labels, actionable errors, evidence blockers, source/version information and consequential confirmations remain.

The layout regression checks actual rendered geometry for identity, headings, tab content, checkbox dimensions, form footer gaps, staff status wrapping and page overflow, including the sign-in card at 390 and 320 pixels. Strict typecheck, all 50 service/integration tests, the six-case browser suite and production build passed during this pass. Impeccable's layout scan reported no findings; rendered inspection identified the issues above that the scan did not catch.

## Members, capital and beneficial ownership extension

W05 browser paths cover opening balances, exact before/after totals, independent pack and record review, posting, a transfer blocked with one of two signatures missing, completed 40/60 transfer, cancelled/source/replacement certificates, and an allotment into a new share class. Posting leaves filing Not ready. Whole share units and capital amounts up to two decimal places are supported; multi-source transfers and specialist corporate actions need further routes.

W06 browser paths cover restricted evidence upload, an outstanding notice, reply, sourced criteria/ownership assessment, independent exact-version review and dated register posting. An unsaved assessment survives a notice save. Ordinary users cannot see BO sections, jobs or documents; direct mutation/download/register routes deny access. BO entry/review/cessation, future effectiveness, discrepancy resolution, escalation, active-posted review reminders and cancellation guards are also covered by database tests.

The independent review found and resolved cached creation after BO capability revocation, restricted evidence linkage into general workflows, stale concurrent idempotency reads, exact record-proposal history retention, re-review after posted-output revision, aggregate capital overflow, and reminder lifecycle issues. No remaining material correctness/security blocker was identified in the final read-only pass.

Manual in-app-browser inspection used a separately scoped fictional company with two members and a BO entry, including the 30 September view before 1 October effectiveness, overdue BO follow-up, tablet/mobile/narrow reflow, keyboard access, and the Larger text plus reduced-motion preferences at 390 pixels. Preferences were reset and the test account signed out. An ordinary fixture account was also checked interactively: its work count, company file and documents excluded BO work/evidence. Screenshots are in ignored `.local/record-previews/`. Test logins reuse actual issued sessions to avoid unnecessary repeated password attempts; the application's production rate limiter is unchanged. Earlier W03/W04/layout/navigation/access tests remain in the nine-case browser suite.

SSM source indexes were checked on 22 October 2026; no legal threshold or response deadline is inferred from share percentages. Each assessment records its criteria/source version, notices and evidence. Existing staff accounts receive no new BO permission automatically; an administrator must explicitly assign `view_bo`. The evaluation build remains subject to the live-use gates above.

Final extension cleanup confirmed six companies, six original jobs and six original staff accounts; no synthetic company registers remain. Temporary credential files and fixture attachments were removed, the browser viewport override was reset, and the updated worker restarted successfully with seven persisted reminder occurrences. The production application and isolated MySQL remain running locally.

## SQLite migration (28 October 2026)

The database moved from MySQL 8.4 to one SQLite file through `better-sqlite3` 13.0.3 (SQLite 3.53.4); plan and decisions are in [SQLITE_MIGRATION_PLAN.md](SQLITE_MIGRATION_PLAN.md). The owner chose a fresh fictional seed and full removal of MySQL. The final MySQL dump, document files and account list are kept privately in `.local/backups/mysql-final-20261028/`.

| Check | MySQL baseline (before) | SQLite (after) |
| --- | --- | --- |
| `npm run typecheck` | clean | clean |
| `npm test` | 157 tests in 15 files passed | 164 tests in 16 files passed (157 existing plus 7 new SQLite checks) |
| `npm run build` | passed | passed |
| `npm run test:e2e` | 27 passed | 27 passed, with the reminder worker running against the same database |
| `npm run format:check` | — | clean |

The new SQLite checks cover: a second process holding the write lock (the app waits, then commits); a lock held past the five-second timeout (a retryable busy error, and the connection recovers); ten overlapping writes in one process with no lost update; rollback of every write on failure; refusal of nested transactions; one account per email regardless of case; refusal of writes on the read connection; and millisecond UTC timestamp round trips. The documented backup command (`VACUUM INTO`) was run against the seeded database and the copy passed `PRAGMA integrity_check`.

A driver spike rejected `@libsql/client` 0.18.0: when one save timed out under contention, that connection kept failing every later save. `better-sqlite3` recovered from the same test with no lost updates.

Not yet done: a full restore rehearsal from a backup, and measured contention under real staff use. Both remain release gates, as before.

### SQLite review fixes (28 October 2026)

The database connections now retain their write queue and nested-write guard across development module reloads. A regression test holds a transaction open across a reload, queues another transaction and an auth-style autocommit write, and verifies that rolling back the first save preserves both later writes. People search explicitly declares its SQLite escape character, with regression cases for literal underscores, percent signs and backslashes, including the creator visibility boundary.

Runtime database paths are excluded from Turbopack tracing, and local data/storage directories are excluded from deployment traces. The production build no longer emits the whole-project tracing warning; all 58 generated trace manifests were checked and contained no database, private-storage or environment files. The server external-package configuration now names `better-sqlite3`.

Verification: all 168 tests in 16 files passed; type checking, the production build and formatting checks passed. Browser tests were not rerun for these server changes.

### Greptile follow-up (28 October 2026)

All three findings on PR #8 were reproduced and fixed. With `DATABASE_URL` empty, the old MySQL gates skipped 27 integration cases; those gates are removed, so every group runs against the automatically provisioned SQLite test database. Relationship and resolution-context reads now use independent read-only WAL snapshots, retaining a consistent view while saves proceed. Generation stages private DOCX bytes before reserving the write lock, then rechecks `Pending` and atomically records the document metadata, generation state and audit. Unused staged bytes are removed after reconciliation or transaction failure.

Regression checks exercise both actual read callers while a save holds the write lock, stable independent snapshots across a concurrent update, an unrelated database save during file staging, reconciliation during staging, and rollback after a forced finalisation-audit failure. `DATABASE_URL= npm test` passed all 173 tests in 16 files with no skipped tests. Type checking, production build, formatting and diff-whitespace checks passed. Browser tests were not rerun for this server-only follow-up; the restore and real-staff contention release gates above remain open.
