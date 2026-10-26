# Resolution builder progress ledger

Tracks [RESOLUTION_BUILDER_IMPLEMENTATION_PLAN.md](../RESOLUTION_BUILDER_IMPLEMENTATION_PLAN.md). A milestone is complete only when its gate has evidence; a rendered screen or a file with the right extension is not evidence by itself.

## M0 — Baseline, contracts and renderer feasibility

**Status:** Complete (26 October 2026).

- Branch `build/local-workspace-app`. Pre-existing local changes: `RESOLUTION_BUILDER_IMPLEMENTATION_PLAN.md` (clause-library revision) and untracked `docs/research/`. Both preserved.
- Baseline: `npm run typecheck` clean; `npm test` 10 files / 75 tests passed. MySQL 8.4.11 local runtime on port 3307 running.
- Renderer: `docx@9.14.0` (MIT, no runtime network). Spike with long Unicode company name, numbered clauses, page break, header, "Page X of Y" footer and borderless two-column signature table converted to PDF by Microsoft Word for Mac: 2 A4 pages, all features correct. Quick Look previews ignore page breaks and fields, so Word conversion is the QA renderer. Word acceptance in the team's target Word/Windows environment remains **pending**.
- Editor additions: `@tiptap/extension-table@3.32.0`, `@tiptap/extension-text-align@3.32.0` (MIT). No paid modules.
- Contracts: [docs/RESOLUTION_CONTRACTS.md](RESOLUTION_CONTRACTS.md), [src/domain/resolution/model.ts](../src/domain/resolution/model.ts), [src/server/resolution/shared.ts](../src/server/resolution/shared.ts).
- Migration `0003_resolution_builder.sql`: 12 new tables, audit columns (`entity_type`, `request_id`, `reason`, `sensitivity`, `scope_company_ids`) and indexes; seeds two output types. Backup taken first: `.local/backups/pre-0003-*.sql` and `storage-pre-0003.tgz`. The first attempt stopped part-way because one generated foreign-key name exceeded MySQL's 64-character limit; the empty partial tables were removed and the corrected migration applied. Lesson recorded: name long foreign keys explicitly.
- New capabilities `manage_people`, `manage_templates`, `generate_documents`, `view_audit`, `export_audit`; not granted by migration.

## Evidence summary (27 October 2026)

Implementation used three parallel lanes with fixed file ownership (records/cases/audit, template engine/output, UI) after the M0 contracts were settled; the coordinator integrated W04 and verified the whole.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Clean |
| `npm test` | 14 files, 139 tests passed after review fixes (was 75 at baseline): includes `tests/resolution-records.integration.test.ts` (9), `tests/resolution-template.test.ts` (19), `tests/resolution-template.integration.test.ts` (12), `tests/resolution-ui-convert.test.ts` (12) |
| `npm run build` | Passed |
| `npx playwright test` against the production server | 18/18 passed, including `tests/e2e/resolution.spec.ts` (author → independent publish → preparer case with 3 clauses → answers → DOCX download → output-type switch; 390/768 px overflow checks) |
| `npm run format:check` | Clean |
| DOCX QA | Microsoft Word for Mac → PDF → PNG: `.local/docx-qa/members-*.png`, `directors-*.png` (numbering, exact fee table, Unicode/CJK names, signature grid, header, "Page X of Y", page break). Windows Word **pending**. |
| Legacy migration | `scripts/migrate-people.ts`: 7 companies, 6 people, 6 director relationships, 0 needing review; rerun created nothing |
| Capabilities | `scripts/grant-resolution-capabilities.ts` applied an explicit mapping to 8 of 10 local users (incl. three leftover "Integration …" fixture users); rerun changed nothing |
| Samples | `scripts/seed-resolution-samples.ts`: 6 clauses and 4 assemblies authored by the owner and published by the reviewer; all wording labelled fictional |

Two older browser tests were adjusted: `edit-safety` now waits for the Documents heading before reading options (the old read did not wait and raced navigation); workflow tests mock/clean the new director projection.

## Milestones

