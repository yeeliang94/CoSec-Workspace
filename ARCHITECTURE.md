# CoSec Workspace implementation architecture

Date: 22 October 2026.

The owner has selected React and TypeScript for product development, with AI agents contributing to implementation. The first milestone is a local working application. MySQL first replaced the initial PostgreSQL recommendation; on 28 October 2026 the owner moved the database to SQLite, which suits one application host with fewer than ten staff and needs no database server (assessment and plan in [docs/SQLITE_MIGRATION_PLAN.md](docs/SQLITE_MIGRATION_PLAN.md)). The framework and infrastructure choices below are the recommended implementation baseline. Hosting, identity provider and operational policies remain to be selected.

Read [DESIGN.md](DESIGN.md) for the approved Option A visual system and [DESIGN_SPEC.md](DESIGN_SPEC.md) for product requirements. The original product brief remains the functional authority identified by that specification. This document describes implementation choices and does not approve legal rules.

## Stack

| Area | Baseline | Reason |
| --- | --- | --- |
| Application | Next.js App Router, React, strict TypeScript | One web application with server endpoints and a consistent language across layers |
| Styling | Tailwind CSS using DESIGN.md tokens | Implement the approved visual system with reusable components |
| Database | SQLite (WAL mode) through `better-sqlite3`, one file on the application host | Relational records, constraints and atomic updates with no database server; return to a server database if several application hosts or sustained simultaneous writes are needed |
| Data access | Drizzle ORM and reviewed SQL migrations | Typed queries with explicit database evolution |
| Runtime validation | Zod | Validate untrusted inputs; TypeScript types alone do not validate requests |
| Files | Private local file storage for the local milestone; S3-compatible storage for a hosted environment | Keep document contents outside the relational database; retain version metadata and access rules in the database; keep local files outside the public web directory |
| Background work | Queue implementation to be selected when asynchronous work is introduced | Durable processing for document generation, imports and reminders; Graphile Worker is excluded because it requires PostgreSQL |
| Verification | Vitest and Playwright, with SQLite integration tests on a throwaway database | Check domain rules, persistence behaviour and complete user paths |

Select supported stable dependency versions and commit a lockfile when scaffolding. Authentication should use an established library with local credentials and server-managed sessions for the disconnected deployment. Choose the exact library and recovery approach during foundation implementation. A future online identity provider is optional and must not become a runtime requirement. Company access and sensitive capabilities remain application responsibilities.

## Local and shared deployment

The owner first tests on one computer as administrator. Later, fewer than ten estimated concurrent staff use individual accounts against a shared application server whose database file sits on that server's local disk. These are deployment stages of the same application, not separate single-user and multi-user products.

Keep actor IDs, company access checks, session handling, audit attribution and optimistic concurrency in the local foundation. Use separate fictional role accounts to verify boundaries. Do not hardcode a global administrator or bypass approval checks because the current tester is the owner. Self approval remains governed by an explicit firm policy.

For development, bind services locally. Before shared deployment, configure HTTPS, sessions, credentials, restricted database connectivity and coordinated recovery of database metadata and private document files. Browsers communicate with the application server; they never open the database file. The server's exact operating system and office-network arrangement remain open.

## Application structure

Use a modular monolith: one repository, a web process and, when required, a worker process. Both processes run on the same host and use the same domain modules and SQLite database file. Next.js route handlers and server actions are adapters that validate inputs, establish actor context and call application services.

Keep these responsibilities distinct:

- Company records: company identity, dated appointments, member transactions and historical views.
- Casework: jobs, assignments, checklists, dependencies and completion evaluation.
- Obligations: approved rule versions, applicability and explainable date calculations.
- Documents: templates, immutable versions, approval scope, execution evidence and signatures.
- Filings: readiness, attempts, queries, submitted packages and evidenced outcomes.
- Access and audit: identity context, company scope, sensitive capabilities and attributed events.
- Service operations: custody, disclosure, fees and billing handoff.

Keep domain rules outside React components and framework handlers. Modules expose explicit operations and read models; screens do not directly update statutory records. Avoid a generic workflow builder in the first release. Implement explicit transitions and shared evidence/review primitives for the specified workflows.

Use server-rendered reads where appropriate and client components for interactions such as drawers, filters and forms. Keep private data out of shared caches. Reuse shared validation contracts without exporting database records or sensitive server modules into browser bundles.

## Persistence and safety contracts

- Store job, document, corporate-record, filing and billing states independently, as specified in DESIGN_SPEC.md.
- Bind approvals and filing attempts to exact immutable versions. Material revisions invalidate affected readiness and approvals while preserving history.
- Store effective dates separately from entry dates; retain predecessors and linked corrections. Annual return snapshots must not change when live records change.
- Enforce consequential operations through transactions, constraints and concurrency checks. Reconcile share events atomically and prevent duplicate period jobs.
- Persist audit events with the associated mutation. Application audit history is append-only; database administration and backup controls require separate operational policies.
- Enforce company scope and capabilities for reads, writes, searches, counts, exports and file downloads. Check authorisation inside server operations, including worker execution where applicable.
- Make retried consequential operations idempotent. Queue background work transactionally with its initiating change when consistency requires it.
- Keep statutory dates as dates and audit timestamps in UTC; display relevant times in Asia/Kuala_Lumpur.
- Treat deadline rules and templates as controlled, versioned inputs. Legal applicability and publication require the practising secretary's approval.

