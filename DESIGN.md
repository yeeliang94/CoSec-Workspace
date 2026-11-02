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
  danger-surface: "#fdf8f8"
  danger-border: "#dcb8b7"
  success: "#356047"
  success-border: "#c5d6ca"
  overlay-backdrop: "rgba(28, 45, 57, 0.32)"
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

**Approved direction: Option A Workbench, selected by the product owner on 22 October 2026, with the refinements of 30 October 2026 (see [Refresh rules](#refresh-rules-30-october-2026)).** This is the visual authority for new screens and refinements. Where an older paragraph below conflicts with the refresh rules, the refresh rules win. The token frontmatter defines normative values; the prose explains their application. Read [DESIGN_SPEC.md](DESIGN_SPEC.md) for product boundaries, workflow states, permissions and acceptance scenarios.

The interface serves an internal professional services team working through company records, documents and statutory obligations. Its character is restrained, precise and familiar. Companies, next actions, deadlines and responsible staff carry the hierarchy. Consistent alignment and readable detail matter more than visual novelty.

Use one visual system throughout resolutions, company files, people, documents, templates and settings. Options B and C remain archived explorations; they do not authorise alternative palettes or navigation shells. A useful interaction from an archive can be adapted within A's system when the task warrants it.

The current reference is [prototype/index.html](prototype/index.html). Aster and the sample records are fictional fixtures. Archived B/C and comparison-tool colours remain outside this approved palette; do not promote them into A to silence an advisory scan. The role selector, demo label and design-reference link support evaluation and do not define production authentication or navigation.

## Refresh rules (30 October 2026)

These rules came out of the owner's review of the redesigned My work, Company record, Job detail and Resolution builder screens. They apply to every screen.

- **Desktop only.** The application is used on desktop computers only. Design and validate at desktop widths (1280px and wider). Do not design, build or check phone or tablet layouts.
- **No top bar.** Pages start directly with the page title. The firm name, breadcrumbs and date are not shown. The signed-in person and Sign out sit at the bottom of the navigation rail.
- **Quiet page headers.** A page or record header holds the title and, for a company, its registration number only. Do not add subtitles, helper text, metadata rows or micro tags under titles. Secondary facts (legal status, engagement, owner, dates) go in a labelled details panel.
- **No counts on navigation.** Filter tabs, section tabs, sidebar items and group headings never show counts. A single results line such as "9 jobs" may sit beside the toolbar.
- **No middle dots.** Never use "·" as a separator. Write the relationship in words, or use a comma, colon or parentheses: "Annual return 2026", "20 Oct (2 days overdue)", "Director (proposed)".
- **Plain-text status.** States are plain text in their own column or labelled field. No dots, pills, badges or coloured boxes. Red is only for blocked or overdue, green only for evidenced readiness; everything else uses the normal text colour.
- **One line per cell.** Table cells hold one value. Do not stack a second line of metadata under a value; give it its own column instead. The work table columns are Company, Registration no., Job, Status, Next action, Due, Owner.
- **Grouped work list.** When sorted by due date, My work is grouped under plain headings: Overdue, Due this week, Later. Headings are 15px semibold with whitespace above and no rule.
- **Subtle separation.** Sections are separated by whitespace, not rules (about 48–56px between sections in a column). Section headings are 17px semibold with no underline; a section link may sit on the right of the heading line. Tables have no header fill: muted 12px column names with one hairline under them, and hairlines between rows. Avoid stacking rules.
- **One left edge.** The first table column and the last table column are flush with the section edges, so headings, column names, row text, tabs and toolbars share one left edge.
- **Record layout.** Company and Job pages share one layout: title, optional one-line note, horizontal tabs, then a main column and a details panel separated by a single hairline (48px gap, 40px panel padding). Tables in the same column share the same column widths.
- **Warnings as one quiet line.** A material issue is one line of normal text with the outlined warning icon in front and a section link at the end. No yellow box, fill, border or heavy rule. Use the red icon only for a true blocker.
- **Three action tiers.** (1) Primary button, filled, at most one per page header. (2) Secondary button, white with a grey outline, for other actions that change something. (3) Section link, 13px medium in the primary colour with a small chevron, for going somewhere or opening related detail. Record names in tables and lists stay plain semibold links.
- **Disclosures.** A collapsible section's label uses the section-link style (13px medium, primary colour) followed by a small down chevron that turns upward when open. Never show the browser's default triangle marker.
- **Forms without boxes.** Checkbox and radio options are hairline-separated rows, not bordered cards. A field that depends on an option (for example a signing limit) appears under that option, indented to its text, only while it is selected. Avoid helper text; show outstanding questions with icons in the step or clause list.
- **Dates and titles.** Dates read "5 Nov 2026" (no leading zero, three-letter month, "Sep" not "Sept"); timestamps read "5 Nov 2026, 14:30" in Kuala Lumpur time with no zone suffix. Every page title names the page first: "Companies – CoSec Workspace" (en dash).
- **One name per destination.** The template library is "Templates", with the tabs Wording, Layouts and Document types; an item is "wording" ("New wording"). Links to another page from a page header are section links, not outlined buttons. In-section form saves are secondary buttons.

## Canvas design pass (2 November 2026)

The owner approved the design canvas for every page. These rules win over older paragraphs here.

- **Record names.** The first-column record name is a semibold primary link; other table links are regular weight. Empty cells stay blank, with no dash.
- **Dates in lists.** Lists show the day only. The Audit log keeps the date and time.
- **Actions below the header.** Send for review and Generate Word document are secondary; Mark complete is the one primary button.
- **Tabs.** The selected tab is dark medium text with a primary underline.
- **Templates lists.** Flat rows with one version value ("v2 draft (v1 published)"). Use the category filter to narrow them.
- **Settings.** One page: Personal preferences, Users and company access, Firm. There are no tabs.
- **Side panels.** A 140px step list with a filled current step, an icon close button and a fixed action bar.
- **Template editors.** One page with no section tabs: the working column holds the wording, the fields disclosure and the sample preview; a 340px panel holds settings and versions. The header holds Save draft (secondary) and the version's next step (primary). Independent review before publishing stays.
- **Empty states.** Centred muted text with the action underneath.

## Colors


The palette combines white working surfaces, a slate-navy navigation rail and one muted blue action colour. Resolve exact values from the frontmatter rather than adding parallel palette definitions to individual screens.

- **Primary:** primary actions, links and the selected filter underline. It is not a decorative section fill.
- **Ink and muted:** primary values and secondary context. Keep job titles and company names stronger than registration numbers and preparation metadata.
- **Surface and border:** flat working areas and light structural rules. Group related facts with alignment and spacing before adding another container.
- **Navigation:** a dark, stable anchor with tinted text and a restrained selected fill. Use the same rail across all approved screens.
- **Danger:** overdue dates, blockers and actionable errors. Keep the condition written out.
- **Success:** evidenced readiness or positive states. Approval, effective records and filing outcomes still retain their independent meanings.
- **Warning:** the warning colour is used for the outlined warning icon in front of a one-line note. Show the specific issue rather than a generic warning heading; do not use a filled warning box.

Routine preparing, waiting and review labels stay neutral. Colour supplements language. Maintain at least 4.5:1 text contrast for normal text and 3:1 for applicable large text; evaluate actual adjacent colours and states before shipping a change.

## Typography

Use the same system sans-serif family throughout the product. The roles and weights are defined in the frontmatter. Use sentence case for headings, navigation, table headers and actions.

Page titles identify the task without a subtitle by default. Section titles divide meaningful working regions. Record links distinguish companies and jobs from supporting values. Metadata remains readable; the existing 11px registration numbers and filter counts are limited, noncritical exceptions rather than a body-text default.

Do not stack category, Act, author, date and revision as loose microtext around a title. Keep task-critical state beside its action; put editable classification in Details and authorship in version history. Use compact labelled facts for information users compare, and a named disclosure for secondary provenance or file references. Remove explanations that only restate a heading, field or scope. Empty history sections should not occupy a heading of their own.

Case and company identity headings have their own smaller title roles, and phone action text may use action-title-mobile. These are specific roles, not permission to create an arbitrary size ladder. Use tabular numerals for registration numbers, dates, monetary values and counts. Keep prose and explanations around 65 to 75 characters per line. Tables may use a wider measure because users compare columns rather than read a paragraph.

Preserve full legal names where practical. Allow wrapping in record links and long values before reducing the type size. Use a full accessible name when a constrained control must truncate. Avoid display fonts, ornamental tracking, heading kickers and oversized numerical summaries.

## Layout

### Application shell

The desktop reference has a fixed 208px left rail, no top bar and a content width capped at 1540px. The main content inset is 30px above and 32px at the sides. The application is desktop only; there is no phone or tablet layout to maintain.

Use one page heading and one primary action in a working region. Align headings, filters, search and record content to the same left edge. The navigation order is Resolutions, Companies, People and Documents, with Settings at the foot. (Since 1 November 2026; the work queue, Reviews, Calendar and Billing were removed when the app narrowed to resolutions.) Administration and future screens must retain the shell rather than introduce a new visual world.

### Lists and records

The daily work table and job cases were removed on 1 November 2026; the rules in this section and the next apply if a work list returns. The daily work table uses Company, Job, Next action, Due and Owner. The company link opens its file; the job link opens the case. State appears beneath the job title. Responsible staff are identified by name. A registration number is supporting identity, not a decorative code.

Filters carry no counts and there is no metric-card row. Allow content-driven column widths. Desktop cells have 16px vertical and 15px horizontal padding, with the first and last cells flush to the section edge. Rows grow to fit names and actions; do not force a clipped fixed height.

Genuinely dense tables can scroll within their own region. The page itself must not overflow horizontally at desktop widths.

### Detail and forms

A case drawer is 650px wide at desktop sizes and fills the available width on phones. Keep its header, section navigation and actions fixed within the drawer while the body scrolls. Use a full working page for complex editing rather than putting an entire case into a small modal.

Group form fields by the decision they support. Two-column groups can collapse to a single column on phones. Retain visible labels and entered values after validation. Show optional detail on demand while keeping the next action, blocker and operative due date immediately visible.

The owner selected the guided sequence from [the form layout prototype](prototype/form-layout-review.html?variant=steps) on 30 October 2026. Company and Resolution creation use a numbered left step list and one working section at a time, followed by Review. Continue validates required fields before advancing; Back and earlier steps retain entered values. The review lists the actual entered values and provides Change links. Creation happens only through the final named action. This input review does not establish professional approval or statutory completion. Short in-place edits and search/filter controls remain direct.

Standard desktop forms follow a single vertical reading path within a 640px maximum measure, with 24px between fields and 48px between meaningful groups. Use an explicit pair only when the controls describe one closely related choice, such as Role/From, resolution/effective dates, document type/Layout or numeric Minimum/Maximum. Search and filter toolbars, page margins and editing tables retain their deliberate compact layouts. Do not rearrange controls visually with CSS; keyboard order follows the displayed order.

Keep names, addresses and narrative answers wide. Dates, numbers, registration references and compound year-end controls use widths suited to their expected content. Align labels above their controls and let the parent grid own spacing; do not add margins between labels inside a grid. Use 13px medium labels, including legends that label a compound field, and 14px regular control text with a 40px minimum height scaled by the text-size preference. Textareas have their own height. Dependent identity choices appear immediately below the name, before relationship details. Repeat visible labels on added person rows.

These placement principles draw on [Carbon Forms](https://www.carbondesignsystem.com/building-blocks/core/patterns/forms), [GOV.UK Text inputs](https://design-system.service.gov.uk/components/text-input/) and [USWDS Form templates](https://designsystem.digital.gov/templates/form-templates/), reviewed 30 October 2026. The measurements above are CoSec's application of the guidance; retain Option A's palette and typography.

## Elevation & Depth

Working surfaces are flat. Borders separate table rows, navigation regions and meaningful groups. Shadows indicate an overlay above the underlying workspace; they do not decorate ordinary panels or states.

The current drawer shadow is `-12px 0 38px rgba(0,0,0,.12)`. The focused dialog shadow is `0 16px 60px rgba(0,0,0,.15)`. Keep elevation neutral. The dimmed background makes the active layer clear; it is not a glass or blur treatment.

The owner requires smooth, fluid interactions for the implementation. Use consistent, brief transitions to preserve orientation when drawers open, sections change and controls respond. Proposed implementation timings are 100–150ms for control feedback and 180–250ms for drawers and disclosures, with natural deceleration and faster exits. Keep controls responsive during transitions; repeated actions must interrupt or reverse motion cleanly. Do not delay work, replay page entrances, animate every table row or move a record while it is being edited. The disposable prototype does not yet implement this motion contract.

Respect reduced-motion preferences and offer a personal reduced-motion setting that can further reduce movement. Preserve meaningful focus, pending and result feedback. Reserve space for loading and validation to avoid layout jumps; restore list position and focus after detail views close. Validate fluidity on the target office hardware rather than assuming an animation is smooth.

Allow a personal text-size preference using a shared scale over these typography roles; keep Option A's font family, hierarchy and palette. The default remains the token baseline. Larger text must reflow labels, forms and tables without clipping or hiding essential actions. Reading preferences must not change generated document typography, which belongs to the document template.

## Shapes

Controls and ordinary panels use the control radius. Navigation items use a slightly tighter radius, while focused dialogs use the dialog radius. Avoid capsule-shaped containers around every state or count.

Use a light single border on a field or panel where containment is needed. Warnings are a single line with an outlined icon, without a box, fill or coloured side rail. Related facts often need no outer box at all. Use the existing outlined SVG icon vocabulary with a consistent 17px size and 1.6 stroke; label actions unless the icon has a clear accessible name.

## Components

### Buttons and links

Primary buttons use the action colour, white text and the token padding. The reference minimum height is 36px; navigation items are at least 42px. Ensure touch targets satisfy WCAG 2.2 AA minimum size or spacing requirements and favour 44px targets in touch-oriented flows. Secondary buttons have a white surface and light border. Quiet actions use text or a transparent control.

Use specific action names such as New job, Review v3, Return pack and Record submission. A consequential action names its object or version. Keep visible hover, focus, pressed and disabled states. Disable repeated submission while a real mutation is pending and report the actual result.

### Filters and tables

Filters use plain labels and a selected underline, without counts. Search and sorting live in a compact toolbar. Provide an accessible name with the count, a clear selected state and a reset path. Keep filter controls in a horizontally scrollable strip when needed; never make the whole page scroll sideways.

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
- Do run `npm run check:design` after stylesheet changes; it rejects raw colours and text sizes outside these roles.
- Do open create and edit forms in the side drawer, and keep the page header to one back link, the title and its actions.
- Do use narrow disclosures for secondary detail and keep material warnings visible.
- Do verify a changed path at desktop widths (1280px and 1440px), with keyboard focus and real-length sample content. Do not check phone or tablet widths; the application is desktop only.
- Do update this file when an approved visual rule changes, and keep product rules in DESIGN_SPEC.md.

### Don't

- Don't reintroduce headline metric cards, decorative avatar discs, heading kickers or redundant panels into daily work.
- Don't use middle dots, status dots, counts on tabs, yellow warning boxes, header fills or stacked section rules.
- Don't use colour alone, blanket completion labels or progress rings to imply compliance.
- Don't replace visible labels with placeholders or hide essential dates to make a narrow screenshot fit.
- Don't add a competing typeface, palette or navigation shell from archived B or C.
- Don't let editing convenience bypass review, signed-version history or event-based record changes.
- Don't ship the exploration switcher, role simulator or fictional data as production functionality.
