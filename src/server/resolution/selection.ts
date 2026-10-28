import { assertEditable } from '../../domain/resolution/cases';
import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import { DomainError, today } from '../../domain/access';
import type { Actor } from '../../domain/model';
import { compileDocument } from '../../domain/resolution/compile';
import {
  buildForm,
  validateAnswers,
  type CaseInput,
  type CaseTemplate,
} from '../../domain/resolution/form';
import type {
  AssemblyVersion,
  CaseClauseSelection,
  CaseKind,
  ClauseEntry,
  ClauseTemplate,
  ClauseVersion,
  ResolutionAssembly,
  ResolutionCase,
} from '../../domain/resolution/model';
import {
  answerValueSchema,
  FIELD_ID,
  LIMITS,
  plainText,
  wordingFor,
} from '../../domain/resolution/schema';
import { errorsOnly, IssuesError } from '../../domain/resolution/validate';
import { db, type Transaction } from '../db';
import { getJob } from '../repository';
import { loadResolutionContext } from '../records/context';
import * as s from '../schema';
import { inForce, mutateCase, readCase, requestId, type Lifecycle } from './shared';
export { inForce };
import { listOutputTypes } from './output-types';

type Reader = Transaction | typeof db;
const WRITERS = ['generate_documents', 'prepare_job'];
export function assertPreparer(actor: Actor) {
  if (!actor.capabilities.some((c) => WRITERS.includes(c)))
    throw new DomainError('You do not have permission for this action.', 'FORBIDDEN', 403);
}

type Library = {
  clauses: Map<string, ClauseTemplate>;
  clauseVersions: ClauseVersion[];
  assemblies: Map<string, ResolutionAssembly>;
  assemblyVersions: AssemblyVersion[];
};
async function library(tx: Reader): Promise<Library> {
  const [clauses, clauseVersions, assemblies, assemblyVersions] = await Promise.all([
    tx.select().from(s.clauseTemplates),
    tx.select().from(s.clauseTemplateVersions),
    tx.select().from(s.resolutionAssemblies),
    tx.select().from(s.resolutionAssemblyVersions),
  ]);
  return {
    clauses: new Map(clauses.map((r) => [r.id, r.data])),
    clauseVersions: clauseVersions.map((r) => r.data),
    assemblies: new Map(assemblies.map((r) => [r.id, r.data])),
    assemblyVersions: assemblyVersions.map((r) => r.data),
  };
}

/** Why a version cannot be newly chosen on `asAt` (lifecycle only), or null. */
function lifecycleProblem<V extends Lifecycle>(lineage: V[], version: V, asAt: string) {
  if (version.status !== 'Published' && version.status !== 'Superseded')
    return 'Only a published version can be added.';
  if (!version.effectiveDate || version.effectiveDate > asAt) return 'not effective';
  if (inForce(lineage, asAt)?.id !== version.id)
    return 'Only the version currently in force can be added.';
  return null;
}

/** Why a clause version cannot be newly selected for this case, or null when it can. */
function clauseProblem(
  lib: Library,
  version: ClauseVersion,
  kind: CaseKind,
  outputTypeId: string | null,
  asAt: string,
) {
  const template = lib.clauses.get(version.clauseId);
  if (!template) return 'The clause is unavailable.';
  const lifecycle = lifecycleProblem(
    lib.clauseVersions.filter((v) => v.clauseId === version.clauseId),
    version,
    asAt,
  );
  if (lifecycle === 'not effective') return 'The clause is not effective yet.';
  if (lifecycle) return lifecycle;
  if (template.hidden || template.archived) return 'The clause is hidden from the library.';
  if (!template.usageContexts.includes(kind))
    return 'The clause is not offered for this kind of case.';
  if (outputTypeId && !wordingFor(version.wordings, outputTypeId)?.length)
    return 'The clause has no wording for this output type.';
  return null;
}
function assemblyProblem(
  lib: Library,
  version: AssemblyVersion,
  kind: CaseKind,
  outputTypeId: string,
  asAt: string,
) {
  const template = lib.assemblies.get(version.assemblyId);
  if (!template) return 'The assembly is unavailable.';
  const lifecycle = lifecycleProblem(
    lib.assemblyVersions.filter((v) => v.assemblyId === version.assemblyId),
    version,
    asAt,
  );
  if (lifecycle === 'not effective') return 'The assembly is not effective yet.';
  if (lifecycle) return 'Choose the assembly version currently in force.';
  if (template.archived) return 'The assembly is archived.';
  if (!template.usageContexts.includes(kind))
    return 'The assembly is not offered for this kind of case.';
  if (template.outputTypeId !== outputTypeId) return 'The assembly is for a different output type.';
  return null;
}