| ID | Status | Evidence / remaining gap |
| --- | --- | --- |
| M1 Audit and mutations | **Complete for new mutations** | `auditChange` (before/after diff, scope ids, reason, request id) in every new write; scoped keyset audit list, filters, CSV export with formula escaping (A20, A21). Gap: legacy routes still write the older summary-style audit entries; a full legacy coverage inventory is not done. |
| M2 People and relationships | **Complete** | People, name history, dated relationships, director projection from officer events (never merged by name), custom record fields, dated constitution citations (A04, A17, A32). W04 posting now refreshes the projection in the same transaction. |
| M3 Cases and steps | **Complete** | Board/appointment/resignation cases, default steps, dependency/cycle rules, registration step gated on the W04 record, evidence-backed decisions never auto-passed (A19). Gap: no reminders for case-step due dates. |
| M4 Templates and fields | **Complete** | Versioned clauses (per-output wordings) and assemblies, strict schemas and limits, binding allowlist, validation with locations, independent publication, hide/archive, copy, successor versions (A02, A08, A10, A13, A23, A29–A31). Gap: legacy catalogue templates are not converted. |
| M5 Authoring UI | **Complete** | Separate Tiptap editor with field chips, conditions, repeats, clause slot, signature blocks, tables, inspector; clause/assembly editors with lifecycle, preview and conflict handling. Gap: header/footer use `{{field_id}}` tokens in plain text; no dedicated larger-text/keyboard-only audit beyond e2e. |
| M6 Selection and forms | **Complete** | Clause list with add/remove/reorder/pin/newer-version offer; one form with shared-then-per-clause questions; server-side pools reject guessed ids (A01, A05, A27, A28). |
| M7 DOCX and history | **Complete** | Snapshot → pending → render outside lock → private DOCX → ready; idempotent request key; failures never downloadable; worker reconciles stale pending/orphans (A09, A11, A12, A22). |
| M8 Conditions, repeats, signers | **Complete (engine)** | Conditional variants, per-director fee repeat with exact total, signer role lists, date offsets labelled as samples without an approved source. Gap: per-row and record-picker inputs were exercised in service tests, not end-to-end in the browser; table indentation inside numbered clauses is cosmetic-only. |
| M9 W04 integration | **Complete (appointment proven)** | W04 cases pre-select the director clause and bind the job's person and date; generated document attaches to a new pack version needing its own review; stale person/date/route and newer versions are rejected (A15, A18). New-job form picks existing people. Gap: resignation path shares the mechanism but has no dedicated end-to-end test (A16). |
| M10 Hardening and handoff | **Partial** | Build, full regressions, migration backup/rerun evidence done. Not done: coordinated backup/restore rehearsal of generated DOCX hashes (A25), user walkthrough with the owner, Windows Word check. Live use remains blocked on approved wording, sources (e.g. any lapse period), role policy and deployment security. |

## Five-axis review (27 October 2026)

Three read-only reviewers (records, template/output, UI) reported verified findings; three fixers addressed them in separate file areas; the coordinator re-ran everything (139 unit/integration tests, typecheck, format, production build, 18/18 browser tests).

