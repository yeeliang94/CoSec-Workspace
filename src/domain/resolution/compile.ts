import type {
  BlockNode,
  FieldDefinition,
  InlineNode,
  PersonSnapshot,
  ResolvedBlock,
  ResolvedDocument,
  ResolvedInline,
} from './model';
import {
  evaluate,
  resolverFor,
  SIGNER_LABELS,
  signerPool,
  validateAnswers,
  valueAt,
  type CaseInput,
  type ItemScope,
} from './form';
import { DomainError } from '../access';
import { LIMITS, wordingFor } from './schema';
import { sharedFieldConflicts, type Issue } from './validate';
import { ASSEMBLY_KEY, formatValue, personProperty, type Raw } from './values';

/**
 * 'final': complete values required (generation). 'preview': missing values become labelled
 * placeholders such as "[Director name]" and the result says so. 'sample': fictional values.
 */
export type CompileMode = 'final' | 'preview' | 'sample';
export type CompileResult = {
  resolved: ResolvedDocument;
  issues: Issue[];
  /** Display text of every value used, keyed `fieldId` (shared) or `clauseKey.fieldId`. */
  values: Record<string, string>;
  /** True when at least one placeholder stands in for a missing value. */
  placeholders: boolean;
};

const MAX_BLOCKS = LIMITS.nodes * LIMITS.clauses;
/**
 * Total inline runs (text, breaks, field lines, signature entries) one document may emit.
 * Repeats and shared fields multiply template size, so the budget bounds output (and the
 * renderer's work) independently of how the template is structured.
 */
export const MAX_RUNS = 200_000;
const tooLarge = () =>
  new DomainError(
    'The document is too large to produce. Reduce repeated items or clause content.',
    'TOO_LARGE',
  );

