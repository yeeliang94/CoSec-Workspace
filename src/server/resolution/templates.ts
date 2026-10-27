import { createHash, randomUUID } from 'node:crypto';
import { asc, eq, inArray } from 'drizzle-orm';
import { compileDocument } from '../../domain/resolution/compile';
import type { CaseTemplate } from '../../domain/resolution/form';
import type { ResolvedDocument } from '../../domain/resolution/model';
import { renderDocx } from './render-docx';
import { h, p, SAMPLE_BANNER, sampleAnswers, sampleContext, sampleSigners } from './samples';
import { z } from 'zod';
import { assertCapability, DomainError, today } from '../../domain/access';
import type { Actor } from '../../domain/model';
import {
  CLAUSE_CATEGORIES,
  TEMPLATE_SCHEMA_VERSION,
  type AssemblyVersion,
  type ClauseTemplate,
  type ClauseVersion,
  type OutputType,
  type ResolutionAssembly,
} from '../../domain/resolution/model';
import {
  assemblyContentSchema,
  clauseContentSchema,
  defaultLayout,
  defaultSignature,
  OUTPUT_TYPE_ID,
  plainText,
  wordingFor,
} from '../../domain/resolution/schema';
import {
  errorsOnly,
  IssuesError,
  validateAssembly,
  validateClause,
  type Issue,
} from '../../domain/resolution/validate';
import { db, type Transaction } from '../db';
import { endpoint } from '../http';
import { prior, remember, requestKey } from '../repository';
import * as s from '../schema';
import { auditChange, diff, inForce } from './shared';

export type Kind = 'clause' | 'assembly';
type Version<K extends Kind> = K extends 'clause' ? ClauseVersion : AssemblyVersion;
type Template<K extends Kind> = K extends 'clause' ? ClauseTemplate : ResolutionAssembly;
type AnyVersion = ClauseVersion | AssemblyVersion;
type AnyTemplate = ClauseTemplate | ResolutionAssembly;

/** Deterministic JSON (sorted keys) for hashes. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export function contentOf(version: AnyVersion) {
  if ('clauseId' in version) return { wordings: version.wordings, fields: version.fields };
  const { header, closing, signature, starterClauseIds, fields, layout } = version;
  return { header, closing, signature, starterClauseIds, fields, layout };
}
export function contentHash(version: AnyVersion) {
  return sha256(
    canonical({
      schemaVersion: version.schemaVersion,
      content: contentOf(version),
      source: version.source,
      effectiveDate: version.effectiveDate,
    }),
  );
}

/** Routes that may return field-level issues use this instead of `endpoint` directly. */
export async function respond<T>(request: Request, fn: () => Promise<T>) {
  let failure: IssuesError | undefined;
  const response = await endpoint(request, async () => {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof IssuesError) {
        failure = error;
        return null;
      }
      throw error;
    }
  });
  if (!failure) return response;
  return Response.json(
    { error: failure.message, code: failure.code, issues: failure.issues },
    { status: failure.status, headers: { 'Cache-Control': 'no-store' } },
  );
}

const READERS = ['manage_templates', 'generate_documents', 'prepare_job', 'review_pack'] as const;
export function assertTemplateReader(actor: Actor) {
  if (!actor.capabilities.some((c) => (READERS as readonly string[]).includes(c)))
    throw new DomainError('You do not have permission for this action.', 'FORBIDDEN', 403);
}

