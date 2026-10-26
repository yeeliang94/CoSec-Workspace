import { describe, expect, it } from 'vitest';
import { compileDocument, resolvedText } from '../src/domain/resolution/compile';
import {
  buildForm,
  validateAnswers,
  type CaseInput,
  type ClausePart,
} from '../src/domain/resolution/form';
import type {
  Answers,
  BlockNode,
  FieldDefinition,
  ResolvedBlock,
} from '../src/domain/resolution/model';
import {
  assemblyContentSchema,
  boundedJson,
  clauseContentSchema,
  clauseFragmentSchema,
  dateString,
  fieldsSchema,
  OUTPUT_TYPE_ID,
  wordingFor,
} from '../src/domain/resolution/schema';
import { MAX_RUNS } from '../src/domain/resolution/compile';
import { DomainError } from '../src/domain/access';
import { bindingInfo } from '../src/domain/resolution/bindings';
import {
  sharedFieldConflicts,
  validateAssembly,
  validateClause,
} from '../src/domain/resolution/validate';
import {
  addDays,
  addDecimals,
  compareDecimals,
  formatDecimal,
  formatLongDate,
} from '../src/domain/resolution/values';
import { readZip, renderDocx } from '../src/server/resolution/render-docx';
import {
  f,
  p,
  sampleContext,
  sampleSigners,
  STARTER_ASSEMBLIES,
  STARTER_CLAUSES,
} from '../src/server/resolution/samples';

const ctx = sampleContext();
const clause = (key: string, entryKey = key): ClausePart => {
  const c = STARTER_CLAUSES.find((x) => x.key === key)!;
  return {
    key: entryKey,
    name: c.name,
    version: { id: `v-${key}`, ...structuredClone(c.content) },
  };
};
const assembly = (key: string) => {
  const a = STARTER_ASSEMBLIES.find((x) => x.key === key)!;
  return { name: a.name, version: { id: `a-${key}`, ...structuredClone(a.content) } };
};
const outputs = {
  directors_written: { id: 'directors_written', name: "Directors' written resolution" },
  members_written: { id: 'members_written', name: "Members' written resolution" },
};
function caseInput(
  assemblyKey: string,
  clauses: ClausePart[],
  shared: Answers,
  perClause: Record<string, Answers> = {},
  signers = sampleSigners(ctx),
): CaseInput {
  const a = assembly(assemblyKey);
  const outputTypeId = STARTER_ASSEMBLIES.find((x) => x.key === assemblyKey)!
    .outputTypeId as keyof typeof outputs;
  return {
    outputType: outputs[outputTypeId],
    assembly: a,
    clauses,
    ctx,
    answers: { shared, clauses: perClause },
    signers,
  };
}
const feeAnswers = (payable: boolean): Answers => ({
  fees_payable: payable,
  fee_year_end: '2026-12-31',
  fee_directors: ['sample-d1', 'sample-d2'],
  fee_amount: { 'sample-d1': '1000.10', 'sample-d2': '2000.25' },
});
const text = (input: CaseInput, mode: 'final' | 'preview' = 'final') =>
  resolvedText(compileDocument(input, mode).resolved);
const errors = <T extends { severity?: string }>(issues: T[]) =>
  issues.filter((i) => i.severity !== 'warning');

describe('exact values', () => {
  it('adds and compares decimals without floating point', () => {
    expect(addDecimals(['1000.10', '2000.25'])).toBe('3000.35');
    expect(addDecimals(['0.1', '0.2'])).toBe('0.3');
    expect(addDecimals(['999999999999999999.99', '0.01'])).toBe('1000000000000000000.00');
    expect(compareDecimals('10.50', '10.5')).toBe(0);
    expect(compareDecimals('-1', '0')).toBe(-1);
    expect(formatDecimal('3000.35', 2, true)).toBe('3,000.35');
    expect(formatDecimal('2.005', 2)).toBe('2.01');
    expect(formatDecimal('0', 2)).toBe('0.00');
  });
  it('does calendar date arithmetic and long formatting', () => {
    expect(addDays('2026-10-26', 28)).toBe('2026-11-23');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(formatLongDate('2026-10-26')).toBe('26 October 2026');
  });
});