function available(lib: Library, rc: ResolutionCase, outputTypeId: string | null) {
  const asAt = caseAsAt(rc);
  const clauses = lib.clauseVersions
    .filter((v) => !clauseProblem(lib, v, rc.kind, outputTypeId, asAt))
    .map((v) => {
      const t = lib.clauses.get(v.clauseId)!;
      return {
        clauseId: t.id,
        clauseVersionId: v.id,
        version: v.version,
        name: t.name,
        category: t.category,
        governingAct: t.governingAct,
        displayOrder: t.displayOrder,
        description: t.description,
        usageContexts: t.usageContexts,
        outputTypeIds: Object.entries(v.wordings)
          .filter(([, blocks]) => blocks.length)
          .map(([k]) => k),
      };
    })
    .sort(
      (a, b) =>
        a.category.localeCompare(b.category) ||
        a.displayOrder - b.displayOrder ||
        a.name.localeCompare(b.name),
    );
  const assemblies = lib.assemblyVersions
    .filter((v) => {
      const t = lib.assemblies.get(v.assemblyId);
      // Offer every output type's assemblies so the preparer can switch output type.
      return !assemblyProblem(lib, v, rc.kind, t?.outputTypeId ?? '', asAt);
    })
    .map((v) => {
      const t = lib.assemblies.get(v.assemblyId)!;
      return {
        assemblyId: t.id,
        assemblyVersionId: v.id,
        version: v.version,
        name: t.name,
        outputTypeId: t.outputTypeId,
        description: t.description,
        starterClauseIds: v.starterClauseIds,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const newerVersions = (rc.selection?.clauses ?? []).flatMap((entry) => {
    const pinned = lib.clauseVersions.find((v) => v.id === entry.clauseVersionId);
    const current = inForce(
      lib.clauseVersions.filter((v) => v.clauseId === entry.clauseId),
      asAt,
    );
    const newer =
      current &&
      current.id !== entry.clauseVersionId &&
      (!pinned || current.version > pinned.version)
        ? current
        : null;
    return newer
      ? [
          {
            key: entry.key,
            clauseId: entry.clauseId,
            pinnedVersionId: entry.clauseVersionId,
            pinnedVersion: pinned?.version ?? null,
            newerVersionId: newer.id,
            newerVersion: newer.version,
            hasWording: !!(
              rc.selection && wordingFor(newer.wordings, rc.selection.outputTypeId)?.length
            ),
          },
        ]
      : [];
  });
  return { clauses, assemblies, newerVersions };
}

/** A case template with the full pinned version records (status, dates) for lifecycle checks. */
export type LoadedCaseTemplate = Omit<CaseTemplate, 'assembly' | 'clauses'> & {
  assembly: { name: string; version: AssemblyVersion };
  clauses: { key: string; name: string; version: ClauseVersion }[];
};

/** The exact pinned template versions of a selection, ready for the form engine and compiler. */
export async function loadCaseTemplate(
  tx: Reader,
  selection: CaseClauseSelection,
): Promise<LoadedCaseTemplate> {
  const types = await listOutputTypes(tx);
  const outputType = types.find((t) => t.id === selection.outputTypeId);
  if (!outputType) throw new DomainError('The document type is unavailable.');
  const [assemblyRow] = await tx
    .select()
    .from(s.resolutionAssemblyVersions)
    .where(inArray(s.resolutionAssemblyVersions.id, [selection.assemblyVersionId]));
  if (!assemblyRow) throw new DomainError('The layout is unavailable.', 'NOT_FOUND', 404);
  const [assembly] = await tx
    .select()
    .from(s.resolutionAssemblies)
    .where(inArray(s.resolutionAssemblies.id, [assemblyRow.assemblyId]));
  const ids = selection.clauses.map((c) => c.clauseVersionId);
  const versions = ids.length
    ? (
        await tx
          .select()
          .from(s.clauseTemplateVersions)
          .where(inArray(s.clauseTemplateVersions.id, ids))
      ).map((r) => r.data)
    : [];
  const templateIds = [...new Set(versions.map((v) => v.clauseId))];
  const templates = templateIds.length
    ? (
        await tx.select().from(s.clauseTemplates).where(inArray(s.clauseTemplates.id, templateIds))
      ).map((r) => r.data)
    : [];
  return {
    outputType: { id: outputType.id, name: outputType.name },
    assembly: { name: assembly.data.name, version: assemblyRow.data },
    clauses: selection.clauses.map((entry) => {
      const version = versions.find((v) => v.id === entry.clauseVersionId);
      if (!version || version.clauseId !== entry.clauseId)
        throw new DomainError('A paragraph version is unavailable.', 'NOT_FOUND', 404);
      return {
        key: entry.key,
        name: templates.find((t) => t.id === entry.clauseId)?.name ?? 'Clause',
        version,
      };
    }),
  };
}

export const caseAsAt = (rc: ResolutionCase) => rc.resolutionDate ?? today();

export async function getCaseClauses(actor: Actor, caseId: string) {
  const rc = await readCase(actor, caseId);
  const lib = await library(db);
  const outputTypes = (await listOutputTypes()).filter((t) => t.active);
  if (!rc.selection)
    return {
      selection: null,
      outputTypes,
      available: available(lib, rc, null),
      form: null,
      formInput: null,
    };
  const template = await loadCaseTemplate(db, rc.selection);
  const ctx = await loadResolutionContext(actor, caseId, caseAsAt(rc));
  const input: CaseInput = { ...template, ctx, answers: rc.answers, signers: rc.signers };
  return {
    selection: rc.selection,
    answers: rc.answers,
    signers: rc.signers,
    outputTypes,
    available: available(lib, rc, rc.selection.outputTypeId),
    form: buildForm(input),
    formInput: input,
    issues: validateAnswers(input, true),
  };
}

const entryKey = z.string().regex(/^[a-z0-9_-]{2,40}$/);
const answersSchema = z
  .record(
    z.string().regex(FIELD_ID),
    z.union([answerValueSchema, z.record(z.string().min(1).max(100), answerValueSchema)]),
  )
  .refine((a) => Object.keys(a).length <= 200, 'Too many answers.');
const ids = z.array(z.string().min(1).max(100)).max(LIMITS.repeatItems);
const clauseInput = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('set_selection'),
    expectedRevision: z.number().int().positive(),
    requestId,
    outputTypeId: z.string().min(1).max(64),
    assemblyVersionId: z.string().min(1).max(36),
    clauses: z
      .array(
        z.strictObject({
          key: entryKey.optional(),
          clauseId: z.string().min(1).max(36),
          clauseVersionId: z.string().min(1).max(36),
        }),
      )
      .max(LIMITS.clauses),
    removalReasons: z.record(z.string().max(36), plainText(1000).trim().min(1)).optional(),
  }),
  z.strictObject({
    action: z.literal('save_answers'),
    expectedRevision: z.number().int().positive(),
    requestId,
    selectionRevision: z.number().int().positive(),
    shared: answersSchema,
    clauses: z
      .record(entryKey, answersSchema)
      .refine((c) => Object.keys(c).length <= LIMITS.clauses),
    signers: z.strictObject({
      directors: ids.default([]),
      members: ids.default([]),
      certifiers: ids.default([]),
    }),
  }),
  z.strictObject({
    action: z.literal('accept_version'),
    expectedRevision: z.number().int().positive(),
    requestId,
    key: entryKey,
    clauseVersionId: z.string().min(1).max(36),
  }),
]);

