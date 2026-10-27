# Superior ComSec: what their resolution feature looks like

**Source:** YouTube, "Superior ComSec - Members' Written Resolution" (Superior IT Solutions, about 3 min 40 s, uploaded about five years ago; software build shows version 2017.16). https://www.youtube.com/watch?v=t6HgzrLx1_Q
**Reviewed:** 26 October 2026, by stepping through the video frame by frame (about 30 frames, roughly every 8 seconds).
**Limits:** The video demonstrates one flow only: an AGM-related **members' written resolution**. Director appointment/resignation appears only as a list of event names; we did not see its forms. Field lists below are what was visible on screen, not a full feature inventory.

This is a reference for product ideas. It is not a source for legal wording or rules. Any statutory text or timing seen in their output (for example the 28-day lapse note) must come from our own approved sources before we use it.

---

## 1. The big idea: resolutions are assembled from a clause library

Superior ComSec does not have one template per resolution document. It has a library of small **events**. Each event is one resolution item, such as "Appointment of auditors" or "Directors' fees". The user builds an **activity** (for example AGM no. 3) by picking events from the library and ordering them. The software then prints the whole set as one document, in whichever format is chosen.

```
Activity (AGM no. 3, company, dates, signers)
 ├─ 1. Authority to sign letter of representation   ← event from library
 ├─ 2. Adoption of reports and accounts – tabled
 ├─ 3. Election of directors
 ├─ ...
 └─ 8. Appointment of auditors
         │
         ▼  Report: choose output type(s)
   Members' Written Resolution / Directors' Resolution / Minutes / Notice / Extract ...
```

Each event stores **three wordings**: one for minutes, one for the notice of meeting, and one for the directors'/members' resolution. Choosing a different output type pulls the matching wording for every event in the activity.

This is the most important difference from our current plan (see section 7).

## 2. Screen layout and navigation

- **Top bar:** Search Company, Search Personal, then the selected company name and registration number. Everything below works in that company's context.
- **Left sidebar:**
  - Particular Information → Company Info
  - Activities
  - Register Reports → Director, Secretary, Manager, Member, Charge/Discharge
  - Other, Attachment, Document Viewer
- **Status bar shortcuts:** Create Search Name, Create New Company; current user and role.
- **Menus:** Setting, Report, Window, Tools, Help.

## 3. Activities screen

Tabs, one per activity category:
Director · Secretary · Manager · Auditor · Members · AGM · Meeting · Other · Charge · Tax Agent · Bank · Dividend · History

Each tab has the same layout:

| Left: "[Category] Activities" | Right: "Events List" (library) |
| --- | --- |
| Activity number, Create Activity, Delete Activity | All available events for this category |
| Ordered table: Order, Event Name | **Select** adds the event to the activity |
| Right-click to change order; drag and drop to reorder | **Create New Event** adds a custom event |
| Buttons: Other Info, Attendance List (Invitation), Delete Event, Edit | |

Bottom actions: **Report** (produce documents) and **Post Activity** (commit the outcome to the registers).

### Event libraries seen

**Director tab:** Appointment; Appointment of alternate director; Appointment of Managing Director; Appointment of new [cut off]; Cease of alternate director; Change; Deceased; Deceased of alternate director; Removal; Removal of Managing Director; Resignation; Resignation of alternate director; Resignation of Managing Director; Retirement; Revoke of alternate director.

**AGM tab:** Adoption of reports and accounts; Adoption of reports and accounts – tabled; Allotment; Appointment of auditors; Authority to make directors' declaration; Authority to sign directors' report; Authority to sign directors' statement; Authority to sign letter of representation; Change name; Change object; Directors' fees; Directors' fees – no fees provided; Election of directors; Final dividend.

## 4. Activity-level information (shared by every event in it)

"AGM Information" dialog fields:

- AGM number; date of incorporation (filled from company record)
- **Act** dropdown (Companies Act 2016; implies older Act wording is also kept)
- Meeting address with an address lookup button; postcode, town, state
- Last AGM date; "Assign AGM date" checkbox with start and end date/time
- Annual return date; notice date
- EPC certificate checkbox; auditor and partner (from company record)
- Annual return shareholding sort: by share units, member name or folio number
- Chair by: member or director, then the person
- **Directors grid** with per-director checkboxes: DR (directors' report), DS (directors' statement), SD (statutory declaration). These decide who signs what.
- Annual return signed by: both, director or secretary
- Checkboxes: "Transfers of share have been registered", "Secretary attends meeting"

## 5. Event-level information

Opening an event in an activity shows its three wordings (Minutes / Notice / Resolution) with placeholder tags already filled where possible, plus inputs specific to that event:

