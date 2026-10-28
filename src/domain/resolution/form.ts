import { DomainError } from '../access';
import { bindingInfo, bindingSourceLabel } from './bindings';
import type {
  AnswerValue,
  AssemblyVersion,
  BlockNode,
  ClauseVersion,
  FieldDefinition,
  InlineNode,
  OutputType,
  PersonSnapshot,
  Predicate,
  ResolutionContext,
  SignerRole,
  SignerSelection,
} from './model';
import { DECIMAL, LIMITS, wordingFor } from './schema';
import { sharedFieldConflicts, type Issue } from './validate';
import {
  ASSEMBLY_KEY,
  compareDecimals,
  formatValue,
  isDate,
  isEmptyValue,
  poolFor,
  ValueResolver,
  type CaseAnswers,
  type RowValues,
  type Unit,
} from './values';

export type ClausePart = {
  key: string;
  name: string;
  version: Pick<ClauseVersion, 'id' | 'wordings' | 'fields'>;
};
export type CaseTemplate = {
  outputType: Pick<OutputType, 'id' | 'name'>;
  assembly: {
    name: string;
    version: Pick<AssemblyVersion, 'id' | 'header' | 'closing' | 'signature' | 'fields' | 'layout'>;
  };
  clauses: ClausePart[];
};
export type CaseInput = CaseTemplate & {
  ctx: ResolutionContext;
  answers: CaseAnswers;
  signers: SignerSelection;
};

export type FormField = FieldDefinition & {
  value: AnswerValue | RowValues | string;
  sourceLabel?: string;
  readOnly: boolean;
  active: boolean;
  /** Selected people whose repeat rows actually reach this field. */
  activeItemIds?: string[];
  choices?: PersonSnapshot[];
};
export type FormModel = {
  shared: FormField[];
  clauses: { key: string; clauseName: string; fields: FormField[] }[];
  signers: { role: SignerRole; label: string; pool: PersonSnapshot[] }[];
  conflicts: Issue[];
};

export const SIGNER_LABELS: Record<SignerRole, string> = {
  directors: 'Directors signing',
  members: 'Members signing',
  certifiers: 'Certified true copy signed by',
};
export function signerPool(ctx: ResolutionContext, role: SignerRole) {
  return role === 'directors'
    ? ctx.directors
    : role === 'members'
      ? ctx.members
      : ctx.companyPeople;
}

export function unitsOf(t: CaseTemplate): Unit[] {
  return [
    { key: ASSEMBLY_KEY, name: t.assembly.name, fields: t.assembly.version.fields },
    ...t.clauses.map((c) => ({ key: c.key, name: c.name, fields: c.version.fields })),
  ];
}
export function resolverFor(input: CaseInput) {
  return new ValueResolver(input.ctx, unitsOf(input), input.answers);
}

/**
 * Blocks one document may visit. Nested repeats multiply template size, so every walk over
 * the content spends from this budget before it can block the server.
 */
export const MAX_BLOCKS = LIMITS.nodes * LIMITS.clauses;
export const tooLarge = () =>
  new DomainError(
    'The document is too large to produce. Reduce repeated items or clause content.',
    'TOO_LARGE',
  );
/** Content deeper than the checked limit; unreachable for templates that passed validation. */
export const tooDeep = () =>
  new DomainError('The content is nested too deeply to produce.', 'TOO_DEEP');

/** Items of enclosing repeats, by list field id. */
export type ItemScope = Map<string, PersonSnapshot>;

/** The value a field has at a position, taking the current repeat item into account. */
export function valueAt(
  resolver: ValueResolver,
  unitKey: string,
  fieldId: string,
  scope: ItemScope,
) {
  const found = resolver.lookup(unitKey, fieldId);
  if (!found) return { def: null, value: null, sample: false };
  const resolved = resolver.get(unitKey, fieldId);
  if (found.def.repeatScope) {
    const item = scope.get(found.def.repeatScope);
    const rows = (resolved.value ?? {}) as RowValues;
    return { def: found.def, value: item ? (rows[item.id] ?? null) : null, sample: false };
  }
  return { def: found.def, value: resolved.value, sample: resolved.sample };
}

export function evaluate(
  p: Predicate,
  resolver: ValueResolver,
  unitKey: string,
  scope: ItemScope,
): boolean {
  if ('all' in p)
    return p.op === 'and'
      ? p.all.every((c) => evaluate(c, resolver, unitKey, scope))
      : p.all.some((c) => evaluate(c, resolver, unitKey, scope));
  const { value } = valueAt(resolver, unitKey, p.fieldId, scope);
  switch (p.op) {
    case 'isTrue':
      return value === true;
    case 'isFalse':
      return value === false;
    case 'isEmpty':
      return isEmptyValue(value);
    case 'isNotEmpty':
      return !isEmptyValue(value);
    case 'equals':
      return typeof value === 'string' && value === p.value;
    case 'notEquals':
      return !(typeof value === 'string' && value === p.value);
    case 'includes':
      return Array.isArray(value) && (value as unknown[]).includes(p.value);
  }
}

