# Company records implementation

Extend the existing company file and job workspace in Option A. W05 covers evidenced opening balances, allotments and transfers by class, exact integer units and decimal capital, immutable certificate history, independent version review and atomic posting. W06 covers separately authorised notices/replies/escalation, sourced ownership assessments, discrepancies, register entry, next review and manual e-BOS filing evidence. W07 meeting automation remains outside this slice; decisions/signatures are retained as evidence.

All company record changes originate in jobs. Draft proposal changes create a new pack version, invalidate relevant approvals and preserve earlier versions. Company locks serialize incompatible postings. Historical views use effective dates; entry timestamps remain distinct. Posted originals cannot be edited. Changes affecting filed annual snapshots stop for a specialist correction route; open snapshots are flagged and refreshed explicitly.

BO data, jobs, counts, reminders and documents require `view_bo` plus company scope, including direct downloads and API mutations. Existing accounts do not gain it automatically. Administrators can assign it explicitly. This module records reviewed assessments and evidence, without calculating legal applicability from shareholding alone or enabling ordinary exports.

Verification: pure ledger invariants; real MySQL rollback, races, idempotency, stale reviews, dated queries and access tests; browser paths covering prepare/review/post, nonresponse, revised versions, narrow layouts, keyboard and larger text. Existing W03/W04 regressions must continue passing. No external filing, messages or real client data.

Source reference checked 22 October 2026: SSM Companies Act 2016 legal-framework index and e-BOS overview. The index includes revised BO guidance and access regulations; no thresholds/deadlines are encoded from an obsolete guideline. Source/criteria versions are recorded per assessment and approved by the practising secretary.

- https://www.ssm.com.my/Pages/Legal_Framework/Companies-Act-2016.aspx
- https://www.ssm.com.my/Pages/ebos.aspx
