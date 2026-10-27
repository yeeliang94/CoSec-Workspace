/**
 * Shared contracts for the resolution builder (RESOLUTION_BUILDER_IMPLEMENTATION_PLAN.md §5).
 * Every lane builds against these types; change them only through the coordinator.
 * "Clause" is a reusable resolution item. It is never a corporate event or an audit entry.
 */

// ---------------------------------------------------------------- output types
export type ResolutionBody = 'directors' | 'members';
export type OutputType = {
  id: string; // stable, e.g. 'directors_written'
  name: string; // presentation only
  body: ResolutionBody;
  active: boolean;
  order: number;
};

// ---------------------------------------------------------------- document model (schema v1)
export const TEMPLATE_SCHEMA_VERSION = 1;
export type Mark = 'bold' | 'italic' | 'underline';
export type Align = 'left' | 'center' | 'right' | 'justify';
export type InlineNode =
  | { type: 'text'; text: string; marks?: Mark[] }
  /**
   * A field reference by stable id. Inside a repeat over a record collection, a reference to the
   * collection field with `property` resolves against the current item (for example its name).
   */
  | { type: 'field'; fieldId: string; property?: RecordProperty }
  | { type: 'hardBreak' };
export type Predicate =
  | {
      op: 'isTrue' | 'isFalse' | 'isEmpty' | 'isNotEmpty';
      fieldId: string;
    }
  | { op: 'equals' | 'notEquals' | 'includes'; fieldId: string; value: string }
  | { op: 'and' | 'or'; all: Predicate[] };
export type BlockNode =
  | { type: 'paragraph'; align?: Align; indent?: number; content: InlineNode[] }
  | { type: 'heading'; level: 1 | 2 | 3; align?: Align; content: InlineNode[] }
  | { type: 'list'; ordered: boolean; items: BlockNode[][] }
  | {
      type: 'table';
      /** Percentages that add up to 100, one per column. */
      columnWidths?: number[];
      rows: { header?: boolean; cells: BlockNode[][] }[];
    }
  | { type: 'condition'; when: Predicate; content: BlockNode[] }
  /** Repeats `content` once per item of a recordList field, in the preparer's order. */
  | { type: 'repeat'; fieldId: string; content: BlockNode[]; emptyText?: string }
  | { type: 'pageBreak' }
  /** Assemblies only: where the ordered clause wordings go. */
  | { type: 'clauseSlot'; numbering: 'none' | 'decimal' }
  /** Assemblies only: signature area for one signer role. */
  | { type: 'signatureBlock'; role: SignerRole; heading?: string };

// ---------------------------------------------------------------- fields
export type ValueType =
  | 'text'
  | 'multiline'
  | 'date'
  | 'number'
  | 'boolean'
  | 'choice'
  | 'multiChoice'
  | 'recordReference'
  | 'recordList';
export type RecordProperty = 'name' | 'capacity' | 'appointedOn' | 'ceasedOn';
/**
 * People a record selector may offer. All are scoped to the case's company and an as-at date;
 * `proposedPerson` allows any person the actor may see (for a new appointee).
 */
export type RecordContext =
  'currentDirectors' | 'currentMembers' | 'companyPeople' | 'proposedPerson';
export type FieldSource =
  | { kind: 'binding'; path: string } // must be in the binding registry (bindings.ts)
  | { kind: 'question' }
  | { kind: 'constant'; value: string }
  | {
      kind: 'derived';
      op: 'addDays';
      fieldId: string;
      days: number;
      /** Approved source for any legal time limit. Without one, the value is labelled a sample. */
      sourceNote: string;
    }
  | { kind: 'derived'; op: 'sum'; fieldId: string } // per-row number field
  | { kind: 'derived'; op: 'join'; fieldId: string; property: RecordProperty } // names of a list
  | { kind: 'derived'; op: 'count'; fieldId: string };
