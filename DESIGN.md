---
name: CoSec Workspace
description: The approved Option A workbench for internal company secretarial casework.
colors:
  primary: "#284b5c"
  primary-hover: "#1e3b4b"
  ink: "#252b32"
  muted: "#606972"
  surface: "#ffffff"
  border: "#e0e3e6"
  control-border: "#cbd1d6"
  input-border: "#b9c2c9"
  selection: "#f0f4f6"
  navigation: "#1c2d39"
  navigation-text: "#c3ced7"
  navigation-selected: "#314656"
  focus: "#346f99"
  text-selection: "#d4e4eb"
  text-selection-ink: "#172d38"
  control-hover-border: "#98a7b1"
  control-pressed: "#e1e9ee"
  navigation-heading: "#e2e9ee"
  navigation-muted: "#b7c4ce"
  navigation-hover: "#283c4b"
  navigation-divider: "#40515e"
  tenant-text: "#59646d"
  placeholder: "#666f77"
  table-header-text: "#65707a"
  table-header: "#f5f7f8"
  row-border: "#e7eaed"
  row-hover: "#f8fafb"
  action-text: "#4f5c65"
  scrollbar-thumb: "#b9c2c9"
  scrollbar-track: "#f3f5f6"
  danger: "#a83230"
  success: "#356047"
  warning-surface: "#f8f5ed"
  warning-text: "#5f4c24"
  warning-border: "#e3d9c2"
typography:
  page-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.45px"
  section-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  record-link:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.5
  metadata:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  action-title-mobile:
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.45
  brand:
    fontSize: "19px"
    fontWeight: 600
    letterSpacing: "0.4px"
  case-title:
    fontSize: "21px"
    fontWeight: 600
    lineHeight: 1.4
  company-title:
    fontSize: "23px"
    fontWeight: 600
    lineHeight: 1.4
  caption:
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  navigation: "3px"
  control: "4px"
  dialog: "6px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  section: "24px"
  page: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
  navigation-item:
    backgroundColor: "{colors.navigation}"
    textColor: "{colors.navigation-text}"
    rounded: "{rounded.navigation}"
    padding: "11px 13px"
  navigation-selected:
    backgroundColor: "{colors.navigation-selected}"
    textColor: "{colors.surface}"
  state-blocked:
    textColor: "{colors.danger}"
    typography: "{typography.metadata}"
  state-ready:
    textColor: "{colors.success}"
    typography: "{typography.metadata}"
---

# CoSec Workspace design system

## Overview

**Approved direction: Option A Workbench, selected by the product owner on 22 October 2026.** This is the visual authority for new screens and refinements. The token frontmatter defines normative values; the prose explains their application. Read [DESIGN_SPEC.md](DESIGN_SPEC.md) for product boundaries, workflow states, permissions and acceptance scenarios.

The interface serves an internal professional services team working through company records, documents and statutory obligations. Its character is restrained, precise and familiar. Companies, next actions, deadlines and responsible staff carry the hierarchy. Consistent alignment and readable detail matter more than visual novelty.

Use one visual system throughout work lists, company files, review, documents, filings, calendar and billing. Options B and C remain archived explorations; they do not authorise alternative palettes or navigation shells. A useful interaction from an archive can be adapted within A's system when the task warrants it.

The current reference is [prototype/index.html](prototype/index.html). Aster and the sample records are fictional fixtures. Archived B/C and comparison-tool colours remain outside this approved palette; do not promote them into A to silence an advisory scan. The role selector, demo label and design-reference link support evaluation and do not define production authentication or navigation.

## Colors

The palette combines white working surfaces, a slate-navy navigation rail and one muted blue action colour. Resolve exact values from the frontmatter rather than adding parallel palette definitions to individual screens.

- **Primary:** primary actions, links and the selected filter underline. It is not a decorative section fill.
- **Ink and muted:** primary values and secondary context. Keep job titles and company names stronger than registration numbers and preparation metadata.
- **Surface and border:** flat working areas and light structural rules. Group related facts with alignment and spacing before adding another container.
- **Navigation:** a dark, stable anchor with tinted text and a restrained selected fill. Use the same rail across all approved screens.
- **Danger:** overdue dates, blockers and actionable errors. Keep the condition written out.
- **Success:** evidenced readiness or positive states. Approval, effective records and filing outcomes still retain their independent meanings.
- **Warning:** a low-contrast amber surface with dark readable text for a material dependency or unresolved requirement. Show the specific issue rather than a generic warning heading.

Routine preparing, waiting and review labels stay neutral. Colour supplements language. Maintain at least 4.5:1 text contrast for normal text and 3:1 for applicable large text; evaluate actual adjacent colours and states before shipping a change.