/** The clause the firm adds by default for a director-change case, if one is published. */
function defaultDirectorClause(lib: Library, kind: CaseKind, outputTypeId: string, asAt: string) {
  if (kind === 'board') return null;
  return (
    lib.clauseVersions
      .filter((v) => {
        const t = lib.clauses.get(v.clauseId);
        return t?.category === 'Director' && !clauseProblem(lib, v, kind, outputTypeId, asAt);
      })
      .sort(
        (a, b) =>
          lib.clauses.get(a.clauseId)!.displayOrder - lib.clauses.get(b.clauseId)!.displayOrder ||
          lib.clauses.get(a.clauseId)!.name.localeCompare(lib.clauses.get(b.clauseId)!.name),
      )[0] ?? null
  );
}

export async function applyClauseAction(actor: Actor, caseId: string, input: unknown) {
  assertPreparer(actor);
  const action = clauseInput.parse(input);
  return mutateCase(
    actor,
    caseId,
    action.expectedRevision,
    action.requestId,
    action.action,
    async (current, tx) => {
      if (current.state !== 'Open') throw new DomainError('This case is closed.', 'CONFLICT', 409);
      assertEditable(current);
      if (action.action === 'set_selection') return setSelection(actor, current, action, tx);
      if (!current.selection) throw new DomainError('Choose the layout and wording first.');
      if (action.action === 'accept_version') {
        const lib = await library(tx);
        const entry = current.selection.clauses.find((c) => c.key === action.key);
        if (!entry)
          throw new DomainError('That paragraph is not in this resolution.', 'NOT_FOUND', 404);
        const pinned = lib.clauseVersions.find((v) => v.id === entry.clauseVersionId);
        const newer = lib.clauseVersions.find((v) => v.id === action.clauseVersionId);
        if (
          !newer ||
          newer.clauseId !== entry.clauseId ||
          (pinned && newer.version <= pinned.version)
        )
          throw new DomainError('Choose a newer version of the same paragraph.');
        const problem = clauseProblem(
          lib,
          newer,
          current.kind,
          current.selection.outputTypeId,
          caseAsAt(current),
        );
        if (problem) throw new DomainError(problem);
        const revision = current.selection.revision + 1;
        current.selection = {
          ...current.selection,
          revision,
          clauses: current.selection.clauses.map((c) =>
            c.key === entry.key ? { ...c, clauseVersionId: newer.id } : c,
          ),
        };
        current.answers = { ...current.answers, selectionRevision: revision };
        return {
          next: current,
          detail: `Accepted version ${newer.version} of "${lib.clauses.get(newer.clauseId)!.name}".`,
        };
      }
      // save_answers
      if (action.selectionRevision !== current.selection.revision)
        throw new DomainError(
          'The clause selection changed. Refresh before saving answers.',
          'STALE',
          409,
        );
      const keys = new Set(current.selection.clauses.map((c) => c.key));
      for (const key of Object.keys(action.clauses))
        if (!keys.has(key))
          throw new DomainError('Answers refer to a paragraph that is not in this resolution.');
      const template = await loadCaseTemplate(tx, current.selection);
      const ctx = await loadResolutionContext(actor, current.id, caseAsAt(current), tx);
      const answers = {
        selectionRevision: current.selection.revision,
        shared: action.shared,
        clauses: action.clauses,
      };
      const issues = errorsOnly(
        validateAnswers({ ...template, ctx, answers, signers: action.signers }, false),
      );
      if (issues.length) throw new IssuesError('Some answers cannot be saved:', issues);
      current.answers = answers;
      current.signers = action.signers;
      return { next: current, detail: 'Saved answers.' };
    },
  );
}