describe('template schema and validation', () => {
  it('allows page breaks in clauses but not clause slots, signature blocks or unknown nodes', () => {
    expect(clauseFragmentSchema.safeParse([{ type: 'pageBreak' }]).success).toBe(true);
    expect(
      clauseFragmentSchema.safeParse([{ type: 'clauseSlot', numbering: 'none' }]).success,
    ).toBe(false);
    expect(
      clauseFragmentSchema.safeParse([{ type: 'signatureBlock', role: 'directors' }]).success,
    ).toBe(false);
    expect(
      clauseFragmentSchema.safeParse([{ type: 'image', src: 'https://example.com/x.png' }]).success,
    ).toBe(false);
    expect(
      clauseFragmentSchema.safeParse([
        { type: 'paragraph', content: [{ type: 'text', text: 'x', href: 'https://x' }] },
      ]).success,
    ).toBe(false);
    expect(
      assemblyContentSchema.shape.header.safeParse([{ type: 'clauseSlot', numbering: 'decimal' }])
        .success,
    ).toBe(true);
  });

  it('A23 rejects or bounds hostile content', () => {
    const control = [{ type: 'paragraph', content: [{ type: 'text', text: 'a\u0000b' }] }];
    expect(clauseFragmentSchema.safeParse(control).success).toBe(false);
    const huge = [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(10_001) }] }];
    expect(clauseFragmentSchema.safeParse(huge).success).toBe(false);
    let deep: unknown = { type: 'paragraph', content: [] };
    for (let i = 0; i < 20; i++)
      deep = { type: 'condition', when: { op: 'isTrue', fieldId: 'ab' }, content: [deep] };
    expect(clauseFragmentSchema.safeParse([deep]).success).toBe(false);
    let bomb: unknown = [];
    for (let i = 0; i < 100_000; i++) bomb = [bomb];
    expect(boundedJson(bomb)).toMatch(/nested/);
    expect(clauseFragmentSchema.safeParse(bomb).success).toBe(false);
    const many = Array.from({ length: 2001 }, () => ({ type: 'pageBreak' }));
    expect(clauseFragmentSchema.safeParse(many).success).toBe(false);
    for (const path of [
      '__proto__',
      'company.__proto__',
      'constructor',
      'company.custom.../../etc',
      'job.data',
      'bo.owner',
    ])
      expect(bindingInfo(path)).toBeNull();
    const fields = fieldsSchema.parse([
      {
        id: 'evil',
        label: 'Evil',
        valueType: 'text',
        source: { kind: 'binding', path: 'company.constructor' },
        scope: 'clause',
      },
    ]);
    const issues = validateClause('Hostile', {
      wordings: { directors_written: [p(f('evil'))] },
      fields,
    });
    expect(issues.some((i) => /not an allowed record value/.test(i.message))).toBe(true);
    expect(
      fieldsSchema.safeParse([
        {
          id: 'Bad-Id',
          label: 'x',
          valueType: 'text',
          source: { kind: 'question' },
          scope: 'case',
        },
      ]).success,
    ).toBe(false);
  });

  it('A13 reports invalid references with a location', () => {
    const issues = validateClause(
      'Broken',
      {
        wordings: { directors_written: [p('Intro'), p('Hello ', f('missing_field'))] },
        fields: [],
      },
      Object.values(outputs),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        message: 'This field does not exist.',
        location: `clause "Broken" › wording "Directors' written resolution" › block 2 › field "missing_field"`,
      }),
    );
  });

  it('validates repeats, per-row fields, predicates, cycles and the clause slot', () => {
    const fields: FieldDefinition[] = [
      {
        id: 'flag',
        label: 'Flag',
        valueType: 'text',
        source: { kind: 'question' },
        scope: 'clause',
      },
      {
        id: 'kind',
        label: 'Kind',
        valueType: 'choice',
        options: [{ id: 'a', label: 'A' }],
        source: { kind: 'question' },
        scope: 'clause',
      },
      {
        id: 'rows',
        label: 'Rows',
        valueType: 'number',
        source: { kind: 'question' },
        scope: 'clause',
        repeatScope: 'kind',
      },
      {
        id: 'loop_a',
        label: 'A',
        valueType: 'date',
        source: { kind: 'derived', op: 'addDays', fieldId: 'loop_b', days: 1, sourceNote: 'x' },
        scope: 'clause',
      },
      {
        id: 'loop_b',
        label: 'B',
        valueType: 'date',
        source: { kind: 'derived', op: 'addDays', fieldId: 'loop_a', days: 1, sourceNote: 'x' },
        scope: 'clause',
      },
    ];
    const issues = validateClause('Rules', {
      fields,
      wordings: {
        directors_written: [
          { type: 'condition', when: { op: 'isTrue', fieldId: 'flag' }, content: [p(f('loop_a'))] },
          {
            type: 'condition',
            when: { op: 'equals', fieldId: 'kind', value: 'zzz' },
            content: [p(f('loop_b'))],
          },
          { type: 'repeat', fieldId: 'kind', content: [p(f('rows'))] },
        ],
      },
    });
    const messages = issues.map((i) => i.message).join('\n');
    expect(messages).toMatch(/"isTrue" needs a checkbox field/);
    expect(messages).toMatch(/"zzz" is not an option/);
    expect(messages).toMatch(/A repeat needs a list-of-people field/);
    expect(messages).toMatch(/Per-row questions must belong to a list of people/);
    expect(messages).toMatch(/depends on itself/);
    const a = assembly('directors');
    expect(validateAssembly(a.name, a.version)).toEqual([]);
    expect(
      validateAssembly('No slot', {
        ...a.version,
        header: a.version.header.filter((b) => b.type !== 'clauseSlot'),
      }).map((i) => i.message),
    ).toContain('Add a clause slot where the clauses go.');
    const members = assembly('members');
    const warnings = validateAssembly(members.name, members.version);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      severity: 'warning',
      location: 'assembly "Members\' written resolution" › field "lapse_date"',
    });
  });

  it('accepts every fictional starter template', () => {
    for (const c of STARTER_CLAUSES) {
      expect(
        clauseContentSchema.safeParse({ ...c.content, source: 'x', effectiveDate: null }).success,
      ).toBe(true);
      expect(errors(validateClause(c.name, c.content, Object.values(outputs)))).toEqual([]);
    }
    for (const a of STARTER_ASSEMBLIES) {
      expect(
        assemblyContentSchema.safeParse({
          ...a.content,
          starterClauseIds: [],
          source: 'x',
          effectiveDate: null,
        }).success,
      ).toBe(true);
      expect(errors(validateAssembly(a.name, a.content))).toEqual([]);
    }
  });
});

