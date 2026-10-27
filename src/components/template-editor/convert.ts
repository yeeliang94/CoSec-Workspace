/**
 * Pure converters between the editor's Tiptap JSON and the stored schema-v1 `BlockNode[]`.
 *
 * The stored source is our own model, never Tiptap JSON. Every supported node round-trips
 * without loss once it is in canonical form (adjacent text runs with the same marks merged,
 * marks in bold/italic/underline order, no empty text runs). Content the model cannot hold is
 * reported as an issue rather than silently dropped, so the editor can block saving.
 */
import type {
  Align,
  BlockNode,
  InlineNode,
  Mark,
  Predicate,
  RecordProperty,
  SignerRole,
} from '@/domain/resolution/model';

export type TiptapMark = { type: string; attrs?: Record<string, unknown> };
export type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: TiptapMark[];
  text?: string;
};
export type ConvertMode = 'clause' | 'assembly';
export type ConvertIssue = {
  message: string;
  /** Index of the top-level block that holds the problem, for navigation. */
  blockIndex: number;
  /**
   * The content is still visible in the editor (as a placeholder) and `fromTiptap` reports it
   * again for as long as it is there, so the issue clears once the author removes it.
   */
  live?: boolean;
};

/**
 * Text that marks a placeholder paragraph standing in for an assembly-only node inside a clause.
 * Tiptap rejects the whole document when it meets a node its clause schema lacks, which would
 * open the editor blank; the placeholder keeps the problem visible and removable instead.
 */
export const UNSUPPORTED_IN_CLAUSE = 'Unsupported in clauses — remove: ';

const MARK_ORDER: Mark[] = ['bold', 'italic', 'underline'];
const ALIGNS: Align[] = ['left', 'center', 'right', 'justify'];
const PROPERTIES: RecordProperty[] = ['name', 'capacity', 'appointedOn', 'ceasedOn'];
const ROLES: SignerRole[] = ['directors', 'members', 'certifiers'];
const NODE_NAMES: Record<string, string> = {
  blockquote: 'Quotation',
  codeBlock: 'Code block',
  horizontalRule: 'Horizontal line',
  image: 'Image',
  strike: 'Strikethrough',
  code: 'Inline code',
  link: 'Link',
  highlight: 'Highlight',
  taskList: 'Checklist',
};
const label = (type: string) => NODE_NAMES[type] || `"${type}"`;

export const emptyParagraph = (): TiptapNode => ({ type: 'paragraph' });

// ---------------------------------------------------------------- BlockNode[] → Tiptap