async function setSelection(
  actor: Actor,
  current: ResolutionCase,
  action: Extract<z.infer<typeof clauseInput>, { action: 'set_selection' }>,
  tx: Transaction,
) {
  const lib = await library(tx);
  const outputType = (await listOutputTypes(tx)).find((t) => t.id === action.outputTypeId);
  if (!outputType?.active) throw new DomainError('Choose an active document type.');
  const previous = current.selection;
  const assemblyVersion = lib.assemblyVersions.find((v) => v.id === action.assemblyVersionId);
  if (!assemblyVersion) throw new DomainError('The layout is unavailable.', 'NOT_FOUND', 404);
  const assembly = lib.assemblies.get(assemblyVersion.assemblyId);
  const keptAssembly =
    previous?.assemblyVersionId === assemblyVersion.id &&
    previous.outputTypeId === action.outputTypeId;
  const asAt = caseAsAt(current);
  const assemblyIssue = assemblyProblem(
    lib,
    assemblyVersion,
    current.kind,
    action.outputTypeId,
    asAt,
  );
  if (assemblyIssue && !(keptAssembly && assembly?.outputTypeId === action.outputTypeId))
    throw new DomainError(assemblyIssue);
  let requested: { key?: string; clauseId: string; clauseVersionId: string }[] = action.clauses;
  const firstSelection = !previous?.clauses.length;
  if (firstSelection && !requested.length)
    requested = assemblyVersion.starterClauseIds.flatMap((clauseId) => {
      const v = lib.clauseVersions.find(
        (x) =>
          x.clauseId === clauseId &&
          !clauseProblem(lib, x, current.kind, action.outputTypeId, asAt),
      );
      return v ? [{ clauseId, clauseVersionId: v.id }] : [];
    });
  if (!previous) {
    const director = defaultDirectorClause(lib, current.kind, action.outputTypeId, asAt);
    if (director && !requested.some((c) => c.clauseId === director.clauseId))
      requested = [{ clauseId: director.clauseId, clauseVersionId: director.id }, ...requested];
  }
  if (requested.length > LIMITS.clauses)
    throw new DomainError(`Choose at most ${LIMITS.clauses} paragraphs.`);
  const used = new Set<string>();
  const entries: ClauseEntry[] = requested.map((item) => {
    const template = lib.clauses.get(item.clauseId);
    const version = lib.clauseVersions.find((v) => v.id === item.clauseVersionId);
    const name = template?.name ?? 'Clause';
    if (!version || version.clauseId !== item.clauseId)
      throw new DomainError(`"${name}": the paragraph version is unavailable.`, 'NOT_FOUND', 404);
    // Keys keep clause answers across reordering; without a key, the next unused entry of the clause.
    const existing = previous?.clauses.find(
      (c) =>
        c.clauseId === item.clauseId && !used.has(c.key) && (item.key ? c.key === item.key : true),
    );
    const pinnedAlready = existing?.clauseVersionId === version.id;
    // A version already pinned stays usable (even if hidden or superseded since); new pins must be eligible.
    const problem = pinnedAlready
      ? wordingFor(version.wordings, action.outputTypeId)?.length
        ? null
        : 'The clause has no wording for this output type.'
      : clauseProblem(lib, version, current.kind, action.outputTypeId, asAt);
    if (problem) throw new DomainError(`"${name}": ${problem}`);
    const key = existing?.key ?? `c${randomUUID().replaceAll('-', '').slice(0, 10)}`;
    used.add(key);
    return { key, clauseId: item.clauseId, clauseVersionId: version.id };
  });
  const removals = [...(previous?.removals ?? [])];
  if (current.jobId && current.kind !== 'board' && previous)
    for (const old of previous.clauses) {
      const t = lib.clauses.get(old.clauseId);
      const isDefault = t?.category === 'Director' && t.usageContexts.includes(current.kind);
      if (!isDefault || entries.some((e) => e.clauseId === old.clauseId)) continue;
      const reason = action.removalReasons?.[old.clauseId];
      if (!reason)
        throw new DomainError(
          `Record why "${t.name}" is removed from this director-change case.`,
          'REASON_REQUIRED',
        );
      removals.push({
        clauseId: old.clauseId,
        reason,
        actorId: actor.id,
        at: new Date().toISOString(),
      });
    }
  const revision = (previous?.revision ?? 0) + 1;
  const kept = new Set(entries.map((e) => e.key));
  current.selection = {
    revision,
    outputTypeId: action.outputTypeId,
    assemblyVersionId: assemblyVersion.id,
    clauses: entries,
    removals,
  };
  current.answers = {
    selectionRevision: revision,
    shared: current.answers.shared,
    clauses: Object.fromEntries(
      Object.entries(current.answers.clauses).filter(([key]) => kept.has(key)),
    ),
  };
  if (current.jobId && current.kind !== 'board')
    await prefillDirectorClause(actor, current, lib, tx);
  const removed = removals.slice(previous?.removals.length ?? 0);
  return {
    next: current,
    detail: `Selected ${entries.length} clause${entries.length === 1 ? '' : 's'} for ${outputType.name} (${assembly?.name ?? 'assembly'}).`,
    reason: removed.map((r) => r.reason).join('; ') || undefined,
  };
}

