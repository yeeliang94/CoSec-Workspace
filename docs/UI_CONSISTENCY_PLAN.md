# UI consistency plan — 29 October 2026

Source: owner review of every page plus every hidden state (disclosures, tabs, drawers, inline forms), captured at 1440px on fictional data. Root cause: [DESIGN.md](../DESIGN.md) defines the system, but `globals.css` and the page components do not enforce it (25 font sizes, 39 raw colours, 240 raw pixel spacings, five different "create" behaviours).

Order of work: foundations first (they fix many screens at once), then shared components, then navigation, then per-page content. Each item lists the fix and its status.

## 1. Foundations (stylesheet)

| # | Issue | Fix | Status |
|---|---|---|---|
| 1.1 | 25 font sizes; 21/22/23/15/16/11px near-duplicates | Type tokens: title 24, section 17, subsection 14, body 14, small 13, meta 12. Company/case titles use the page title. 11px removed from the product UI. Document and editor canvas sizes stay (they belong to the generated document). | Done |
| 1.2 | Raw hex colours outside the palette | Every UI colour comes from a named token (hover border, pressed, table header text, danger surface/border, success border, navigation hover/muted). | Done |
| 1.3 | Tabs jump sideways when selected | Selected tab keeps the same weight; selection shown by colour and underline only. | Done |
| 1.4 | Title and tab bar move between tabs | Page header has a fixed minimum height whether or not it has a button. | Done |
| 1.5 | Too many divider lines; doubled rules | Lines only between top-level sections and table rows. Disclosures, empty states, case/job status strips and version bars lose their rules. | Done |
| 1.6 | Three disabled looks | One disabled style for every button, primary or not. | Done |
| 1.7 | Boxed fieldsets as a fourth container style | Fieldsets are unboxed; legend uses the field-label style. | Done |
| 1.8 | Unstyled file input | File chooser rendered as a secondary button with the filename beside it. | Done |
| 1.9 | Disclosure title sits on the first field; two disclosure colours | One disclosure style (13px medium, ink, chevron) with a fixed gap before content. | Done |
| 1.10 | Action buttons sit below the row baseline | Buttons inside table cells align with cell text. | Done |
| 1.11 | Warning, error, confirmation and info boxes differ | One notice shape with three tones: warning (amber), error (red), info (neutral). | Done |

## 2. Shared components

| # | Issue | Fix | Status |
|---|---|---|---|
| 2.1 | Evidence pickers are raw multi-select boxes with "Select…" as an option (8+ places) | `multi` fields render as a checkbox list, with "No documents yet" when empty. | Done |
| 2.2 | Secondary button used for the main action of every job form | `ActionForm` buttons are primary unless the form is a secondary decision (not-applicable, not-required). | Done |
| 2.3 | Five different create/edit behaviours | New person, New company, New resolution, Add a person, Add document type and End relationship open the shared side drawer. Inline top-of-page forms and in-cell forms removed. | Done |
| 2.4 | Header nav buttons mixed with actions | Page header holds one back link, the title and its actions. A page may link to its own sub-area with one secondary button (Resolutions → Templates, Settings → Audit log); duplicate cross-links on Documents and Settings removed. Tabs were rejected: they would stack two tab rows on Templates. | Done |

## 3. Navigation

| # | Issue | Fix | Status |
|---|---|---|---|
| 3.1 | Company page back link says "My work" | Back link returns to Companies. | Done |
| 3.2 | Four names for templates (Clause library, Resolution templates, Standard wording, New paragraph) | Area is "Templates" everywhere (old "Clause library" removed). The newer product wording "Standard wording" / "paragraph" is kept inside it. Settings' separate catalogue renamed "Job templates, checklists and rules". | Done |
| 3.3 | Templates reachable from Documents and Settings header buttons | Only from Resolutions (its rail owner). | Done |
| 3.4 | Audit log back link says "Resolutions" | Back link returns to Settings. | Done |
| 3.5 | New share transaction / New BO assessment land on "New job" with "← My work" | Page title names the activity; back link returns to the company it came from. | Done |
| 3.6 | Clause and layout editors back-link to "Clause library" | Back link "Templates". | Done |

