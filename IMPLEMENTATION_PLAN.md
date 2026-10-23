# Implementation plan — 22 October 2026

## Authorised milestone
Local, fictional-data evaluation of **all three**: W03 annual returns, W04 director appointment/cessation, and integrated reminders/follow-ups. Next.js App Router, strict TypeScript, React, Tailwind, Drizzle, MySQL InnoDB, Zod. Preserve the original brief and existing design changes. No publication, portal integration, outbound communications or legally approved catalogue is authorised.

## Delivery and dependencies
1. **Foundation (coordinator):** inspect tools; establish contracts, schema, migrations, local credential/session authentication, company scopes, audit, optimistic concurrency and idempotency. Bring up isolated MySQL without modifying an existing system service.
2. **Workflow persistence (worker A, after contracts):** W03/W04 transitions, immutable anniversary snapshots and packs, dated events, version reviews, dependencies, independent filing attempts/queries/outcomes/closure; domain and database tests.
3. **Operational UI (worker B, after contracts):** approved Option A shell; work/company/job/review/calendar/document/settings screens with real API actions and failure feedback. No auth role switch.
4. **Supporting operations (worker C, after contracts):** private documents, versioned settings/templates/checklists, preferences, durable reminder reconciliation, backup procedure and tests.
5. **Integration (coordinator):** routes, seed identities/fictional portfolio, installation/start commands; integrate modules; typecheck/build/tests and full browser paths including permissions, failures and responsive/keyboard checks.
6. **Review and handoff:** resolve defects; record actual acceptance evidence and remaining live-operation gates. Leave app running locally when feasible.

Workers own non-overlapping files; coordinator owns schema, shared contracts, auth, API adapters, scaffold and integration. Contract changes require coordination. No worker edits original design documents or prototype.

## Persistence design
Small modular monolith with company-scoped job aggregates stored as typed JSON in MySQL alongside indexed identity/state/revision fields. Immutable pack/review/filing/correspondence history retained inside aggregate; transaction locks serialize mutations. Corporate officer events are separate append-only rows for date-effective company queries. Users, scopes, sessions, documents, catalogue settings, idempotency keys, reminders and audit have dedicated tables. Database changes and audit commit together. Aggregate updates require expected revision and unique actor/request id. Documents reference immutable stored bytes with hashes. This is proportionate to 10–20 companies and does not replace future reporting projections.

## Provisional operational defaults
- Independent reviewer required; self approval disabled. Administrator has administration capabilities only unless explicitly granted professional/company capabilities.
- Initial internal preparation lead time 30 days, client chase 7 days; these are editable operational defaults, **not statutory deadlines**.
- No legally approved rule/template ships. Manual statutory dates need evidence and review. Job creation is allowed without a statutory date; missing rule remains visible.
- First build internal pack output is illustrative HTML/text, never a regulator-compatible filing. External outputs/signatures/submissions are attached and recorded.
- Director routes: appointment, resignation, removal and other cessation with explicit route basis; route evidence reviewed before dated posting. No automatic posting based on filing receipt.
- Host must run for background processing. MySQL reminder ledger + reconciliation at worker startup and dashboard read catches missed dates; unique keys suppress duplicates. No Redis.
- Seed accounts are actual local password accounts with company scopes. Credentials generated into ignored local handoff file; no universal authentication bypass.

## Acceptance evidence to collect
- W03 duplicate company/year rejected; snapshot built at anniversary; later officer changes preserve snapshot.
- Evidence/client confirmation/current-version review/readiness/submission/outcome/closure; revision invalidates approval and readiness; old versions remain.
- W04 appointment and cessation retain distinct effective/entry/filing dates; future event is absent from current officers; source/consent/route basis required; linked W03 dependency blocks readiness.
- Queried/rejected attempts retain packages and require response dates and separate resubmission/outcome.
- Owned follow-up with next chase; missed/overdue items after restart; notification read does not resolve underlying work.
- Scope denial on detail/list/count/download/mutation, self approval denial, stale-write conflict, idempotent retry, transactional audit.
- Settings edits persist, catalogue versions/review/impact preview, display preferences separate from document formatting.
- Browser at 390/768/1280/1440 and 320 reflow, keyboard, enlarged text, reduced motion; typecheck, unit/MySQL integration, build, end-to-end.

## Later milestones (not delivered by this first build)
W07 meeting/decision automation; W01 takeover/CDD and W02 incorporation; W08 financial reporting; W10 service/legal cessation; W11 custody/disclosures; W12 restricted compliance/credentials/billing operations; W09 routine and specialist corporate actions. Add imports only after inspecting actual tracker files. Shared deployment requires HTTPS, individual recovery, approved retention/security policies, coordinated restore rehearsal and real-file acceptance.

## Open live-use decisions
Practising secretary must approve legal sources/versions, applicability, deadlines, actual pack content, execution matrix and legally effective posting points. Team walkthrough must confirm opening data, role combinations, client confirmation, chasing cadence and file evidence. Shared server OS/location, retention/holds/disposal and backup destination remain open. Do not treat fictional fixtures or completed checklists as legal validation.

## Local milestone outcome

Implemented foundations and all three first-build workflows with settings, private documents, company opening review and dated officer views. Detailed workflow tabs were separated into focused modules; rich editing loads on demand. The local MySQL runtime, production web app and worker run independently on localhost. Reviewed migration SQL uses InnoDB and a checksum ledger.

Actual acceptance evidence is recorded in [docs/VERIFICATION.md](docs/VERIFICATION.md). Unit/MySQL scenarios and browser user paths pass; this is not approval for live statutory operation. Guarded first-build exceptions include leap-day anniversary determination and backdated changes affecting filed annual snapshots. The unchanged original brief, design sources and prototype remain intact. No external messages, publication, deployment, merge or remote push was performed.

## Company records extension

W05 members/share capital/transfers and W06 restricted BO records are implemented for fictional-data evaluation. See [records scope](docs/COMPANY_RECORDS_PLAN.md) and [verification](docs/VERIFICATION.md). Posting still requires exact-version independent review; approved source versions and live statutory validation remain release gates.
