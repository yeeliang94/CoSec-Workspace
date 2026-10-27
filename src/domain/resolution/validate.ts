import { DomainError } from '../access';
import { bindingInfo } from './bindings';
import type { BlockNode, FieldDefinition, InlineNode, Predicate } from './model';
import { DECIMAL } from './schema';
import { isDate } from './values';

/** `location` is human readable, e.g. `clause "Appointment" › wording "Directors' written resolution" › block 3`. */
export type Issue = {
  message: string;
  location: string;
  /** Warnings never block publication or generation. Absent means error. */
  severity?: 'error' | 'warning';
  /** For form issues: the unit (clause entry key, or 'case') and field the issue belongs to. */
  unit?: string;
  fieldId?: string;
  itemId?: string;
};
export const errorsOnly = (issues: Issue[]) => issues.filter((i) => i.severity !== 'warning');

export class IssuesError extends DomainError {
  constructor(
    message: string,
    public issues: Issue[],
    code = 'INCOMPLETE',
    status = 400,
  ) {
    super(
      `${message} ${issues
        .slice(0, 8)
        .map((i) => `${i.location}: ${i.message}`)
        .join('; ')}${issues.length > 8 ? `; and ${issues.length - 8} more` : ''}`,
      code,
      status,
    );
  }
}

const at = (...parts: string[]) => parts.filter(Boolean).join(' › ');
const q = (s: string) => `"${s}"`;

type Fragment = { label: string; blocks: BlockNode[] };
export type ContentToCheck = {
  /** e.g. `clause "Appointment of director"` */
  prefix: string;
  fields: FieldDefinition[];
  fragments: Fragment[];
  /** Inline content outside blocks (assembly page header/footer). */
  inline?: { label: string; content: InlineNode[] }[];
  assembly: boolean;
  /** Fields of the case-wide namespace that clause content may also use (assembly fields). */
  sharedFields?: FieldDefinition[];
};

