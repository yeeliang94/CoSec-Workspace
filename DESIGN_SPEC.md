# CoSec Workspace product design specification

Status: proposed design baseline for direction selection. Version 0.2, 22 October 2026.

CoSec Workspace supports an internal Malaysian company secretarial services team managing an initial portfolio of 10 to 20 companies. The interface should help staff find the next action, inspect the evidence and understand what has become legally effective, what is signed and what remains to be filed. Use a restrained professional services visual language: aligned information, neutral surfaces, readable tables and deliberate use of colour.

Recommended direction: **A Workbench** for the application shell and daily work. Use **B Review desk** as a candidate layout for review queues. Use **C Portfolio** as a candidate hierarchy for a manager overview. The owner has not selected a direction. These are alternatives to evaluate, not three visual themes to ship together.

## How agents should use this specification

1. Read the product boundaries and state model before designing a screen. Identify the activity IDs and the staff role involved.
2. Select the relevant screen contract and workflow entry below. Keep the product rules intact even when simplifying a screen.
3. Use the shared tokens and component behaviour. Introduce a new pattern only when an existing pattern cannot express the task; record the reason.
4. Implement a single task path with its loading, empty, validation, permission and failure states. Use fictional data in prototypes.
5. Verify the applicable acceptance scenarios and keyboard behaviour. Report any remaining gaps accurately.

Completion means a staff member can perform the intended task, see its resulting state and recover from a correctable error. A polished happy-path screenshot alone is insufficient. This document specifies product and interaction design; production architecture, integrations and legal rules require separate decisions.

## Product authority and scope

The functional baseline is the supplied [Malaysian Company Secretarial Software Internal product requirements and user workflows](references/product-brief.docx), revision 2, dated 21 October 2026. Its W01 to W12 catalogue and cross-workflow safeguards take precedence over illustrative prototype behaviour. Preserve the supplied file with the project when moving these materials elsewhere.

The prototype is `prototype/index.html`. Its dates, names, company numbers, fees, documents and references are fictional examples. Its reduced data model demonstrates interactions and does not establish a compliance rule or final schema.

### Required product boundaries

- All accounts belong to internal staff. Clients, directors, auditors, banks and regulators use existing external channels.
- Staff record external instructions, signatures, submissions, correspondence and outcomes. A document generation action does not complete a job.
- The initial entity scope is Malaysian private companies limited by shares. Public companies, LLPs, foreign branches and regulated sectors need separate assessment.
- AI product features, AI vendors and AI architecture are outside the brief. “For AI agents” describes the intended consumers of this specification.
- Direct SSM, MBRS, e-BOS, stamping, screening or electronic signing integration is not assumed.
- A practising secretary approves legal routes, deadline rules, applicability, document packs and posting points before live use. This design does not independently validate the legal references in the brief.

### Design proposals

The navigation, tokens, typography, layouts, interaction choices and implementation sequence below are design proposals. Preserve the required capabilities even if delivery is phased. Specialist matters use reviewer-approved cases rather than a generic workflow pretending to automate professional judgment.

## Design goals and tradeoffs

| Goal | Design response | Check |
| --- | --- | --- |
| Find actionable work quickly | Start at My work, ordered by urgency and due date | Owner and next action are available from every job |
| Keep the page quiet | Labelled groups, short metadata and disclosed secondary detail | Remove explanatory paragraphs from routine list views |
| Preserve confidence | Separate states, exact versions, dates and named decisions | A pending filing never looks complete because a record is effective |
| Support casework | Tables for lists, structured detail for individual cases | Staff can return to the same filtered queue after inspecting a job |
| Remain familiar | Stable navigation, standard controls, consistent action placement | The same component behaves identically across W01 to W12 |
| Handle exceptions visibly | Local blocker with cause, owner and next action | Missing evidence cannot disappear into a success count |
| Support a small practice | Simple defaults and limited top-level navigation | Avoid large-enterprise configuration before there is a real need |

Density is useful when it improves comparison. Whitespace should separate meaningful groups, not turn each fact into a separate card. Reduce unnecessary text while preserving visible labels and material consequences.

## Staff roles and access

| Role | Primary workspace | Typical actions | Boundary |
| --- | --- | --- | --- |
| Executive | My work and company files | Prepare jobs, draft records, log correspondence, attach evidence | Material changes and filing readiness require the applicable review |
| Reviewer or practising secretary | Review queue | Approve a version, confirm applicability, authorise record consequences, resolve exceptions | Decision scope is explicit; unrelated jobs remain untouched |
| Authorised lodger | Ready for filing queue | Record external submissions, references, payments and outcomes | Submission and outcome confirmation remain separate |
| Manager or administrator | Portfolio and administration | Allocate work, manage users and approved catalogues, oversee deadlines and handoff | Management access does not automatically grant restricted compliance access |
| Restricted compliance staff | Restricted cases | CDD escalation and separately controlled evidence or reporting | Restricted details stay out of ordinary comments, exports and handovers |
| Custodian or authorised certifier | Custody and disclosure requests | Log originals, movements, certifications and authorised releases | A scan does not prove custody of an original |

