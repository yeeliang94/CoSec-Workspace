# CoSec Workspace

The [resolution builder](RESOLUTION_BUILDER_IMPLEMENTATION_PLAN.md) is implemented for fictional-data evaluation: in-app standard wording (clauses) and layouts (assemblies), people and dated company relationships, resolutions prepared on one page with optional colleague review and direct completion by the preparer, generated question forms, native Word (.docx) generation with immutable history, and scoped before/after audit. Status per milestone, evidence and open gaps are in [docs/RESOLUTION_BUILDER_PROGRESS.md](docs/RESOLUTION_BUILDER_PROGRESS.md). Sample clause wording is fictional, not approved legal precedent.

On 1 November 2026 the owner narrowed the app to resolution preparation. The job-based workflows — annual returns (W03), director-change jobs (W04), members/share capital/transfers (W05), beneficial ownership (W06), filing tracking, billing handoff, reminders and the work queue — were removed from the app. Directors are recorded directly on the company; resolution member lists come from the people a company records with the member role. On start-up, holders from the old share register are carried into dated member records. Existing membership dates are preserved; only uncovered dates are added, and a permanent audit receipt prevents later restarts from undoing edits. Earlier rows in the `jobs`, `reminders` and `company_registers` tables are left untouched in the database file but are no longer read; earlier beneficial-ownership evidence and audit entries stay hidden. Companies, people, documents, settings and the audit log remain.

The database is a single SQLite file, `.local/cosec.db`; no database server is needed.

To run it, double-click `start.bat` on Windows, or run `./start.sh` on macOS or Linux. Node 24 LTS must be installed. The script installs dependencies, creates the private settings and database with fictional data, builds the app when the code has changed, then starts the app and the background worker (it tidies interrupted document generations) and opens the browser. Ctrl+C or closing the window stops both.

Background maintenance runs quietly every minute; actual errors and interrupted document generations remain visible in the terminal.

The one-step launcher disables Node's unused server-side Web Storage feature to prevent `localStorage` availability warnings. Browser storage is unaffected; other Node warnings remain enabled.

The same steps by hand, using development mode:

```sh
npm ci
npm run db:provision   # first time only: private .env and empty database
npm run db:migrate
npm run db:migrate-members   # copies old share-register holders into company members (safe to re-run)
npm run db:seed        # fictional companies and staff, only into an empty database
npx tsx scripts/seed-resolution-samples.ts
npm run dev
# Another terminal:
npm run worker
```

Open [CoSec Workspace](http://127.0.0.1:4300). Generated fictional staff credentials are saved privately in `.local/ACCOUNTS.md`. See [local setup](docs/LOCAL_SETUP.md), [implementation plan](IMPLEMENTATION_PLAN.md), [recovery procedure](docs/RECOVERY.md) and [verification evidence](docs/VERIFICATION.md). No approved statutory rules or filing templates are bundled; this build is for fictional-data evaluation.

[DESIGN.md](DESIGN.md) remains the approved Option A visual authority. [DESIGN_SPEC.md](DESIGN_SPEC.md) and the unchanged [original brief](references/product-brief.docx) define the broader product. The other W01–W12 workflows are out of scope for now. Accounts have one of two roles, Admin or User, set in Settings → Users. See the [records scope](docs/COMPANY_RECORDS_PLAN.md).

## Design reference

The dependency-free [prototype](prototype/index.html) is retained as a disposable design reference. Normal use presents A; archived B/C explorations remain behind `?explore=1&variant=B|C`. Its role selector and in-memory state are unrelated to the application's actual authentication and persistence.

## Git and GitHub

This project is stored in `~/Desktop/Cosec Workspace` and has a local Git repository on branch `main`. The original working folder is retained separately.

The design sources, prototype, source brief and before/after screenshots are tracked. Application changes may remain uncommitted during local implementation. The ZIP download is retained in the folder and excluded from Git because it duplicates the editable files.

To publish later, create an empty GitHub repository without an initial README, license or gitignore, then connect its URL as the `origin` remote and push `main`. No remote is configured yet. The repository includes the original product brief; choose its visibility accordingly.

## Agent entry point

AGENTS.md routes UI work to DESIGN.md and behavioural changes to DESIGN_SPEC.md. DESIGN.md follows the portable token-and-prose format; `.impeccable/design.json` contains companion component previews and layout/elevation metadata. These files describe A; archived explorations do not override them.

## Approved design baseline

The owner selected Option A on 22 October 2026. The selection pass validated JavaScript syntax, A-only normal mode, exploration URL gating, keyboard isolation, YAML token references, companion JSON and local documentation links. The Impeccable source scan reported no primary anti-patterns and advisory design-system differences in the retained prototype. Live browser layout was not rechecked in this documentation and selection pass.

Older wording and layouts that used a retired job's person, effective date or route now ask for those values as normal questions, keeping the original field ids. Staff must enter required answers before creating a document. Stored template versions and previously generated documents are unchanged; historical snapshots retain their original values.