function fieldIssues(prefix: string, fields: FieldDefinition[], assembly: boolean): Issue[] {
  const issues: Issue[] = [];
  const byId = new Map<string, FieldDefinition>();
  for (const field of fields) {
    if (byId.has(field.id))
      issues.push({
        message: 'Field ids must be unique.',
        location: at(prefix, `field ${q(field.id)}`),
      });
    byId.set(field.id, field);
  }
  for (const field of fields) {
    const loc = at(prefix, `field ${q(field.id)}`);
    const err = (message: string) => issues.push({ message, location: loc, fieldId: field.id });
    const warn = (message: string) =>
      issues.push({ message, location: loc, severity: 'warning', fieldId: field.id });
    const target = (id: string) => byId.get(id);
    const scopeOf = (f: FieldDefinition) => (assembly ? 'case' : f.scope);
    if (field.valueType === 'choice' || field.valueType === 'multiChoice') {
      const ids = (field.options ?? []).map((o) => o.id);
      if (!ids.length) err('Add at least one option.');
      if (new Set(ids).size !== ids.length) err('Option ids must be unique.');
    }
    if (field.valueType === 'recordReference' || field.valueType === 'recordList') {
      if (!field.record) err('Choose which people this selector may offer.');
      if (field.source.kind !== 'question') err('A person selector must be a question.');
    }
    const source = field.source;
    if (source.kind === 'binding') {
      const info = bindingInfo(source.path);
      if (!info) err(`The source ${q(source.path)} is not an allowed record value.`);
      else {
        if (info.selection) {
          const selected = target(info.selection);
          if (!selected || selected.valueType !== 'recordReference')
            err(`${q(info.selection)} must be a single-person selector in this template.`);
        }
        const ok =
          info.valueType === 'date'
            ? ['date', 'text'].includes(field.valueType)
            : info.valueType === 'text'
              ? ['text', 'multiline'].includes(field.valueType)
              : ['text', 'multiline', 'date', 'number', 'boolean'].includes(field.valueType);
        if (!ok) err(`A ${info.valueType} record value cannot fill a ${field.valueType} field.`);
      }
      if (field.repeatScope) err('A record value cannot be asked per row.');
    }
    if (source.kind === 'derived') {
      const base = target(source.fieldId);
      if (!base) err(`It is calculated from ${q(source.fieldId)}, which does not exist.`);
      else if (source.op === 'addDays') {
        if (base.valueType !== 'date') err('A date offset needs a date field.');
        if (field.valueType !== 'date') err('A date offset produces a date.');
        if (!source.sourceNote.trim())
          warn(
            'No approved source is recorded for this date offset, so its value is labelled a sample.',
          );
      } else if (source.op === 'sum') {
        if (base.valueType !== 'number' || !base.repeatScope)
          err('A total needs a per-row number field.');
        if (field.valueType !== 'number') err('A total produces a number.');
      } else {
        if (base.valueType !== 'recordList')
          err(`${source.op === 'join' ? 'Joined names' : 'A count'} needs a list of people.`);
        if (field.valueType !== (source.op === 'join' ? 'text' : 'number'))
          err(`This calculation produces ${source.op === 'join' ? 'text' : 'a number'}.`);
      }
      if (field.repeatScope) err('A calculated value cannot be asked per row.');
    }
    if (field.repeatScope) {
      const list = target(field.repeatScope);
      if (!list || list.valueType !== 'recordList')
        err(
          `Per-row questions must belong to a list of people; ${q(field.repeatScope)} is not one.`,
        );
      else if (scopeOf(list) !== scopeOf(field))
        err('A per-row question must have the same scope as its list.');
      if (field.valueType === 'recordList' || field.valueType === 'recordReference')
        err('A per-row question cannot select people.');
    }
    for (const bound of ['min', 'max'] as const) {
      const value = field.validation?.[bound];
      if (value === undefined) continue;
      if (field.valueType === 'number' && !DECIMAL.test(value))
        err(`The ${bound} must be a number.`);
      else if (field.valueType === 'date' && !isDate(value)) err(`The ${bound} must be a date.`);
      else if (!['number', 'date'].includes(field.valueType))
        err(`A ${bound} applies only to numbers and dates.`);
    }
    if (field.validation?.mustBeChecked && field.valueType !== 'boolean')
      err('"Must be checked" applies only to checkboxes.');
  }
  // Dependencies form a bounded DAG: calculations, selection bindings and per-row lists.
  const edges = (f: FieldDefinition) => {
    const out: string[] = [];
    if (f.source.kind === 'derived') out.push(f.source.fieldId);
    if (f.source.kind === 'binding') {
      const sel = bindingInfo(f.source.path)?.selection;
      if (sel) out.push(sel);
    }
    if (f.repeatScope) out.push(f.repeatScope);
    return out;
  };
  const state = new Map<string, 1 | 2>();
  const cyclic = new Set<string>();
  const visit = (id: string, trail: string[]) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      trail.slice(trail.indexOf(id)).forEach((x) => cyclic.add(x));
      return;
    }
    state.set(id, 1);
    const f = byId.get(id);
    if (f) for (const next of edges(f)) if (byId.has(next)) visit(next, [...trail, id]);
    state.set(id, 2);
  };
  for (const id of byId.keys()) visit(id, []);
  for (const id of cyclic)
    issues.push({
      message: 'This field depends on itself through other calculated fields.',
      location: at(prefix, `field ${q(id)}`),
      fieldId: id,
    });
  return issues;
}

function predicateIssues(
  p: Predicate,
  loc: string,
  lookup: (id: string) => FieldDefinition | undefined,
  repeating: string[],
  issues: Issue[],
  depth = 0,
) {
  if (depth > 8) {
    issues.push({ message: 'Simplify this condition.', location: loc });
    return;
  }
  if ('all' in p) {
    p.all.forEach((c) => predicateIssues(c, loc, lookup, repeating, issues, depth + 1));
    return;
  }
  const field = lookup(p.fieldId);
  const where = at(loc, `field ${q(p.fieldId)}`);
  if (!field) {
    issues.push({ message: 'The condition uses a field that does not exist.', location: where });
    return;
  }
  if (field.repeatScope && !repeating.includes(field.repeatScope))
    issues.push({
      message: 'A per-row field can be tested only inside a repeat over its list.',
      location: where,
    });
  if ((p.op === 'isTrue' || p.op === 'isFalse') && field.valueType !== 'boolean')
    issues.push({ message: `"${p.op}" needs a checkbox field.`, location: where });
  if (p.op === 'equals' || p.op === 'notEquals') {
    if (['boolean', 'multiChoice', 'recordList', 'recordReference'].includes(field.valueType))
      issues.push({
        message: `"${p.op}" cannot compare a ${field.valueType} field.`,
        location: where,
      });
    if (field.valueType === 'choice' && !field.options?.some((o) => o.id === p.value))
      issues.push({ message: `"${p.value}" is not an option of this field.`, location: where });
  }
  if (p.op === 'includes') {
    if (field.valueType !== 'multiChoice')
      issues.push({ message: '"includes" needs a multiple-choice field.', location: where });
    else if (!field.options?.some((o) => o.id === p.value))
      issues.push({ message: `"${p.value}" is not an option of this field.`, location: where });
  }
}