/** Whether a clause is the director clause of a director-change case of this kind. */
export const isDirectorClause = (
  template: Pick<ClauseTemplate, 'category' | 'usageContexts'> | undefined,
  kind: CaseKind,
) => template?.category === 'Director' && template.usageContexts.includes(kind);
/** The director clause's first person question and first date question (what W04 binds). */
export function directorQuestions(version: Pick<ClauseVersion, 'fields'> | undefined) {
  const questions = (version?.fields ?? []).filter(
    (f) => f.source.kind === 'question' && f.scope === 'clause' && !f.repeatScope,
  );
  return {
    person: questions.find((f) => f.valueType === 'recordReference'),
    date: questions.find((f) => f.valueType === 'date'),
  };
}

/**
 * A W04-linked case binds its director clause to the job's person and date: the clause's first
 * person question and first date question start with those values. Existing answers are kept.
 */
async function prefillDirectorClause(
  actor: Actor,
  current: ResolutionCase,
  lib: Library,
  tx: Transaction,
) {
  const job = await getJob(actor, current.jobId!, tx);
  const personId = current.personId ?? job.personId;
  const effectiveDate = current.effectiveDate ?? job.effectiveDate;
  for (const entry of current.selection!.clauses) {
    if (!isDirectorClause(lib.clauses.get(entry.clauseId), current.kind)) continue;
    if (Object.keys(current.answers.clauses[entry.key] ?? {}).length) continue;
    const { person, date } = directorQuestions(
      lib.clauseVersions.find((v) => v.id === entry.clauseVersionId),
    );
    const seeded: Record<string, string> = {};
    if (person && personId) seeded[person.id] = personId;
    if (date && effectiveDate) seeded[date.id] = effectiveDate;
    if (Object.keys(seeded).length) current.answers.clauses[entry.key] = seeded;
  }
}

/** Live preview from the saved draft and current records; no side effects. */
export async function previewCase(actor: Actor, caseId: string) {
  const rc = await readCase(actor, caseId);
  if (!rc.selection) throw new DomainError('Choose the layout and wording first.');
  const template = await loadCaseTemplate(db, rc.selection);
  const ctx = await loadResolutionContext(actor, caseId, caseAsAt(rc));
  const result = compileDocument(
    { ...template, ctx, answers: rc.answers, signers: rc.signers },
    'preview',
  );
  return {
    resolved: result.resolved,
    issues: result.issues,
    values: result.values,
    placeholders: result.placeholders,
    notice: result.placeholders
      ? 'Preview only: values in [brackets] are placeholders for missing answers. Word decides final pagination.'
      : 'Preview only: Word decides final pagination.',
  };
}