/**
 * Fields that the chosen output actually reaches with the current answers: referenced outside
 * false conditions (condition tests themselves count), plus their dependencies. A field used
 * only inside a false condition, or only in another output type's wording, is inactive.
 */
export function activeUsage(input: CaseInput, resolver: ValueResolver) {
  const fields = new Set<string>();
  const activeRows = new Map<string, Set<string>>();
  const roles = new Set<SignerRole>();
  const mark = (unitKey: string, id: string, scope: ItemScope, seen = new Set<string>()) => {
    const found = resolver.lookup(unitKey, id);
    if (!found) return;
    const name = `${found.ns}:${id}`;
    if (seen.has(name)) return;
    seen.add(name);
    fields.add(name);
    const def = found.def;
    if (def.repeatScope) {
      const rows = activeRows.get(name) ?? new Set<string>();
      const item = scope.get(def.repeatScope);
      // An aggregate outside the repeat depends on every selected row.
      for (const person of item ? [item] : resolver.people(unitKey, def.repeatScope))
        rows.add(person.id);
      activeRows.set(name, rows);
    }
    if (def.source.kind === 'derived') mark(unitKey, def.source.fieldId, scope, seen);
    if (def.source.kind === 'binding') {
      const sel = bindingInfo(def.source.path)?.selection;
      if (sel) mark(unitKey, sel, scope, seen);
    }
    if (def.repeatScope) mark(unitKey, def.repeatScope, scope, seen);
  };
  const markPredicate = (p: Predicate, unitKey: string, scope: ItemScope) => {
    if ('all' in p) p.all.forEach((c) => markPredicate(c, unitKey, scope));
    else mark(unitKey, p.fieldId, scope);
  };
  const inline = (content: InlineNode[], unitKey: string, scope: ItemScope) =>
    content.forEach((n) => n.type === 'field' && mark(unitKey, n.fieldId, scope));
  let visited = 0;
  const walk = (blocks: BlockNode[], unitKey: string, scope: ItemScope, depth = 0): void => {
    if (depth > LIMITS.depth + 2) throw tooDeep();
    for (const block of blocks) {
      if (++visited > MAX_BLOCKS) throw tooLarge();
      switch (block.type) {
        case 'paragraph':
        case 'heading':
          inline(block.content, unitKey, scope);
          break;
        case 'list':
          block.items.forEach((item) => walk(item, unitKey, scope, depth + 1));
          break;
        case 'table':
          block.rows.forEach((r) => r.cells.forEach((c) => walk(c, unitKey, scope, depth + 1)));
          break;
        case 'condition':
          markPredicate(block.when, unitKey, scope);
          if (evaluate(block.when, resolver, unitKey, scope))
            walk(block.content, unitKey, scope, depth + 1);
          break;
        case 'repeat':
          mark(unitKey, block.fieldId, scope);
          for (const item of resolver.people(unitKey, block.fieldId).slice(0, LIMITS.repeatItems))
            walk(block.content, unitKey, new Map(scope).set(block.fieldId, item), depth + 1);
          break;
        case 'clauseSlot':
          // Clause wording is depth-checked on its own, so it starts again at the top level.
          for (const clause of input.clauses)
            walk(
              wordingFor(clause.version.wordings, input.outputType.id) ?? [],
              clause.key,
              new Map(),
            );
          break;
        case 'signatureBlock':
          roles.add(block.role);
          break;
        case 'pageBreak':
          break;
      }
    }
  };
  const a = input.assembly.version;
  walk(a.header, ASSEMBLY_KEY, new Map());
  walk(a.closing, ASSEMBLY_KEY, new Map());
  inline(a.layout.header, ASSEMBLY_KEY, new Map());
  inline(a.layout.footer, ASSEMBLY_KEY, new Map());
  return { fields, roles, activeRows };
}

/** Roles that have a signature block anywhere in the assembly. */
function signatureRoles(blocks: BlockNode[], out = new Set<SignerRole>()) {
  for (const b of blocks) {
    if (b.type === 'signatureBlock') out.add(b.role);
    if (b.type === 'condition') signatureRoles(b.content, out);
  }
  return out;
}