## Typography

Use the same system sans-serif family throughout the product. The roles and weights are defined in the frontmatter. Use sentence case for headings, navigation, table headers and actions.

Page titles identify the task without a subtitle by default. Section titles divide meaningful working regions. Record links distinguish companies and jobs from supporting values. Metadata remains readable; the existing 11px registration numbers and filter counts are limited, noncritical exceptions rather than a body-text default.

Do not stack category, Act, author, date and revision as loose microtext around a title. Keep task-critical state beside its action; put editable classification in Details and authorship in version history. Use compact labelled facts for information users compare, and a named disclosure for secondary provenance or file references. Remove explanations that only restate a heading, field or scope. Empty history sections should not occupy a heading of their own.

Case and company identity headings have their own smaller title roles, and phone action text may use action-title-mobile. These are specific roles, not permission to create an arbitrary size ladder. Use tabular numerals for registration numbers, dates, monetary values and counts. Keep prose and explanations around 65 to 75 characters per line. Tables may use a wider measure because users compare columns rather than read a paragraph.

Preserve full legal names where practical. Allow wrapping in record links and long values before reducing the type size. Use a full accessible name when a constrained control must truncate. Avoid display fonts, ornamental tracking, heading kickers and oversized numerical summaries.

## Layout

### Application shell

The desktop reference has a fixed 208px left rail, a 58px top bar and a content width capped at 1540px. The main content inset is 30px above and 32px at the sides. At widths up to 1100px the rail reduces to 184px and the side inset to 24px. At widths up to 900px, replace the rail with labelled compact navigation. At widths up to 650px, use 16px side insets and stacked working regions.

Use one page heading and one primary action in a working region. Align headings, filters, search and record content to the same left edge. The navigation order is My work, Companies, People, Reviews, Calendar, Documents, Resolutions and Billing. Administration and future screens must retain the shell rather than introduce a new visual world.

### Lists and records

The daily work table uses Company, Job, Next action, Due and Owner. The company link opens its file; the job link opens the case. State appears beneath the job title. Responsible staff are identified by name. A registration number is supporting identity, not a decorative code.

Use small counts inside filters rather than a separate metric-card row. The reference column proportions are 27%, 24%, 25%, 11% and 13%; allow content-driven adjustment. Desktop cells have 16px vertical and 15px horizontal padding. Rows grow to fit names and actions; do not force a clipped fixed height.

Below 650px, the work table becomes a single stacked list. Keep company, due date, job, next action, state and owner visible together. Other genuinely dense tables can scroll within their own region. The page itself must not overflow horizontally.

### Detail and forms

A case drawer is 650px wide at desktop sizes and fills the available width on phones. Keep its header, section navigation and actions fixed within the drawer while the body scrolls. Use a full working page for complex editing rather than putting an entire case into a small modal.

Group form fields by the decision they support. Two-column groups can collapse to a single column on phones. Retain visible labels and entered values after validation. Show optional detail on demand while keeping the next action, blocker and operative due date immediately visible.

## Elevation & Depth

Working surfaces are flat. Borders separate table rows, navigation regions and meaningful groups. Shadows indicate an overlay above the underlying workspace; they do not decorate ordinary panels or states.

The current drawer shadow is `-12px 0 38px rgba(0,0,0,.12)`. The focused dialog shadow is `0 16px 60px rgba(0,0,0,.15)`. Keep elevation neutral. The dimmed background makes the active layer clear; it is not a glass or blur treatment.

The owner requires smooth, fluid interactions for the implementation. Use consistent, brief transitions to preserve orientation when drawers open, sections change and controls respond. Proposed implementation timings are 100–150ms for control feedback and 180–250ms for drawers and disclosures, with natural deceleration and faster exits. Keep controls responsive during transitions; repeated actions must interrupt or reverse motion cleanly. Do not delay work, replay page entrances, animate every table row or move a record while it is being edited. The disposable prototype does not yet implement this motion contract.

Respect reduced-motion preferences and offer a personal reduced-motion setting that can further reduce movement. Preserve meaningful focus, pending and result feedback. Reserve space for loading and validation to avoid layout jumps; restore list position and focus after detail views close. Validate fluidity on the target office hardware rather than assuming an animation is smooth.

Allow a personal text-size preference using a shared scale over these typography roles; keep Option A's font family, hierarchy and palette. The default remains the token baseline. Larger text must reflow labels, forms and tables without clipping or hiding essential actions. Reading preferences must not change generated document typography, which belongs to the document template.

## Shapes

