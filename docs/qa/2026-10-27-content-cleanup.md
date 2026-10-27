# Page content cleanup and QA fixes — 27 October 2026

## Scope and direction

Reviewed every application page route and its working components for redundant headings, explanatory microcopy and loose metadata. The owner specifically requested fewer subtitle-like lines and a structured place for category, Act, authorship and scope information.

Implemented with three sub-agents plus parent integration. Option A remains the visual authority. Editable classifications belong in Details; authorship belongs in Versions/history; secondary file/reference information belongs in named disclosures. Shared `record-meta` definition lists provide compact labelled facts. Material blockers, independent states, deadlines, legal sources and consequential-action information stay available where needed.

`DESIGN.md` now records this content-presentation rule. No legal rule, publication permission, record transition or document output typography was changed.

## Page review inventory

| Page / working surface | Result |
| --- | --- |
| `/` | Redirect only; no presentation change needed. |
| `/login` | Already concise visible field labels; no helper-text cleanup needed. |
| `/work` | Retained company identity, job state, next action, due-date basis and owner. These are required work-list information, not redundant descriptions. |
| `/reviews` | Uses the same work-list component; same decision. |
| `/calendar` | Retained dates, owners and overdue status; no routine prose to remove. |
| `/billing` | Already a labelled comparison table; no routine prose to remove. |
| `/companies` | Existing list keeps supporting registration identity and independent company states. No additional headings introduced. |
| `/companies/[id]` | Registration is a labelled company fact; technical person/event IDs and file details are disclosed. Member/capital/BO history uses labelled provenance facts. |
| `/jobs/new` | Removed repeated person-picker explanation; labels and the New person option convey the available action. Material source/deadline warnings remain. |
| `/jobs/[id]` | Removed duplicate header state/owner/revision sentence. Independent states remain in the existing fact strip; revision/activity are in History and owner remains in Overview. Removed repeated next-action blocker text and empty dependency heading. Pack/filing provenance and submission metadata are structured. |
| Job W05 and W06 record views | Capital amounts, reconciliation, stamping, BO notice dates/owners, criteria and sources use facts/tables. Decision-critical information remains visible. |
| `/documents` | Filename disclosed when it differs from document title; upload date/size/link columns remain visible. |
| `/settings` | Catalogue source/effective date and approval policy use labelled facts; placeholder reference is a scannable list inside its disclosure. Personal settings and permission controls retained. |
| `/resolutions` | Creation guard repaired. Existing case state/next-step list information retained. |
| `/resolutions/[id]` | Case kind/state and step responsibility structured; revision in History; redundant decision/reorder guidance removed. Document provenance is in Version details; actual review/signature state stays visible. |
| `/resolutions/companies/[id]` | Citation source/reason/effectiveness structured. No empty custom-values section when no definitions exist. |
| `/templates` | Consolidated duplicate latest/published columns into Version; different published predecessor still explicit. Secondary description/update information disclosed; Act remains a labelled column. |
| `/templates/clauses/[id]` | Title-only header; category/Act in Details; author/date in Versions; redundant scope and read-only prose removed. Duplicate section headings visually hidden while accessible headings remain. |
| `/templates/assemblies/[id]` | Same header/history pattern. Output type is a labelled Details fact. Placeholder guidance disclosed; meaningful form groups retained. |
| Template field inspector | Removed repeated raw IDs, scope tags and usage lines from list rows. Field references disclosure retains technical IDs, source, usage and choice IDs; deletion blockers/errors remain visible. |
| Template/document previews | Secondary sample/pagination context moved into Preview details. Sample identity and any unsaved-preview versus saved-download difference remain explicit. |
| `/people` | Removed empty history/custom-value headings. Record provenance and relationship facts structured; history remains accessible. |
| `/audit` | Kept record evidence and filtering; timezone moved into the time column heading instead of a helper sentence. |

## Four QA fixes

1. Unsaved clause/assembly/resolution creation forms require confirmed discard on section changes, close toggles and cancellation. Dirty detection covers meaningful non-name changes. Successful creation clears the captured form's dirty marker before navigation.
2. Templates and People retain Resolutions as the selected parent; Audit retains Settings.
3. Wording tabs implement roving focus, Left/Right wrapping and Home/End, retaining panel association.
4. Formatting toolbar text follows the shared personal text scale; desktop controls have a 36px minimum height and mobile template controls 40px. Generated document typography stays independent.

Focused regressions are in `tests/e2e/ui-qa-regressions.spec.ts`. They create no new application records and restore the original personal text preference.

## Verification

- Typecheck, production build and formatting checks pass.
- Unit/integration suite: 15 files / 148 tests passed.
- Four focused UI regressions passed on the development server, including Larger text and 390/768px overflow.
- The first full production browser pass exposed old location-based assertions after the metadata move. They now assert the structured state/source values and open Field references where appropriate.
- The director test also selected an arbitrary company document, which could now be a generated resolution with separate immutable signer requirements. Its fixture now explicitly selects an uploaded, General, unlinked source; the Fully signed assertion is retained. No service logic was weakened.
- Final production browser coverage: all 26 distinct cases passed across the final full run and a targeted rerun. The full run passed 21 and exposed two remaining assertion-location mismatches (with three dependent cases skipped); the subsequent register/resolution rerun passed all 9 cases, including those five. No application changes were needed after that full run; only assertions were updated to inspect the new labelled facts and open Preview details.
- Impeccable source scan: no primary findings; seven pre-existing colour advisories (five document-preview colours and two feedback-border literals). Evidence: `.local/ui-qa-2026-10-27/declutter-detector.json`.

Computer-use checks inspected the integrated template editor (Wording, Details, Versions, Preview), company list/file, job Overview/Documents, resolution Overview/Documents and citation settings, including mobile layouts. Every route was reviewed in source; this does not claim every record/role/state combination was visually exercised. Full physical-touch, screen-reader and target-hardware performance certification remain separate.

Finished desktop/mobile captures: `.local/ui-qa-2026-10-27/declutter-desktop.jpg` and `declutter-mobile.jpg`. The root-workspace production preview remains available at `http://127.0.0.1:3001`; temporary development port 3002 was stopped. The older port-3000 process was left unchanged.