// ---------------------------------------------------------------- persistence helpers
export async function loadTemplate<K extends Kind>(
  tx: Transaction | typeof db,
  kind: K,
  id: string,
  lock = false,
): Promise<Template<K>> {
  const table = kind === 'clause' ? s.clauseTemplates : s.resolutionAssemblies;
  const query = tx.select().from(table).where(eq(table.id, id));
  const [row] = await (lock ? query.for('update') : query);
  if (!row) throw new DomainError('The template is unavailable.', 'NOT_FOUND', 404);
  return row.data as Template<K>;
}
export async function loadVersion<K extends Kind>(
  tx: Transaction | typeof db,
  kind: K,
  id: string,
  lock = false,
): Promise<Version<K>> {
  const table = kind === 'clause' ? s.clauseTemplateVersions : s.resolutionAssemblyVersions;
  const query = tx.select().from(table).where(eq(table.id, id));
  const [row] = await (lock ? query.for('update') : query);
  if (!row) throw new DomainError('The template version is unavailable.', 'NOT_FOUND', 404);
  return row.data as Version<K>;
}
async function lineage<K extends Kind>(
  tx: Transaction | typeof db,
  kind: K,
  parentId: string,
  lock = false,
) {
  const rows =
    kind === 'clause'
      ? await (lock
          ? tx
              .select()
              .from(s.clauseTemplateVersions)
              .where(eq(s.clauseTemplateVersions.clauseId, parentId))
              .for('update')
          : tx
              .select()
              .from(s.clauseTemplateVersions)
              .where(eq(s.clauseTemplateVersions.clauseId, parentId)))
      : await (lock
          ? tx
              .select()
              .from(s.resolutionAssemblyVersions)
              .where(eq(s.resolutionAssemblyVersions.assemblyId, parentId))
              .for('update')
          : tx
              .select()
              .from(s.resolutionAssemblyVersions)
              .where(eq(s.resolutionAssemblyVersions.assemblyId, parentId)));
  return rows.map((r) => r.data as Version<K>).sort((a, b) => a.version - b.version);
}
async function writeVersion(tx: Transaction, version: AnyVersion, insert = false) {
  if ('clauseId' in version) {
    const row = { status: version.status, revision: version.revision, data: version };
    if (insert)
      await tx
        .insert(s.clauseTemplateVersions)
        .values({ id: version.id, clauseId: version.clauseId, version: version.version, ...row });
    else
      await tx
        .update(s.clauseTemplateVersions)
        .set(row)
        .where(eq(s.clauseTemplateVersions.id, version.id));
  } else {
    const row = { status: version.status, revision: version.revision, data: version };
    if (insert)
      await tx.insert(s.resolutionAssemblyVersions).values({
        id: version.id,
        assemblyId: version.assemblyId,
        version: version.version,
        ...row,
      });
    else
      await tx
        .update(s.resolutionAssemblyVersions)
        .set(row)
        .where(eq(s.resolutionAssemblyVersions.id, version.id));
  }
}
async function writeTemplate(tx: Transaction, kind: Kind, template: AnyTemplate, insert = false) {
  const table = kind === 'clause' ? s.clauseTemplates : s.resolutionAssemblies;
  if (insert)
    await tx
      .insert(table)
      .values({ id: template.id, revision: template.revision, data: template as never });
  else
    await tx
      .update(table)
      .set({ revision: template.revision, data: template as never })
      .where(eq(table.id, template.id));
}
/** The version's editors with `actorId` added once. */
const withEditor = (version: AnyVersion, actorId: string) =>
  (version.editors ?? []).includes(actorId)
    ? (version.editors ?? [])
    : [...(version.editors ?? []), actorId];
const parentOf = (v: AnyVersion) => ('clauseId' in v ? v.clauseId : v.assemblyId);
const versionEntity = (kind: Kind) => (kind === 'clause' ? 'clause_version' : 'assembly_version');
const templateEntity = (kind: Kind) => (kind === 'clause' ? 'clause_template' : 'assembly');