export function toTiptap(
  blocks: BlockNode[],
  mode: ConvertMode = 'clause',
): { doc: TiptapNode; issues: ConvertIssue[] } {
  const issues: ConvertIssue[] = [];
  let top = 0;
  const report = (message: string, live = false) =>
    issues.push({ message, blockIndex: top, ...(live ? { live } : {}) });
  const placeholder = (name: string): TiptapNode => ({
    type: 'paragraph',
    content: [{ type: 'text', text: UNSUPPORTED_IN_CLAUSE + name }],
  });

  const inline = (nodes: InlineNode[]): TiptapNode[] => {
    const out: TiptapNode[] = [];
    for (const node of nodes) {
      if (node.type === 'text') {
        if (!node.text) continue;
        const marks = canonicalMarks(node.marks);
        out.push({
          type: 'text',
          text: node.text,
          ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
        });
      } else if (node.type === 'field') {
        out.push({
          type: 'field',
          attrs: { fieldId: node.fieldId, property: node.property ?? null },
        });
      } else if (node.type === 'hardBreak') {
        out.push({ type: 'hardBreak' });
      } else {
        report(`Inline content of type ${label((node as { type: string }).type)} cannot be shown.`);
      }
    }
    return out;
  };
  const textblock = (
    type: string,
    attrs: Record<string, unknown>,
    content: InlineNode[],
  ): TiptapNode => {
    const children = inline(content);
    return { type, attrs, ...(children.length ? { content: children } : {}) };
  };
  const nonEmpty = (nodes: TiptapNode[]) => (nodes.length ? nodes : [emptyParagraph()]);

  const block = (node: BlockNode): TiptapNode | null => {
    switch (node.type) {
      case 'paragraph':
        return textblock(
          'paragraph',
          { textAlign: node.align ?? null, indent: node.indent ?? 0 },
          node.content,
        );
      case 'heading':
        return textblock(
          'heading',
          { level: node.level, textAlign: node.align ?? null },
          node.content,
        );
      case 'list':
        return {
          type: node.ordered ? 'orderedList' : 'bulletList',
          ...(node.ordered ? { attrs: { start: 1 } } : {}),
          content: node.items.map((item) => {
            const content = blocksOf(item);
            if (content[0]?.type !== 'paragraph') content.unshift(emptyParagraph());
            return { type: 'listItem', content };
          }),
        };
      case 'table': {
        const columns = node.rows[0]?.cells.length ?? 0;
        return {
          type: 'table',
          attrs: {
            columnWidths:
              node.columnWidths && node.columnWidths.length === columns
                ? [...node.columnWidths]
                : null,
          },
          content: node.rows.map((row) => ({
            type: 'tableRow',
            content: row.cells.map((cell) => ({
              type: row.header ? 'tableHeader' : 'tableCell',
              attrs: { colspan: 1, rowspan: 1, colwidth: null },
              content: nonEmpty(blocksOf(cell)),
            })),
          })),
        };
      }
      case 'condition':
        return {
          type: 'condition',
          attrs: { when: structuredClone(node.when) },
          content: nonEmpty(blocksOf(node.content)),
        };
      case 'repeat':
        return {
          type: 'repeat',
          attrs: { fieldId: node.fieldId, emptyText: node.emptyText ?? null },
          content: nonEmpty(blocksOf(node.content)),
        };
      case 'pageBreak':
        return { type: 'pageBreak' };
      case 'clauseSlot':
        if (mode !== 'assembly') {
          report(
            'A clause slot belongs in an assembly, not a clause. Remove the placeholder.',
            true,
          );
          return placeholder('clause slot');
        }
        return { type: 'clauseSlot', attrs: { numbering: node.numbering } };
      case 'signatureBlock':
        if (mode !== 'assembly') {
          report(
            'A signature block belongs in an assembly, not a clause. Remove the placeholder.',
            true,
          );
          return placeholder('signature block');
        }
        return {
          type: 'signatureBlock',
          attrs: { role: node.role, heading: node.heading ?? null },
        };
      default:
        report(
          `Content of type ${label((node as { type: string }).type)} cannot be shown in the editor. Saving would remove it.`,
        );
        return null;
    }
  };
  const blocksOf = (nodes: BlockNode[]): TiptapNode[] =>
    nodes.map(block).filter((node): node is TiptapNode => node !== null);

  const content: TiptapNode[] = [];
  blocks.forEach((node, index) => {
    top = index;
    const converted = block(node);
    if (converted) content.push(converted);
  });
  return { doc: { type: 'doc', content: content.length ? content : [emptyParagraph()] }, issues };
}

// ---------------------------------------------------------------- Tiptap → BlockNode[]

