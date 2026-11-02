/** Client helpers and response shapes for the resolution builder APIs (docs/RESOLUTION_CONTRACTS.md). */
import type {
  AssemblyVersion,
  ClauseTemplate,
  ClauseVersion,
  DocumentGeneration,
  GenerationRecord,
  ResolutionAssembly,
  ResolutionCase,
  ResolvedDocument,
} from '@/domain/resolution/model';

export type Issue = {
  message: string;
  location: string;
  severity?: 'error' | 'warning';
  /** Form issues: clause entry key (or 'case') and field the issue belongs to. */
  unit?: string;
  fieldId?: string;
  itemId?: string;
};
export type { FormField, FormModel } from '@/domain/resolution/form';
import type { FormModel, CaseInput } from '@/domain/resolution/form';
export type ClauseWithVersions = ClauseTemplate & { versions: ClauseVersion[] };
export type AssemblyWithVersions = ResolutionAssembly & { versions: AssemblyVersion[] };
export type CaseDetail = {
  case: ResolutionCase;
  generations: DocumentGeneration[];
  records: GenerationRecord[];
};
export type PreviewResult = { resolved: ResolvedDocument | null; issues: Issue[] };

export class ApiError extends Error {
  status: number;
  code: string;
  issues: Issue[];
  constructor(message: string, status: number, code = '', issues: Issue[] = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    window.location.assign('/login');
    throw new ApiError('Your session has ended. Sign in again.', 401);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    if (response.status === 404)
      throw new ApiError('This feature is not available yet (the server has no route).', 404);
    throw new ApiError('The server did not respond. Try again.', response.status);
  }
  if (!response.ok) {
    const value = body as {
      error?: string | { message?: string };
      message?: string;
      code?: string;
      issues?: Issue[];
    };
    const message =
      (typeof value.error === 'string' ? value.error : value.error?.message) ||
      value.message ||
      'The change could not be saved.';
    throw new ApiError(message, response.status, value.code || '', value.issues || []);
  }
  return body as T;
}

export async function getJson<T>(url: string): Promise<T> {
  return parse<T>(await fetch(url, { cache: 'no-store' }));
}
export async function postJson<T>(url: string, body: unknown): Promise<T> {
  return parse<T>(
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    }),
  );
}
export function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}
export const newRequestId = () => crypto.randomUUID();