Roles may be combined under firm policy. Record preparer, reviewer and lodger separately. Any permitted self approval must be identifiable. Proposed production capabilities include `prepare_job`, `review_pack`, `confirm_record`, `record_filing`, `manage_catalogue`, `view_bo`, `view_restricted_compliance` and `authorise_disclosure`, constrained by company access.

The server must enforce access on list queries, search, detail views, downloads and mutations. Hiding a navigation link is insufficient. Restricted metadata, names, counts and search snippets must also be filtered. The prototype’s role selector only previews action placement; it is not an access-control implementation.

## Information architecture

### Global navigation

| Destination | Purpose | Default view |
| --- | --- | --- |
| My work | Actionable jobs across assigned companies | Open work with overdue items first |
| Companies | Current and historical company records | Searchable company directory |
| Reviews | Version-specific decisions | Oldest urgent review first |
| Calendar | Explainable statutory and internal dates | Upcoming obligations list; month view optional |
| Documents | Cross-company packs, versions and evidence | Searchable document list |
| Billing | Completed chargeable work and handoff | Ready to bill |
| Administration | Users, templates, rules, credentials and policies | Role-restricted settings |

Portfolio reporting can be a manager view within My work initially. Keep the twelve activity types inside job creation and company casework rather than twelve top-level navigation items. Restricted compliance needs a separately authorised entry point.

### Route proposals

- `/work` with owner, state, due range and activity filters.
- `/companies` and `/companies/:companyId/:section`.
- `/jobs/:jobId/:section`, deep linkable from every queue.
- `/reviews`, `/obligations`, `/documents`, `/billing` and `/administration`.
- Company sections: Overview, Officers, Members and capital, Beneficial ownership, Decisions, Filings, Obligations, Jobs, Documents, Custody, History.

Group infrequent company sections into a labelled “More” menu when horizontal space is constrained. Preserve the active section and accessible navigation. Keep company identity in the header while a user changes sections.

### Object relationships

A company has an engagement, dated corporate records, obligations and jobs. Jobs connect triggers to checklists, decisions, document versions, correspondence, record changes, filing tasks and completion evidence. A person or organisation can participate in several companies through dated relationships. Parent cases link related jobs without collapsing their independent outcomes.

Documents can be linked to several cases through one authoritative version history. A filing references the exact submitted version or package. An obligation references its approved rule version, trigger, period and deadline calculation.

## Independent states and time

These are separate tracks. Derive each from its own data and approvals.

| Track | Canonical states from the brief | UI rule |
| --- | --- | --- |
| Job | New, Preparing, Waiting on external information, Awaiting review, Action in progress, Blocked, Complete, Cancelled | Show the next action and owner with the state |
| Document | Draft, Reviewed, Issued for signature, Partly signed, Fully signed, Superseded, Void | Identify exact version and required signers |
| Corporate record | Proposed, Approved and future dated, Effective, Corrected, Ceased | Always retain effective date and predecessor history |
| Filing task | Not required with reason, Not ready, Ready, Submitted, Queried, Rejected, Resubmitted, Outcome confirmed | Retain actual authority wording and evidence |
| Billing | Proposed: Not ready, Ready to bill, Handed off, Invoiced | Independent of job completion and filing outcomes |

“Ready for filing” is a derived queue condition, not an additional canonical job state. “Overdue” is a date condition, not a workflow state. The prototype uses a short queue label for demonstration.

### Transition requirements

| Action | Preconditions | Result |
| --- | --- | --- |
| Request review | Required preparation evidence and selected document versions exist | Record a review request for that scope |
| Approve pack | Reviewer authority, current versions and resolved dependencies | Store approver, time, scope, version and basis |
| Revise material content | Preserve prior version and dependencies | Create new version and invalidate affected downstream approvals |
| Confirm corporate event | Reviewer confirms evidence and legally supported effective date | Post the dated event independently of filing completion |
| Authorise filing readiness | Required review, execution, dependencies and current package satisfied | Filing task becomes Ready |
| Record submission | Authorised lodger, actual package, date, reference and evidence | Filing becomes Submitted; outcome remains unresolved |
| Record query or rejection | Authority message and response deadline | Keep original submission and open required response work |
| Confirm outcome | Evidence matches the authority outcome | Store its actual wording; reconcile required consequences |
| Complete job | All mandatory evidence, review and applicable tasks resolved | Close operational work; evaluate billing separately |
| Correct completed work | Linked correction job and retained original | Preserve earlier history and review affected downstream work |

### Date behaviour

Store instruction, decision, signature, effective, record-entry, submission and regulatory-outcome dates separately. Keep the statutory deadline, internal target, original deadline and approved revised deadline separately. Calendar dates should use date-only storage where time has no meaning; audit events should store UTC timestamps and display Asia/Kuala_Lumpur time with a clear timezone when relevant.

A future-dated approved change is not current before its effective date. A backdated discovery triggers consequence review without silently changing historical filed documents. A pending extension does not move the operative deadline. Reassignment, waiting and cancellation do not erase an already incurred obligation.