export function fromTiptap(
  doc: TiptapNode,
  mode: ConvertMode = 'clause',
): { blocks: BlockNode[]; issues: ConvertIssue[] } {
  const issues: ConvertIssue[] = [];
  let top = 0;
  const report = (message: string) => issues.push({ message, blockIndex: top });

  const inline = (nodes: TiptapNode[] | undefined): InlineNode[] => {
    const out: InlineNode[] = [];
    for (const node of nodes ?? []) {
      if (node.type === 'text') {
        if (!node.text) continue;
        const marks: Mark[] = [];
        for (const mark of node.marks ?? []) {
          if ((MARK_ORDER as string[]).includes(mark.type)) marks.push(mark.type as Mark);
          else report(`${label(mark.type)} formatting is not supported in templates.`);
        }
        const canonical = canonicalMarks(marks);
        const previous = out.at(-1);
        if (previous?.type === 'text' && sameMarks(previous.marks, canonical)) {
          previous.text += node.text;
          continue;
        }
        out.push({
          type: 'text',
          text: node.text,
          ...(canonical.length ? { marks: canonical } : {}),
        });
      } else if (node.type === 'field') {
        const fieldId = String(node.attrs?.fieldId ?? '');
        if (!fieldId) {
          report('A field chip has no field. Choose a field or remove the chip.');
          continue;
        }
        const property = node.attrs?.property;
        if (property && !PROPERTIES.includes(property as RecordProperty))
          report(`Field property "${String(property)}" is not supported.`);
        out.push({
          type: 'field',
          fieldId,
          ...(property && PROPERTIES.includes(property as RecordProperty)
            ? { property: property as RecordProperty }
            : {}),
        });
      } else if (node.type === 'hardBreak') {
        out.push({ type: 'hardBreak' });
      } else {
        report(`${label(node.type)} is not supported inside text.`);
      }
    }
    return out;
  };

  const align = (attrs: TiptapNode['attrs']): { align?: Align } => {
    const value = attrs?.textAlign;
    return typeof value === 'string' && ALIGNS.includes(value as Align)
      ? { align: value as Align }
      : {};
  };

  const block = (node: TiptapNode): BlockNode | null => {
    switch (node.type) {
      case 'paragraph': {
        const indent = Number(node.attrs?.indent ?? 0);
        if (
          mode === 'clause' &&
          node.content?.some((child) => child.text?.startsWith(UNSUPPORTED_IN_CLAUSE))
        )
          report('Remove the “Unsupported in clauses” placeholder before saving.');
        return {
          type: 'paragraph',
          ...align(node.attrs),
          ...(indent > 0 ? { indent } : {}),
          content: inline(node.content),
        };
      }
      case 'heading': {
        const level = Number(node.attrs?.level ?? 1);
        if (![1, 2, 3].includes(level)) report(`Heading level ${level} is not supported.`);
        return {
          type: 'heading',
          level: Math.min(3, Math.max(1, level)) as 1 | 2 | 3,
          ...align(node.attrs),
          content: inline(node.content),
        };
      }
      case 'bulletList':
      case 'orderedList': {
        const start = Number(node.attrs?.start ?? 1);
        if (node.type === 'orderedList' && start !== 1)
          report('A numbered list must start at 1. Restart numbering is not supported.');
        return {
          type: 'list',
          ordered: node.type === 'orderedList',
          items: (node.content ?? []).map((item) => {
            if (item.type !== 'listItem') report(`${label(item.type)} is not a list item.`);
            return blocksOf(item.content);
          }),
        };
      }
      case 'table': {
        const rows = (node.content ?? []).map((row) => {
          const cells = row.content ?? [];
          const headers = cells.filter((cell) => cell.type === 'tableHeader').length;
          if (headers && headers !== cells.length)
            report('Mix of header and normal cells in one table row is not supported.');
          for (const cell of cells) {
            if (Number(cell.attrs?.colspan ?? 1) !== 1 || Number(cell.attrs?.rowspan ?? 1) !== 1)
              report('Merged table cells are not supported. Split the cells before saving.');
          }
          return {
            ...(headers && headers === cells.length ? { header: true } : {}),
            cells: cells.map((cell) => blocksOf(cell.content)),
          };
        });
        const columns = rows[0]?.cells.length ?? 0;
        if (rows.some((row) => row.cells.length !== columns))
          report('Every table row must have the same number of cells.');
        const widths = node.attrs?.columnWidths;
        const columnWidths =
          Array.isArray(widths) &&
          widths.length === columns &&
          widths.every((value) => typeof value === 'number')
            ? (widths as number[])
            : undefined;
        return { type: 'table', ...(columnWidths ? { columnWidths } : {}), rows };
      }
      case 'condition': {
        const when = node.attrs?.when as Predicate | undefined;
        if (!when || typeof when !== 'object') {
          report('A condition has no rule. Set when it applies.');
          return {
            type: 'condition',
            when: { op: 'isTrue', fieldId: '' },
            content: blocksOf(node.content),
          };
        }
        return { type: 'condition', when: structuredClone(when), content: blocksOf(node.content) };
      }
      case 'repeat': {
        const fieldId = String(node.attrs?.fieldId ?? '');
        if (!fieldId) report('A repeat has no list field. Choose the list it repeats over.');
        const emptyText = node.attrs?.emptyText;
        return {
          type: 'repeat',
          fieldId,
          content: blocksOf(node.content),
          ...(typeof emptyText === 'string' ? { emptyText } : {}),
        };
      }
      case 'pageBreak':
        return { type: 'pageBreak' };
      case 'clauseSlot':
        if (mode !== 'assembly') report('A clause slot belongs in an assembly, not a clause.');
        return {
          type: 'clauseSlot',
          numbering: node.attrs?.numbering === 'decimal' ? 'decimal' : 'none',
        };
      case 'signatureBlock': {
        if (mode !== 'assembly') report('A signature block belongs in an assembly, not a clause.');
        const role = node.attrs?.role as SignerRole;
        if (!ROLES.includes(role)) report(`Signer role "${String(role)}" is not supported.`);
        const heading = node.attrs?.heading;
        return {
          type: 'signatureBlock',
          role: ROLES.includes(role) ? role : 'directors',
          ...(typeof heading === 'string' && heading ? { heading } : {}),
        };
      }
      default:
        report(`${label(node.type)} is not supported in templates. Remove it before saving.`);
        return null;
    }
  };
  const blocksOf = (nodes: TiptapNode[] | undefined): BlockNode[] =>
    (nodes ?? []).map(block).filter((node): node is BlockNode => node !== null);

  const blocks: BlockNode[] = [];
  (doc.content ?? []).forEach((node, index) => {
    top = index;
    const converted = block(node);
    if (converted) blocks.push(converted);
  });
  // A document holding a single empty paragraph is the editor's representation of "nothing".
  if (
    blocks.length === 1 &&
    blocks[0].type === 'paragraph' &&
    !blocks[0].content.length &&
    !blocks[0].align &&
    !blocks[0].indent
  )
    return { blocks: [], issues };
  return { blocks, issues };
}