/** Every structural and reference issue of a clause or assembly version. */
export function validateContent(input: ContentToCheck): Issue[] {
  const { prefix, fields, assembly } = input;
  const issues = fieldIssues(prefix, fields, assembly);
  const own = new Map(fields.map((f) => [f.id, f]));
  const lookup = (id: string) =>
    own.get(id) ?? input.sharedFields?.find((f) => f.id === id && (assembly || f.scope === 'case'));
  let slots = 0;
  const used = new Set<string>();
  const inline = (content: InlineNode[], loc: string, repeating: string[]) =>
    content.forEach((node) => {
      if (node.type !== 'field') return;
      used.add(node.fieldId);
      const where = at(loc, `field ${q(node.fieldId)}`);
      const field = lookup(node.fieldId);
      if (!field) {
        issues.push({
          message: 'This field does not exist.',
          location: where,
          fieldId: node.fieldId,
        });
        return;
      }
      if (field.repeatScope && !repeating.includes(field.repeatScope))
        issues.push({
          message: 'A per-row field can appear only inside a repeat over its list.',
          location: where,
        });
      if (node.property) {
        if (field.valueType === 'recordList' && !repeating.includes(field.id))
          issues.push({
            message: 'A property of a list item can appear only inside a repeat over that list.',
            location: where,
          });
        else if (field.valueType !== 'recordList' && field.valueType !== 'recordReference')
          issues.push({ message: 'Only a person selector has properties.', location: where });
      } else if (field.valueType === 'recordList' && repeating.includes(field.id))
        issues.push({ message: 'Choose which property of the item to show.', location: where });
    });
  const walk = (
    blocks: BlockNode[],
    loc: string,
    repeating: string[],
    topLevel: boolean,
    nested: string | null,
  ) =>
    blocks.forEach((block, index) => {
      const here = at(loc, `block ${index + 1}`);
      switch (block.type) {
        case 'paragraph':
        case 'heading':
          inline(block.content, here, repeating);
          break;
        case 'list':
          block.items.forEach((item, i) =>
            walk(item, at(here, `item ${i + 1}`), repeating, false, 'list'),
          );
          break;
        case 'table': {
          const widths = block.columnWidths;
          const columns = Math.max(...block.rows.map((r) => r.cells.length));
          if (block.rows.some((r) => r.cells.length !== columns))
            issues.push({
              message: 'Every table row needs the same number of cells.',
              location: here,
            });
          if (widths && (widths.length !== columns || widths.reduce((a, b) => a + b, 0) !== 100))
            issues.push({
              message: 'Column widths must be one percentage per column, adding up to 100.',
              location: here,
            });
          block.rows.forEach((row, r) =>
            row.cells.forEach((cell, c) =>
              walk(cell, at(here, `row ${r + 1}`, `cell ${c + 1}`), repeating, false, 'table'),
            ),
          );
          break;
        }
        case 'condition':
          predicateIssues(block.when, at(here, 'condition'), lookup, repeating, issues);
          collectPredicate(block.when).forEach((id) => used.add(id));
          walk(block.content, here, repeating, topLevel, nested);
          break;
        case 'repeat': {
          used.add(block.fieldId);
          const list = lookup(block.fieldId);
          if (!list || list.valueType !== 'recordList')
            issues.push({
              message: 'A repeat needs a list-of-people field.',
              location: at(here, `field ${q(block.fieldId)}`),
              fieldId: block.fieldId,
            });
          walk(block.content, here, [...repeating, block.fieldId], false, 'repeat');
          break;
        }
        case 'clauseSlot':
          slots++;
          if (!topLevel || repeating.length)
            issues.push({ message: 'Place the clause slot at the top level.', location: here });
          break;
        case 'signatureBlock':
          if (nested)
            issues.push({
              message: `A signature block cannot be inside a ${nested}.`,
              location: here,
            });
          break;
        case 'pageBreak':
          if (nested === 'table' || nested === 'list')
            issues.push({ message: `A page break cannot be inside a ${nested}.`, location: here });
          break;
      }
    });
  for (const fragment of input.fragments)
    walk(fragment.blocks, at(prefix, fragment.label), [], true, null);
  for (const part of input.inline ?? []) inline(part.content, at(prefix, part.label), []);
  if (assembly && slots !== 1)
    issues.push({
      message: slots ? 'Use exactly one clause slot.' : 'Add a clause slot where the clauses go.',
      location: prefix,
    });
  // Dependencies of used fields count as used.
  const pending = [...used];
  while (pending.length) {
    const f = lookup(pending.pop()!);
    if (!f) continue;
    const deps: string[] = [];
    if (f.source.kind === 'derived') deps.push(f.source.fieldId);
    if (f.source.kind === 'binding') {
      const sel = bindingInfo(f.source.path)?.selection;
      if (sel) deps.push(sel);
    }
    if (f.repeatScope) deps.push(f.repeatScope);
    for (const d of deps) if (!used.has(d)) (used.add(d), pending.push(d));
  }
  for (const field of fields)
    if (!used.has(field.id) && !assembly)
      issues.push({
        message: 'This field is not used in any wording, so it will not be asked.',
        location: at(prefix, `field ${q(field.id)}`),
        severity: 'warning',
        fieldId: field.id,
      });
  return issues;
}