Render dates as `22 Oct 2026`. Use `RM 1,250.00` for monetary displays. Preserve registration and identity values as strings. Sort dates and money by their raw values, not formatted text. Show zero, unknown, not applicable and unverified as different conditions.

## Workflow coverage

Every activity below must be representable. Guided routines and controlled specialist cases share the same evidence and review model.

| ID | Workspace and key design elements | Required protection |
| --- | --- | --- |
| W01 Client acceptance and takeover | Prospective file, engagement, CDD decision, incoming record inventory, verification gaps, inherited backlog | Activation does not certify missing history; rejected onboarding stays retained |
| W02 Incorporation and setup | Proposed names, reservation expiry, parties, application, registration evidence, initial registers and obligations | Convert the same prospective identity when registered; rejected names are not current names |
| W03 Annual return | Period and anniversary snapshot, confirmation pack, BO checks, sequencing dependencies, reviewed output, filed package | One job per company and reporting year; current live data cannot overwrite a filed snapshot |
| W04 Officers and particulars | Specific event type, person reuse, consent, authority, before and after particulars, dated appointments, per-company filings | Distinguish resignation, removal and other routes; one person’s change can create several independently filed notifications |
| W05 Members and capital | Transaction ledger by class, transfer or allotment pack, stamping evidence, before and after units, capital reconciliation and certificates | Transfers conserve issued units; allotments increase them; prevent negative holdings and duplicate certificate numbers |
| W06 Beneficial ownership | Notices, replies, assessed criteria, ownership chain evidence, register-entry date, e-BOS task, discrepancies and next review | Members and BO remain distinct; nonresponse escalates; restricted access and export controls apply |
| W07 Meetings and resolutions | Route, notice, quorum, voting or circulation, conflicts, decisions, minutes, signer matrix and resulting actions | A draft or meeting entry is not a passed decision; partly signed stays partly signed |
| W08 Financial statements | Financial period, external preparer and auditor, approved exemption basis, execution, circulation, filing and extension case | Separate from annual return; signed, circulated and lodged versions reconcile; pending extensions retain original dates |
| W09 Other corporate events | Name and constitution changes, charge cases, dividends, bank mandates and specialist milestones | Preserve identity and predecessor versions; borrowing alone does not establish a registrable charge; unresolved specialist conditions block closure |
| W10 Service exit and cessation | Exit inventory, verified recipient, W04 link, handover evidence, strike-off milestones and confirmed legal outcome | Engagement and legal company status stay separate; applications do not cancel obligations or appointments |
| W11 Registers and custody | Current and historical records, original location, movement ledger, mail intake, authorised disclosure and certified extracts | A scan does not establish original custody; disclose only the approved scope and retain released copies |
| W12 Compliance and operations | CDD review, restricted escalation, credentials and renewals, allocation, fees, disbursements and billing references | Restricted reporting stays separate; credential expiry does not silently change appointments; invoicing does not clear filings |

Bespoke jobs require a named reviewer, defined scope, milestones, evidence, record consequences and completion criteria. Reuse the controlled case structure rather than adding unrestricted freeform “complete” switches.

## Screen contracts

### My work

The screen answers “What should I do next?” Display a page title and one primary “New job” action. Use one filter row for all work, assigned work, overdue, review, filing and waiting. Put small counts beside the filter labels. Avoid separate headline counters that repeat those same values. Counts must use the same access scope and query semantics as the list.

Default desktop columns are Company, Job, Next action, Due and Owner. The company name opens its file; the job title opens the case. Show the job state beneath the job title as plain text. Use staff names in the owner column. Reveal blockers, internal target and reviewer in the job preview. Offer search by job, company name and registration number; filters by owner, state, activity, due range and blocker; sorting by due date and company. Distinguish “My work” from all assigned-company work.

Preserve search, filters, sorting and scroll position when a user returns from a job. Encode shareable non-sensitive list state in URL parameters. Show active filters with a clear reset. Empty results say “No matching jobs” and offer “Clear filters”; a true first-use state offers “Create job”.

### Job workspace

The header contains company identity, job title, activity, owner and a compact state summary. The main area contains Next action, Checklist, Documents, Record changes, Filing, Correspondence and History. Use tabs for substantial peer sections, disclosure for infrequent metadata and a side panel for brief previews.

Every blocking item shows cause, responsible person, next action and relevant date. Required checklist items can be satisfied by evidence or an authorised, reasoned not-applicable decision. A checkbox alone cannot establish a legal event. The completion action evaluates requirements and returns a specific list of missing items.

Use a full route for complex editing and browser deep links. A 600 to 720px side panel is suitable for list inspection. Closing it restores focus to the invoking row and preserves the list. Avoid a small modal containing an entire case.

### New job

Begin with company and activity. Ask only for essential routing facts: trigger or instruction, scope/title, owner, reviewer and relevant date. Activity-specific questions follow after creation or in a short second step. Incorporation must allow a prospective company without a registration number. Save a draft for incomplete information.

Determine applicable deadlines through approved rules rather than treating an arbitrary date entry as a statutory deadline. If a deadline is entered manually, distinguish its type and capture source and reviewer basis. Check duplicate company-period obligations before creation. For specialist matters, capture a reviewer-approved plan.

