import { inflateRawSync } from 'node:zlib';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopType,
  TextRun,
  VerticalAlignTable,
  WidthType,
  convertMillimetersToTwip,
} from 'docx';
import { DomainError } from '../../domain/access';
import type {
  Align,
  ResolvedBlock,
  ResolvedDocument,
  ResolvedInline,
} from '../../domain/resolution/model';
import { LIMITS } from '../../domain/resolution/schema';

/** Recorded on every generation; bump when output for the same input would change. */
export const RENDERER_VERSION = 'docx@9.14.0/cosec-1';

const STEP = 567; // 1 cm in twips: one indent level and the clause-number hanging indent
const PAGE = { A4: { width: 11906, height: 16838 }, Letter: { width: 12240, height: 15840 } };
const ALIGN: Record<Align, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};
const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const LINE = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
// Word refuses documents containing these characters.
const clean = (text: string) =>
  text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').toWellFormed();

function textRuns(runs: ResolvedInline[], extra: { bold?: boolean } = {}) {
  return runs.map((run) =>
    'break' in run
      ? new TextRun({ break: 1 })
      : new TextRun({
          text: clean(run.text),
          bold: extra.bold || run.marks?.includes('bold') || undefined,
          italics: run.marks?.includes('italic') || undefined,
          underline: run.marks?.includes('underline') ? {} : undefined,
        }),
  );
}

type Child = Paragraph | Table;

class Builder {
  private listInstance = 0;
  constructor(private contentWidth: number) {}

  blocks(blocks: ResolvedBlock[], width = this.contentWidth, inCell = false): Child[] {
    // The paragraph before a signature area (for example "Dated: …") stays on its page.
    return blocks.flatMap((b, i) =>
      this.block(b, width, inCell, blocks[i + 1]?.type === 'signatures'),
    );
  }