export async function listOutputTypes(tx: Transaction | typeof db = db): Promise<OutputType[]> {
  return (await tx.select().from(s.outputTypes))
    .map((r) => r.data)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Validation issues for a version (both structural and reference problems). */
export async function versionIssues(
  kind: Kind,
  template: AnyTemplate,
  version: AnyVersion,
  tx: Transaction | typeof db = db,
) {
  if ('clauseId' in version)
    return validateClause(template.name, version, await listOutputTypes(tx));
  const issues = validateAssembly(template.name, version);
  if (version.starterClauseIds.length) {
    const found = await tx
      .select({ id: s.clauseTemplates.id })
      .from(s.clauseTemplates)
      .where(inArray(s.clauseTemplates.id, version.starterClauseIds));
    for (const id of version.starterClauseIds)
      if (!found.some((r) => r.id === id))
        issues.push({
          message: 'A starter clause no longer exists.',
          location: `assembly "${template.name}" › starter clauses`,
        });
  }
  void kind;
  return issues;
}
function publicationIssues(version: AnyVersion, prefix: string): Issue[] {
  const issues: Issue[] = [];
  if (!version.source.trim())
    issues.push({
      message: 'Record the source or basis of this wording.',
      location: `${prefix} › source`,
    });
  if (!version.effectiveDate)
    issues.push({
      message: 'Record the date this version takes effect.',
      location: `${prefix} › effective date`,
    });
  return issues;
}

// ---------------------------------------------------------------- reads
export async function listTemplates(
  actor: Actor,
  kind: Kind,
  filters: {
    category?: string;
    act?: string;
    includeHidden?: boolean;
    usage?: string;
    outputTypeId?: string;
  } = {},
) {
  assertTemplateReader(actor);
  const templates =
    kind === 'clause'
      ? (await db.select().from(s.clauseTemplates)).map((r) => r.data as AnyTemplate)
      : (await db.select().from(s.resolutionAssemblies)).map((r) => r.data as AnyTemplate);
  const versions =
    kind === 'clause'
      ? (
          await db
            .select()
            .from(s.clauseTemplateVersions)
            .orderBy(asc(s.clauseTemplateVersions.version))
        ).map((r) => r.data as AnyVersion)
      : (
          await db
            .select()
            .from(s.resolutionAssemblyVersions)
            .orderBy(asc(s.resolutionAssemblyVersions.version))
        ).map((r) => r.data as AnyVersion);
  return templates
    .filter((t) => {
      if (!filters.includeHidden && (t.archived || ('hidden' in t && t.hidden))) return false;
      if (filters.usage && !t.usageContexts.includes(filters.usage as never)) return false;
      if ('category' in t) {
        if (filters.category && t.category !== filters.category) return false;
        if (filters.act && t.governingAct !== filters.act) return false;
      } else if (filters.outputTypeId && t.outputTypeId !== filters.outputTypeId) return false;
      return true;
    })
    .sort((a, b) =>
      'category' in a && 'category' in b
        ? a.category.localeCompare(b.category) ||
          a.displayOrder - b.displayOrder ||
          a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name),
    )
    .map((t) => ({ ...t, versions: versions.filter((v) => parentOf(v) === t.id) }));
}

export async function getVersion(actor: Actor, kind: Kind, templateId: string, versionId: string) {
  assertTemplateReader(actor);
  const [template, version] = await Promise.all([
    loadTemplate(db, kind, templateId),
    loadVersion(db, kind, versionId),
  ]);
  if (parentOf(version) !== templateId)
    throw new DomainError('The template version is unavailable.', 'NOT_FOUND', 404);
  const predecessor = version.predecessorId
    ? await loadVersion(db, kind, version.predecessorId)
    : null;
  return {
    template,
    version,
    issues: await versionIssues(kind, template, version),
    changes: predecessor ? diff(contentOf(predecessor), contentOf(version)) : [],
  };
}

// ---------------------------------------------------------------- template-level actions
const requestId = z.string().min(8).max(80);
const usage = z
  .array(z.enum(['board', 'director_appointment', 'director_resignation']))
  .min(1)
  .max(3);
const name = plainText(160).trim().min(1);
const clauseMeta = {
  name,
  category: z.enum(CLAUSE_CATEGORIES),
  usageContexts: usage,
  governingAct: plainText(160).trim().default('Companies Act 2016'),
  displayOrder: z.number().int().min(0).max(100_000).default(100),
  description: plainText(1000, true).default(''),
};
const clauseAction = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('create'), requestId, ...clauseMeta }),
  z.strictObject({
    action: z.literal('copy'),
    requestId,
    sourceId: z.string().min(1).max(36),
    versionId: z.string().min(1).max(36).optional(),
    name,
  }),
  z.strictObject({
    action: z.literal('update'),
    requestId,
    id: z.string().min(1).max(36),
    expectedRevision: z.number().int().positive(),
    name: name.optional(),
    category: clauseMeta.category.optional(),
    usageContexts: usage.optional(),
    governingAct: plainText(160).trim().optional(),
    displayOrder: z.number().int().min(0).max(100_000).optional(),
    description: plainText(1000, true).optional(),
    hidden: z.boolean().optional(),
    archived: z.boolean().optional(),
    reason: plainText(1000).optional(),
  }),
]);
const assemblyAction = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('create'),
    requestId,
    name,
    outputTypeId: z.string().regex(OUTPUT_TYPE_ID),
    usageContexts: usage,
    description: plainText(1000, true).default(''),
  }),
  z.strictObject({
    action: z.literal('copy'),
    requestId,
    sourceId: z.string().min(1).max(36),
    versionId: z.string().min(1).max(36).optional(),
    name,
  }),
  z.strictObject({
    action: z.literal('update'),
    requestId,
    id: z.string().min(1).max(36),
    expectedRevision: z.number().int().positive(),
    name: name.optional(),
    usageContexts: usage.optional(),
    description: plainText(1000, true).optional(),
    archived: z.boolean().optional(),
    reason: plainText(1000).optional(),
  }),
]);