describe('forms and answers', () => {
  it('A01 asks exactly the custom questions once, even when a tag repeats', () => {
    const custom: ClausePart = {
      key: 'c1',
      name: 'Two questions',
      version: {
        id: 'v',
        fields: [
          {
            id: 'project_name',
            label: 'Project',
            valueType: 'text',
            source: { kind: 'question' },
            scope: 'clause',
            required: true,
          },
          {
            id: 'approve_budget',
            label: 'Approve budget',
            valueType: 'boolean',
            source: { kind: 'question' },
            scope: 'clause',
          },
        ],
        wordings: {
          directors_written: [
            p('THAT ', f('project_name'), ' proceed.'),
            p('The project ', f('project_name'), ' is approved: ', f('approve_budget'), '.'),
          ],
        },
      },
    };
    const form = buildForm(caseInput('directors', [custom], {}));
    const asked = form.clauses[0].fields.filter((x) => !x.readOnly && x.active);
    expect(asked.map((x) => x.id)).toEqual(['project_name', 'approve_budget']);
    expect(form.shared.filter((x) => !x.readOnly).map((x) => x.id)).toEqual(['resolution_date']);
    expect(form.shared.find((x) => x.id === 'company_name')).toMatchObject({
      readOnly: true,
      value: 'EXAMPLE HOLDINGS SDN. BHD. (FICTIONAL)',
    });
    expect(form.shared.find((x) => x.id === 'company_name')?.sourceLabel).toMatch(/Company record/);
  });

  it('A05 keeps false, zero, empty and null distinct, and checks pools server-side', () => {
    const fields: FieldDefinition[] = [
      {
        id: 'agree',
        label: 'Agree',
        valueType: 'boolean',
        source: { kind: 'question' },
        scope: 'clause',
        required: true,
      },
      {
        id: 'confirm',
        label: 'Confirm',
        valueType: 'boolean',
        source: { kind: 'question' },
        scope: 'clause',
        validation: { mustBeChecked: true },
      },
      {
        id: 'amount',
        label: 'Amount',
        valueType: 'number',
        source: { kind: 'question' },
        scope: 'clause',
        required: true,
        format: { decimals: 2 },
        validation: { min: '0', max: '99999999999999999.99' },
      },
      {
        id: 'note',
        label: 'Note',
        valueType: 'text',
        source: { kind: 'question' },
        scope: 'clause',
        required: true,
      },
      {
        id: 'pick',
        label: 'Pick',
        valueType: 'choice',
        options: [{ id: 'opt_a', label: 'Option A' }],
        source: { kind: 'question' },
        scope: 'clause',
        required: true,
      },
      {
        id: 'who',
        label: 'Who',
        valueType: 'recordReference',
        record: { context: 'currentDirectors' },
        source: { kind: 'question' },
        scope: 'clause',
        required: true,
      },
    ];
    const part: ClausePart = {
      key: 'k',
      name: 'Typed',
      version: {
        id: 'v',
        fields,
        wordings: {
          directors_written: [
            p(f('agree'), f('confirm'), f('amount'), f('note'), f('pick'), f('who')),
          ],
        },
      },
    };
    const run = (answers: Answers) =>
      validateAnswers(
        caseInput('directors', [part], { resolution_date: '2026-10-26' }, { k: answers }),
        true,
      );
    const good = run({
      agree: false,
      confirm: true,
      amount: '0',
      note: 'x',
      pick: 'opt_a',
      who: 'sample-d1',
    });
    expect(good).toEqual([]);
    const bad = run({
      agree: null,
      confirm: false,
      amount: '1.234',
      note: '',
      pick: 'Option A',
      who: 'not-a-director',
    });
    const byField = Object.fromEntries(bad.map((i) => [i.fieldId, i.message]));
    expect(byField).toEqual({
      agree: 'Answer this question.',
      confirm: 'This box must be checked.',
      amount: 'Use at most 2 decimal places.',
      note: 'Answer this question.',
      pick: 'Choose one of the listed options.',
      who: 'Choose a person from the list offered for this company.',
    });
    expect(
      run({
        agree: true,
        confirm: true,
        amount: '1e3',
        note: 'x',
        pick: 'opt_a',
        who: 'sample-d1',
      })[0].message,
    ).toMatch(/exact number/);
    expect(
      run({
        agree: true,
        confirm: true,
        amount: '-1',
        note: 'x',
        pick: 'opt_a',
        who: 'sample-d1',
      })[0].message,
    ).toBe('Enter 0 or more.');
    const doc = text(
      caseInput(
        'directors',
        [part],
        { resolution_date: '2026-10-26' },
        {
          k: {
            agree: false,
            confirm: true,
            amount: '12345678901234567.25',
            note: 'x',
            pick: 'opt_a',
            who: 'sample-d2',
          },
        },
      ),
    );
    expect(doc).toContain('NoYes12,345,678,901,234,567.25xOption ATan Wei Ming 陈伟明 (fictional)');
  });

  it('A29 asks a shared question once, keeps clause fields separate and reports conflicts with both places', () => {
    const shared: FieldDefinition = {
      id: 'meeting_place',
      label: 'Place',
      valueType: 'text',
      source: { kind: 'question' },
      scope: 'case',
      required: true,
    };
    const year: FieldDefinition = {
      id: 'year_end',
      label: 'Year end',
      valueType: 'date',
      source: { kind: 'question' },
      scope: 'clause',
      required: true,
    };
    const mk = (
      key: string,
      name: string,
      extra: FieldDefinition[] = [shared, year],
    ): ClausePart => ({
      key,
      name,
      version: {
        id: key,
        fields: extra,
        wordings: { directors_written: [p(f('meeting_place'), ' ', f('year_end'))] },
      },
    });
    const input = caseInput(
      'directors',
      [mk('a', 'Clause A'), mk('b', 'Clause B')],
      { meeting_place: 'KL', resolution_date: '2026-10-26' },
      {
        a: { year_end: '2026-12-31' },
        b: { year_end: '2027-06-30' },
      },
    );
    const form = buildForm(input);
    expect(form.shared.filter((x) => x.id === 'meeting_place')).toHaveLength(1);
    expect(form.clauses.map((c) => c.fields.map((x) => x.id))).toEqual([
      ['year_end'],
      ['year_end'],
    ]);
    expect(text(input)).toContain('KL 31 December 2026');
    expect(text(input)).toContain('KL 30 June 2027');
    const conflicting = mk('c', 'Clause C', [{ ...shared, valueType: 'date' }, year]);
    const conflicts = sharedFieldConflicts([
      { name: 'Clause A', fields: [shared] },
      { name: 'Clause C', fields: conflicting.version.fields },
    ]);
    expect(conflicts[0].location).toBe(
      'clause "Clause A" › field "meeting_place"; clause "Clause C" › field "meeting_place"',
    );
    const compiled = compileDocument(
      caseInput('directors', [mk('a', 'Clause A'), conflicting], {}),
      'final',
    );
    expect(errors(compiled.issues).some((i) => i.message.includes('defined differently'))).toBe(
      true,
    );
  });
});