/** Saves a blob response as a download, reporting server errors as text. */
export async function download(url: string, init?: RequestInit, fallbackName = 'download') {
  const response = await fetch(url, { cache: 'no-store', ...init });
  if (!response.ok) {
    let message = 'The file could not be downloaded.';
    try {
      const body = await response.json();
      message = body.error?.message || body.error || body.message || message;
    } catch {}
    throw new ApiError(message, response.status);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1];
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name ? decodeURIComponent(name) : fallbackName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export const CASE_KINDS: { value: ResolutionCase['kind']; label: string }[] = [
  { value: 'board', label: 'Board resolution' },
  { value: 'director_appointment', label: 'Director appointment' },
  { value: 'director_resignation', label: 'Director resignation' },
];
export const kindLabel = (kind: string) =>
  CASE_KINDS.find((item) => item.value === kind)?.label || kind;

export const USAGE_CONTEXTS = [
  { value: 'board', label: 'Board resolutions' },
  { value: 'director_appointment', label: 'Director appointments' },
  { value: 'director_resignation', label: 'Director resignations' },
] as const;

/** Latest version by number. */
export function latest<T extends { version: number }>(versions: T[]): T | undefined {
  return [...versions].sort((a, b) => b.version - a.version)[0];
}
export function latestPublished<T extends { version: number; status: string }>(
  versions: T[],
): T | undefined {
  return latest(versions.filter((version) => version.status === 'Published'));
}

/** A published clause version offered to a case (GET /api/resolution-cases/:id/clauses). */
export type AvailableClause = {
  clauseId: string;
  clauseVersionId: string;
  version: number;
  name: string;
  category: string;
  governingAct: string;
  displayOrder: number;
  description: string;
  /** Output types this version has wording for. */
  outputTypeIds: string[];
};
export type AvailableAssembly = {
  assemblyId: string;
  assemblyVersionId: string;
  version: number;
  name: string;
  outputTypeId: string;
  description: string;
  starterClauseIds: string[];
};
export type NewerVersion = {
  key: string;
  clauseId: string;
  pinnedVersionId: string;
  pinnedVersion: number | null;
  newerVersionId: string;
  newerVersion: number;
  hasWording: boolean;
};
export type ClausesResponse = {
  selection: import('@/domain/resolution/model').CaseClauseSelection | null;
  outputTypes: import('@/domain/resolution/model').OutputType[];
  available: {
    clauses: AvailableClause[];
    assemblies: AvailableAssembly[];
    newerVersions: NewerVersion[];
  };
  form: FormModel | null;
  formInput: CaseInput | null;
  /** Answer issues for generation (complete check); field issues carry unit and fieldId. */
  issues?: Issue[];
};

/** Newest eligible version per clause, so the library lists each clause once. */
export function newestPerClause(clauses: AvailableClause[]) {
  const best = new Map<string, AvailableClause>();
  for (const clause of clauses) {
    const current = best.get(clause.clauseId);
    if (!current || clause.version > current.version) best.set(clause.clauseId, clause);
  }
  return [...best.values()];
}

export function statusOf<T extends { version: number; status: string }>(versions: T[]) {
  const last = latest(versions);
  const published = latestPublished(versions);
  return { last, published };
}

/** Field facts used to phrase an issue for people rather than as a path. */
export type IssueField = {
  id: string;
  label: string;
  valueType?: string;
  source?: { kind: string; path?: string };
  /** Clause entry key, or 'case' for shared questions. Clauses can reuse a field id. */
  unit?: string;
};

/** Every field of a form, tagged with the unit it belongs to. */
export function issueFields(form: Pick<FormModel, 'shared' | 'clauses'>): IssueField[] {
  return [
    ...form.shared.map((field) => ({ ...field, unit: 'case' })),
    ...form.clauses.flatMap((clause) =>
      clause.fields.map((field) => ({ ...field, unit: clause.key })),
    ),
  ];
}

const CASE_DETAILS_PATHS = [
  'case.title',
  'case.instructionDate',
  'case.resolutionDate',
  'case.effectiveDate',
];

const firstLower = (text: string) =>
  /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
const stripStop = (text: string) => text.trim().replace(/\.$/, '');

function askFor(field?: IssueField) {
  switch (field?.valueType) {
    case 'recordReference':
      return 'choose a person';
    case 'recordList':
      return 'choose at least one person';
    case 'date':
      return 'enter a date';
    case 'choice':
    case 'boolean':
      return 'choose an answer';
    case 'multiChoice':
      return 'choose at least one option';
    case 'number':
      return 'enter a number';
    default:
      return 'enter an answer';
  }
}

/**
 * Plain wording for a validation issue, e.g. "Proposed director: choose a person".
 * Server issues carry a developer-style location (`clause "X" › field "Y"`); this keeps only
 * the field (and person row) the reader needs to find. `fields` looks up the field the issue
 * belongs to when the caller has the form.
 */
export function plainIssue(issue: Issue, fields: IssueField[] = []): string {
  const location = issue.location || '';
  const quoted = (kind: string) =>
    [...location.matchAll(new RegExp(`${kind} "([^"]+)"`, 'g'))].map((m) => m[1]).at(-1);
  const byId = (id: string) =>
    fields.find((f) => f.id === id && f.unit === issue.unit) ?? fields.find((f) => f.id === id);
  const field =
    (issue.fieldId ? byId(issue.fieldId) : undefined) ??
    fields.find((f) => f.label === quoted('field'));
  const row = quoted('row');
  const signers = /signers › (.+)$/.exec(location)?.[1];
  let label = field?.label || quoted('field') || signers || '';
  if (label && row) label += ` for ${row}`;
  const message = stripStop(issue.message);
  let text = firstLower(message);
  if (message === 'Answer this question' || message === 'Enter a value') text = askFor(field);
  const missing = /^No value is recorded for (.+)\. Complete the source record$/.exec(message);
  if (missing) {
    label = label || missing[1];
    const path = field?.source?.path || '';
    const from = path.startsWith('selection.') ? byId(path.split('.')[1]) : undefined;
    text = from
      ? from.valueType === 'recordReference' || from.valueType === 'recordList'
        ? `choose the ${firstLower(from.label)} first`
        : `answer ${firstLower(from.label)} first`
      : path.startsWith('selection.')
        ? 'answer the question this comes from first'
        : path.startsWith('company.')
          ? 'not recorded on the company file yet'
          : CASE_DETAILS_PATHS.includes(path)
            ? 'add it in step 1, Details'
            : 'no value recorded yet';
  }
  const derived = /^(.+) cannot be calculated yet$/.exec(message);
  if (derived) {
    label = label || derived[1];
    text = 'answer the questions it is calculated from first';
  }
  if (!label) {
    // Fall back to the first named place, e.g. clause "Appointment of director".
    label = /"([^"]+)"/.exec(location)?.[1] || '';
  }
  return label ? `${label}: ${text}` : message;
}