function blankVersion(kind: Kind, parentId: string, actor: Actor, now: string): AnyVersion {
  const base = {
    id: randomUUID(),
    version: 1,
    status: 'Draft' as const,
    revision: 1,
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    source: '',
    effectiveDate: null,
    createdBy: actor.id,
    createdAt: now,
    updatedAt: now,
    submittedBy: null,
    submittedAt: null,
    reviewedBy: null,
    reviewedAt: null,
    returnReason: null,
    predecessorId: null,
    contentHash: null,
    editors: [actor.id],
  };
  return kind === 'clause'
    ? { ...base, clauseId: parentId, wordings: {}, fields: [] }
    : {
        ...base,
        assemblyId: parentId,
        header: [{ type: 'clauseSlot', numbering: 'decimal' }],
        closing: [],
        signature: defaultSignature,
        starterClauseIds: [],
        fields: [],
        layout: defaultLayout,
      };
}

/** create / copy / update for clause templates or assemblies. */
export async function templateAction(actor: Actor, kind: Kind, input: unknown) {
  assertCapability(actor, 'manage_templates');
  const action = (kind === 'clause' ? clauseAction : assemblyAction).parse(input);
  const key = requestKey(
    actor,
    `${templateEntity(kind)}:${action.action === 'update' ? action.id : action.action}`,
    action.requestId,
  );
  const id = await db.transaction(async (tx) => {
    const old = await prior(tx, key);
    if (old) return old.id;
    const now = new Date().toISOString();
    if (action.action === 'update') {
      const current = await loadTemplate(tx, kind, action.id, true);
      if (current.revision !== action.expectedRevision)
        throw new DomainError(
          'This template changed. Refresh and review the current version.',
          'STALE',
          409,
        );
      const {
        action: _a,
        requestId: _r,
        id: _i,
        expectedRevision: _e,
        reason,
        ...changes
      } = action;
      void _a;
      void _r;
      void _i;
      void _e;
      const defined = Object.fromEntries(
        Object.entries(changes).filter(([, v]) => v !== undefined),
      );
      const next = { ...current, ...defined, revision: current.revision + 1 } as AnyTemplate;
      await writeTemplate(tx, kind, next);
      await auditChange(tx, actor, {
        companyId: null,
        entityType: templateEntity(kind),
        entityId: next.id,
        action: `${templateEntity(kind)}.updated`,
        before: current,
        after: next,
        reason: reason ?? null,
        requestId: action.requestId,
      });
      await remember(tx, key, { id: next.id, revision: next.revision });
      return next.id;
    }
    let template: AnyTemplate;
    let version: AnyVersion;
    if (action.action === 'create') {
      const tid = randomUUID();
      template =
        kind === 'clause'
          ? {
              id: tid,
              ...(action as Extract<z.infer<typeof clauseAction>, { action: 'create' }>),
              hidden: false,
              archived: false,
              createdBy: actor.id,
              createdAt: now,
              revision: 1,
            }
          : {
              id: tid,
              ...(action as Extract<z.infer<typeof assemblyAction>, { action: 'create' }>),
              archived: false,
              createdBy: actor.id,
              createdAt: now,
              revision: 1,
            };
      delete (template as { action?: unknown }).action;
      delete (template as { requestId?: unknown }).requestId;
      if (kind === 'assembly') {
        const types = await listOutputTypes(tx);
        if (!types.some((t) => t.id === (template as ResolutionAssembly).outputTypeId && t.active))
          throw new DomainError('Choose an active output type.');
      }
      version = blankVersion(kind, tid, actor, now);
    } else {
      const source = await loadTemplate(tx, kind, action.sourceId);
      const versions = await lineage(tx, kind, source.id);
      const from = action.versionId
        ? versions.find((v) => v.id === action.versionId)
        : versions.at(-1);
      if (!from) throw new DomainError('The template version is unavailable.', 'NOT_FOUND', 404);
      const tid = randomUUID();
      template = {
        ...source,
        id: tid,
        name: action.name,
        archived: false,
        ...('hidden' in source ? { hidden: false } : {}),
        createdBy: actor.id,
        createdAt: now,
        revision: 1,
      } as AnyTemplate;
      // A copy is a new lineage; field ids are kept so references inside it stay valid.
      version = {
        ...structuredClone(from),
        ...blankVersion(kind, tid, actor, now),
        ...contentOf(structuredClone(from)),
        source: from.source,
      } as AnyVersion;
    }
    await writeTemplate(tx, kind, template, true);
    await writeVersion(tx, version, true);
    await auditChange(tx, actor, {
      companyId: null,
      entityType: templateEntity(kind),
      entityId: template.id,
      action: `${templateEntity(kind)}.${action.action === 'copy' ? 'copied' : 'created'}`,
      after: template,
      detail: {
        versionId: version.id,
        ...(action.action === 'copy' ? { copiedFrom: action.sourceId } : {}),
      },
      requestId: action.requestId,
    });
    await remember(tx, key, { id: template.id, revision: 1 });
    return template.id;
  });
  const template = await loadTemplate(db, kind, id);
  return { ...template, versions: await lineage(db, kind, id) };
}