  private block(block: ResolvedBlock, width: number, inCell: boolean, keepNext = false): Child[] {
    const spacing = inCell ? { before: 20, after: 20 } : undefined;
    switch (block.type) {
      case 'paragraph': {
        if (block.number)
          return [
            new Paragraph({
              children: [
                new TextRun(clean(block.number)),
                new TextRun({ text: '\t' }),
                ...textRuns(block.runs),
              ],
              alignment: block.align ? ALIGN[block.align] : undefined,
              keepNext: keepNext || undefined,
              indent: { left: STEP * ((block.indent ?? 0) + 1), hanging: STEP },
              tabStops: [{ type: TabStopType.LEFT, position: STEP * ((block.indent ?? 0) + 1) }],
            }),
          ];
        return [
          new Paragraph({
            children: textRuns(block.runs),
            alignment: block.align ? ALIGN[block.align] : undefined,
            indent: block.indent ? { left: STEP * block.indent } : undefined,
            keepNext: keepNext || undefined,
            spacing,
          }),
        ];
      }
      case 'heading':
        return [
          new Paragraph({
            children: textRuns(block.runs),
            heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][
              block.level - 1
            ],
            alignment: block.align ? ALIGN[block.align] : undefined,
            keepNext: true,
            keepLines: true,
          }),
        ];
      case 'list':
        return this.list(block, 0, width);
      case 'table':
        return [this.table(block, width), ...(inCell ? [] : [new Paragraph({ children: [] })])];
      case 'pageBreak':
        return inCell ? [] : [new Paragraph({ children: [new PageBreak()] })];
      case 'signatures':
        return this.signatures(block, width);
    }
  }

  private list(
    block: Extract<ResolvedBlock, { type: 'list' }>,
    level: number,
    width: number,
  ): Child[] {
    const instance = ++this.listInstance;
    const reference = block.ordered ? 'ordered' : 'bullet';
    const out: Child[] = [];
    for (const item of block.items) {
      item.forEach((child, index) => {
        if (child.type === 'list') out.push(...this.list(child, Math.min(level + 1, 2), width));
        else if (child.type === 'paragraph' || child.type === 'heading')
          out.push(
            new Paragraph({
              children: textRuns(child.runs, { bold: child.type === 'heading' }),
              alignment: child.align ? ALIGN[child.align] : undefined,
              ...(index === 0
                ? { numbering: { reference, level, instance } }
                : { indent: { left: STEP * (level + 2) } }),
            }),
          );
        else out.push(...this.block(child, width, false));
      });
    }
    return out;
  }

  private table(block: Extract<ResolvedBlock, { type: 'table' }>, width: number) {
    const columns = Math.max(1, ...block.rows.map((r) => r.cells.length));
    const percents =
      block.columnWidths?.length === columns
        ? block.columnWidths
        : Array(columns).fill(100 / columns);
    const widths = percents.map((p) => Math.floor((width * p) / 100));
    return new Table({
      width: { size: width, type: WidthType.DXA },
      columnWidths: widths,
      layout: TableLayoutType.FIXED,
      borders: {
        top: LINE,
        bottom: LINE,
        left: LINE,
        right: LINE,
        insideHorizontal: LINE,
        insideVertical: LINE,
      },
      rows: block.rows.map(
        (row) =>
          new TableRow({
            tableHeader: row.header || undefined,
            cantSplit: true,
            children: Array.from({ length: columns }, (_, c) => {
              const inner = (row.cells[c] ?? []).flatMap((b) =>
                row.header && (b.type === 'paragraph' || b.type === 'heading')
                  ? [
                      new Paragraph({
                        children: textRuns(b.runs, { bold: true }),
                        alignment: b.align ? ALIGN[b.align] : undefined,
                        spacing: { before: 20, after: 20 },
                      }),
                    ]
                  : this.block(b, widths[c] - 200, true),
              );
              return new TableCell({
                width: { size: widths[c], type: WidthType.DXA },
                margins: { top: 60, bottom: 60, left: 100, right: 100 },
                verticalAlign: VerticalAlignTable.CENTER,
                children: inner.length ? inner : [new Paragraph({ children: [] })],
              });
            }),
          }),
      ),
    });
  }

  private signatures(
    block: Extract<ResolvedBlock, { type: 'signatures' }>,
    width: number,
  ): Child[] {
    const columns = block.columns;
    const cellWidth = Math.floor(width / columns);
    const rows: TableRow[] = [];
    for (let i = 0; i < block.signers.length; i += columns) {
      const group = block.signers.slice(i, i + columns);
      rows.push(
        new TableRow({
          cantSplit: true,
          children: Array.from({ length: columns }, (_, c) => {
            const signer = group[c];
            const children = signer
              ? [
                  new Paragraph({ children: [], spacing: { before: 600 } }),
                  new Paragraph({
                    children: [new TextRun('_'.repeat(Math.max(16, Math.floor(34 / columns) * 2)))],
                  }),
                  ...clean(signer.label)
                    .split('\n')
                    .map(
                      (line) => new Paragraph({ children: [new TextRun(line)], keepNext: true }),
                    ),
                  ...(block.showDate
                    ? [new Paragraph({ children: [new TextRun('Date: ____________________')] })]
                    : []),
                ]
              : [new Paragraph({ children: [] })];
            return new TableCell({
              width: { size: cellWidth, type: WidthType.DXA },
              borders: { top: NONE, bottom: NONE, left: NONE, right: NONE },
              margins: { top: 0, bottom: 120, left: 0, right: 240 },
              children,
            });
          }),
        }),
      );
    }
    return [
      ...(block.heading
        ? [
            new Paragraph({
              children: [new TextRun({ text: clean(block.heading), bold: true })],
              keepNext: true,
              spacing: { before: 240 },
            }),
          ]
        : []),
      new Table({
        width: { size: cellWidth * columns, type: WidthType.DXA },
        columnWidths: Array(columns).fill(cellWidth),
        layout: TableLayoutType.FIXED,
        borders: {
          top: NONE,
          bottom: NONE,
          left: NONE,
          right: NONE,
          insideHorizontal: NONE,
          insideVertical: NONE,
        },
        rows,
      }),
      new Paragraph({ children: [] }),
    ];
  }
}