- **Approval of financial statements:** year-end "from" and "to" dates, which fill `<<Year End>>`.
- **Directors' fees:** sub-tabs "Director fees" and "No fees provided" (two variants of one event). A table lists the company's directors with a Select checkbox and a fee per person, Add/Edit/Delete rows, a total, and "Show director fees table in report".
- Buttons: **Use default** (reset to standard wording) and **Change Minutes/Notice/Resolution** (edit the wording for this one activity only).

## 6. Producing the document ("Report for Multiple Activity")

Three tabs plus a signers panel:

- **Section:** pick the statutory sections to cite (seen: Section 260, Section 68).
- **Report / Letter:** tick one or more outputs: Circulation of audited financial statements; Directors' circular resolution; Directors' resolution; Directors' written resolution; Extract resolution; Members' circular resolution; Members' resolution; Members' written resolution; Minutes – AGM; Notice – AGM.
- **Signature setting:** layout per type, for example "H:2.5, D:2-col, M:2-col" (header spacing, directors two columns, members two columns).
- **Settings** tab (contents not shown).
- **Signers:** separate tabs for Director Sign By, Member Sign By and CTC (certified true copy) Sign By. Each is a checkbox list with drag-and-drop ordering, check/uncheck all and "Show all".
- **Extract resolution / annual return signed by:** director name and secretary name dropdowns.
- **Form / notice (first board meeting) signed by:** director and secretary dropdowns; sign by director or by secretary.
- **Declare at town, in the state of, date, lodger** (person lodging), EGM checkbox, Cover Letter, Other Info.
- Buttons: **Preview**, **Print**, Close.

The date entered here drives computed dates in the output. On screen the tutorial says the lapse date in the report is 28 days after this date; changing 1 Aug 2017 to 1 Sep 2017 moved the printed lapse date from 29 Aug 2017 to 29 Sep 2017, and the "Dated this" line followed.

### Output seen (Members' Written Resolution, 2 pages)

1. Company header: name, registration number, "(Incorporated in Malaysia)".
2. Title, then the header sentence: "Pursuant to Section 306 of the Companies Act 2016, we the undersign hereby RESOLVED :-". The section reference comes from a per-company setting (section 8).
3. One heading and paragraph per event, in activity order. Bound values (director names, auditor firm and number, year end) appear in bold.
4. Closing clauses (company secretary authority, indemnity).
5. "Dated this : 1st August 2017", "All members at date of resolutions", then a signature line per selected member.
6. "Important Notice of Members": a numbered list including the computed lapse date.

Preview window: page thumbnails, page navigation, zoom, print and save/export.

## 7. Company record ("Edit Company")

Tabs: Company Info, Address, Director, Secretary, Manager, Member, Auditor, Business Nature, Charge, Tax Agent, Share Capital, Remark, Setting, Lodge, Bank, Dividend.

Company Info fields: company name, former name, company number, approval number, reference number, identifier, GST register number, date of incorporation, email, website, telephone, fax, mobile, SSM info, non-active, show in report, PLC.

**Resolution section (per company):** dropdowns for the **Director** authority (e.g. "Article 90 of the Articles of Association"), **Member** authority (e.g. "Section 306 of the Companies Act 2016") and **Election** authority (e.g. "Article 63"). These fill `<<Member Article No>>` and similar tags, so each company's constitution is cited correctly.

Also: entry by, date of change, common seal held (in/out dates), password protection, annual return and accounts due dates with 1st/2nd/3rd reminder checkboxes, Back to Pre-Incorporation, Confirmation Letter, M & A.

## 8. Template administration (Setting menu)

Setting menu items seen: Company Profile, User Profile, Individual Master, Company/Audit Firm Master, Tax Agent Master, **Resolution Format**, Event Description, Report Setting, Form Setting, Set Service Address, plus lookup lists (Identifier, Nature of Business, Occupation, Due Date, Race, SSM Profile, Country/Nationality, Bank, Bank Branch, Condition, Malaysia State, Confirmation Letter – Company, Working Hour, List of Financial Record, List of Register Books).

**Resolution Format** submenu: Auditor, Bank, Charge, Director, Dividend, First Director Meeting, **Header**, **Footer**, Secretary, M & A, Manager, Meeting/AGM → Act 2016, Member, Tax Agent, Other.