// ---------------------------------------------------------------- version lifecycle
const base = { requestId, expectedRevision: z.number().int().positive() };
const versionAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save_draft'), ...base }).passthrough(),
  z.strictObject({ action: z.literal('submit'), ...base }),
  z.strictObject({
    action: z.literal('return'),
    ...base,
    reason: plainText(2000, true).trim().min(1),
  }),
  z.strictObject({ action: z.literal('publish'), ...base, confirm: z.literal(true) }),
  z.strictObject({ action: z.literal('new_version'), requestId }),
]);

export async function applyVersionAction<K extends Kind>(
  actor: Actor,
  kind: K,
  templateId: string,
  versionId: string,
  input: unknown,
): Promise<{ version: Version<K>; issues: Issue[] }> {
  const action = versionAction.parse(input);
  assertCapability(actor, 'manage_templates');
  if (action.action === 'publish' || action.action === 'return')
    assertCapability(actor, 'review_pack');
  let content: Record<string, unknown> | null = null;
  if (action.action === 'save_draft') {
    const {
      action: _a,
      requestId: _r,
      expectedRevision: _e,
      ...rest
    } = action as Record<string, unknown>;
    void _a;
    void _r;
    void _e;
    content = (kind === 'clause' ? clauseContentSchema : assemblyContentSchema).parse(rest);
  }
  const key = requestKey(actor, `${versionEntity(kind)}:${versionId}`, action.requestId);
  return db.transaction(async (tx) => {
    // The template row lock serialises every lifecycle change in one lineage.
    const template = await loadTemplate(tx, kind, templateId, true);
    const current = await loadVersion(tx, kind, versionId, true);
    if (parentOf(current) !== templateId)
      throw new DomainError('The template version is unavailable.', 'NOT_FOUND', 404);
    const old = await prior(tx, key);
    if (old) return { version: (await loadVersion(tx, kind, old.id)) as Version<K>, issues: [] };
    if (action.action !== 'new_version' && current.revision !== action.expectedRevision)
      throw new DomainError(
        'This version changed. Refresh and review the current version.',
        'STALE',
        409,
      );
    const now = new Date().toISOString();
    const prefix = `${kind} "${template.name}"`;
    let next: AnyVersion = structuredClone(current);
    let issues: Issue[] = [];
    let reason: string | null = null;
    const others: AnyVersion[] = [];
    switch (action.action) {
      case 'save_draft':
        if (current.status !== 'Draft' && current.status !== 'Returned')
          throw new DomainError(
            'Only a draft can be edited. Create a new version instead.',
            'CONFLICT',
            409,
          );
        next = {
          ...next,
          ...(content as object),
          status: 'Draft',
          updatedAt: now,
          contentHash: null,
          editors: withEditor(current, actor.id),
        } as AnyVersion;
        issues = await versionIssues(kind, template, next, tx);
        break;
      case 'submit':
        if (current.status !== 'Draft' && current.status !== 'Returned')
          throw new DomainError('Only a draft can be submitted.', 'CONFLICT', 409);
        issues = [
          ...(await versionIssues(kind, template, current, tx)),
          ...publicationIssues(current, prefix),
        ];
        if (errorsOnly(issues).length)
          throw new IssuesError('Fix these problems before review:', errorsOnly(issues));
        next = {
          ...next,
          status: 'In review',
          submittedBy: actor.id,
          submittedAt: now,
          updatedAt: now,
          returnReason: null,
          contentHash: contentHash(current),
        };
        break;
      case 'return':
        if (current.status !== 'In review')
          throw new DomainError('Only a version in review can be returned.', 'CONFLICT', 409);
        next = {
          ...next,
          status: 'Returned',
          returnReason: action.reason,
          reviewedBy: actor.id,
          reviewedAt: now,
          updatedAt: now,
        };
        reason = action.reason;
        break;
      case 'publish': {
        if (current.status !== 'In review')
          throw new DomainError('Only a version in review can be published.', 'CONFLICT', 409);
        // Anyone who wrote any of this wording (including while it was Returned) is not independent.
        if (
          current.createdBy === actor.id ||
          current.submittedBy === actor.id ||
          (current.editors ?? []).includes(actor.id)
        )
          throw new DomainError(
            'An independent reviewer must publish this version.',
            'SELF_APPROVAL',
            403,
          );
        if (!current.contentHash || current.contentHash !== contentHash(current))
          throw new DomainError(
            'The content changed after submission. Return it and submit again.',
            'CONFLICT',
            409,
          );
        issues = [
          ...(await versionIssues(kind, template, current, tx)),
          ...publicationIssues(current, prefix),
        ];
        if (errorsOnly(issues).length)
          throw new IssuesError('Publication is blocked:', errorsOnly(issues));
        for (const other of await lineage(tx, kind, templateId, true))
          if (other.id !== current.id && other.status === 'Published')
            others.push({ ...other, status: 'Superseded', updatedAt: now });
        next = {
          ...next,
          status: 'Published',
          reviewedBy: actor.id,
          reviewedAt: now,
          updatedAt: now,
        };
        break;
      }
      case 'new_version': {
        if (current.status !== 'Published' && current.status !== 'Superseded')
          throw new DomainError('Start a new version from a published version.', 'CONFLICT', 409);
        const versions = await lineage(tx, kind, templateId, true);
        const open = versions.find((v) => ['Draft', 'In review', 'Returned'].includes(v.status));
        if (open)
          throw new DomainError(
            `Version ${open.version} is still ${open.status.toLowerCase()}. Continue that version.`,
            'CONFLICT',
            409,
          );
        next = {
          ...structuredClone(current),
          ...blankVersion(kind, templateId, actor, now),
          ...contentOf(structuredClone(current)),
          source: current.source,
          version: Math.max(...versions.map((v) => v.version)) + 1,
          predecessorId: current.id,
        } as AnyVersion;
        break;
      }
    }
    if (action.action !== 'new_version') next.revision = current.revision + 1;
    await writeVersion(tx, next, action.action === 'new_version');
    for (const other of others) {
      await writeVersion(tx, other);
      await auditChange(tx, actor, {
        companyId: null,
        entityType: versionEntity(kind),
        entityId: other.id,
        action: `${versionEntity(kind)}.superseded`,
        before: { status: 'Published' },
        after: { status: 'Superseded' },
        detail: { templateId, version: other.version, supersededBy: next.id },
        requestId: action.requestId,
      });
    }
    const contentChanged = action.action === 'save_draft' || action.action === 'new_version';
    await auditChange(tx, actor, {
      companyId: null,
      entityType: versionEntity(kind),
      entityId: next.id,
      action: `${versionEntity(kind)}.${action.action === 'save_draft' ? 'draft_saved' : action.action === 'new_version' ? 'created' : action.action === 'submit' ? 'submitted' : action.action === 'return' ? 'returned' : 'published'}`,
      before:
        contentChanged && action.action === 'save_draft'
          ? {
              status: current.status,
              source: current.source,
              effectiveDate: current.effectiveDate,
              ...contentOf(current),
            }
          : { status: current.status },
      after: contentChanged
        ? {
            status: next.status,
            source: next.source,
            effectiveDate: next.effectiveDate,
            ...contentOf(next),
          }
        : { status: next.status },
      detail: {
        templateId,
        version: next.version,
        revision: next.revision,
        contentHash: next.contentHash,
        ...(action.action === 'new_version' ? { predecessorId: current.id } : {}),
      },
      reason,
      requestId: action.requestId,
    });
    await remember(tx, key, { id: next.id, revision: next.revision });
    return { version: next as Version<K>, issues };
  });
}