export type FieldDefinition = {
  id: string; // stable within a template lineage: /^[a-z][a-z0-9_]{1,63}$/
  label: string;
  help?: string;
  valueType: ValueType;
  source: FieldSource;
  /** 'case': shared across clauses in one case and asked once. 'clause': local to the clause. */
  scope: 'case' | 'clause';
  required?: boolean;
  options?: { id: string; label: string }[]; // choice / multiChoice; ids are stable
  record?: { context: RecordContext };
  /** Asked once per item of this recordList field (for example a fee per director). */
  repeatScope?: string;
  format?: {
    date?: 'long' | 'iso';
    /** Exact decimal places for number display; values are kept as decimal strings. */
    decimals?: number;
    prefix?: string;
    case?: 'upper' | 'none';
  };
  defaultValue?: AnswerValue;
  validation?: { min?: string; max?: string; maxLength?: number; mustBeChecked?: boolean };
};
/** Numbers are exact decimal strings. Record ids are person ids. Choice values are option ids. */
export type AnswerValue = string | boolean | string[] | null;
/** Per-row answers are keyed by item (person) id. */
export type Answers = Record<string, AnswerValue | Record<string, AnswerValue>>;

// ---------------------------------------------------------------- templates
export type TemplateStatus = 'Draft' | 'In review' | 'Returned' | 'Published' | 'Superseded';
export const CLAUSE_CATEGORIES = [
  'Director',
  'Secretary',
  'Auditor',
  'Members',
  'Meeting',
  'Dividend',
  'Share capital',
  'Other',
] as const;
export type ClauseCategory = (typeof CLAUSE_CATEGORIES)[number];
export type UsageContext = 'board' | 'director_appointment' | 'director_resignation';
type Reviewed = {
  status: TemplateStatus;
  /** Optimistic revision for draft edits; published versions never change. */
  revision: number;
  schemaVersion: number;
  source: string; // basis/source of wording, e.g. "Fictional sample — not approved wording"
  effectiveDate: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  submittedBy: string | null;
  submittedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  returnReason: string | null;
  predecessorId: string | null;
  /** sha256 of the canonical content, set on submission and checked on publication. */
  contentHash: string | null;
  /** Everyone who created or edited this version's content; none of them may publish it. */
  editors?: string[];
};
export type ClauseTemplate = {
  id: string;
  name: string;
  category: ClauseCategory;
  usageContexts: UsageContext[];
  governingAct: string;
  displayOrder: number;
  hidden: boolean;
  archived: boolean;
  description: string;
  createdBy: string;
  createdAt: string;
  revision: number;
};
export type ClauseVersion = Reviewed & {
  id: string;
  clauseId: string;
  version: number;
  /** One fragment per supported output type id. A type with no wording is not offered. */
  wordings: Record<string, BlockNode[]>;
  fields: FieldDefinition[];
};
export type SignerRole = 'directors' | 'members' | 'certifiers';
export type PageLayout = {
  pageSize: 'A4' | 'Letter';
  marginsMm: { top: number; right: number; bottom: number; left: number };
  fontFamily: 'Arial' | 'Times New Roman' | 'Calibri';
  fontSizePt: number;
  header: InlineNode[];
  footer: InlineNode[];
  pageNumbers: boolean;
};
export type SignatureSettings = {
  columns: 1 | 2 | 3;
  showDate: boolean;
  /** Label under each line; supports the tokens {name} and {capacity}. */
  label: string;
};
export type ResolutionAssembly = {
  id: string;
  name: string;
  outputTypeId: string;
  usageContexts: UsageContext[];
  archived: boolean;
  description: string;
  createdBy: string;
  createdAt: string;
  revision: number;
};
export type AssemblyVersion = Reviewed & {
  id: string;
  assemblyId: string;
  version: number;
  header: BlockNode[];
  closing: BlockNode[];
  signature: SignatureSettings;
  /** Clause template ids in default order; the newest published version is pinned on use. */
  starterClauseIds: string[];
  /** Case-level shared questions such as the resolution date. */
  fields: FieldDefinition[];
  layout: PageLayout;
};

