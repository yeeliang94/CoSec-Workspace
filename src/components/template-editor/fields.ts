/** Pure helpers for template fields: ids, usage lookup and plain-language summaries. */
import type {
  BlockNode,
  FieldDefinition,
  InlineNode,
  Predicate,
  ValueType,
} from '@/domain/resolution/model';

export const FIELD_ID_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

export const VALUE_TYPES: { value: ValueType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'multiline', label: 'Several lines of text' },
  { value: 'date', label: 'Date' },
  { value: 'number', label: 'Exact number' },
  { value: 'boolean', label: 'Yes or no' },
  { value: 'choice', label: 'One choice' },
  { value: 'multiChoice', label: 'Several choices' },
  { value: 'recordReference', label: 'One person from records' },
  { value: 'recordList', label: 'People from records' },
];

/** Builds a stable id from a label. Existing ids are never regenerated. */
export function slugId(label: string, existing: Iterable<string> = []): string {
  let base = label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!/^[a-z]/.test(base)) base = 'field_' + base;
  base = base.replace(/_+$/g, '').slice(0, 58) || 'field';
  if (base.length < 2) base = base + '_value';
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export type FieldUsage = { place: string; wording?: string; blockIndex?: number };

export function predicateFields(predicate: Predicate): string[] {
  return 'all' in predicate ? predicate.all.flatMap(predicateFields) : [predicate.fieldId];
}

/** Every place a field id is referenced: wording chips, conditions, repeats and other fields. */
export function findFieldUsages(
  fieldId: string,
  wordings: { name: string; key: string; blocks: BlockNode[] }[],
  fields: FieldDefinition[],
): FieldUsage[] {
  const usages: FieldUsage[] = [];
  for (const wording of wordings) {
    wording.blocks.forEach((node, index) => {
      const count = countInBlock(node, fieldId);
      if (count)
        usages.push({
          place: `${wording.name}, block ${index + 1}${count > 1 ? ` (${count} times)` : ''}`,
          wording: wording.key,
          blockIndex: index,
        });
    });
  }
  for (const field of fields) {
    if (field.id === fieldId) continue;
    const source = field.source;
    if (source.kind === 'derived' && source.fieldId === fieldId)
      usages.push({ place: `Calculated field "${field.label}"` });
    if (source.kind === 'binding' && source.path.startsWith(`selection.${fieldId}.`))
      usages.push({ place: `Record value "${field.label}"` });
    if (field.repeatScope === fieldId)
      usages.push({ place: `Per-person question "${field.label}"` });
  }
  return usages;
}

function countInline(nodes: InlineNode[], fieldId: string) {
  return nodes.filter((node) => node.type === 'field' && node.fieldId === fieldId).length;
}
function countInBlock(node: BlockNode, fieldId: string): number {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return countInline(node.content, fieldId);
    case 'list':
      return node.items.flat().reduce((sum, child) => sum + countInBlock(child, fieldId), 0);
    case 'table':
      return node.rows
        .flatMap((row) => row.cells.flat())
        .reduce((sum, child) => sum + countInBlock(child, fieldId), 0);
    case 'condition':
      return (
        (predicateFields(node.when).includes(fieldId) ? 1 : 0) +
        node.content.reduce((sum, child) => sum + countInBlock(child, fieldId), 0)
      );
    case 'repeat':
      return (
        (node.fieldId === fieldId ? 1 : 0) +
        node.content.reduce((sum, child) => sum + countInBlock(child, fieldId), 0)
      );
    default:
      return 0;
  }
}