### Review queue

Use a queue with a persistent detail pane when the available width permits it. Show company, event, requested decision, affected versions, proposed record changes, unresolved warnings and the evidence supporting them. Default to the most urgent actionable requests.

The decision action names its scope, such as “Approve pack v3” or “Confirm appointment effective 20 Sep”. “Approve company” is too broad. Returning a pack requires a reason and assigns the next action. Material edits invalidate the relevant approval, visibly explain why and preserve the old decision. Self approval follows the configured policy and remains visible.

### Company file

Display legal company status and engagement status independently. Present current identity, registration number, incorporation date, financial year end, responsible secretary, owner and unresolved verification gaps. Use a record-as-at control for historical views. Show the chosen effective date prominently; historical read-only views must not look like editable current data.

Officers use dated appointments; members use transactions and class totals; BO uses separate assessment and permissions; charges use specific security events. Material changes originate from event jobs. A convenient edit field must not bypass approval, event history or record consequences.

### Obligations and calendar

Prefer an upcoming list for precise work; offer a month view for planning. Show statutory deadlines and internal targets with separate labels and visual treatment. Each obligation opens its job and explains the source rule version, trigger date and calculation. Queries, extensions and dependencies remain attached to the obligation.

Calendar dragging must not change statutory deadlines. A rule change or financial year-end change produces an affected-work preview for review. Preserve prior completed periods and original dates.

### Documents and signatures

Default to a compact list with title, company, type/period, current version, document state and owner. A document detail view provides source records, approved template version, review, issued copies, signer capacities, sent and received dates, execution evidence and version history.

Keep drafts, reviewed, issued, executed and submitted copies distinct. The “current” version and the “filed” version may differ and should be explicitly labelled. Uploading a scan records evidence; it does not automatically satisfy every signature or original-custody requirement. A material edit after review creates a new version and reassessment of dependants.

### Filing record

Display readiness requirements, filing channel, exact package, submission time, reference, fees/payment evidence, query history, response date and authority outcome. Use “Record external submission” for manual logging. Use the authority’s actual outcome language; an acknowledgement is not automatically substantive approval.

Recording a submission leaves outcome confirmation outstanding. Show query or rejection as unresolved work. Preserve every attempt and its package. A missing receipt prompts a specific evidence task.

### Correspondence and custody

Correspondence entries capture direction, counterparty, channel, received/sent date, version, owner, required response and evidence. “Record correspondence” logs an external communication. Sending messages is a separate future integration decision.

Custody captures original type, identifier, location, custodian, condition, movement and recipient receipt. A release request has requester, authority, purpose, scope, reviewer decision and exact released copies. General handover packs exclude restricted BO and compliance material unless specifically authorised.

### Billing and manager overview

Billing shows service, operational completion, agreed fee, disbursements, payment evidence, billing status and handoff reference. Keep financial amounts right aligned with tabular figures. Readiness for billing does not imply successful filing, and invoicing cannot close an unresolved obligation.

The manager view prioritises unowned work, overdue obligations, stalled requests, missing evidence and workload by owner. Summary values drill into underlying records. Avoid decorative charts or an invented “compliance score”. Reassignment captures reason and prior ownership history.

### Administration

Use separate sections for users/capabilities, approved document templates, obligation rules, activity checklists, secretary credentials and retention policies. Catalogues have version, status, approver, effective date and source. Rule/template changes preview affected work and are reviewed before activation. Archived records remain recoverable under policy; authorised disposal and legal holds are distinct operations.

## Visual directions for evaluation

| Direction | Structure | Strength | Tradeoff | Best use |
| --- | --- | --- | --- | --- |
| A Workbench | Navy sidebar, counted filters, company-first work table and case drawer | Next action, due date and owner are visible together | Wide tables need contained scrolling on narrow screens | Executive daily work and general application shell |
| B Review desk | Light navigation, company-led queue and adjacent case detail | Keeps evidence and the next item in context | Narrow screens need stacked list and detail | Review, filing preparation and repeated case processing |
| C Portfolio | Horizontal navigation, company files and an exceptions column | Open company work and urgent exceptions are easy to inspect | Lower record density than the daily work table | Manager overview and partner reporting |

Use A as the provisional implementation reference until the owner selects otherwise. Do not mix the three typography and colour systems indiscriminately. A combined approach should reuse A’s tokens while borrowing a useful page structure from B or C.

## Design tokens

The following proposed tokens define the production direction A. Prototype B and C deliberately vary these values for comparison.

```json
{
  "colour": {
    "text": "#252b32",
    "muted": "#606972",
    "canvas": "#ffffff",
    "surface": "#ffffff",
    "border": "#e0e3e6",
    "accent": "#284b5c",
    "accentTint": "#f0f4f6",
    "navigation": "#1c2d39",
    "focus": "#346f99",
    "dangerText": "#a83230",
    "warningText": "#76581c",
    "successText": "#356047"
  },
  "space": [4, 8, 12, 16, 20, 24, 32, 40, 48],
  "radius": {"control": 4, "panel": 4},
  "type": {"metadata": 12, "body": 14, "section": 17, "page": 24},
  "layout": {"sidebar": 208, "header": 58, "pageInset": 32, "maxContent": 1540},
  "control": {"height": 40, "tableRow": 64, "compactRow": 44},
  "motion": {"feedbackMs": 120, "panelMs": 180}
}
```