// ---------------------------------------------------------------- people and records
export type Person = {
  id: string;
  fullName: string;
  /** Previous names with the date the correction was recorded; old outputs keep their snapshot. */
  nameHistory: { name: string; until: string; actorId: string; reason: string }[];
  email: string | null;
  notes: string;
  customValues: CustomValues;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  /** Set when the legacy migration could not establish identity reliably. */
  migrationNote?: string;
};
export type RelationshipRole = 'director' | 'member' | 'secretary' | 'auditor' | 'other';
export type CompanyRelationship = {
  id: string;
  companyId: string;
  personId: string;
  role: RelationshipRole;
  /** Configured attribute only (e.g. "Non-executive"); never a statutory appointment by itself. */
  capacity: string;
  startDate: string | null;
  endDate: string | null;
  /** Director relationships are projections of posted officer events and are not edited directly. */
  projectedFrom: { officerEventIds: string[] } | null;
  evidenceIds: string[];
  createdBy: string;
  createdAt: string;
  revision: number;
};
export type CustomFieldScope = 'company' | 'person' | 'case';
export type RecordFieldDefinition = {
  id: string;
  scope: CustomFieldScope;
  label: string;
  valueType: 'text' | 'date' | 'number' | 'boolean' | 'choice';
  options?: { id: string; label: string }[];
  version: number;
  archived: boolean;
  createdBy: string;
  createdAt: string;
  revision: number;
};
/** Dated values, newest last. `effectiveDate` is the date the value applies from. */
export type DatedValue = {
  value: string | boolean | null;
  effectiveDate: string;
  definitionVersion?: number;
  recordedAt: string;
  actorId: string;
  reason: string;
};
export type CustomValues = Record<string, DatedValue[]>;
export const CITATION_KEYS = ['directorAuthority', 'memberAuthority', 'electionAuthority'] as const;
export type CitationKey = (typeof CITATION_KEYS)[number];
/** Editable, dated company particulars kept beside the immutable opening record. */
export type CompanyProfile = {
  companyId: string;
  revision: number;
  citations: Partial<Record<CitationKey, DatedValue[]>>;
  customValues: CustomValues;
};

// ---------------------------------------------------------------- resolution cases
export type CaseKind = 'board' | 'director_appointment' | 'director_resignation';
export type StepState = 'Pending' | 'In progress' | 'Waiting' | 'Complete' | 'Not applicable';
export type StepKind =
  'instruction' | 'preparation' | 'review' | 'execution' | 'registration' | 'custom';