/** Problem with one answer value, or null. Distinguishes false, zero, empty and null. */
export function checkValue(
  def: FieldDefinition,
  value: unknown,
  pool: PersonSnapshot[],
): string | null {
  if (value === null || value === undefined) return null;
  switch (def.valueType) {
    case 'boolean':
      if (typeof value !== 'boolean') return 'Choose yes or no.';
      return null;
    case 'text':
    case 'multiline': {
      if (typeof value !== 'string') return 'Enter text.';
      if (def.valueType === 'text' && /[\r\n]/.test(value)) return 'Enter a single line.';
      const max = def.validation?.maxLength ?? (def.valueType === 'text' ? 500 : 5000);
      if (value.length > max) return `Keep this under ${max} characters.`;
      return null;
    }
    case 'date':
      if (value === '') return null;
      if (!isDate(value)) return 'Enter a valid date (YYYY-MM-DD).';
      if (def.validation?.min && value < def.validation.min)
        return `Enter ${def.validation.min} or later.`;
      if (def.validation?.max && value > def.validation.max)
        return `Enter ${def.validation.max} or earlier.`;
      return null;
    case 'number': {
      if (value === '') return null;
      if (typeof value !== 'string' || !DECIMAL.test(value))
        return 'Enter an exact number, for example 1000.50.';
      const places = value.split('.')[1]?.length ?? 0;
      if (def.format?.decimals !== undefined && places > def.format.decimals)
        return `Use at most ${def.format.decimals} decimal places.`;
      const { min, max } = def.validation ?? {};
      if (min && DECIMAL.test(min) && compareDecimals(value, min) < 0)
        return `Enter ${min} or more.`;
      if (max && DECIMAL.test(max) && compareDecimals(value, max) > 0)
        return `Enter ${max} or less.`;
      return null;
    }
    case 'choice':
      if (value === '') return null;
      return typeof value === 'string' && def.options?.some((o) => o.id === value)
        ? null
        : 'Choose one of the listed options.';
    case 'multiChoice':
      if (!Array.isArray(value) || value.some((v) => !def.options?.some((o) => o.id === v)))
        return 'Choose from the listed options.';
      return new Set(value).size === value.length ? null : 'Choose each option once.';
    case 'recordReference':
      if (value === '') return null;
      return typeof value === 'string' && pool.some((p) => p.id === value)
        ? null
        : 'Choose a person from the list offered for this company.';
    case 'recordList':
      if (
        !Array.isArray(value) ||
        value.some((v) => typeof v !== 'string' || !pool.some((p) => p.id === v))
      )
        return 'Choose people from the list offered for this company.';
      if (new Set(value).size !== value.length) return 'Choose each person once.';
      if (value.length > LIMITS.repeatItems) return `Choose at most ${LIMITS.repeatItems} people.`;
      return null;
  }
}

/**
 * Server-side answer checks. With `complete`, active required questions and signers must be
 * present (final generation); without it only the shape and pools are checked (draft save).
 */
export function validateAnswers(
  input: CaseInput,
  complete: boolean,
  resolver = resolverFor(input),
): Issue[] {
  const issues: Issue[] = [];
  const { fields: active, roles, activeRows } = activeUsage(input, resolver);
  const seen = new Set<string>();
  const units = unitsOf(input);
  for (const unit of units)
    for (const field of unit.fields) {
      const found = resolver.lookup(unit.key, field.id);
      if (!found) continue;
      const name = `${found.ns}:${field.id}`;
      if (seen.has(name)) continue;
      seen.add(name);
      const def = found.def;
      const where =
        found.ns === 'case'
          ? `shared questions › field "${def.label}"`
          : `clause "${unit.name}" › field "${def.label}"`;
      const base = { unit: found.ns, fieldId: def.id };
      const isActive = active.has(name);
      if (def.source.kind !== 'question') {
        continue; // bound and calculated values are checked when they are rendered
      }
      const raw = resolver.answer(found.ns, def.id);
      const pool = poolFor(input.ctx, def.record?.context);
      if (def.repeatScope) {
        const rows = raw ?? {};
        if (typeof rows !== 'object' || Array.isArray(rows) || rows === null) {
          issues.push({
            ...base,
            message: 'Enter one value per selected person.',
            location: where,
          });
          continue;
        }
        const items = resolver.people(unit.key, def.repeatScope);
        for (const [itemId, value] of Object.entries(rows)) {
          const item = items.find((p) => p.id === itemId);
          if (!item) {
            if (value !== null && complete && isActive)
              issues.push({
                ...base,
                itemId,
                message: 'This row belongs to a person who is no longer selected.',
                location: where,
                severity: 'warning',
              });
            continue;
          }
          const problem = checkValue(def, value, pool);
          if (problem)
            issues.push({
              ...base,
              itemId,
              message: problem,
              location: `${where} › row "${item.name}"`,
            });
        }
        if (complete && isActive)
          for (const item of items)
            if (activeRows.get(name)?.has(item.id)) {
              const value = (rows as RowValues)[item.id];
              const message =
                def.required && isEmptyValue(value)
                  ? 'Enter a value.'
                  : def.validation?.mustBeChecked && value !== true
                    ? 'This box must be checked.'
                    : null;
              if (message)
                issues.push({
                  ...base,
                  itemId: item.id,
                  message,
                  location: `${where} › row "${item.name}"`,
                });
            }
        continue;
      }
      const value = raw === undefined ? (def.defaultValue ?? null) : raw;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        issues.push({ ...base, message: 'Enter a single value.', location: where });
        continue;
      }
      const problem = checkValue(def, value, pool);
      if (problem) issues.push({ ...base, message: problem, location: where });
      else if (complete && isActive) {
        if (def.required && isEmptyValue(value))
          issues.push({ ...base, message: 'Answer this question.', location: where });
        else if (def.validation?.mustBeChecked && value !== true)
          issues.push({ ...base, message: 'This box must be checked.', location: where });
      }
    }
  for (const role of Object.keys(input.signers) as SignerRole[]) {
    const ids = input.signers[role] ?? [];
    const pool = signerPool(input.ctx, role);
    if (new Set(ids).size !== ids.length)
      issues.push({ message: 'Choose each signer once.', location: `signers › ${role}` });
    for (const id of ids)
      if (!pool.some((p) => p.id === id))
        issues.push({
          message: 'Choose signers from the people offered for this company.',
          location: `signers › ${role}`,
          itemId: id,
        });
  }
  if (complete)
    for (const role of roles)
      if (!(input.signers[role] ?? []).length)
        issues.push({
          message: 'Choose at least one signer.',
          location: `signers › ${SIGNER_LABELS[role]}`,
        });
  return issues;
}