- **Header Setting:** one header wording per document type (Circular Resolution – AGM, Directors' Circular Resolution, Directors' Resolution, Directors' Written Resolution, Extract Resolution, Members' Circular Resolution, Members' Resolution, Members' Written Resolution, Notice – AGM). Rich-text editor; Use default / Save / Cancel.
- **Event list per category:** columns Event Name, System (built-in flag), Order No, **Not Use** (hide from library). Add, Edit, Delete; "Reset to default order no".
- **Event editor:** Word-style ribbon (Home, Insert, View, **System Field**, Header & Footer Tools, Table Tools Design/Layout). System Field group ("Mail Merge"): **Insert System Field** (dropdown), **Show All Field Codes**, **Show All Field Results**, **View System Data**. Three panes: Minutes, Notice, Directors'/Members' Resolution. Bottom: Use Default, Order No, Not Use, Save, Close. Tags appear as `<<Auditor Name>>`, `<<Auditor Firm No>>`, `<<Year End>>`.

So wording has three levels: built-in default → firm-wide edit in Settings → one-off edit inside a single activity. "Use default" resets at either level.

## 9. "Select Activity use" dialog

Lets the user choose which activity from each category (Director, Secretary, Manager, Auditor, Member, Tax Agent, Bank, Dividend, Other, AGM, Meeting, Charge) feeds a combined resolution or form, with an Act selector and "Select all". So one document can combine items from several categories (e.g. a director appointment plus an auditor change).

---

## 10. What this means for our plan

Compared with [RESOLUTION_BUILDER_IMPLEMENTATION_PLAN.md](../../RESOLUTION_BUILDER_IMPLEMENTATION_PLAN.md):

| Superior ComSec feature | Our plan today | Suggested change |
| --- | --- | --- |
| Clause library ("events"), assembled and ordered into one document | One template = one whole document | Add **clause templates** as a first-class versioned unit, and a **resolution assembly** (ordered clauses + header + closing + signature block). Whole-document templates can remain as "starter assemblies". Biggest change. |
| One clause, several wordings (minutes / notice / resolution) | Template has usage contexts only | Let a clause hold a wording per output type; the output type picks the wording. |
| Output types: directors'/members' resolution, written, circular, extract, minutes, notice | Board resolution, appointment, resignation | Make document type a configurable list; header wording keyed by type. |
| Activity-level shared fields (meeting date, chair, address, who signs DR/DS/SD) | Case fields exist (M3) | Treat these as resolution-case questions shared by all clauses, asked once. Fits A01 "ask once". |
| Event-specific structured input (directors' fees table) | Repeat blocks (M8) | Confirms need for repeat blocks over selected directors with per-row values and a total. |
| Clause variants ("fees" vs "no fees provided") | Conditional blocks (M8) | Either variants inside one clause or conditions; both fit M8. |
| Per-company authority citations (Article 90, Section 306) | Company custom fields (M2) | Add these as standard company fields bound into header/clauses. Concrete M2 requirement. |
| Signers chosen at output time; separate director / member / CTC lists; drag to order; signature layout setting | Signature block + repeat (M8) | Add separate signer roles and a column-layout setting to the signature block. |
| Computed dates (lapse date from circulation date) | "Derived" fields only where needed | This is a real need. Add a date-offset derived field, but the rule itself must come from an approved source, not from this video. |
| Default → firm → one-off wording, "Use default" | Versioned templates; overrides only for bound values | Consider a per-case wording override for a clause, audited and flagged for review. Needs an owner decision. |
| "Not Use", order number, system flag on library items | Archive state | Add display order and hide-from-library on clause templates. |
| Act selector (Companies Act 2016) | Effective date / source on versions | Add the governing Act as a template attribute used for filtering. |
| Post Activity updates registers | W04 posting stays separate | Same idea; keep our stricter review-before-posting. |
| Attendance list / invitation, notices, minutes | Full W07 meetings deferred | Keep deferred, but design clause wording so minutes/notice can be added later. |
| Preview with thumbnails, print | DOCX download, preview | Matches; they print directly, we export Word. |

### Things not to copy

- The Windows-desktop look, stacked pop-up windows and dense forms. Our approved Option A workbench design stays the visual authority.
- Legal wording, section numbers and day counts from their output. These need our own approved sources.
- Free-form wording edits without review. Any one-off wording change should be visible, audited and re-reviewed in our version.

### Open questions for the team

1. Do your users think in **clauses** (pick "Appointment of auditors" + "Directors' fees") or in **whole documents**? The video suggests clauses.
2. Which output types are needed first: directors' written resolution, members' written resolution, extract, circular, minutes, notice?
3. Should a preparer be allowed to edit a clause's wording for one company, or must changes go through the template library?
4. Which per-company constitution citations do you track (director, member, election articles)?
5. Can you share a director appointment/resignation tutorial or sample output from Superior ComSec? This video does not show that flow.
