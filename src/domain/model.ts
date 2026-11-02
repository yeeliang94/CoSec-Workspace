export type Capability =
  | 'prepare_job'
  | 'review_pack'
  | 'confirm_record'
  | 'manage_catalogue'
  | 'manage_users'
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
export type Document = {
  id: string;
  companyId: string;
  title: string;
  originalName: string;
  mimeType: string;
  size: number;
  sha256: string;
  storageKey: string;
  createdBy: string;
  createdAt: string;
  /** 'BO' marks restricted evidence from the retired beneficial-ownership feature; it is never shown. */
  classification: 'General' | 'BO';
  /** Set for server-generated resolution documents; uploads leave it unset. */
  generationId?: string;
};
export type Settings = {
  revision: number;
  firmName: string;
  selfApproval: false;
};
export type Workspace = {
  actor: Actor;
  companies: Company[];
  documents: Omit<Document, 'storageKey'>[];
  settings: Settings;
  /** Active users; `companyIds` lists only the companies shared with the signed-in user. */
  users: { id: string; name: string; companyIds: string[] }[];
};
export const defaultPreferences: Preferences = {
  textSize: 'default',
  density: 'comfortable',
  reducedMotion: false,
};
export const defaultSettings: Settings = {
  revision: 1,
  firmName: 'CoSec Workspace',
  selfApproval: false,
};