export function compileDocument(input: CaseInput, mode: CompileMode): CompileResult {
  const resolver = resolverFor(input);
  const a = input.assembly.version;
  const issues: Issue[] = [
    ...sharedFieldConflicts([
      { name: input.assembly.name, fields: a.fields, kind: 'assembly' },
      ...input.clauses.map((c) => ({ name: c.name, fields: c.version.fields })),
    ]),
    ...validateAnswers(input, mode === 'final', resolver),
  ];
  const values: Record<string, string> = {};
  const missing = new Set<string>();
  let containsSamples = false;
  let placeholders = false;
  let emitted = 0;
  let runCount = 0;
  const count = (n = 1) => {
    runCount += n;
    if (runCount > MAX_RUNS) throw tooLarge();
  };
  const unitName = (key: string) =>
    key === ASSEMBLY_KEY
      ? input.assembly.name
      : (input.clauses.find((c) => c.key === key)?.name ?? key);

  const fieldText = (
    node: Extract<InlineNode, { type: 'field' }>,
    unitKey: string,
    scope: ItemScope,
  ) => {
    const found = resolver.lookup(unitKey, node.fieldId);
    if (!found) {
      issues.push({
        message: 'This field does not exist.',
        location: `${unitName(unitKey)} › field "${node.fieldId}"`,
      });
      return placeholder(node.fieldId);
    }
    const def: FieldDefinition = found.def;
    const name = found.ns === 'case' ? def.id : `${unitKey}.${def.id}`;
    let text = '';
    let key = name;
    const { value, sample } = valueAt(resolver, unitKey, def.id, scope);
    if (def.repeatScope) key = `${name}[${scope.get(def.repeatScope)?.id ?? ''}]`;
    if (node.property) {
      const person =
        def.valueType === 'recordList'
          ? scope.get(def.id)
          : value && typeof value === 'object' && !Array.isArray(value) && 'name' in value
            ? (value as PersonSnapshot)
            : undefined;
      if (def.valueType === 'recordList') key = `${name}[${person?.id ?? ''}].${node.property}`;
      else key = `${name}.${node.property}`;
      text = person ? personProperty(person, node.property) : '';
    } else if (def.valueType === 'recordList' && scope.has(def.id)) {
      text = scope.get(def.id)!.name;
    } else text = formatValue(def, value as Raw);
    if (sample && text) containsSamples = true;
    if (!text) {
      const required =
        def.required || def.source.kind === 'binding' || def.source.kind === 'derived';
      if (!required) return '';
      if (!missing.has(key)) {
        missing.add(key);
        if (def.source.kind !== 'question' || mode !== 'final')
          issues.push({
            message:
              def.source.kind === 'binding'
                ? `No value is recorded for ${def.label}. Complete the source record.`
                : def.source.kind === 'derived'
                  ? `${def.label} cannot be calculated yet.`
                  : 'Answer this question.',
            location: `${found.ns === 'case' ? 'shared questions' : `clause "${unitName(unitKey)}"`} › field "${def.label}"`,
            unit: found.ns,
            fieldId: def.id,
            severity: mode === 'final' ? 'error' : 'warning',
          });
      }
      return placeholder(def.label);
    }
    values[key] = text;
    return text;
  };
  const placeholder = (label: string) => {
    placeholders = true;
    return `[${label}]`;
  };
  const runs = (content: InlineNode[], unitKey: string, scope: ItemScope): ResolvedInline[] => {
    const out: ResolvedInline[] = [];
    const push = (run: ResolvedInline) => {
      count();
      out.push(run);
    };
    for (const node of content) {
      if (node.type === 'hardBreak') push({ break: true });
      else if (node.type === 'text')
        push(node.marks?.length ? { text: node.text, marks: node.marks } : { text: node.text });
      else
        fieldText(node, unitKey, scope)
          .split('\n')
          .forEach((line, i) => {
            if (i) push({ break: true });
            if (line) push({ text: line });
          });
    }
    return out;
  };
  const inlineText = (content: InlineNode[]) =>
    runs(content, ASSEMBLY_KEY, new Map())
      .map((r) => ('text' in r ? r.text : ' '))
      .join('');

  const fromRepeat = new WeakSet<ResolvedBlock>();
  const blocks = (
    list: BlockNode[],
    unitKey: string,
    scope: ItemScope,
    depth: number,
  ): ResolvedBlock[] => {
    const out: ResolvedBlock[] = [];
    if (depth > LIMITS.depth + 2) return out;
    for (const block of list) {
      if (++emitted > MAX_BLOCKS) throw tooLarge();
      const produced = one(block, unitKey, scope, depth);
      for (const b of produced) {
        const last = out.at(-1);
        // A table straight after a repeated table (for example a total row) joins it.
        if (
          b.type === 'table' &&
          last?.type === 'table' &&
          fromRepeat.has(last) &&
          last.rows[0]?.cells.length === b.rows[0]?.cells.length
        ) {
          last.rows.push(...b.rows.map((r) => ({ cells: r.cells })));
          continue;
        }
        out.push(b);
      }
    }
    return out;
  };
  const one = (
    block: BlockNode,
    unitKey: string,
    scope: ItemScope,
    depth: number,
  ): ResolvedBlock[] => {
    switch (block.type) {
      case 'paragraph':
        return [
          {
            type: 'paragraph',
            ...(block.align ? { align: block.align } : {}),
            ...(block.indent ? { indent: block.indent } : {}),
            runs: runs(block.content, unitKey, scope),
          },
        ];
      case 'heading':
        return [
          {
            type: 'heading',
            level: block.level,
            ...(block.align ? { align: block.align } : {}),
            runs: runs(block.content, unitKey, scope),
          },
        ];
      case 'list': {
        const items = block.items
          .map((item) => blocks(item, unitKey, scope, depth + 1))
          .filter((i) => i.length);
        return items.length ? [{ type: 'list', ordered: block.ordered, items }] : [];
      }
      case 'table':
        return [
          {
            type: 'table',
            ...(block.columnWidths ? { columnWidths: block.columnWidths } : {}),
            rows: block.rows.map((row) => ({
              ...(row.header ? { header: true } : {}),
              cells: row.cells.map((cell) => blocks(cell, unitKey, scope, depth + 1)),
            })),
          },
        ];
      case 'condition':
        return evaluate(block.when, resolver, unitKey, scope)
          ? blocks(block.content, unitKey, scope, depth + 1)
          : [];
      case 'repeat': {
        const items = resolver.people(unitKey, block.fieldId).slice(0, LIMITS.repeatItems);
        if (!items.length)
          return block.emptyText ? [{ type: 'paragraph', runs: [{ text: block.emptyText }] }] : [];
        const each = items.map((item) =>
          blocks(block.content, unitKey, new Map(scope).set(block.fieldId, item), depth + 1),
        );
        // A repeat whose content is one table becomes one table with a row group per item.
        if (each.every((b) => b.length === 1 && b[0].type === 'table')) {
          const tables = each.map((b) => b[0] as Extract<ResolvedBlock, { type: 'table' }>);
          const merged: ResolvedBlock = {
            type: 'table',
            ...(tables[0].columnWidths ? { columnWidths: tables[0].columnWidths } : {}),
            rows: [
              ...tables[0].rows.filter((r) => r.header),
              ...tables.flatMap((t) => t.rows.filter((r) => !r.header)),
            ],
          };
          fromRepeat.add(merged);
          return [merged];
        }
        return each.flat();
      }
      case 'pageBreak':
        return [{ type: 'pageBreak' }];
      case 'clauseSlot':
        return input.clauses.flatMap((clause, index) => {
          const wording = wordingFor(clause.version.wordings, input.outputType.id);
          if (!wording?.length) {
            issues.push({
              message: `This clause has no wording for ${input.outputType.name}.`,
              location: `clause "${clause.name}"`,
            });
            return [];
          }
          const out = blocks(wording, clause.key, new Map(), depth + 1);
          if (block.numbering !== 'decimal') return out;
          return numberClause(out, `${index + 1}.`);
        });
      case 'signatureBlock': {
        const pool = signerPool(input.ctx, block.role);
        const people = (input.signers[block.role] ?? [])
          .map((id) => pool.find((p) => p.id === id))
          .filter((p): p is PersonSnapshot => !!p);
        // One pass, so a name containing "{capacity}" is never expanded again.
        const label = (p: PersonSnapshot) =>
          a.signature.label
            .replace(/\{(name|capacity)\}/g, (_, token: string) =>
              token === 'name' ? p.name : p.capacity,
            )
            .trim();
        count(people.length);
        const signers = people.map((p) => ({ name: p.name, label: label(p) }));
        if (!signers.length) {
          placeholders = true;
          const text = `[${SIGNER_LABELS[block.role]}]`;
          signers.push({ name: text, label: text });
        }
        return [
          {
            type: 'signatures',
            ...(block.heading ? { heading: block.heading } : {}),
            columns: a.signature.columns,
            showDate: a.signature.showDate,
            signers,
          },
        ];
      }
    }
  };

  const body = [
    ...blocks(a.header, ASSEMBLY_KEY, new Map(), 0),
    ...blocks(a.closing, ASSEMBLY_KEY, new Map(), 0),
  ];
  const { header, footer, ...layout } = a.layout;
  const resolved: ResolvedDocument = {
    title: input.outputType.name,
    layout: { ...layout, header: inlineText(header), footer: inlineText(footer) },
    blocks: body,
    containsSamples,
  };
  return { resolved, issues, values, placeholders };
}