// ---------------------------------------------------------------- output types
const outputTypeAction = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('create'),
    requestId,
    id: z.string().regex(OUTPUT_TYPE_ID),
    name: plainText(120).trim().min(1),
    body: z.enum(['directors', 'members']),
    order: z.number().int().min(0).max(1000).default(100),
  }),
  z.strictObject({
    action: z.literal('update'),
    requestId,
    id: z.string().regex(OUTPUT_TYPE_ID),
    name: plainText(120).trim().min(1).optional(),
    active: z.boolean().optional(),
    order: z.number().int().min(0).max(1000).optional(),
  }),
]);
export async function applyOutputTypeAction(actor: Actor, input: unknown) {
  assertCapability(actor, 'manage_templates');
  const action = outputTypeAction.parse(input);
  const key = requestKey(actor, `output_type:${action.id}`, action.requestId);
  await db.transaction(async (tx) => {
    if (await prior(tx, key)) return;
    const [row] = await tx
      .select()
      .from(s.outputTypes)
      .where(eq(s.outputTypes.id, action.id))
      .for('update');
    const before: OutputType | null = row?.data ?? null;
    let next: OutputType;
    if (action.action === 'create') {
      if (row)
        throw new DomainError('An output type with this id already exists.', 'DUPLICATE', 409);
      next = {
        id: action.id,
        name: action.name,
        body: action.body,
        active: true,
        order: action.order,
      };
      await tx.insert(s.outputTypes).values({ id: next.id, data: next });
    } else {
      if (!row) throw new DomainError('The output type is unavailable.', 'NOT_FOUND', 404);
      next = {
        ...row.data,
        ...(action.name !== undefined ? { name: action.name } : {}),
        ...(action.active !== undefined ? { active: action.active } : {}),
        ...(action.order !== undefined ? { order: action.order } : {}),
      };
      await tx.update(s.outputTypes).set({ data: next }).where(eq(s.outputTypes.id, next.id));
    }
    await auditChange(tx, actor, {
      companyId: null,
      entityType: 'output_type',
      entityId: next.id,
      action: `output_type.${action.action === 'create' ? 'created' : 'updated'}`,
      before,
      after: next,
      requestId: action.requestId,
    });
    await remember(tx, key, { id: next.id });
  });
  return listOutputTypes();
}

