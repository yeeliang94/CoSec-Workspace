import { z } from 'zod';
import type {
  AnswerValue,
  BlockNode,
  FieldDefinition,
  InlineNode,
  PageLayout,
  Predicate,
  SignatureSettings,
} from './model';

/** Contract limits (docs/RESOLUTION_CONTRACTS.md). */
export const LIMITS = {
  nodes: 2000,
  depth: 12,
  fields: 100,
  textLength: 10_000,
  clauses: 40,
  repeatItems: 50,
  outputBytes: 5 * 1024 * 1024,
  renderMs: 15_000,
  options: 100,
  labelLength: 200,
} as const;

export const FIELD_ID = /^[a-z][a-z0-9_]{1,63}$/;
export const OPTION_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** Object.prototype member names are reserved so an id can never index an inherited property. */
export const OUTPUT_TYPE_ID =
  /^(?!(?:constructor|prototype|__proto__|__definegetter__|__definesetter__|__lookupgetter__|__lookupsetter__|hasownproperty|isprototypeof|propertyisenumerable|tolocalestring|tostring|valueof)$)[a-z][a-z0-9_]{1,63}$/;
/** The wording of a clause for one output type; never an inherited property. */
export const wordingFor = (wordings: Record<string, BlockNode[]>, outputTypeId: string) =>
  Object.hasOwn(wordings, outputTypeId) ? wordings[outputTypeId] : undefined;
// Characters Word cannot store (XML 1.0) or that hide text direction tricks.
const UNSAFE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F￾￿‪-‮⁦-⁩]/;
export const DECIMAL = /^-?\d{1,18}(\.\d{1,8})?$/;

const safeText = (max: number, multiline = false) =>
  z
    .string()
    .max(max)
    .refine((v) => !UNSAFE.test(v) && (multiline || !/[\r\n]/.test(v)), {
      message: 'Remove control characters.',
    })
    .refine((v) => v.isWellFormed(), { message: 'Text contains invalid characters.' });
export const plainText = safeText;
export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number(v.slice(0, 4)) >= 1900 &&
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    'Enter a valid calendar date between 1900 and 9999.',
  );
const fieldId = z.string().regex(FIELD_ID, 'Field ids use lower-case letters, digits and _.');
const align = z.enum(['left', 'center', 'right', 'justify']).optional();
const recordProperty = z.enum(['name', 'capacity', 'appointedOn', 'ceasedOn']);

export const inlineSchema: z.ZodType<InlineNode> = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('text'),
    text: safeText(LIMITS.textLength).min(1),
    marks: z
      .array(z.enum(['bold', 'italic', 'underline']))
      .max(3)
      .optional(),
  }),
  z.strictObject({ type: z.literal('field'), fieldId, property: recordProperty.optional() }),
  z.strictObject({ type: z.literal('hardBreak') }),
]);

export const predicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.union([
    z.strictObject({ op: z.enum(['isTrue', 'isFalse', 'isEmpty', 'isNotEmpty']), fieldId }),
    z.strictObject({
      op: z.enum(['equals', 'notEquals', 'includes']),
      fieldId,
      value: safeText(LIMITS.labelLength),
    }),
    z.strictObject({ op: z.enum(['and', 'or']), all: z.array(predicateSchema).min(1).max(20) }),
  ]),
);