/** Puts the clause number on the first paragraph or heading; later paragraphs align with its text. */
function numberClause(blocks: ResolvedBlock[], number: string): ResolvedBlock[] {
  const out = [...blocks];
  const first = out[0];
  if (first?.type === 'paragraph') out[0] = { ...first, number };
  else if (first?.type === 'heading')
    out[0] = { ...first, runs: [{ text: `${number} ` }, ...first.runs] };
  else out.unshift({ type: 'paragraph', number, runs: [] });
  return out.map((b, i) =>
    i > 0 && b.type === 'paragraph' && !b.number ? { ...b, indent: (b.indent ?? 0) + 1 } : b,
  );
}

/** Plain text of a resolved document (tests, search and the browser preview's text view). */
export function resolvedText(doc: ResolvedDocument): string {
  const inline = (runs: ResolvedInline[]) =>
    runs.map((r) => ('text' in r ? r.text : '\n')).join('');
  const block = (b: ResolvedBlock): string => {
    switch (b.type) {
      case 'paragraph':
        return `${b.number ? `${b.number} ` : ''}${inline(b.runs)}`;
      case 'heading':
        return inline(b.runs);
      case 'list':
        return b.items.map((item) => item.map(block).join('\n')).join('\n');
      case 'table':
        return b.rows.map((r) => r.cells.map((c) => c.map(block).join(' ')).join(' | ')).join('\n');
      case 'pageBreak':
        return '---';
      case 'signatures':
        return [b.heading ?? '', ...b.signers.map((s) => s.label)].filter(Boolean).join('\n');
    }
  };
  return doc.blocks.map(block).join('\n');
}