export function collectPredicate(p: Predicate, out = new Set<string>()) {
  if ('all' in p) p.all.forEach((c) => collectPredicate(c, out));
  else out.add(p.fieldId);
  return out;
}

export function validateClause(
  name: string,
  content: { wordings: Record<string, BlockNode[]>; fields: FieldDefinition[] },
  outputTypes: { id: string; name: string }[] = [],
): Issue[] {
  const prefix = `clause ${q(name)}`;
  const label = (id: string) => `wording ${q(outputTypes.find((t) => t.id === id)?.name ?? id)}`;
  const issues = validateContent({
    prefix,
    fields: content.fields,
    assembly: false,
    fragments: Object.entries(content.wordings).map(([id, blocks]) => ({
      label: label(id),
      blocks,
    })),
  });
  const written = Object.entries(content.wordings).filter(([, blocks]) => blocks.length);
  if (!written.length) issues.push({ message: 'Write at least one wording.', location: prefix });
  if (outputTypes.length)
    for (const [id] of written)
      if (!outputTypes.some((t) => t.id === id))
        issues.push({ message: `${q(id)} is not a configured output type.`, location: label(id) });
  return issues;
}

export function validateAssembly(
  name: string,
  content: {
    header: BlockNode[];
    closing: BlockNode[];
    fields: FieldDefinition[];
    layout: { header: InlineNode[]; footer: InlineNode[] };
  },
): Issue[] {
  return validateContent({
    prefix: `assembly ${q(name)}`,
    fields: content.fields,
    assembly: true,
    fragments: [
      { label: 'header', blocks: content.header },
      { label: 'closing', blocks: content.closing },
    ],
    inline: [
      { label: 'page header', content: content.layout.header },
      { label: 'page footer', content: content.layout.footer },
    ],
  });
}

/**
 * Case-scope ids are one question per case, so every definition of one id must agree on
 * type, options and selector context. Reports both places.
 */
export function sharedFieldConflicts(
  units: { name: string; fields: FieldDefinition[]; kind?: string }[],
): Issue[] {
  const first = new Map<string, { name: string; kind: string; def: FieldDefinition }>();
  const issues: Issue[] = [];
  const ordered = (value: object | undefined) =>
    Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const signature = (f: FieldDefinition) =>
    JSON.stringify([
      f.valueType,
      (f.options ?? []).map((o) => o.id).sort(),
      f.record?.context ?? null,
      f.repeatScope ?? null,
      f.required ?? false,
      ordered(f.validation),
      ordered(f.source),
      f.defaultValue ?? null,
      ordered(f.format),
    ]);
  for (const unit of units)
    for (const def of unit.fields) {
      if (def.scope !== 'case' && unit.kind !== 'assembly') continue;
      const seen = first.get(def.id);
      if (!seen) {
        first.set(def.id, { name: unit.name, kind: unit.kind ?? 'clause', def });
        continue;
      }
      if (signature(seen.def) !== signature(def))
        issues.push({
          message: `The shared field ${q(def.id)} is defined differently in ${seen.kind} ${q(seen.name)} (${seen.def.valueType}) and ${unit.kind ?? 'clause'} ${q(unit.name)} (${def.valueType}). Align the definitions before generating.`,
          location: `${seen.kind} ${q(seen.name)} › field ${q(def.id)}; ${unit.kind ?? 'clause'} ${q(unit.name)} › field ${q(def.id)}`,
          unit: 'case',
          fieldId: def.id,
        });
    }
  return issues;
}