describe('compiler', () => {
  it('A06 renders the chosen variant of a conditional clause with no stray text', () => {
    const payable = compileDocument(
      caseInput(
        'members',
        [clause('fees')],
        { resolution_date: '2026-10-26' },
        { fees: feeAnswers(true) },
      ),
      'final',
    );
    expect(errors(payable.issues)).toEqual([]);
    const none = caseInput(
      'members',
      [clause('fees')],
      { resolution_date: '2026-10-26' },
      {
        fees: { fees_payable: false, fee_year_end: '2026-12-31' },
      },
    );
    const compiled = compileDocument(none, 'final');
    expect(errors(compiled.issues)).toEqual([]);
    const body = resolvedText(compiled.resolved);
    expect(body).toContain("1. Directors' fees");
    expect(body).toContain(
      "THAT no directors' fees be paid for the financial year ending 31 December 2026.",
    );
    expect(body).not.toMatch(/payable as follows|RM|Total/);
    const paragraphs = compiled.resolved.blocks.filter((b) => b.type === 'paragraph');
    expect(paragraphs.every((b) => b.type === 'paragraph' && (b.runs.length > 0 || b.number))).toBe(
      true,
    );
    const form = buildForm(none);
    expect(form.clauses[0].fields.find((x) => x.id === 'fee_directors')?.active).toBe(false);
    expect(form.clauses[0].fields.find((x) => x.id === 'fee_amount')?.active).toBe(false);
  });

  it('requires a conditional per-person answer only for rows that reach it', () => {
    const fields: FieldDefinition[] = [
      {
        id: 'directors',
        label: 'Directors',
        valueType: 'recordList',
        source: { kind: 'question' },
        scope: 'clause',
        required: true,
        record: { context: 'currentDirectors' },
      },
      {
        id: 'payable',
        label: 'Payable',
        valueType: 'boolean',
        source: { kind: 'question' },
        scope: 'clause',
        required: true,
        repeatScope: 'directors',
      },
      {
        id: 'fee',
        label: 'Fee',
        valueType: 'number',
        source: { kind: 'question' },
        scope: 'clause',
        required: true,
        repeatScope: 'directors',
      },
    ];
    const rowClause: ClausePart = {
      key: 'rows',
      name: 'Conditional fees',
      version: {
        id: 'rows-v1',
        fields,
        wordings: {
          directors_written: [
            {
              type: 'repeat',
              fieldId: 'directors',
              content: [
                {
                  type: 'condition',
                  when: { op: 'isTrue', fieldId: 'payable' },
                  content: [p(f('fee'))],
                },
              ],
            },
          ],
        },
      },
    };
    expect(errors(validateClause(rowClause.name, rowClause.version))).toEqual([]);
    const input = caseInput(
      'directors',
      [rowClause],
      { resolution_date: '2026-10-26' },
      {
        rows: {
          directors: ['sample-d1', 'sample-d2'],
          payable: { 'sample-d1': true, 'sample-d2': false },
          fee: { 'sample-d1': '100' },
        },
      },
    );
    expect(errors(compileDocument(input, 'final').issues)).toEqual([]);
    expect(buildForm(input).clauses[0].fields.find((f) => f.id === 'fee')?.activeItemIds).toEqual([
      'sample-d1',
    ]);
    input.answers.clauses.rows.fee = {};
    expect(
      errors(compileDocument(input, 'final').issues)
        .filter((i) => i.fieldId === 'fee')
        .map((i) => i.itemId),
    ).toEqual(['sample-d1']);
  });

  it('totals a per-director fee table exactly and keeps item scope', () => {
    const compiled = compileDocument(
      caseInput(
        'members',
        [clause('fees')],
        { resolution_date: '2026-10-26' },
        { fees: feeAnswers(true) },
      ),
      'final',
    );
    const table = compiled.resolved.blocks.find((b) => b.type === 'table') as Extract<
      ResolvedBlock,
      { type: 'table' }
    >;
    const cells = table.rows.map((r) =>
      r.cells.map((c) => resolvedText({ ...compiled.resolved, blocks: c })),
    );
    expect(cells).toEqual([
      ['Director', 'Fee'],
      ['Nur Aisyah binti Abdullah Rahman (fictional)', 'RM 1,000.10'],
      ['Tan Wei Ming 陈伟明 (fictional)', 'RM 2,000.25'],
      ['Total', 'RM 3,000.35'],
    ]);
    expect(compiled.values['fees.fee_total']).toBe('RM 3,000.35');
    const missing = compileDocument(
      caseInput(
        'members',
        [clause('fees')],
        { resolution_date: '2026-10-26' },
        {
          fees: { ...feeAnswers(true), fee_amount: { 'sample-d1': '1000.10' } },
        },
      ),
      'final',
    );
    expect(errors(missing.issues)).toContainEqual(
      expect.objectContaining({
        itemId: 'sample-d2',
        location: `clause "Directors' fees" › field "Fee" › row "Tan Wei Ming 陈伟明 (fictional)"`,
      }),
    );
    const guessed = validateAnswers(
      caseInput(
        'members',
        [clause('fees')],
        {},
        { fees: { ...feeAnswers(true), fee_amount: { intruder: '5' } } },
      ),
      true,
    );
    expect(guessed.some((i) => i.itemId === 'intruder')).toBe(true);
  });

  it('recomputes a date offset and labels it a sample without a source', () => {
    const at = (date: string) =>
      compileDocument(
        caseInput(
          'members',
          [clause('auditors')],
          { resolution_date: date },
          {
            auditors: { auditor_firm: 'Example & Co (fictional)', audit_year_end: '2026-12-31' },
          },
        ),
        'final',
      );
    const first = at('2026-10-26');
    expect(first.values.lapse_date).toBe('23 November 2026');
    expect(first.resolved.containsSamples).toBe(true);
    expect(at('2026-11-05').values.lapse_date).toBe('3 December 2026');
  });

  it('A07 produces one signature per selected signer in each role order', () => {
    const signers = {
      directors: ['sample-d3', 'sample-d1', 'sample-d2'],
      members: ['sample-m2', 'sample-m1'],
      certifiers: [],
    };
    const directors = compileDocument(
      caseInput(
        'directors',
        [clause('general')],
        { resolution_date: '2026-10-26' },
        {
          general: { business_title: 'Bank', business_text: 'Open account' },
        },
        signers,
      ),
      'final',
    );
    const block = directors.resolved.blocks.find((b) => b.type === 'signatures') as Extract<
      ResolvedBlock,
      { type: 'signatures' }
    >;
    expect(block.signers.map((s) => s.name)).toEqual([
      'Ravichandran a/l Subramaniam Pillai (fictional)',
      'Nur Aisyah binti Abdullah Rahman (fictional)',
      'Tan Wei Ming 陈伟明 (fictional)',
    ]);
    expect(block.signers[0].label).toBe(
      'Ravichandran a/l Subramaniam Pillai (fictional)\nDirector',
    );
    expect(block.columns).toBe(2);
    const members = compileDocument(
      caseInput(
        'members',
        [clause('general')],
        { resolution_date: '2026-10-26' },
        {
          general: { business_title: 'Bank', business_text: 'Open account' },
        },
        signers,
      ),
      'final',
    );
    const memberBlock = members.resolved.blocks.find((b) => b.type === 'signatures') as Extract<
      ResolvedBlock,
      { type: 'signatures' }
    >;
    expect(memberBlock.signers.map((s) => s.name)).toEqual([
      'Zoë Lefèvre-Østergaard (fictional)',
      'Example Holdings Nominees Sdn. Bhd. (fictional)',
    ]);
    const none = compileDocument(
      caseInput(
        'directors',
        [clause('general')],
        { resolution_date: '2026-10-26' },
        {
          general: { business_title: 'Bank', business_text: 'Open account' },
        },
        { directors: [], members: [], certifiers: [] },
      ),
      'final',
    );
    expect(errors(none.issues).map((i) => i.location)).toContain('signers › Directors signing');
  });

  it('A27 numbers clauses from two categories in case order; reordering renumbers', () => {
    const answers = {
      auditors: { auditor_firm: 'Example & Co (fictional)', audit_year_end: '2026-12-31' },
      authority: { authorised_director: 'sample-d1', documents_to_sign: 'the bank forms' },
      general: { business_title: 'Bank account', business_text: 'Open an account.' },
    };
    const ordered = [clause('auditors'), clause('authority'), clause('general')];
    const first = text(caseInput('directors', ordered, { resolution_date: '2026-10-26' }, answers));
    expect(first.indexOf('1. Appointment of auditors')).toBeGreaterThan(0);
    expect(first.indexOf('2. Authority to sign documents')).toBeGreaterThan(
      first.indexOf('1. Appointment'),
    );
    expect(first).toContain('3. Bank account');
    const second = text(
      caseInput(
        'directors',
        [ordered[2], ordered[0], ordered[1]],
        { resolution_date: '2026-10-26' },
        answers,
      ),
    );
    expect(second).toContain('1. Bank account');
    expect(second).toContain('2. Appointment of auditors');
  });

  it('A28 switches wording and header with the output type', () => {
    const answers = {
      auditors: { auditor_firm: 'Example & Co (fictional)', audit_year_end: '2026-12-31' },
    };
    const directors = text(
      caseInput('directors', [clause('auditors')], { resolution_date: '2026-10-26' }, answers),
    );
    const members = text(
      caseInput('members', [clause('auditors')], { resolution_date: '2026-10-26' }, answers),
    );
    expect(directors).toContain("DIRECTORS' WRITTEN RESOLUTION");
    expect(directors).toContain('Clause 99 of the Constitution');
    expect(directors).toContain('be recommended to the members');
    expect(members).toContain("MEMBERS' WRITTEN RESOLUTION");
    expect(members).toContain('Clause 98 of the Constitution');
    expect(members).toContain('authorised to fix their remuneration');
    const resignation = compileDocument(
      caseInput('members', [clause('resignation')], { resolution_date: '2026-10-26' }),
      'final',
    );
    expect(resignation.issues.map((i) => i.message)).toContain(
      "This clause has no wording for Members' written resolution.",
    );
  });

  it('shows labelled placeholders in preview and errors in final mode', () => {
    const input = caseInput('directors', [clause('appointment')], {});
    const preview = compileDocument(input, 'preview');
    expect(preview.placeholders).toBe(true);
    expect(resolvedText(preview.resolved)).toContain('[Proposed director name]');
    expect(errors(preview.issues)).toEqual([]);
    const final = compileDocument(input, 'final');
    expect(errors(final.issues).map((i) => i.location)).toEqual(
      expect.arrayContaining([
        'shared questions › field "Resolution date"',
        'clause "Appointment of director" › field "Proposed director"',
      ]),
    );
  });
});

