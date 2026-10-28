# CoSec Workspace

The [resolution builder](RESOLUTION_BUILDER_IMPLEMENTATION_PLAN.md) is implemented for fictional-data evaluation: an in-app clause library and assembly builder, people and dated company relationships, resolution cases with steps, generated question forms, native Word (.docx) generation with immutable history, and scoped before/after audit. Status per milestone, evidence and open gaps are in [docs/RESOLUTION_BUILDER_PROGRESS.md](docs/RESOLUTION_BUILDER_PROGRESS.md). Sample clause wording is fictional, not approved legal precedent.

The local first build now supports annual returns (W03), director appointments/cessations (W04), members/share capital/transfers (W05), restricted beneficial ownership records (W06), integrated follow-ups, company history, private evidence, exact-version review, external filing tracking and editable settings.

The database is a single SQLite file, `.local/cosec.db`; no database server is needed.

To run it, double-click `start.bat` on Windows, or run `./start.sh` on macOS or Linux. Node 24 LTS must be installed. The script installs dependencies, creates the private settings and database with fictional data, builds the app when the code has changed, then starts the app and the reminder worker and opens the browser. Ctrl+C or closing the window stops both.

The same steps by hand, using development mode:

```sh
npm ci
npm run db:provision   # first time only: private .env and empty database
npm run db:migrate
npm run db:seed        # fictional companies and staff, only into an empty database
npx tsx scripts/seed-resolution-samples.ts
npm run dev
# Another terminal:
npm run worker
```

Open [CoSec Workspace](http://127.0.0.1:4300). Generated fictional staff credentials are saved privately in `.local/ACCOUNTS.md`. See [local setup](docs/LOCAL_SETUP.md), [implementation plan](IMPLEMENTATION_PLAN.md), [recovery procedure](docs/RECOVERY.md) and [verification evidence](docs/VERIFICATION.md). No approved statutory rules or filing templates are bundled; this build is for fictional-data evaluation.

[DESIGN.md](DESIGN.md) remains the approved Option A visual authority. [DESIGN_SPEC.md](DESIGN_SPEC.md) and the unchanged [original brief](references/product-brief.docx) define the broader product. The remaining W01–W12 workflows remain planned. BO access requires explicit `view_bo` assignment in Settings → Users; existing accounts are unchanged. See the [records scope](docs/COMPANY_RECORDS_PLAN.md).

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