Controls and ordinary panels use the control radius. Navigation items use a slightly tighter radius, while focused dialogs use the dialog radius. Avoid capsule-shaped containers around every state or count.

Use a light single border on a field or panel where containment is needed. Warnings have a full subtle outline, without a thick coloured side rail. Related facts often need no outer box at all. Use the existing outlined SVG icon vocabulary with a consistent 17px size and 1.6 stroke; label actions unless the icon has a clear accessible name.

## Components

### Buttons and links

Primary buttons use the action colour, white text and the token padding. The reference minimum height is 36px; navigation items are at least 42px. Ensure touch targets satisfy WCAG 2.2 AA minimum size or spacing requirements and favour 44px targets in touch-oriented flows. Secondary buttons have a white surface and light border. Quiet actions use text or a transparent control.

Use specific action names such as New job, Review v3, Return pack and Record submission. A consequential action names its object or version. Keep visible hover, focus, pressed and disabled states. Disable repeated submission while a real mutation is pending and report the actual result.

### Filters and tables

Filters use plain labels, small counts and a selected underline. Search and sorting live in a compact toolbar. Provide an accessible name with the count, a clear selected state and a reset path. Keep filter controls in a horizontally scrollable strip when needed; never make the whole page scroll sideways.

Tables use semantic column headers and captions, quiet row rules and a subtle hover surface. The row contains separate actionable company and job links. Avoid making the entire row a competing click target. Preserve list context when a case drawer closes. Use skeletons for real loading, a first-use action for a new workspace, and No matching jobs with Clear filters for a filtered empty result.

### Company file

Keep company identity visible above its sections. Label legal company status and engagement status separately. Current records, dated history, members, beneficial ownership and filing evidence follow their own product rules in DESIGN_SPEC.md. A single green label cannot stand in for an entire company's compliance condition.

### Case summary and state labels

Lead with the next action, responsible staff and due date. Keep job, document, corporate-record and filing states independently labelled. Present a material dependency near the action it constrains. Place secondary dates and version history behind a disclosure.

Use plain-text state labels. Reserve red for blockers and overdue work and green for evidenced readiness. Preserve the complete state name in the visible text or accessible name. A partly signed document, effective event and outstanding filing must remain distinguishable.

### Inputs and validation

The owner prefers a concise interface without routine explanatory microcopy or persistent helper text. Use clear labels, familiar controls and direct action names. Reveal optional guidance on request or at the point it becomes relevant. Retain field labels, actionable validation, save state, material blockers and consequential-action information needed to complete work correctly.

Inputs use a white surface, input-border token, control radius and shared padding. Search may use a smaller 35px control within the desktop toolbar. Labels remain visible; placeholders provide examples only. Text fields, selects and text areas show focus by changing their border to the focus colour, with no surrounding ring (owner decision, 28 October 2026). Buttons, links and other controls keep the focus-colour 2px outline with a 3px offset. Selects use a custom chevron inset 12px from the right edge so it never touches the border.

Place actionable errors near the field and provide a linked error summary for a long form. Preserve entered values, identify what needs correcting and prevent duplicate consequential submissions. The prototype's required fields and toasts are examples, not the full production validation contract.

### Overlays and feedback

A dialog must be labelled, receive focus, keep background content inert, support an appropriate escape path and restore focus to the invoking control. Keep section navigation reachable while long case content scrolls. A drawer or dialog's scroll region must not collapse its tabs.

Use a status live region for brief action results. Keep missing evidence and unresolved outcomes in the working page; a transient toast is insufficient. Changing a filter, layout or navigation destination does not need a success toast.

## Do's and Don'ts

### Do

- Do use Option A's shell, token roles and component behaviour on every new working screen.
- Do show what needs doing, who owns it and when it is due.
- Do keep dates, evidence, versions and independent states explicit where they affect a decision.
- Do use the existing spacing and type roles before introducing a new value.
- Do use narrow disclosures for secondary detail and keep material warnings visible.
- Do verify a changed path at 390px, 768px and desktop widths, with keyboard focus and real-length sample content.
- Do update this file when an approved visual rule changes, and keep product rules in DESIGN_SPEC.md.

### Don't

- Don't reintroduce headline metric cards, decorative avatar discs, heading kickers or redundant panels into daily work.
- Don't use colour alone, blanket completion labels or progress rings to imply compliance.
- Don't replace visible labels with placeholders or hide essential dates to make a narrow screenshot fit.
- Don't add a competing typeface, palette or navigation shell from archived B or C.
- Don't let editing convenience bypass review, signed-version history or event-based record changes.
- Don't ship the exploration switcher, role simulator or fictional data as production functionality.