## First implementation slice

Follow the delivery sequence in DESIGN_SPEC.md: establish identity/access, company records and the shared job workspace, then implement W03 annual return with a linked W04 officer change.

The first complete path should demonstrate:

1. An authorised executive opens a company and creates the annual return job for a reporting year.
2. The job preserves an anniversary snapshot and exposes its linked officer-change dependency.
3. A reviewer approves the exact prepared version; a subsequent revision invalidates affected approval.
4. An authorised lodger records an external submission with package, date, reference and evidence.
5. The outcome remains outstanding until separately evidenced; closure evaluates all applicable completion requirements.

Verify role boundaries, stale edits, missing evidence, duplicate jobs and correction history alongside the successful path. Apply Option A throughout and validate the affected interface at the widths and keyboard conditions specified in DESIGN.md.

## Decisions still required

The owner confirms W03 annual returns, W04 director changes, reminders/follow-ups and usable settings as first-build scope. Implement these together through the shared records, review, documents and filing model described in DESIGN_SPEC.md. Other operating details remain explicitly provisional until the team walkthrough. Do not treat unanswered questions as approved requirements.

Server platform and location, retention and recovery policies, document-generation tooling and approved legal catalogues remain open. The owner requires the initial application to work without runtime internet access or external APIs. Bundle runtime assets locally, including fonts and scripts. Development installation and updates may still require network access; a disconnected installation procedure is a separate decision. Reminder execution depends on the host running; show overdue and missed work when it restarts. Initial reminders appear in the application; external message delivery is outside the baseline. Use fictional data until live-operation requirements are resolved. Initial regulator and signature interactions remain externally performed and recorded by staff.

The baseline assumes one firm with internal staff. A future multi-firm service requires an explicit tenant-isolation design. Agent-assisted development does not remove the need for reviewed migrations, permission checks and scenario verification.

## Technical references

- [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting)
- [Next.js authentication and authorisation guidance](https://nextjs.org/docs/app/guides/authentication)
- [Drizzle transactions](https://orm.drizzle.team/docs/transactions)
- [Drizzle migrations](https://orm.drizzle.team/docs/migrations)
- [Tailwind theme variables](https://tailwindcss.com/docs/theme)
- [Graphile Worker](https://worker.graphile.org/)

## Implemented local milestone — 22 October 2026

The first local evaluation build is now in `src/`, with setup in [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md) and actual check evidence in [docs/VERIFICATION.md](docs/VERIFICATION.md). Earlier sections remain the baseline and release constraints.

- Next.js 16/React 19, strict TypeScript with unused-code checks, Tailwind 4 using Option A tokens, Zod, Drizzle and SQLite (better-sqlite3, WAL); dependency lockfile committed when changes are reviewed. No remote repository or publication was created.
- Better Auth local email/password with public registration disabled, server-managed sessions, explicit capabilities/company scopes and independent review. Account administration alone has no company/professional access. Password resets are an audited local administrator action; recovery policy remains a live-use decision.
- SQLite identity/document/settings/audit/request/reminder tables plus company-scoped typed job aggregates. Every write runs in one `BEGIN IMMEDIATE` transaction, queued in-process and serialised across the web and worker processes by SQLite's write lock; version tokens reject stale edits, request keys make consequential retries idempotent, and audit/events commit with changes. Reads use a separate read-only connection. Timestamps are stored as UTC epoch milliseconds; statutory/effective dates remain date strings.
- Durable deterministic reminder occurrences in the database. Worker reconciles at startup/every 60 seconds; workspace reads also reconcile missed dates. No Redis, Graphile Worker, external notification service or runtime API dependency. Reconciliation is eventually consistent and unique occurrence IDs prevent duplicate reminders.
- Private immutable General and separately restricted BO evidence bytes with hashes, scoped download adapters and a filesystem storage seam. Published internal templates generate clearly illustrative text with pinned source provenance. Documents are never served from `public`.
- W03 covers upcoming period preparation, anniversary-time capture, exact source/pack history, client confirmation, linked dependencies, reviews, evidence, manual-date review, filing attempts/messages/responses/outcomes and closure. W04 covers distinct director routes, execution, independent dated-event posting and filing. Material changes flag affected open W03 snapshots for versioned refresh and new confirmation/review.

The records extension adds W05 opening balances, allotments (including new classes), single-source-certificate transfers, conserved integer units/decimal capital and immutable certificate history. W06 adds information notices/replies, independent escalation and discrepancy resolution, sourced entry/review/cessation assessments and effective-dated BO registers. All changes use immutable pack snapshots, exact-version independent review, company-locked atomic posting and separate filing states. Annual snapshots capture the reviewed member/capital position; earlier snapshots retain their original contents. BO reads, jobs, reminders and evidence require explicit `view_bo` plus company scope, with audited downloads.

The local build is not the entire W01–W12 catalogue. Broader corporate actions, restricted identity/compliance handling, external disclosure releases, legal deadline execution, regulated filing output, live opening-data migration and specialist filed-history correction remain later controlled work. A reviewed source is required for live legal applicability. See the implementation plan for release gates and pending walkthrough decisions.