Fixed, with regression tests where marked (T):
- **Critical:** a W04 job could name another company's existing person id and link that person into its company on posting. Now checked at job creation (visibility, company relationship for cessations, exact name, UUID for new appointees, ≤64 chars) and again at projection time (T).
- **Critical:** generation snapshots stored the full selector pools (people from the preparer's other companies). Snapshots and all generation views now keep only referenced people (T).
- Firm-level audit rows gated by entity type; unlinked people's email/notes redacted for non-creators (T). Migration identity notes no longer name other companies.
- Read endpoints no longer lock companies or re-sync projections; insert order and `ORDER BY` before `LIMIT` fixed.
- Pack attachment: refuses closed jobs (T), replaces the family's previous version (T), and requires the director clause's person/date answers to match the job (T).
- Independent publication now also excludes anyone who edited the draft (T). Future-dated publication keeps the in-force version selectable until the successor's date (T).
- Output budget of 200,000 runs with a domain error; compile happens before locks; each generation advances the case revision so concurrent duplicates are stale (T).
- UI: person picker resets and validates by company/route; edits typed during a save stay dirty; clause reorder no longer applies an unapplied output type; version/person links react to the URL; focus is kept on reorder controls; clause editor never opens blank on assembly-only nodes (T); colour tokens.
- Coordinator: radio buttons were unstyled (full width); fixed globally.

Not fixed (recorded): DOCX rendering is not in a killable worker thread (Next/Vitest/tsx bundling); the input budget and output byte limit are the real bound. The W04 person check runs just before, not inside, the job-creation transaction; the posting-time check covers the gap. Large UI files (`field-inspector.tsx`, `templates/page.tsx`, `case-questions.tsx`) should be split.

The requested Codex app review did not run: the macOS access prompt for the ChatGPT/Codex app was declined.

## Review follow-up fixes (27 October 2026)

All five subsequent Codex review findings are addressed:

- Boolean questions offer explicit Yes/No answers (distinct from unanswered); `mustBeChecked` remains a checkbox. Draft answers may be saved incomplete, with final generation still enforcing active requirements.
- Version-history links run the shared discard guard before changing versions; cancelling retains the unsaved editor, and accepting opens the historical version.
- Generation and case mutations resolve immutable company identity before starting their transaction. The company lock precedes the first consistent read, preventing an old repeatable-read snapshot after waiting for a writer.
- Conditional repeat usage tracks active person IDs. Required per-person answers apply only to reached rows; inactive table cells show Not applicable. Aggregate dependencies still include every selected row.
- Open unlinked cases can use the audited, revision-checked `link_job` action in Overview. It validates company, route and job state, takes person/effective date from W04, and preserves W04 posting review. Cancelled jobs are rejected; an existing association cannot be replaced.

Regression evidence: 142 unit/integration tests pass, including real MySQL lock-wait checks for generation and case mutation, inactive repeat rows, and linking/rejection/posting gates. Typecheck, Prettier check, production build and `git diff --check` pass. All 20 browser tests pass against the production build, including No-answer generation, cancel/accept of dirty version navigation and W04 linking at 390px/768px. Independent follow-up reviews found no further blockers after the cancelled-job edge was addressed.

An existing native skip-link/history test fails under the development server's Strict Mode remounting but passes against the production build. The shared history guard was not changed in this follow-up; the new version-history guard passes in both modes.

## Greptile review fixes (27 October 2026)

All 19 Greptile findings on PRs 1–5 were checked against the code; all were valid and are fixed on the PR that introduced them:

- **Bounds and depth:** the active-usage walk spends the compiler's block budget, so nested repeats fail with `TOO_LARGE` instead of blocking the server. Clause wording restarts depth at the clause slot, and over-deep content throws instead of silently disappearing.
- **Shared fields:** definitions of one case-scope id must also agree on source, format and answer rules. Shared calculations may not depend on a clause's own field, and their inputs resolve in the shared scope.
- **Dates and versions:** impossible calendar dates return false instead of throwing. Generation refuses pinned versions that take effect after the resolution date. Assembly previews use the same in-force rule as new cases.
- **Access:** person-creation replays and W04 posting re-check current person access. A still-unlinked person chosen by the preparer can be posted by an independent reviewer.
- **Audit export:** more than 5,000 matches is refused with a request to narrow the filters, rather than returning a silently cut file.
- **Screens:** template details edits survive section changes, stale version loads are ignored, and page header/footer fields count as uses. The W04 appointment picker lists every visible person, and a late reply no longer erases a typed name. Yes/No custom values start unanswered. Per-person multiple-choice answers save as lists. Case details follow a linked job's date. Signed copies can be recorded by every capability the server accepts.

Regression evidence: 149 unit/integration tests pass against MySQL (new tests cover nested repeats, clause depth, shared-field conflicts, invalid dates, backdated generation, in-force previews, replay access and posting access). Typecheck, Prettier check and production build pass. All 20 browser tests pass against the production build, and the W04 picker was checked in the browser.

## Known limitations

- All clause wording is fictional evaluation content, not approved legal precedent.
- Render time limit stops waiting at 15 s but cannot interrupt rendering already in progress; size limits keep renders short.
- Contract doc API shapes were refined during implementation; the code and tests are authoritative where they differ.