function blockSchema(assembly: boolean): z.ZodType<BlockNode> {
  const self: z.ZodType<BlockNode> = z.lazy(() => {
    const blocks = z.array(self).max(LIMITS.nodes);
    const common = [
      z.strictObject({
        type: z.literal('paragraph'),
        align,
        indent: z.number().int().min(0).max(4).optional(),
        content: z.array(inlineSchema).max(LIMITS.nodes),
      }),
      z.strictObject({
        type: z.literal('heading'),
        level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        align,
        content: z.array(inlineSchema).max(LIMITS.nodes),
      }),
      z.strictObject({
        type: z.literal('list'),
        ordered: z.boolean(),
        items: z.array(blocks).min(1).max(200),
      }),
      z.strictObject({
        type: z.literal('table'),
        columnWidths: z.array(z.number().int().min(1).max(100)).min(1).max(8).optional(),
        rows: z
          .array(
            z.strictObject({
              header: z.boolean().optional(),
              cells: z.array(blocks).min(1).max(8),
            }),
          )
          .min(1)
          .max(200),
      }),
      z.strictObject({ type: z.literal('condition'), when: predicateSchema, content: blocks }),
      z.strictObject({
        type: z.literal('repeat'),
        fieldId,
        content: blocks,
        emptyText: safeText(1000).optional(),
      }),
      // An explicit page break is allowed in clauses too; page settings live on assemblies.
      z.strictObject({ type: z.literal('pageBreak') }),
    ] as const;
    if (!assembly) return z.discriminatedUnion('type', [...common]);
    return z.discriminatedUnion('type', [
      ...common,
      z.strictObject({
        type: z.literal('clauseSlot'),
        numbering: z.enum(['none', 'decimal']),
      }),
      z.strictObject({
        type: z.literal('signatureBlock'),
        role: z.enum(['directors', 'members', 'certifiers']),
        heading: safeText(LIMITS.labelLength).optional(),
      }),
    ]);
  });
  return self;
}
const clauseBlock = blockSchema(false);
const assemblyBlock = blockSchema(true);

/**
 * Cheap iterative pre-check on untrusted JSON so that deep or huge input cannot exhaust the
 * recursive validator. Counts objects and nesting before the typed parse.
 */
export function boundedJson(value: unknown, maxObjects = LIMITS.nodes * 4, maxDepth = 64) {
  const stack: [unknown, number][] = [[value, 0]];
  let objects = 0;
  while (stack.length) {
    const [item, depth] = stack.pop()!;
    if (item === null || typeof item !== 'object') continue;
    if (depth > maxDepth) return 'The content is nested too deeply.';
    if (++objects > maxObjects) return 'The content has too many elements.';
    for (const child of Object.values(item)) stack.push([child, depth + 1]);
  }
  return null;
}

/** Node count and block depth of a parsed fragment. */
export function measureBlocks(blocks: BlockNode[]) {
  let nodes = 0;
  let depth = 0;
  const visit = (list: BlockNode[], level: number) => {
    depth = Math.max(depth, level);
    for (const block of list) {
      nodes++;
      if (block.type === 'paragraph' || block.type === 'heading') nodes += block.content.length;
      if (block.type === 'list') block.items.forEach((item) => visit(item, level + 1));
      if (block.type === 'table')
        block.rows.forEach((row) => row.cells.forEach((cell) => visit(cell, level + 1)));
      if (block.type === 'condition' || block.type === 'repeat') visit(block.content, level + 1);
    }
  };
  visit(blocks, 1);
  return { nodes, depth };
}

function fragment(assembly: boolean) {
  const schema = z.array(assembly ? assemblyBlock : clauseBlock).max(LIMITS.nodes);
  return z
    .unknown()
    .superRefine((value, ctx) => {
      const problem = boundedJson(value);
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    })
    .pipe(schema)
    .superRefine((blocks, ctx) => {
      const { nodes, depth } = measureBlocks(blocks);
      if (nodes > LIMITS.nodes)
        ctx.addIssue({
          code: 'custom',
          message: `Keep each wording under ${LIMITS.nodes} elements.`,
        });
      if (depth > LIMITS.depth)
        ctx.addIssue({
          code: 'custom',
          message: `Nest content at most ${LIMITS.depth} levels deep.`,
        });
    });
}
export const clauseFragmentSchema = fragment(false) as unknown as z.ZodType<BlockNode[]>;
export const assemblyFragmentSchema = fragment(true) as unknown as z.ZodType<BlockNode[]>;

const answerValue: z.ZodType<AnswerValue> = z.union([
  safeText(LIMITS.textLength, true),
  z.boolean(),
  z.array(safeText(200)).max(LIMITS.repeatItems * 2),
  z.null(),
]);
export const answerValueSchema = answerValue;
const decimal = z.string().regex(DECIMAL, 'Enter an exact decimal number.');