// ---------------------------------------------------------------- template preview service
const previewInput = z.strictObject({
  kind: z.enum(['clause', 'assembly']),
  versionId: z.string().min(1).max(36),
  outputTypeId: z.string().min(1).max(64).optional(),
  draft: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Previews a clause or assembly (saved version or unsaved draft) with fictional values only.
 * No company data is read, so a shared template never carries real data from a preview.
 */
export async function previewTemplate(actor: Actor, input: unknown) {
  assertTemplateReader(actor);
  const request = previewInput.parse(input);
  const ctx = sampleContext(today());
  const types = await listOutputTypes();
  let template: CaseTemplate;
  let issues: Issue[];
  if (request.kind === 'clause') {
    const version = await loadVersion(db, 'clause', request.versionId);
    const clause = await loadTemplate(db, 'clause', version.clauseId);
    const content = request.draft
      ? clauseContentSchema.parse({ source: '', effectiveDate: null, ...request.draft })
      : version;
    const outputTypeId =
      request.outputTypeId ?? Object.keys(content.wordings)[0] ?? 'directors_written';
    const outputType = types.find((t) => t.id === outputTypeId);
    if (!outputType) throw new DomainError('Choose a configured output type.');
    issues = validateClause(clause.name, content, types);
    template = {
      outputType,
      assembly: {
        name: SAMPLE_BANNER,
        version: {
          id: 'sample-assembly',
          header: [
            h(1, outputType.name.toUpperCase(), 'center'),
            { type: 'clauseSlot', numbering: 'decimal' },
          ],
          closing: [],
          signature: { columns: 2, showDate: false, label: '{name}' },
          fields: [],
          layout: defaultLayout,
        },
      },
      clauses: [
        {
          key: 'sample',
          name: clause.name,
          version: { id: version.id, wordings: content.wordings, fields: content.fields },
        },
      ],
    };
  } else {
    const version = await loadVersion(db, 'assembly', request.versionId);
    const assembly = await loadTemplate(db, 'assembly', version.assemblyId);
    const content = request.draft
      ? assemblyContentSchema.parse({
          source: '',
          effectiveDate: null,
          starterClauseIds: [],
          ...request.draft,
        })
      : version;
    const outputType = types.find((t) => t.id === (request.outputTypeId ?? assembly.outputTypeId));
    if (!outputType) throw new DomainError('Choose a configured output type.');
    issues = validateAssembly(assembly.name, content);
    const candidates = content.starterClauseIds.length
      ? (
          await db
            .select()
            .from(s.clauseTemplateVersions)
            .where(inArray(s.clauseTemplateVersions.clauseId, content.starterClauseIds))
        ).map((r) => r.data)
      : [];
    // Starters follow the same effective-date rule as a new case dated today.
    const asAt = today();
    const starters = content.starterClauseIds.flatMap((id) => {
      const v = inForce(
        candidates.filter((x) => x.clauseId === id),
        asAt,
      );
      return v && wordingFor(v.wordings, outputType.id)?.length ? [v] : [];
    });
    const names = starters.length
      ? (
          await db
            .select()
            .from(s.clauseTemplates)
            .where(
              inArray(
                s.clauseTemplates.id,
                starters.map((v) => v.clauseId),
              ),
            )
        ).map((r) => r.data)
      : [];
    const clauses = content.starterClauseIds.flatMap((id) => {
      const v = starters.find((x) => x.clauseId === id);
      return v
        ? [
            {
              key: `s${v.version}${id.slice(0, 6)}`.toLowerCase().replace(/[^a-z0-9]/g, ''),
              name: names.find((n) => n.id === id)?.name ?? 'Clause',
              version: v,
            },
          ]
        : [];
    });
    template = {
      outputType,
      assembly: { name: assembly.name, version: { id: version.id, ...content } },
      clauses: clauses.length
        ? clauses
        : [
            {
              key: 'placeholder',
              name: 'Selected clauses',
              version: {
                id: 'placeholder',
                fields: [],
                wordings: {
                  [outputType.id]: [p('[The clauses chosen for the case appear here.]')],
                },
              },
            },
          ],
    };
  }
  const allFields = [
    template.assembly.version.fields,
    ...template.clauses.map((c) => c.version.fields),
  ];
  const shared = sampleAnswers(
    allFields
      .flat()
      .filter(
        (field, i, list) =>
          (field.scope === 'case' || template.assembly.version.fields.includes(field)) &&
          list.findIndex((x) => x.id === field.id) === i,
      ),
    ctx,
  );
  const answers = {
    shared,
    clauses: Object.fromEntries(
      template.clauses.map((c) => [
        c.key,
        sampleAnswers(
          c.version.fields.filter((x) => x.scope === 'clause'),
          ctx,
        ),
      ]),
    ),
  };
  const compiled = compileDocument(
    { ...template, ctx, answers, signers: sampleSigners(ctx) },
    'sample',
  );
  const resolved: ResolvedDocument = {
    ...compiled.resolved,
    title: `${compiled.resolved.title} (${SAMPLE_BANNER})`,
    layout: {
      ...compiled.resolved.layout,
      header: [SAMPLE_BANNER, compiled.resolved.layout.header].filter(Boolean).join(' · '),
    },
    blocks: [
      { type: 'paragraph', align: 'center', runs: [{ text: SAMPLE_BANNER, marks: ['bold'] }] },
      ...compiled.resolved.blocks,
    ],
    containsSamples: true,
  };
  return { resolved, issues: [...issues, ...compiled.issues], values: compiled.values };
}

export async function previewTemplateDocx(actor: Actor, input: unknown) {
  const { resolved } = await previewTemplate(actor, input);
  return {
    bytes: await renderDocx(resolved),
    fileName: `${resolved.title.replace(/[^\p{L}\p{N} ._()-]+/gu, ' ').trim()}.docx`,
  };
}