Use a single system sans-serif stack across all three options. Use weight 400 for body, 500 for values and 600 for headings. Use tabular numerals for registration numbers, counts, dates and amounts. Keep display faces out of the operational interface.

Use 14/20px body text, 12/18px table and secondary text, 17/24px section headings and 24/31px page headings. Keep controls and critical data at least 12px. Use sentence case throughout. Headings stand on their own without uppercase kicker labels. Use larger text where reading comfort requires it.

Use hairline borders and minimal shadows. Reserve shadows for overlays. Panels group related material rather than framing each value. Keep one primary action per working region; use neutral buttons for secondary actions. Use plain text for routine states, with red for blockers and overdue dates and green for evidenced readiness. Keep the full state name available. Coloured capsules and dots are unnecessary for every field. Icons use one 18px outline family and consistent stroke weight; pair with labels unless the action is universally clear and accessibly named.

Dark mode, alternative branding and custom themes are deferred until the main direction is selected. Validate every selected foreground/background pair before production; these values are a starting palette, not an accessibility certification.

### Refinement decisions

The October refinement applies the [Impeccable](https://github.com/pbakaus/impeccable) polish and distill guidance to this operational interface. Retain these decisions during later implementation:

- Company names, next actions and deadlines lead; decorative counters and statistics do not.
- Use a company file link and a separate job link. Avoid a redundant arrow at the end of every row.
- Display responsible staff by name. Initials and coloured avatar discs are not sufficient identification.
- Keep routine statuses as text. Reserve stronger emphasis for blockers, overdue dates and filing readiness.
- Use table rules, spacing and alignment to group information. Avoid nested cards, cosmetic borders and coloured callout rails.
- Use a single sans-serif type system across the alternatives. Layout, rather than an editorial font, distinguishes the portfolio view.
- Keep the four workflow states independent in the case view. Visual simplification never merges their meanings.
- Remove duplicate upcoming-work and recent-activity panels from the work list. Calendar and case history remain available through their existing destinations.
- On phones, selecting a queue item moves to its detail and offers a clear return to the jobs. Closing a case drawer returns focus to its invoking job.
- Prototype tools belong in the small comparison bar. Layout changes do not need a toast notification.

## Component contracts

| Component | Required behaviour | States |
| --- | --- | --- |
| Application shell | Stable navigation, clear current page, company context when needed | Expanded, compact, mobile navigation |
| Page header | One title, optional compact context, one primary action | Default, historical, read only |
| Data table | Semantic headers, meaningful sort controls, optional selection and horizontal overflow | Loading, rows, empty, filtered empty, partial error |
| Filter toolbar | Search, scoped filters, result count, reset | Default, active filters, no matches |
| State label | Plain text with restrained semantic colour; use a badge only when its container adds meaning | All canonical states and derived conditions |
| Next action | Action, owner, relevant date and blocker where applicable | Actionable, awaiting external response, blocked |
| Case drawer | Labelled dialog, focus containment, Escape, return focus, context preserved | Viewing, editing, unsaved changes |
| Review panel | Specific version, evidence, diff, dependencies and named decision | Awaiting, approved, returned, invalidated, stale |
| Before and after diff | Field names, previous/proposed values and effective date | Proposed, approved future, posted, corrected |
| Signer matrix | Signer, capacity, required status, dates and version | Not sent, outstanding, partial, complete, superseded |
| Deadline summary | Statutory date, internal target, rule and extension status | Upcoming, overdue, extension pending, revised |
| Document list | Version and state visible with retained history | Draft, reviewed, issued, signed, superseded, void |
| Evidence attachment | Filename, type, uploader/date, linked purpose and safe preview/download | Uploading, checking, retained, failed, restricted |
| Checklist item | Required condition, evidence link, responsible person and allowed N/A reason | Outstanding, satisfied, N/A approved, reopened |
| Audit timeline | Actor, time, action, scope/version and source | Recorded, corrected through a new event |
| Confirmation dialog | Exact affected object and consequence with meaningful buttons | Confirm, cancellation, blocking validation |
| Notification | Concise result, optional recovery action, appropriate live region | Success, error, warning, information |
| Empty state | Distinguish no records, no matches and unavailable data | First use, filtered empty, access restricted |

Use disclosure for legal sources, secondary dates, version history and infrequent settings. Keep the next action, deadline, missing requirement and consequential warning visible. Tooltips are supplemental, keyboard accessible and never the only place for essential instructions.

## Language and content policy

Write task labels instead of tutorial paragraphs. Prefer “New job”, “Review pack v3”, “Record signature”, “Record submission”, “Return pack” and “View history”. Use “Company” in navigation and retain full legal names in records. Expand uncommon abbreviations on first meaningful use or provide a concise definition on demand.

Keep permanent helper text only where the field is ambiguous, the format is unusual or a material consequence needs explaining. Use visible field labels; placeholders may show an example but never replace the label. Show validation after a relevant interaction or attempted submission and preserve entered values.

Examples:

| Context | Preferred copy |
| --- | --- |
| Missing signature | “Director consent is missing Adrian Lee’s signature.” |
| Returned pack | “Update the effective date and request review again.” |
| Pending outcome | “Submission recorded. Outcome confirmation is outstanding.” |
| No matching records | “No matching jobs” with “Clear filters” |
| Invalid date | “Enter the date the signed consent was received.” |
| Stale review | “This pack changed after you opened it. Review version 4.” |
| Unsaved changes | “Discard changes to this job?” with “Keep editing” and “Discard changes” |

Use red for errors, blockers or critical overdue work, amber for unresolved dependencies and green for evidenced positive states. Routine review, draft and waiting states stay neutral. State labels name the actual condition, rather than “Good”, “Done” or a vague confidence score.

## Responsive and accessibility requirements

Target WCAG 2.2 AA for production. Use a 3px focus outline with sufficient contrast as a design convention; the stronger WCAG Focus Appearance criterion is AAA, while Focus Not Obscured Minimum is AA. Standard text needs at least 4.5:1 contrast, with applicable large-text exceptions. Pointer targets must satisfy the 24 by 24 CSS pixel minimum or its specified exceptions; use 40px controls and preferably 44px touch targets where practical.

- At 1280px and above, use the full sidebar and table; allow split review panes where adequate reading width remains.
- At 900 to 1279px, reduce shell width and secondary columns. Preserve required data through detail views, not unexplained clipping.
- At 650 to 899px, use compact navigation and prioritize the working region. Review can use a narrower split or switch to sequential list/detail.
- Below 650px, use stacked content, full-width case views and a labelled navigation control. Avoid hiding essential information solely to make a screenshot fit.
- The daily work table becomes stacked rows below 650px, preserving company, job, next action, due date, status and owner. Other dense tables may scroll inside their own region. The page should reflow without whole-page horizontal overflow.
- Test at 390px, 768px, 1280px and 1440px, at 200% zoom and with keyboard only. Check reflow at 320 CSS pixels for ordinary content.
- Use landmarks, heading hierarchy, semantic buttons, labelled form controls and associated errors. Use proper table headers and captions.
- Use a tested accessible tab pattern or simple navigation links for tabs. Arrow-key behaviour must not interfere with text editing.
- Dialogs receive focus, contain it, support Escape when safe, make the background inert and restore focus to the trigger. Nested dialog behaviour needs deliberate handling.
- Announce asynchronous results using live regions. Keep important errors in place; do not rely on a transient toast.
- Respect reduced motion. Avoid animation that communicates a workflow outcome on its own.

## Loading failure and safety states

| Situation | Required response |
| --- | --- |
| Initial data load | Structure-preserving skeleton; no fake zero counts |
| Failed refresh | Preserve readable previous data with a labelled refresh failure |
| Empty portfolio | Offer the appropriate initial company/engagement action |
| Partial import | Show accepted and rejected rows with recoverable reasons and source references |
| Unsaved edit | Show save state and prompt before discarding meaningful changes |
| Permission denied | Explain unavailable access without revealing restricted facts |
| Connection lost | Preserve local entered values; do not show a successful mutation |
| Duplicate submit | Disable pending action and make the server operation idempotent |
| Concurrent edit | Detect stale versions; show changed fields and request fresh review |
| Upload failed | Retain context, name the failed file and allow a retry |
| Missing mandatory evidence | List concrete missing items next to the blocked action |
| Not applicable request | Require the reviewer’s reason and evidence where relevant |
| Completed record correction | Create a linked corrective event and preserve the original |

Confirm consequential actions such as posting records, confirming an outcome, cancelling a job with effective consequences, releasing records or authorised disposal. Routine filter changes and opening records do not need confirmations. Name the object and effect in the confirmation rather than using a generic “Are you sure?”.

## Conceptual implementation boundaries

This is a proposed domain seam map, not an approved stack or database design.

| Module | Responsibility | Shared contract |
| --- | --- | --- |
| Company records | Dated identity, appointments, member ledger, BO and charges | As-at queries and reviewed change proposals |
| Casework | Jobs, activities, dependencies, checklists, assignments and correspondence | Explicit next action and completion evaluation |
| Obligations | Applicability, triggers, rule versions, date calculations and extensions | Explainable deadline result with provenance |
| Documents | Templates, versions, review scope, execution and evidence | Immutable reviewed/submitted version references |
| Filings | Readiness, attempts, queries, payment and outcomes | Exact submitted package and actual authority wording |
| Access and audit | Company scope, sensitive capabilities and actor history | Server-side authorisation and attributable actions |
| Service operations | Fees, disbursements, billing handoff and credentials | Independent operational and billing state |

Persist approvals against immutable data/document versions. Use concurrency tokens for consequential mutations. Posting a share event should reconcile related holdings atomically. Audit events should be append-only or corrected through additional attributed entries. Define retention, legal holds, backup/restore and controlled export before live operation.

Deadline rules should be approved, versioned data with calculation provenance and a controlled execution mechanism. Do not scatter legal deadlines as hardcoded constants across components. Keep date and completion decisions in domain services so every screen agrees.

Use semantic HTML and shared design tokens regardless of framework. A future React/TypeScript implementation may use an established accessible component library, but framework selection is open. The prototype’s single-file global state is disposable and should not become the production architecture.

## Data and interaction details

### Minimum record fields

| Record | Fields that the design must account for |
| --- | --- |
| Company | Stable internal ID, legal identity, registration number if assigned, legal status, engagement status, incorporation/FYE dates, responsibility and verification state |
| Person or organisation | Stable identity, party type, dated particulars, contact details, verification evidence and company relationships |
| Job | Company, activity and subtype, trigger, scope, owner, reviewer, canonical state, dates, next action, dependencies and completion requirements |
| Obligation | Company/period, approved rule version, applicability, trigger, statutory date, internal target, original/revised dates, exception basis and owner |
| Document version | Document identity, exact version, template version, source snapshot, changes, review scope, signature requirements and evidence |
| Record change | Before/after values or ledger transaction, effective date, entry date, evidence, reviewer, predecessor and correction link |
| Filing attempt | Filing task, package version, lodger, submitted date, channel, reference, payment/evidence, query and actual outcome |
| Correspondence | Case/company, counterparty, channel, direction, date, document version, owner, required response and evidence |
| Custody event | Original identifier, type, source/recipient, location, custodian, movement dates and receipt evidence |
| Decision and audit event | Actor, capability/role, action, timestamp, affected scope/version, reason and linked evidence |
| Billing handoff | Service fee, disbursements, payment evidence, readiness, billing reference and handoff dates |

These are design coverage fields, not a database schema. Exact types, constraints and relationships belong in the approved implementation design.

### Search and navigation continuity

Global search can group results into companies, people, jobs and documents; start with exact registration-number matches and recent accessible work. Show enough context to distinguish people with similar names. Preserve full values in detail and accessible labels when long names are visually truncated. A missing permission must not leak through suggested searches or result counts.

Use pagination for large lists; retain a simple full list at the initial small scale when performance remains good. Avoid premature virtualisation that disrupts keyboard navigation or find-in-page. Give every consequential save an explicit pending and result state. A row should not move out of view during editing merely because its sort value changes.

### Batch work and notifications

Batch actions can assign work, change approved non-statutory metadata or download an authorised selection. Show the selected count, scope and any ineligible records. Keep decisions that depend on specific versions and evidence individually reviewable; a bulk approval must never hide unresolved requirements.

Internal notifications should link to a concrete job or decision, group duplicate reminders and distinguish unread from unresolved. Reading a notification does not resolve work. Chasers to clients remain external communications that staff record. Avoid interruptive toasts for every background refresh; reserve immediate feedback for the user’s own action or a material conflict.

### Performance and privacy

Set measurable performance budgets when the production stack is chosen. Suggested targets for a representative 20-company dataset are a usable initial work list within two seconds on the agreed office connection and perceptible feedback within 150ms after a local interaction. These are proposed targets, not measured prototype results. Measure realistic documents and histories before increasing page size or adding complex charts.

Keep identity evidence, BO details and restricted compliance content out of ordinary telemetry, URLs, browser storage and error messages. Serve private attachments through authorised access; confirm content type and size, scan uploads under the firm’s policy and record access where required. Aggregate product analytics, if adopted, around task completion and errors without collecting client document contents. Masking a field is a presentation choice and does not replace access control.

## Delivery sequence

Phasing orders implementation; it does not remove W01 to W12 from scope.

1. **Foundation:** select visual direction, confirm roles and terminology, approve sample records, build shell, company identity, shared job workspace, access boundary and audit contract.
2. **Vertical slice:** implement W03 plus a linked W04 event. Demonstrate anniversary snapshot, review versions, independent effective record and filing status, query handling and closure evidence.
3. **Shared records and execution:** add W05/W06/W07, member ledger, controlled BO assessment, document version/signature matrix and reconciled record consequences.
4. **Lifecycle and operations:** cover W01/W02/W08/W10/W11/W12, original custody, disclosure, financial periods, billing and firm credentials.
5. **Remaining corporate cases:** complete W09 routines and reviewed specialist plans, then verify representative exception cases across the full catalogue.
6. **Release readiness:** approve legal catalogues, verify permissions/exports, reconcile reports, demonstrate recovery and validate real examples with the practising secretary.

For each slice, deliver the applicable screen, transitions, failure states, audit events and scenario evidence together. Avoid building every visual screen before verifying one complete operational workflow.

## Acceptance scenarios

| Scenario | Observable pass condition |
| --- | --- |
| Takeover with missing history | Verified and unverified facts differ visibly; inherited late jobs retain owners and dates |
| Director change near anniversary | Annual return snapshot uses the anniversary position and exposes the filing sequence dependency |
| One person in three companies | One shared personal history prompts three separately evidenced notification tasks where applicable |
| Transfer and allotment | Transfer preserves class units; allotment increases issued units; before and after totals reconcile |
| BO nonresponse | Outstanding notice, chasers, owner and escalation remain visible without confirming ownership |
| Partly signed resolution | Required missing signature prevents execution-dependent action |
| Queried or rejected filing | Original attempt remains; query and response date create actionable unresolved work |
| Extension pending | Original operative deadline stays visible until a revised date is approved with evidence |
| Correction after filing | Original filed version remains unchanged and a linked correction/review case appears |
| Service exit or strike off | Engagement and company legal status remain separate and obligations are assessed individually |
| Restricted disclosure | Only authorised material is released; recipient, scope, authority and exact copies are retained |
| Billing after completion | Ready-to-bill is independent; paid work with outstanding filings still appears unfinished operationally |
| Revised reviewed pack | Revision invalidates affected approval and dependent readiness; prior approval remains in history |
| Future-dated appointment | Approved event appears in future history while current officer list stays unchanged until effective |
| Concurrent share events | Incompatible pending transactions are detected before posting; holdings cannot become negative |
| Rule version change | Affected open-work preview is reviewed; completed periods retain original provenance |
| Access through search or export | Restricted information remains protected across results, counts, previews and downloads |
| Manager totals | Summary counts drill into exactly the records counted under the same filters |

## Prototype scope and evaluation

The HTML provides three switchable layouts using the same six fictional companies and six seeded jobs. It includes My work, company file examples, review queue, calendar, document list, billing handoff and design guide. All changes live in memory and reset on refresh. `?variant=A`, `?variant=B` and `?variant=C` preserve the selected layout in the URL. The floating bottom switcher is prototype tooling only.

Demonstrated interactions include search, filters, sorting in A, opening case detail, role preview, version-specific review, returning a pack, revising a document, recording a case note, recording an external submission and creating a job. Filing submission leaves the outcome outstanding; approval does not automatically make a pack filing-ready. New annual return creation includes a simple company-year duplicate example.

The prototype does not implement real authorisation, legal calculations, document generation, uploads, statutory record posting, complete signature capture, outcome closure, historical as-at queries, full CDD controls or the entire W01 to W12 catalogue. Company particulars are illustrative fixtures. The creation form is intentionally reduced and is not the complete production contract above. No “complete job” shortcut is provided.

### Evaluation session

Ask an executive, reviewer and manager to perform these tasks without coaching:

1. Find the overdue appointment and identify the missing evidence and owner.
2. Inspect the annual return and explain why its snapshot and linked filing are separate.
3. Switch to Reviewer, review the exact pack version and explain what approval changed.
4. Switch to Lodger, open the ready financial statements job and record an external submission; confirm that outcome is still outstanding.
5. Find the current company file, its officer history and its open work.
6. Compare A, B and C for the same task; identify which layout needs the fewest context switches.

Record first action, completion, errors, missed warnings and confidence. Candidate targets for the next validated build: at least four of five representative users find the overdue item within 15 seconds and correctly distinguish submission from confirmed outcome. These are proposed usability targets, not measured results.

## Decisions to make before implementation

| Decision | Proposed default | Decision owner |
| --- | --- | --- |
| Main visual direction | A, with B’s structure for reviews | Product owner and staff |
| Manager reporting surface | Portfolio mode within My work | Manager |
| Default list density | Comfortable; optional compact later | Product owner |
| Role combinations and self approval | Explicit policy and visible attribution | Practising secretary and manager |
| Deadline and document catalogues | Approved versioned sources | Practising secretary |
| Historical record posting rules | Evidence-based effective dates | Practising secretary |
| Restricted BO and compliance access | Separate capabilities and export policy | Compliance lead |
| Language | English first; confirm Malay terminology needs | Product owner |
| Branding and firm customisation | Single firm brand for first release | Product owner |
| Authentication and hosting | Separate architecture decision | Technical owner |
| Retention, backups and legal holds | Approved category-specific policy | Firm and technical owners |
| Integrations | Manual external evidence capture initially | Product owner |

The next useful decision is which structure staff prefer. Colour refinement can follow after the workflow is understandable.

## Research and application

These sources informed the interaction proposals. They are design references, not legal authorities. Reviewed 22 October 2026. No source text is reproduced verbatim.

- [Nielsen Norman Group Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) supports revealing less frequent choices on demand. Applied here to version history, source rules and secondary dates; essential blockers remain visible.
- [IBM Carbon Data Table Usage](https://carbondesignsystem.com/components/data-table/usage/) describes tables, toolbars, sorting, row expansion and actions. Applied to case queues and shared table controls.
- [W3C WCAG 2.2 Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) provides the pointer-target baseline and exceptions. Applied to control sizing and dense layouts.
- [W3C WCAG 2.2 Focus Not Obscured Minimum](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) addresses focused controls hidden by authored content. Applied to fixed navigation, overlays and sticky actions.
- [W3C WCAG 2.2 Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) provides text contrast thresholds. Applied to muted text, badges and neutral surfaces.
- [GOV UK Design System Error Message](https://design-system.service.gov.uk/components/error-message/) covers actionable inline errors and preserving answers. Applied to forms and recoverable validation.

The recommendation to use A as the main shell and B for review is a design judgment based on this product’s repeated casework and small internal team. It is not a finding established by these sources.