export type CaseStep = {
  id: string;
  kind: StepKind;
  label: string;
  ownerId: string;
  state: StepState;
  reason: string | null; // required for Not applicable
  dueDate: string | null;
  completedAt: string | null;
  dependsOn: string[];
  evidenceIds: string[];
};
export type ClauseEntry = {
  /** Stable key for this clause in the case; clause-specific answers are stored under it. */
  key: string;
  clauseId: string;
  clauseVersionId: string;
};
export type CaseClauseSelection = {
  revision: number;
  outputTypeId: string;
  assemblyVersionId: string;
  clauses: ClauseEntry[];
  /** Reasons recorded when a default clause was removed from a W04-linked case. */
  removals: { clauseId: string; reason: string; actorId: string; at: string }[];
};
export type SignerSelection = Record<SignerRole, string[]>; // ordered person ids
export type DecisionRecord = {
  status: 'Not recorded' | 'Passed' | 'Not passed';
  date: string | null;
  evidenceIds: string[];
  actorId: string | null;
  note: string;
};
export type ResolutionCase = {
  id: string;
  companyId: string;
  kind: CaseKind;
  title: string;
  /** Linked W04 job, when the case prepares a director change. */
  jobId: string | null;
  personId: string | null;
  ownerId: string;
  state: 'Open' | 'Complete' | 'Cancelled';
  cancellationReason: string | null;
  instructionDate: string | null;
  resolutionDate: string | null;
  effectiveDate: string | null;
  customValues: CustomValues;
  steps: CaseStep[];
  selection: CaseClauseSelection | null;
  /** Draft answers, saved against the exact selection revision. */
  answers: { selectionRevision: number; shared: Answers; clauses: Record<string, Answers> };
  signers: SignerSelection;
  decision: DecisionRecord;
  families: { id: string; title: string; createdAt: string }[];
  history: { id: string; action: string; actorId: string; at: string; detail: string }[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
};

// ---------------------------------------------------------------- resolution context
/** Authorised, as-at view of the records a template may bind to. Built by the records lane. */
export type PersonSnapshot = {
  id: string;
  name: string;
  capacity: string;
  appointedOn: string | null;
  ceasedOn: string | null;
};
export type ResolutionContext = {
  asAt: string;
  /** Preparation date in Asia/Kuala_Lumpur, frozen independently of the record as-at date. */
  preparedOn: string;
  firm: { name: string };
  company: {
    id: string;
    name: string;
    registrationNumber: string;
    address: string;
    incorporationDate: string;
    financialYearEnd: string;
    revision: number;
    profileRevision: number;
    citations: Partial<Record<CitationKey, string>>;
    custom: Record<string, string | boolean | null>;
  };
  case: {
    id: string;
    kind: CaseKind;
    title: string;
    revision: number;
    instructionDate: string | null;
    resolutionDate: string | null;
    effectiveDate: string | null;
    custom: Record<string, string | boolean | null>;
  };
  job: null | {
    id: string;
    revision: number;
    route: string | null;
    personId: string | null;
    personName: string | null;
    effectiveDate: string | null;
    packVersion: number | null;
  };
  /** Selector pools. Only these ids may be chosen for the matching record context. */
  directors: PersonSnapshot[];
  members: PersonSnapshot[];
  companyPeople: PersonSnapshot[];
  /** People visible to the actor for a proposed appointment (no other-company detail). */
  proposedPeople: PersonSnapshot[];
};

// ---------------------------------------------------------------- generated documents
export type ResolvedInline = { text: string; marks?: Mark[] } | { break: true };
export type ResolvedBlock =
  | { type: 'paragraph'; align?: Align; indent?: number; runs: ResolvedInline[]; number?: string }
  | { type: 'heading'; level: 1 | 2 | 3; align?: Align; runs: ResolvedInline[] }
  | { type: 'list'; ordered: boolean; items: ResolvedBlock[][] }
  | {
      type: 'table';
      columnWidths?: number[];
      rows: { header?: boolean; cells: ResolvedBlock[][] }[];
    }
  | { type: 'pageBreak' }
  | {
      type: 'signatures';
      heading?: string;
      columns: 1 | 2 | 3;
      showDate: boolean;
      signers: { name: string; label: string }[];
    };
export type ResolvedDocument = {
  title: string;
  layout: Omit<PageLayout, 'header' | 'footer'> & { header: string; footer: string };
  blocks: ResolvedBlock[];
  /** True when any value is a labelled sample (for example an unsourced date offset). */
  containsSamples: boolean;
};
export type GenerationStatus = 'Pending' | 'Ready' | 'Failed';
export type DocumentGeneration = {
  id: string;
  familyId: string;
  predecessorId: string | null;
  caseId: string;
  companyId: string;
  jobId: string | null;
  packVersion: number | null;
  outputTypeId: string;
  assemblyVersionId: string;
  clauseVersionIds: string[];
  /** The selection entries (answer keys with their pinned versions) used; set on new generations. */
  clauses?: ClauseEntry[];
  selectionRevision: number;
  signers: SignerSelection;
  answers: { shared: Answers; clauses: Record<string, Answers> };
  /**
   * Exactly the authorised values used, with ids/revisions for provenance. Selector pools hold only
   * the people the answers, signers or linked job refer to (never the preparer's wider pools).
   */
  snapshot: ResolutionContext;
  resolvedValues: Record<string, string>;
  resolved: ResolvedDocument | null;
  snapshotHash: string;
  rendererVersion: string;
  status: GenerationStatus;
  failure: string | null;
  /** Private document row holding the DOCX bytes, once Ready. */
  documentId: string | null;
  sha256: string | null;
  requestHash: string;
  createdBy: string;
  createdAt: string;
  finalisedAt: string | null;
};
/** Review, issue and execution records against one exact generation (separate rows). */
export type GenerationRecord =
  | {
      id: string;
      kind: 'review';
      generationId: string;
      sha256: string;
      decision: 'Approved' | 'Returned';
      reason: string;
      actorId: string;
      at: string;
    }
  | {
      id: string;
      kind: 'execution';
      generationId: string;
      sha256: string;
      signerPersonId: string;
      capacity: string;
      signedDate: string;
      evidenceId: string;
      actorId: string;
      at: string;
    };
