# Workflow API actions

POST `/api/jobs` body `{companyId,activity:'W03'|'W04',ownerId,year?,anniversaryDate?,route?,personId?,personName?,effectiveDate?,routeBasis?,internalTarget?,statutoryDue?,manualDateBasis?,manualDateEvidenceId?,sourceEvidenceIds?,dependencyIds?,checklistVersionId?}`. W03 requires year/anniversary; W04 route/person/effectiveDate/basis. All YYYY-MM-DD dates validated. requestId separate body field read by adapter.

POST `/api/jobs/:id` always includes `{expectedRevision,requestId,action,...}`. Defaults omitted arrays only where documented:

- `revise_pack`: `{notes,documentIds,requiredSigners?,templateVersionId?}` appends version and retains preceding versions. Reuses checklist evidence and clears signatures; review/readiness invalidated by version binding.
- `checklist_evidence`: `{itemId,evidenceIds}` appends a material version with changed checklist evidence. Required checklist items cannot be deleted.
- `checklist_na`: `{itemId,reason,evidenceIds}` reviewer-only, appends version, reasoned N/A only for non-core checks; mandated source/consent/authority cannot be waived.
- `refresh_snapshot`: no payload. Only for open W03 `snapshotNeedsReview` with no filing attempts. Archives old snapshot in snapshotHistory with original packVersion, rebuilds at the same anniversary, creates material pack version clearing evidence/output/confirmation; removes consequence flag.
- `capture_snapshot`: no payload. W03 only; future jobs keep snapshot null until anniversary, then one-time immutable capture allowed. Creates fresh pack version, clears prior outputs/client confirmation. Preparation/review/generation blocked until snapshot captured.
- `confirm_client`: `{evidenceId}` for W03; material confirmation invalidates prior approval if any.
- `request_review`: no payload; checks required preparation evidence/documents/client confirmation.
- `review`: `{scope:'pack'|'record'|'manual_date'|'readiness',decision:'Approved'|'Returned',reason,version}`. Exact current version required. Independent reviewer only. Record/readiness approvals do not automatically post or submit.
- `sign`: `{signer,evidenceId,receivedDate}` required current-version signer. Execution evidence follows exact pack version; no automatic record posting.
- `post_record`: `{confirmed:true}` W04 only, independently reviewed record/effective date/source and executed pack required. Appends officer event atomically.
- `authorise_readiness`: no payload. Reviewer capability; current pack approval/signatures, dependencies and manual date review required; creates explicit readiness review.
- `filing_not_required`: `{reason,evidenceId}` reviewer assessed; separate filing track.
- `submit`: `{version,documentIds,submittedDate,reference,channel,evidenceId,paymentEvidenceId?}` lodger only; Ready state; exact current pack output required. On query/rejection obtain renewed readiness first; history remains.
- `filing_message`: `{kind:'Query'|'Rejection',wording,date,responseDue,evidenceId}` lodger; preserves latest attempt, sets queried/rejected, response work remains unresolved.
- `filing_response`: `{summary,date,evidenceId,messageId?}` lodger; records specific query/rejection response evidence. With messageId omitted, selects the oldest unanswered message in the latest attempt. Every message needs its own evidenced response before renewed filing readiness. The message retains optional `response` metadata; filing remains Queried/Rejected until readiness/resubmission.
- `confirm_outcome`: `{wording,date,evidenceId,confirmed:true}` lodger; actual authority wording, separately evidenced, requires submitted/resubmitted state.
- `correspondence`: `{direction:'Incoming'|'Outgoing',counterparty,channel,date,summary,ownerId,evidenceIds,nextChaseDate?}`; logs external message. New outgoing request sets waiting state, never sends anything.
- `correspondence_response`: `{correspondenceId,respondedOn,evidenceId}` closes one chase only.
- `assign`: `{ownerId,reason}` active scoped preparer required; retains reason/history.
- `dates`: `{internalTarget?,statutoryDue?,manualDateBasis?,manualDateEvidenceId?}` changes internal date or sets `manualDateProposal` for independent manual_date review. The existing operative statutoryDue stays unchanged until approval; deadlineHistory retains approved predecessors. Cannot silently remove existing statutory due date; manual-date approval invalidated.
- `link_dependency`: `{dependencyId}` same company; rejects self/cycles.
- `note`: `{html}` sanitised focused rich text; no state effect.
- `billing`: `{state:'Not ready'|'Ready to bill'|'Handed off'|'Invoiced',reason}` independent operational track.
- `complete`: `{confirmed:true}` all required checks, current pack review, record consequences, resolved dependencies and filing outcome/not-required needed.
- `cancel`: `{reason,confirmed:true}` preserves record/filing history; forbidden if outstanding incurred filing after event/submission. Closure needs resolved obligations.
Corrections are explicit new W04 jobs linked to the original via dependency; no mutation reopens closed originals.

Mutation errors preserve entered data; stale versions return conflict. `blockers(job)` describes completion blockers; `nextAction(job)` provides work queue wording. Job fields remain independently inspectable.

Operational defaults: omitted internalTarget uses settings preparationLeadDays before W03 anniversary or W04 effective date (internal only); explicit null stays empty. Outgoing correspondence with omitted nextChaseDate uses settings chaseIntervalDays from sent date; explicit null records no chase. Optional checklistVersionId requires effective Published checklist; each paragraph/list/plain line becomes an additional mandatory item (1–30, <=500 characters). Protected core checks remain. Exact version ID is retained on Job.
