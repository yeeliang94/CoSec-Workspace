import { describe, expect, it } from 'vitest';
import type { BlockNode, FieldDefinition } from '../src/domain/resolution/model';
import {
  canonicalBlocks,
  fromTiptap,
  plainText,
  toTiptap,
  UNSUPPORTED_IN_CLAUSE,
  type TiptapNode,
} from '../src/components/template-editor/convert';
import {
  findFieldUsages,
  predicateSummary,
  referencedFieldIds,
  slugId,
} from '../src/components/template-editor/fields';

const clause: BlockNode[] = [
  { type: 'heading', level: 2, align: 'center', content: [{ type: 'text', text: 'Appointment' }] },
  {
    type: 'paragraph',
    align: 'justify',
    indent: 1,
    content: [
      { type: 'text', text: 'RESOLVED that ', marks: ['bold'] },
      { type: 'field', fieldId: 'company_name' },
      { type: 'text', text: ' appoints ' },
      { type: 'field', fieldId: 'appointee', property: 'name' },
      { type: 'hardBreak' },
      { type: 'text', text: 'with effect', marks: ['bold', 'italic', 'underline'] },
    ],
  },
  {
    type: 'list',
    ordered: true,
    items: [
      [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }],
      [
        { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
        {
          type: 'list',
          ordered: false,
          items: [[{ type: 'paragraph', content: [{ type: 'field', fieldId: 'fee' }] }]],
        },
      ],
    ],
  },
  {
    type: 'table',
    columnWidths: [60, 40],
    rows: [
      {
        header: true,
        cells: [
          [{ type: 'paragraph', content: [{ type: 'text', text: 'Director' }] }],
          [{ type: 'paragraph', content: [{ type: 'text', text: 'Fee' }] }],
        ],
      },
      {
        cells: [
          [
            {
              type: 'paragraph',
              content: [{ type: 'field', fieldId: 'directors', property: 'name' }],
            },
          ],
          [{ type: 'paragraph', align: 'right', content: [{ type: 'field', fieldId: 'fee' }] }],
        ],
      },
    ],
  },
  {
    type: 'condition',
    when: {
      op: 'and',
      all: [
        { op: 'isTrue', fieldId: 'fees_payable' },
        { op: 'equals', fieldId: 'basis', value: 'annual' },
      ],
    },
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fees are payable.' }] }],
  },
  {
    type: 'repeat',
    fieldId: 'directors',
    emptyText: 'No directors selected',
    content: [
      { type: 'paragraph', content: [{ type: 'field', fieldId: 'directors', property: 'name' }] },
    ],
  },
  { type: 'pageBreak' },
  { type: 'paragraph', content: [] },
];

const assembly: BlockNode[] = [
  { type: 'paragraph', content: [{ type: 'field', fieldId: 'company_name' }] },
  { type: 'clauseSlot', numbering: 'decimal' },
  { type: 'signatureBlock', role: 'directors', heading: 'Directors' },
  { type: 'signatureBlock', role: 'certifiers' },
];