const sourceSchema = z.union([
  z.strictObject({ kind: z.literal('binding'), path: z.string().min(1).max(160) }),
  z.strictObject({ kind: z.literal('question') }),
  z.strictObject({ kind: z.literal('constant'), value: safeText(LIMITS.textLength, true) }),
  z.strictObject({
    kind: z.literal('derived'),
    op: z.literal('addDays'),
    fieldId,
    days: z.number().int().min(-3660).max(3660),
    sourceNote: safeText(500),
  }),
  z.strictObject({ kind: z.literal('derived'), op: z.enum(['sum', 'count']), fieldId }),
  z.strictObject({
    kind: z.literal('derived'),
    op: z.literal('join'),
    fieldId,
    property: recordProperty,
  }),
]);

export const fieldSchema: z.ZodType<FieldDefinition> = z.strictObject({
  id: fieldId,
  label: safeText(LIMITS.labelLength).trim().min(1),
  help: safeText(1000).optional(),
  valueType: z.enum([
    'text',
    'multiline',
    'date',
    'number',
    'boolean',
    'choice',
    'multiChoice',
    'recordReference',
    'recordList',
  ]),
  source: sourceSchema,
  scope: z.enum(['case', 'clause']),
  required: z.boolean().optional(),
  options: z
    .array(
      z.strictObject({
        id: z.string().regex(OPTION_ID),
        label: safeText(LIMITS.labelLength).min(1),
      }),
    )
    .max(LIMITS.options)
    .optional(),
  record: z
    .strictObject({
      context: z.enum(['currentDirectors', 'currentMembers', 'companyPeople', 'proposedPerson']),
    })
    .optional(),
  repeatScope: fieldId.optional(),
  format: z
    .strictObject({
      date: z.enum(['long', 'iso']).optional(),
      decimals: z.number().int().min(0).max(8).optional(),
      prefix: safeText(20).optional(),
      case: z.enum(['upper', 'none']).optional(),
    })
    .optional(),
  defaultValue: answerValue.optional(),
  validation: z
    .strictObject({
      min: decimal.or(dateString).optional(),
      max: decimal.or(dateString).optional(),
      maxLength: z.number().int().min(1).max(LIMITS.textLength).optional(),
      mustBeChecked: z.boolean().optional(),
    })
    .optional(),
});
export const fieldsSchema = z.array(fieldSchema).max(LIMITS.fields);

export const pageLayoutSchema: z.ZodType<PageLayout> = z.strictObject({
  pageSize: z.enum(['A4', 'Letter']),
  marginsMm: z.strictObject({
    top: z.number().min(5).max(60),
    right: z.number().min(5).max(60),
    bottom: z.number().min(5).max(60),
    left: z.number().min(5).max(60),
  }),
  fontFamily: z.enum(['Arial', 'Times New Roman', 'Calibri']),
  fontSizePt: z.number().min(8).max(16),
  header: z.array(inlineSchema).max(50),
  footer: z.array(inlineSchema).max(50),
  pageNumbers: z.boolean(),
});
export const signatureSettingsSchema: z.ZodType<SignatureSettings> = z.strictObject({
  columns: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  showDate: z.boolean(),
  label: safeText(LIMITS.labelLength, true),
});

const meta = {
  source: safeText(2000),
  effectiveDate: dateString.nullable(),
};
export const clauseContentSchema = z.strictObject({
  wordings: z
    .record(z.string().regex(OUTPUT_TYPE_ID), clauseFragmentSchema)
    .refine((w) => Object.keys(w).length <= 12, 'Too many wordings.'),
  fields: fieldsSchema,
  ...meta,
});
export const assemblyContentSchema = z.strictObject({
  header: assemblyFragmentSchema,
  closing: assemblyFragmentSchema,
  signature: signatureSettingsSchema,
  starterClauseIds: z.array(z.string().min(1).max(36)).max(LIMITS.clauses),
  fields: fieldsSchema,
  layout: pageLayoutSchema,
  ...meta,
});
export type ClauseContent = z.infer<typeof clauseContentSchema>;
export type AssemblyContent = z.infer<typeof assemblyContentSchema>;

export const defaultLayout: PageLayout = {
  pageSize: 'A4',
  marginsMm: { top: 25, right: 25, bottom: 25, left: 25 },
  fontFamily: 'Arial',
  fontSizePt: 11,
  header: [],
  footer: [],
  pageNumbers: true,
};
export const defaultSignature: SignatureSettings = {
  columns: 2,
  showDate: false,
  label: '{name}',
};