describe('DOCX renderer', () => {
  it('A22 writes a valid package with text, numbering, tables, page break, header and page fields', async () => {
    const hostile: ClausePart = {
      key: 'hostile',
      name: 'Hostile',
      version: {
        id: 'h',
        fields: [],
        wordings: {
          members_written: [
            p('<script>alert(1)</script> & https://evil.example/'),
            { type: 'list', ordered: true, items: [[p('First')], [p('Second')]] } as BlockNode,
          ],
        },
      },
    };
    const compiled = compileDocument(
      caseInput(
        'members',
        [clause('fees'), clause('auditors'), hostile],
        { resolution_date: '2026-10-26' },
        {
          fees: feeAnswers(true),
          auditors: { auditor_firm: 'Example & Co (fictional)', audit_year_end: '2026-12-31' },
        },
      ),
      'final',
    );
    expect(errors(compiled.issues)).toEqual([]);
    const bytes = await renderDocx(compiled.resolved);
    const zip = readZip(bytes);
    const xml = zip.get('word/document.xml')!.toString('utf8');
    for (const expected of [
      'MEMBERS&apos; WRITTEN RESOLUTION',
      'Clause 98 of the Constitution (fictional citation)',
      'RM 3,000.35',
      'Tan Wei Ming 陈伟明 (fictional)',
      'Zoë Lefèvre-Østergaard (fictional)',
      '&lt;script&gt;alert(1)&lt;/script&gt; &amp; https://evil.example/',
    ])
      expect(xml.replace(/&#39;|'/g, '&apos;')).toContain(expected);
    expect(xml).toMatch(/<w:t[^>]*>1\.<\/w:t>/);
    expect(xml).toMatch(/<w:t[^>]*>3\.<\/w:t>/);
    expect(xml).toContain('<w:br w:type="page"/>');
    expect(xml).toContain('<w:tblHeader');
    expect(xml).toContain('<w:keepNext');
    expect(xml).not.toContain('<w:hyperlink');
    expect(zip.get('word/numbering.xml')!.toString('utf8')).toContain('w:numFmt w:val="decimal"');
    const footer = [...zip.keys()]
      .filter((k) => k.startsWith('word/footer'))
      .map((k) => zip.get(k)!.toString('utf8'))
      .join('');
    expect(footer).toMatch(/PAGE/);
    expect(footer).toMatch(/NUMPAGES/);
    const header = [...zip.keys()]
      .filter((k) => k.startsWith('word/header'))
      .map((k) => zip.get(k)!.toString('utf8'))
      .join('');
    expect(header).toContain('EXAMPLE HOLDINGS SDN. BHD. (FICTIONAL)');
    expect(xml).toContain('w:pgSz w:w="11906" w:h="16838"');
  });

  it('rejects a render that exceeds its time limit', async () => {
    const compiled = compileDocument(caseInput('directors', [clause('general')], {}), 'preview');
    await expect(renderDocx(compiled.resolved, 0)).rejects.toThrow(/too long/);
  });
});

describe('output bounds and hostile identifiers', () => {
  it('stops compiling with a DomainError once the inline-run budget is spent', () => {
    const many: BlockNode[] = [
      {
        type: 'paragraph',
        content: Array.from({ length: MAX_RUNS + 1 }, () => ({ type: 'text' as const, text: 'x' })),
      },
    ];
    const big: ClausePart = {
      key: 'big',
      name: 'Big',
      version: { id: 'v-big', fields: [], wordings: { directors_written: many } },
    };
    let failure: unknown;
    try {
      compileDocument(caseInput('directors', [big], { resolution_date: '2026-10-26' }), 'preview');
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(DomainError);
    expect(failure).toMatchObject({ code: 'TOO_LARGE' });
  });

  it('replaces signature tokens in one pass so a name cannot inject another token', () => {
    const tricky = structuredClone(ctx);
    tricky.directors[0] = { ...tricky.directors[0], name: 'Ali {capacity} (fictional)' };
    const input = caseInput(
      'directors',
      [clause('general')],
      { resolution_date: '2026-10-26' },
      { general: { business_title: 'Bank', business_text: 'Open account' } },
      { directors: [tricky.directors[0].id], members: [], certifiers: [] },
    );
    input.ctx = tricky;
    input.assembly.version.signature = {
      ...input.assembly.version.signature,
      label: '{name} / {capacity}',
    };
    const block = compileDocument(input, 'preview').resolved.blocks.find(
      (b) => b.type === 'signatures',
    ) as Extract<ResolvedBlock, { type: 'signatures' }>;
    expect(block.signers[0].label).toBe(
      `Ali {capacity} (fictional) / ${tricky.directors[0].capacity}`,
    );
  });

  it('never indexes inherited properties as wordings and reserves prototype names', () => {
    expect(OUTPUT_TYPE_ID.test('constructor')).toBe(false);
    expect(OUTPUT_TYPE_ID.test('tostring')).toBe(false);
    expect(OUTPUT_TYPE_ID.test('directors_written')).toBe(true);
    expect(wordingFor({}, 'constructor')).toBeUndefined();
    expect(
      clauseContentSchema.safeParse({
        source: 'x',
        effectiveDate: null,
        fields: [],
        wordings: { constructor: [] },
      }).success,
    ).toBe(false);
  });

  it('bounds calendar dates to the years 1900 to 9999', () => {
    expect(dateString.safeParse('1899-12-31').success).toBe(false);
    expect(dateString.safeParse('0001-01-01').success).toBe(false);
    expect(dateString.safeParse('1900-01-01').success).toBe(true);
    expect(dateString.safeParse('9999-12-31').success).toBe(true);
    expect(dateString.safeParse('2026-02-29').success).toBe(false);
  });
});

describe('review fixes: bounded walks, clause depth and shared fields', () => {
  const people: FieldDefinition = {
    id: 'people',
    label: 'People',
    valueType: 'recordList',
    source: { kind: 'question' },
    scope: 'clause',
    required: true,
    record: { context: 'currentDirectors' },
  };
  const nest = (levels: number, inner: BlockNode): BlockNode =>
    levels ? { type: 'repeat', fieldId: 'people', content: [nest(levels - 1, inner)] } : inner;
  const wide = structuredClone(ctx);
  wide.directors = Array.from({ length: 50 }, (_, i) => ({
    ...ctx.directors[0],
    id: `wide-${i}`,
    name: `Director ${i} (fictional)`,
  }));

  it('stops nested repeats with TOO_LARGE before walking every combination', () => {
    const deep: ClausePart = {
      key: 'deep',
      name: 'Deep',
      version: {
        id: 'v-deep',
        fields: [people],
        wordings: { directors_written: [nest(6, p(f('people', 'name')))] },
      },
    };
    const input = {
      ...caseInput(
        'directors',
        [deep],
        { resolution_date: '2026-10-26' },
        { deep: { people: wide.directors.map((d) => d.id) } },
      ),
      ctx: wide,
    };
    const started = Date.now();
    expect(() => buildForm(input)).toThrow(expect.objectContaining({ code: 'TOO_LARGE' }));
    expect(() => compileDocument(input, 'preview')).toThrow(
      expect.objectContaining({ code: 'TOO_LARGE' }),
    );
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('keeps deeply nested clause wording when the slot itself is nested', () => {
    const nestCondition = (levels: number, inner: BlockNode): BlockNode =>
      levels
        ? {
            type: 'condition',
            when: { op: 'isNotEmpty', fieldId: 'resolution_date' },
            content: [nestCondition(levels - 1, inner)],
          }
        : inner;
    const a = assembly('directors');
    a.version.header = [nestCondition(10, { type: 'clauseSlot', numbering: 'none' })];
    const deepText: ClausePart = {
      key: 'deep',
      name: 'Deep text',
      version: {
        id: 'v-deep-text',
        fields: [],
        wordings: {
          directors_written: [
            {
              type: 'list',
              ordered: false,
              items: [[nestCondition(9, p('Deep wording survives'))]],
            },
          ],
        },
      },
    };
    const input = {
      ...caseInput('directors', [deepText], { resolution_date: '2026-10-26' }),
      assembly: a,
    };
    const compiled = compileDocument(input, 'preview');
    expect(resolvedText(compiled.resolved)).toContain('Deep wording survives');
  });

  it('reports shared fields whose source or answer rules differ', () => {
    const date = (path: string): FieldDefinition => ({
      id: 'key_date',
      label: 'Key date',
      valueType: 'date',
      source: { kind: 'binding', path } as FieldDefinition['source'],
      scope: 'case',
      required: true,
    });
    expect(
      sharedFieldConflicts([
        { name: 'A', fields: [date('case.resolutionDate')] },
        { name: 'B', fields: [date('case.effectiveDate')] },
      ]),
    ).toHaveLength(1);
    const asked: FieldDefinition = { ...date('x'), source: { kind: 'question' } };
    expect(
      sharedFieldConflicts([
        { name: 'A', fields: [asked] },
        { name: 'B', fields: [{ ...asked, required: false }] },
      ]),
    ).toHaveLength(1);
  });

  it('rejects a shared calculation over one clause’s own field', () => {
    const issues = validateClause('Fees', {
      fields: [
        people,
        {
          id: 'shared_count',
          label: 'Count',
          valueType: 'number',
          source: { kind: 'derived', op: 'count', fieldId: 'people' },
          scope: 'case',
          required: true,
        },
      ],
      wordings: { directors_written: [p(f('shared_count'))] },
    });
    expect(issues.some((i) => i.message.includes('cannot depend on'))).toBe(true);
  });
});

describe('calendar dates', () => {
  it('returns false for well-shaped but impossible dates instead of throwing', async () => {
    const { isCalendarDate } = await import('../src/domain/resolution/records');
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-02-28')).toBe(true);
  });
});