/** Ids referenced anywhere in a fragment (used to warn about missing definitions). */
export function referencedFieldIds(blocks: BlockNode[]): Set<string> {
  const ids = new Set<string>();
  const inline = (nodes: InlineNode[]) =>
    nodes.forEach((node) => node.type === 'field' && ids.add(node.fieldId));
  const walk = (nodes: BlockNode[]) => {
    for (const node of nodes) {
      if (node.type === 'paragraph' || node.type === 'heading') inline(node.content);
      else if (node.type === 'list') node.items.forEach(walk);
      else if (node.type === 'table') node.rows.forEach((row) => row.cells.forEach(walk));
      else if (node.type === 'condition') {
        predicateFields(node.when).forEach((id) => id && ids.add(id));
        walk(node.content);
      } else if (node.type === 'repeat') {
        if (node.fieldId) ids.add(node.fieldId);
        walk(node.content);
      }
    }
  };
  walk(blocks);
  return ids;
}

/** "Only when …" sentence for a condition. */
export function predicateSummary(predicate: Predicate, fields: FieldDefinition[]): string {
  const name = (id: string) => fields.find((field) => field.id === id)?.label || id || 'a field';
  const option = (fieldId: string, value: string) =>
    fields.find((field) => field.id === fieldId)?.options?.find((o) => o.id === value)?.label ||
    value;
  switch (predicate.op) {
    case 'isTrue':
      return `${name(predicate.fieldId)} is ticked`;
    case 'isFalse':
      return `${name(predicate.fieldId)} is not ticked`;
    case 'isEmpty':
      return `${name(predicate.fieldId)} is empty`;
    case 'isNotEmpty':
      return `${name(predicate.fieldId)} has a value`;
    case 'equals':
      return `${name(predicate.fieldId)} is ${option(predicate.fieldId, predicate.value)}`;
    case 'notEquals':
      return `${name(predicate.fieldId)} is not ${option(predicate.fieldId, predicate.value)}`;
    case 'includes':
      return `${name(predicate.fieldId)} includes ${option(predicate.fieldId, predicate.value)}`;
    case 'and':
    case 'or':
      return predicate.all
        .map((child) => predicateSummary(child, fields))
        .join(predicate.op === 'and' ? ' and ' : ' or ');
  }
}

export function sourceSummary(field: FieldDefinition): string {
  const source = field.source;
  switch (source.kind) {
    case 'question':
      return 'Asked of the preparer';
    case 'binding':
      return `From records: ${source.path}`;
    case 'constant':
      return `Fixed value: ${source.value}`;
    case 'derived':
      return source.op === 'addDays'
        ? `${source.days} days after ${source.fieldId}`
        : source.op === 'sum'
          ? `Total of ${source.fieldId}`
          : source.op === 'join'
            ? `Names from ${source.fieldId}`
            : `Count of ${source.fieldId}`;
  }
}

export const BINDING_PATHS: { path: string; label: string }[] = [
  { path: 'company.name', label: 'Company name' },
  { path: 'company.registrationNumber', label: 'Company registration number' },
  { path: 'company.address', label: 'Company address' },
  { path: 'company.incorporationDate', label: 'Company incorporation date' },
  { path: 'company.financialYearEnd', label: 'Company financial year end' },
  { path: 'company.citation.directorAuthority', label: 'Director authority citation' },
  { path: 'company.citation.memberAuthority', label: 'Member authority citation' },
  { path: 'company.citation.electionAuthority', label: 'Election authority citation' },
  { path: 'case.title', label: 'Resolution title' },
  { path: 'case.instructionDate', label: 'Instruction date' },
  { path: 'case.resolutionDate', label: 'Resolution date' },
  { path: 'case.effectiveDate', label: 'Effective date' },
  { path: 'job.personName', label: 'Director change: person name' },
  { path: 'job.effectiveDate', label: 'Director change: effective date' },
  { path: 'job.route', label: 'Director change: route' },
  { path: 'firm.name', label: 'Firm name' },
  { path: 'today', label: "Today's date" },
];

export function newField(label: string, existing: FieldDefinition[]): FieldDefinition {
  return {
    id: slugId(
      label,
      existing.map((field) => field.id),
    ),
    label,
    valueType: 'text',
    source: { kind: 'question' },
    scope: 'clause',
    required: true,
  };
}
