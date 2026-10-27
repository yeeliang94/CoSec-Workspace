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