## 4. Page content

| # | Issue | Fix | Status |
|---|---|---|---|
| 4.1 | Company: "Unverified" shown three times | Warning box holds the review disclosure; the duplicate fact is removed. | Done |
| 4.2 | Company: Industry "—" with orphan caption | Industry and business activity shown as one value. | Done |
| 4.3 | Company: "as at {date}" repeated in every heading; date picker floats in People | One "Record as at" control above the record sections; headings drop the date. | Done |
| 4.4 | Company: Jobs table repeats the company in every row | Company column hidden on the company page. | Done |
| 4.5 | Job: same 9-line blocker list on Overview and Filing | Filing shows a one-line count with the list behind "Show outstanding items". (Blockers are free text, so they cannot be reliably split by topic.) | Done |
| 4.6 | Job: Completion repeats the status strip | Completion shows only its action. | Done |
| 4.7 | Job History: lowercase event titles, ISO dates in text | Event titles capitalised; dates in domain messages formatted like the rest of the app. | Done |
| 4.8 | Resolution: stray "." and two link sizes in company line | One company link plus a quiet "Company details" link. | Done |
| 4.9 | Resolution: red error box with Retry for "choose the layout first" | Neutral info notice, no Retry. | Done |
| 4.10 | Resolution: helper line repeated; cancel link indented | One helper line; cancel aligned left. | Done |
| 4.11 | Templates list repeats table header per category | One table with category group rows. | Done |
| 4.12 | Document types show internal IDs | ID column removed. | Done |
| 4.13 | Audit log shows machine action names | Action names humanised ("Assembly version draft saved"). | Done |
| 4.14 | Clause editor: boxed tabs stacked under page tabs | Wording selector restyled as a segmented control. | Done |
| 4.15 | Empty states differ; three "New resolution" buttons at once | One empty-state style; empty state has no duplicate of the header action. | Done |
| 4.16 | Settings tables narrower than the rest | Tables use the full content width; forms keep the 760px measure. | Done |
| 4.17 | Users staff names not links | Kept as plain text: there is no staff profile page to link to. Edit access stays the row action. | Kept |

## Kept deliberately (not changed)

- **"Internal target" under due dates** — distinguishes an internal date from a statutory deadline; DESIGN_SPEC requires the date type to stay visible.
- **File details disclosures** — DESIGN.md names a disclosure as the place for file references.
- **Reviews page** — product information architecture; a separate decision for the owner.
- **Template placeholders list in Settings → Catalogues** — authoring reference that authors need verbatim; already behind a disclosure.
- **Top bar firm name** — it is the configurable firm name, which defaults to "CoSec Workspace".

## Not done in this pass

- **Spacing values** — about 240 margins and paddings are still typed as raw pixels. Visible spacing problems were fixed where seen, but they are not yet all on the 4–32px steps, and `check:design` does not police spacing yet.
- **Clause editor field list** — the small "View" buttons in "Fields and settings" still sit slightly below their labels.

## Verification

Run on 29 October 2026: typecheck, Prettier and `npm run check:design` pass; production build succeeds. Unit/integration tests: 187 of 188 pass. The one failure (`tests/sqlite.integration.test.ts`, busy-database timeout) fails identically on the untouched base commit, so it predates this work. Every page and hidden state was re-captured at 1440px; company, job, templates and New company were also checked at 390px.

### Five-axis review follow-up — 29 October 2026

Fixed cyclic colour tokens and added cycle detection to `check:design`. Typography roles now resolve on the application element so saved text-size preferences apply. Document-type errors and relationship conflict recovery remain inside their drawers. Required evidence groups validate before submission, and job titles and creation actions follow the selected activity.

Updated the affected browser journeys for checkbox evidence, modal creation forms, page headers and the shared record date. Added regressions for required choices, token cycles, in-drawer feedback, relationship conflict recovery and changing job activities.

Follow-up verification after integrating the latest `main`: all 200 unit/integration tests pass, as do TypeScript, formatting, design-token validation and the production build. Playwright discovers all 30 browser tests. Fresh browser execution and visual verification were unavailable because browser access is disabled in Work settings; the earlier captures do not verify these follow-up fixes.