describe('template editor conversion', () => {
  it('round-trips every supported clause node without loss', () => {
    const { doc, issues } = toTiptap(clause);
    expect(issues).toEqual([]);
    const back = fromTiptap(JSON.parse(JSON.stringify(doc)) as TiptapNode);
    expect(back.issues).toEqual([]);
    expect(back.blocks).toEqual(clause);
  });

  it('round-trips assembly-only nodes in assembly mode', () => {
    const { doc, issues } = toTiptap(assembly, 'assembly');
    expect(issues).toEqual([]);
    expect(fromTiptap(doc, 'assembly')).toEqual({ blocks: assembly, issues: [] });
  });

  it('reports assembly nodes inside a clause instead of hiding them', () => {
    const { doc, issues } = toTiptap(assembly, 'clause');
    expect(issues.map((issue) => issue.blockIndex)).toEqual([1, 2, 3]);
    expect(fromTiptap(doc, 'clause').issues).toHaveLength(3);
  });

  it('shows assembly nodes inside a clause as removable placeholders the clause schema accepts', () => {
    const { doc, issues } = toTiptap(assembly, 'clause');
    // Tiptap rejects the whole document for unknown nodes, so none may reach a clause editor.
    const types = (doc.content ?? []).map((node) => node.type);
    expect(types).not.toContain('clauseSlot');
    expect(types).not.toContain('signatureBlock');
    expect(issues.every((issue) => issue.live)).toBe(true);
    const placeholders = (doc.content ?? []).filter((node) =>
      node.content?.some((child) => child.text?.startsWith(UNSUPPORTED_IN_CLAUSE)),
    );
    expect(placeholders).toHaveLength(3);
    // Removing the placeholders clears the issues, so the author can save again.
    const cleaned: TiptapNode = {
      ...doc,
      content: (doc.content ?? []).filter((node) => !placeholders.includes(node)),
    };
    expect(fromTiptap(cleaned, 'clause').issues).toEqual([]);
  });

  it('canonicalises marks, adjacent runs and empty text', () => {
    const blocks: BlockNode[] = [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'A', marks: ['underline', 'bold'] },
          { type: 'text', text: 'B', marks: ['bold', 'underline'] },
          { type: 'text', text: '' },
          { type: 'text', text: 'C', marks: [] },
        ],
      },
    ];
    expect(canonicalBlocks(blocks)).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'AB', marks: ['bold', 'underline'] },
          { type: 'text', text: 'C' },
        ],
      },
    ]);
  });

  it('treats an empty document as no content', () => {
    const { doc } = toTiptap([]);
    expect(doc.content).toHaveLength(1);
    expect(fromTiptap(doc).blocks).toEqual([]);
  });

  it('reports unsupported Tiptap content rather than dropping it silently', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'strike' }] }] },
        { type: 'blockquote', content: [{ type: 'paragraph' }] },
        { type: 'orderedList', attrs: { start: 3 }, content: [] },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', attrs: { colspan: 2 }, content: [{ type: 'paragraph' }] },
              ],
            },
          ],
        },
        { type: 'paragraph', content: [{ type: 'image' }] },
      ],
    };
    const { issues } = fromTiptap(doc);
    expect(issues.map((issue) => issue.blockIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(issues[0].message).toMatch(/Strikethrough/);
    expect(issues[1].message).toMatch(/Quotation/);
    expect(issues[3].message).toMatch(/Merged/);
  });

  it('reports unknown stored nodes it cannot show', () => {
    const { issues } = toTiptap([{ type: 'futureNode' } as unknown as BlockNode]);
    expect(issues[0].message).toMatch(/cannot be shown/);
  });

  it('drops column widths that no longer match the column count', () => {
    const table: BlockNode = {
      type: 'table',
      columnWidths: [50, 50],
      rows: [{ cells: [[{ type: 'paragraph', content: [] }]] }],
    };
    expect(canonicalBlocks([table])).toEqual([
      { type: 'table', rows: [{ cells: [[{ type: 'paragraph', content: [] }]] }] },
    ]);
  });

  it('gives plain text with field placeholders', () => {
    expect(plainText(clause.slice(1, 2))).toBe(
      'RESOLVED that {company_name} appoints {appointee.name}\nwith effect',
    );
  });
});

describe('template fields', () => {
  const fields: FieldDefinition[] = [
    {
      id: 'fees_payable',
      label: 'Fees payable',
      valueType: 'boolean',
      source: { kind: 'question' },
      scope: 'clause',
    },
    {
      id: 'basis',
      label: 'Basis',
      valueType: 'choice',
      source: { kind: 'question' },
      scope: 'case',
      options: [{ id: 'annual', label: 'Annual' }],
    },
    {
      id: 'directors',
      label: 'Directors',
      valueType: 'recordList',
      source: { kind: 'question' },
      scope: 'clause',
      record: { context: 'currentDirectors' },
    },
    {
      id: 'fee',
      label: 'Fee',
      valueType: 'number',
      source: { kind: 'question' },
      scope: 'clause',
      repeatScope: 'directors',
    },
    {
      id: 'total',
      label: 'Total',
      valueType: 'number',
      source: { kind: 'derived', op: 'sum', fieldId: 'fee' },
      scope: 'clause',
    },
  ];

  it('creates stable, valid, unique ids from labels', () => {
    expect(slugId('Year-end date')).toBe('year_end_date');
    expect(slugId('2026 fee')).toBe('field_2026_fee');
    expect(slugId('Année')).toBe('annee');
    expect(slugId('Fee', ['fee', 'fee_2'])).toBe('fee_3');
    expect(slugId('!')).toMatch(/^[a-z][a-z0-9_]{1,63}$/);
    expect(slugId('x'.repeat(100))).toHaveLength(58);
  });

  it('finds every usage in wordings, conditions, repeats and other fields', () => {
    const wordings = [{ key: 'directors_written', name: "Directors' written", blocks: clause }];
    const fee = findFieldUsages('fee', wordings, fields);
    expect(fee.map((usage) => usage.place)).toEqual([
      "Directors' written, block 3",
      "Directors' written, block 4",
      'Calculated field "Total"',
    ]);
    const directors = findFieldUsages('directors', wordings, fields).map((usage) => usage.place);
    expect(directors).toEqual([
      "Directors' written, block 4",
      "Directors' written, block 6 (2 times)",
      'Per-person question "Fee"',
    ]);
    expect(findFieldUsages('basis', wordings, fields)[0].blockIndex).toBe(4);
    expect([...referencedFieldIds(clause)].sort()).toEqual(
      ['appointee', 'basis', 'company_name', 'directors', 'fee', 'fees_payable'].sort(),
    );
  });

  it('summarises conditions in plain language', () => {
    const condition = clause[4];
    if (condition.type !== 'condition') throw new Error('fixture');
    expect(predicateSummary(condition.when, fields)).toBe(
      'Fees payable is ticked and Basis is Annual',
    );
  });
});