export function buildForm(input: CaseInput): FormModel {
  const resolver = resolverFor(input);
  const { fields: active, activeRows } = activeUsage(input, resolver);
  const toFormField = (unitKey: string, def: FieldDefinition, ns: string): FormField => {
    const isQuestion = def.source.kind === 'question';
    const resolved = resolver.get(unitKey, def.id);
    let value: FormField['value'];
    if (isQuestion) {
      const raw = resolver.answer(ns, def.id);
      value = (
        raw === undefined ? (def.defaultValue ?? (def.repeatScope ? {} : null)) : raw
      ) as FormField['value'];
    } else value = formatValue(def, resolved.value);
    const field: FormField = {
      ...def,
      value,
      readOnly: !isQuestion,
      active: active.has(`${ns}:${def.id}`),
    };
    if (def.source.kind === 'binding')
      field.sourceLabel = bindingSourceLabel(def.source.path, input.ctx.asAt);
    if (def.source.kind === 'derived')
      field.sourceLabel =
        def.source.op === 'addDays'
          ? `${def.source.days} days after another date${def.source.sourceNote.trim() ? ` (${def.source.sourceNote})` : ' — sample rule, no approved source'}`
          : 'Calculated';
    if (def.source.kind === 'constant') field.sourceLabel = 'Fixed wording';
    if (def.valueType === 'recordReference' || def.valueType === 'recordList')
      field.choices = poolFor(input.ctx, def.record?.context);
    if (def.repeatScope) {
      field.choices = resolver.people(unitKey, def.repeatScope);
      field.activeItemIds = [...(activeRows.get(`${ns}:${def.id}`) ?? [])];
    }
    return field;
  };
  const shared: FormField[] = [];
  const sharedIds = new Set<string>();
  const clauses: FormModel['clauses'] = [];
  for (const unit of unitsOf(input)) {
    const own: FormField[] = [];
    for (const field of unit.fields) {
      const found = resolver.lookup(unit.key, field.id);
      if (!found) continue;
      if (found.ns === 'case') {
        if (sharedIds.has(field.id)) continue;
        sharedIds.add(field.id);
        shared.push(toFormField(unit.key, found.def, 'case'));
      } else own.push(toFormField(unit.key, found.def, found.ns));
    }
    if (unit.key !== ASSEMBLY_KEY)
      clauses.push({ key: unit.key, clauseName: unit.name, fields: own });
  }
  const a = input.assembly.version;
  const roles = signatureRoles([...a.header, ...a.closing]);
  return {
    shared,
    clauses,
    signers: [...roles].map((role) => ({
      role,
      label: SIGNER_LABELS[role],
      pool: signerPool(input.ctx, role),
    })),
    conflicts: sharedFieldConflicts([
      { name: input.assembly.name, fields: a.fields, kind: 'assembly' },
      ...input.clauses.map((c) => ({ name: c.name, fields: c.version.fields })),
    ]),
  };
}
