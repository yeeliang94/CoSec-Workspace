import type { CapitalProposal, CapitalPosition, CapitalReconciliation, BoCase } from './records';
export type Capability =
  | 'prepare_job'
  | 'review_pack'
  | 'confirm_record'
  | 'record_filing'
  | 'manage_catalogue'
  | 'manage_users'
  | 'view_bo'
  | 'manage_people'
  | 'manage_templates'
  | 'generate_documents'
  | 'view_audit'
  | 'export_audit';
/** Two roles. Capabilities stay as the server's fine-grained checks, set from the role. */
export type Role = 'admin' | 'user';
const USER_CAPABILITIES: Capability[] = [
  'prepare_job',
  'review_pack',
  'confirm_record',
  'record_filing',
  'view_bo',
  'manage_people',
  'generate_documents',
  'view_audit',
];
export const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  admin: [
    ...USER_CAPABILITIES,
    'manage_catalogue',
    'manage_users',
    'manage_templates',
    'export_audit',
  ],
  user: USER_CAPABILITIES,
};
export const ROLE_LABELS: Record<Role, string> = { admin: 'Admin', user: 'User' };
export function roleOf(capabilities: Capability[]): Role {
  return capabilities.includes('manage_users') ? 'admin' : 'user';
}
export type Actor = {
  id: string;
  name: string;
  email: string;
  capabilities: Capability[];
  companyIds: string[];
  preferences: Preferences;
};
export type Preferences = {
  textSize: 'default' | 'large' | 'larger';
  density: 'comfortable' | 'compact';
  reducedMotion: boolean;
};
export type Company = {
  id: string;
  name: string;
  registrationNumber: string;
  incorporationDate: string;
  financialYearEnd: string;
  legalStatus: string;
  engagementStatus: string;
  address: string;
  /** MSIC 2008 section letter; absent on records created before the industry list. */
  industry?: string;
  activity: string;
  verification: 'Unverified' | 'Reviewed';
  sourceEvidenceId: string | null;
  createdBy?: string;
  openingReview?: { reviewerId: string; at: string; basis: string };
  revision: number;
};
export type OfficerEvent = {
  id: string;
  companyId: string;
  jobId: string;
  personId: string;
  personName: string;
  route: 'appointment' | 'resignation' | 'removal' | 'other_cessation';
  effectiveDate: string;
  recordedAt: string;
  evidenceIds: string[];
  basis: string;
  reviewerId: string;
  predecessorId: string | null;
};
export type Officer = {
  personId: string;
  personName: string;
  appointedOn: string;
  eventId: string;
};
export type JobState =
  | 'New'
  | 'Preparing'
  | 'Waiting on external information'
  | 'Awaiting review'
  | 'Action in progress'
  | 'Blocked'
  | 'Complete'
  | 'Cancelled';
export type FilingState =
  | 'Not required with reason'
  | 'Not ready'
  | 'Ready'
  | 'Submitted'
  | 'Queried'
  | 'Rejected'
  | 'Resubmitted'
  | 'Outcome confirmed';
export type DocumentState =
  | 'Draft'
  | 'Reviewed'
  | 'Issued for signature'
  | 'Partly signed'
  | 'Fully signed'
  | 'Superseded'
  | 'Void';