function canonicalMarks(marks: Mark[] | undefined): Mark[] {
  return MARK_ORDER.filter((mark) => marks?.includes(mark));
}
function sameMarks(a: Mark[] | undefined, b: Mark[]) {
  const left = canonicalMarks(a);
  return left.length === b.length && left.every((mark, index) => mark === b[index]);
}

/** Canonical form of stored blocks: what a lossless round trip returns. */
export function canonicalBlocks(blocks: BlockNode[], mode: ConvertMode = 'clause'): BlockNode[] {
  return fromTiptap(toTiptap(blocks, mode).doc, mode).blocks;
}

/** Plain text of a fragment, used for diffs and summaries. Fields show as {id}. */
export function plainText(blocks: BlockNode[]): string {
  const inline = (nodes: InlineNode[]) =>
    nodes
      .map((node) =>
        node.type === 'text'
          ? node.text
          : node.type === 'field'
            ? `{${node.fieldId}${node.property ? '.' + node.property : ''}}`
            : '\n',
      )
      .join('');
  const lines: string[] = [];
  const walk = (nodes: BlockNode[]) => {
    for (const node of nodes) {
      if (node.type === 'paragraph' || node.type === 'heading') lines.push(inline(node.content));
      else if (node.type === 'list') node.items.forEach(walk);
      else if (node.type === 'table') node.rows.forEach((row) => row.cells.forEach(walk));
      else if (node.type === 'condition' || node.type === 'repeat') walk(node.content);
      else if (node.type === 'clauseSlot') lines.push('[Clauses]');
      else if (node.type === 'signatureBlock') lines.push(`[Signatures: ${node.role}]`);
    }
  };
  walk(blocks);
  return lines.join('\n');
}