function buildDocument(doc: ResolvedDocument) {
  const layout = doc.layout;
  const page = PAGE[layout.pageSize];
  const margin = {
    top: convertMillimetersToTwip(layout.marginsMm.top),
    right: convertMillimetersToTwip(layout.marginsMm.right),
    bottom: convertMillimetersToTwip(layout.marginsMm.bottom),
    left: convertMillimetersToTwip(layout.marginsMm.left),
  };
  const contentWidth = page.width - margin.left - margin.right;
  const size = Math.round(layout.fontSizePt * 2);
  const small = Math.max(14, size - 2);
  const footerChildren: Paragraph[] = [];
  if (layout.footer)
    footerChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: clean(layout.footer), size: small })],
      }),
    );
  if (layout.pageNumbers)
    footerChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
            size: small,
          }),
        ],
      }),
    );
  const levels = (formats: (typeof LevelFormat)[keyof typeof LevelFormat][], texts: string[]) =>
    formats.map((format, level) => ({
      level,
      format,
      text: texts[level],
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: STEP * (level + 2), hanging: STEP } } },
    }));
  return new Document({
    title: clean(doc.title),
    creator: 'CoSec Workspace',
    description: doc.containsSamples ? 'Contains labelled sample values' : undefined,
    styles: {
      default: {
        document: {
          run: { font: layout.fontFamily, size },
          paragraph: { spacing: { after: 120, line: 276 } },
        },
        heading1: {
          run: { font: layout.fontFamily, size: size + 8, bold: true, color: '000000' },
          paragraph: { spacing: { before: 240, after: 120 }, keepNext: true },
        },
        heading2: {
          run: { font: layout.fontFamily, size: size + 4, bold: true, color: '000000' },
          paragraph: { spacing: { before: 240, after: 120 }, keepNext: true },
        },
        heading3: {
          run: { font: layout.fontFamily, size, bold: true, color: '000000' },
          paragraph: { spacing: { before: 200, after: 100 }, keepNext: true },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'ordered',
          levels: levels(
            [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN],
            ['%1.', '(%2)', '(%3)'],
          ),
        },
        {
          reference: 'bullet',
          levels: levels(
            [LevelFormat.BULLET, LevelFormat.BULLET, LevelFormat.BULLET],
            ['•', '–', '•'],
          ),
        },
      ],
    },
    sections: [
      {
        properties: { page: { size: page, margin: { ...margin, header: 567, footer: 567 } } },
        headers: layout.header
          ? {
              default: new Header({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [new TextRun({ text: clean(layout.header), size: small })],
                  }),
                ],
              }),
            }
          : undefined,
        footers: footerChildren.length
          ? { default: new Footer({ children: footerChildren }) }
          : undefined,
        children: (() => {
          const body = new Builder(contentWidth).blocks(doc.blocks);
          return body.length ? body : [new Paragraph({ children: [] })];
        })(),
      },
    ],
  });
}

/** Minimal ZIP reader for validating our own packages (stored or deflated entries). */
export function readZip(bytes: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--)
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error('Not a ZIP package.');
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Corrupt ZIP directory.');
    const method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20);
    const size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extra = bytes.readUInt16LE(offset + 30);
    const comment = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    total += size;
    if (total > 64 * 1024 * 1024) throw new Error('ZIP package is too large.');
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const data = bytes.subarray(start, start + compressed);
    entries.set(name, method === 0 ? Buffer.from(data) : inflateRawSync(data));
    offset += 46 + nameLength + extra + comment;
  }
  return entries;
}

export function validateDocx(bytes: Buffer) {
  if (bytes.byteLength > LIMITS.outputBytes)
    throw new DomainError('The document is larger than 5 MiB.', 'TOO_LARGE');
  const entries = readZip(bytes);
  const xml = entries.get('word/document.xml')?.toString('utf8');
  if (!xml || !xml.includes('<w:body>')) throw new Error('The package has no Word document body.');
  if (!entries.has('[Content_Types].xml')) throw new Error('The package has no content types.');
}

/**
 * Renders a resolved document to DOCX bytes; never fetches anything.
 *
 * Time bound: the timeout below stops the caller waiting, but it cannot interrupt work already
 * running on the event loop (building the document tree is synchronous), so it is not a hard
 * kill. Rendering in a `node:worker_threads` worker with `worker.terminate()` was considered and
 * not adopted: this module is bundled by Next.js (Turbopack) and also run from source by Vitest
 * and the tsx worker, and there is no single worker entry that loads this TypeScript module and
 * its `docx` dependency under all three without a separate build step. The real bound is on the
 * input instead: compileDocument caps the blocks and inline runs a document may contain
 * (MAX_RUNS), and the output is limited to LIMITS.outputBytes. A Pending generation that never
 * finishes is marked Failed by reconcilePendingGenerations.
 */
export async function renderDocx(
  doc: ResolvedDocument,
  timeoutMs: number = LIMITS.renderMs,
): Promise<Buffer> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const bytes = await Promise.race([
      Packer.toBuffer(buildDocument(doc)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new DomainError('Rendering took too long.', 'TIMEOUT')),
          timeoutMs,
        );
      }),
    ]);
    const buffer = Buffer.from(bytes);
    validateDocx(buffer);
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}