export type ChecklistItem = {
  id: string;
  label: string;
  required: boolean;
  evidenceIds: string[];
  notApplicable?: { reason: string; reviewerId: string; evidenceIds: string[] };
};
export type PackVersion = {
  version: number;
  recordSnapshot?: {
    capitalProposal?: CapitalProposal;
    capitalReconciliation?: CapitalReconciliation;
    boCase?: BoCase;
    recordBaseRevision?: number;
    effectiveDate: string | null;
    routeBasis: string;
  };
  createdAt: string;
  createdBy: string;
  notes: string;
  documentIds: string[];
  checklist: ChecklistItem[];
  requiredSigners: string[];
  signatures: { signer: string; evidenceId: string; receivedDate: string }[];
  templateVersionId: string | null;
  state: DocumentState;
};
export type Review = {
  id: string;
  version: number;
  scope: 'pack' | 'record' | 'manual_date' | 'readiness';
  decision: 'Approved' | 'Returned';
  actorId: string;
  at: string;
  reason: string;
};
export type Correspondence = {
  id: string;
  direction: 'Incoming' | 'Outgoing';
  counterparty: string;
  channel: string;
  date: string;
  summary: string;
  ownerId: string;
  evidenceIds: string[];
  nextChaseDate: string | null;
  respondedOn: string | null;
};
export type FilingAttempt = {
  id: string;
  version: number;
  documentIds: string[];
  submittedDate: string;
  reference: string;
  channel: string;
  evidenceId: string;
  paymentEvidenceId: string | null;
  lodgerId: string;
  at: string;
  messages: {
    id: string;
    kind: 'Query' | 'Rejection';
    wording: string;
    date: string;
    responseDue: string;
    evidenceId: string;
    response?: { summary: string; date: string; evidenceId: string; actorId: string };
  }[];
  outcome: null | { wording: string; date: string; evidenceId: string; actorId: string };
};
export type Job = {
  id: string;
  companyId: string;
  activity: 'W03' | 'W04' | 'W05' | 'W06';
  capitalProposal?: CapitalProposal;
  capitalReconciliation?: CapitalReconciliation;
  recordBaseRevision?: number;
  boCase?: BoCase;
  title: string;
  year: number | null;
  anniversaryDate: string | null;
  snapshot: null | {
    asAt: string;
    company: Company;
    officers: Officer[];
    members?: CapitalPosition;
    capturedAt: string;
  };
  snapshotNeedsReview?: { eventId: string; reason: string } | null;
  snapshotHistory?: { snapshot: NonNullable<Job['snapshot']>; packVersion: number }[];
  route: OfficerEvent['route'] | null;
  personId: string | null;
  personName: string | null;
  effectiveDate: string | null;
  routeBasis: string;
  sourceEvidenceIds: string[];
  recordEventId: string | null;
  ownerId: string;
  createdBy: string;
  state: JobState;
  revision: number;
  createdAt: string;
  updatedAt: string;
  internalTarget: string | null;
  statutoryDue: string | null;
  manualDateBasis: string;
  manualDateEvidenceId: string | null;
  deadlineReviewRequired: boolean;
  manualDateProposal?: { date: string; basis: string; evidenceId: string } | null;
  deadlineHistory?: {
    date: string;
    basis: string;
    evidenceId: string;
    reviewerId: string;
    at: string;
  }[];
  ruleVersionId: string | null;
  dependencyIds: string[];
  checklistVersionId?: string | null;
  packs: PackVersion[];
  reviews: Review[];
  correspondence: Correspondence[];
  clientConfirmed: boolean;
  clientConfirmationEvidenceId: string | null;
  filingState: FilingState;
  filingNotRequiredReason: string | null;
  filingAttempts: FilingAttempt[];
  billingState: 'Not ready' | 'Ready to bill' | 'Handed off' | 'Invoiced';
  notes: { id: string; html: string; actorId: string; at: string }[];
  history: { id: string; action: string; actorId: string; at: string; detail: string }[];
  blockers?: string[];
  nextAction?: string;
};
export type Document = {
  id: string;
  companyId: string;
  jobId: string | null;
  title: string;
  originalName: string;
  mimeType: string;
  size: number;
  sha256: string;
  storageKey: string;
  createdBy: string;
  createdAt: string;
  classification: 'General' | 'BO';
  /** Set for server-generated resolution documents; uploads leave it unset. */
  generationId?: string;
};
export type CatalogueVersion = {
  id: string;
  kind: 'template' | 'checklist' | 'rule';
  name: string;
  version: number;
  status: 'Draft' | 'Published' | 'Retired';
  content: string;
  source: string;
  effectiveDate: string | null;
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  predecessorId: string | null;
};
export type Settings = {
  revision: number;
  firmName: string;
  preparationLeadDays: number;
  chaseIntervalDays: number;
  defaultOwnerId: string | null;
  selfApproval: false;
  catalogue: CatalogueVersion[];
};
export type Reminder = {
  id: string;
  companyId: string;
  jobId: string;
  ownerId: string;
  kind:
    | 'Internal target'
    | 'Client chase'
    | 'Statutory date'
    | 'Query response'
    | 'BO response'
    | 'BO review';
  dueDate: string;
  resolved: boolean;
  createdAt: string;
};
export type Workspace = {
  actor: Actor;
  companies: Company[];
  jobs: Job[];
  documents: Omit<Document, 'storageKey'>[];
  settings: Settings;
  users: { id: string; name: string }[];
  reminders: Reminder[];
};
export const defaultPreferences: Preferences = {
  textSize: 'default',
  density: 'comfortable',
  reducedMotion: false,
};
export const defaultSettings: Settings = {
  revision: 1,
  firmName: 'CoSec Workspace',
  preparationLeadDays: 30,
  chaseIntervalDays: 7,
  defaultOwnerId: null,
  selfApproval: false,
  catalogue: [],
};
