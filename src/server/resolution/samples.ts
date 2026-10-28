/**
 * Fictional sample values and fictional starter wording.
 *
 * Fictional sample wording — not approved legal precedent. No section numbers, time limits or
 * statements here come from an approved source; they exist to exercise the clause/assembly
 * engine until the firm supplies reviewed wording.
 */
import type {
  AnswerValue,
  Answers,
  AssemblyVersion,
  BlockNode,
  ClauseCategory,
  ClauseVersion,
  FieldDefinition,
  InlineNode,
  Mark,
  PersonSnapshot,
  Predicate,
  ResolutionContext,
  SignerSelection,
  UsageContext,
} from '../../domain/resolution/model';
import { defaultLayout } from '../../domain/resolution/schema';

export const SAMPLE_SOURCE = 'Fictional sample wording — not approved legal precedent';
export const SAMPLE_BANNER = 'SAMPLE — fictional values';

// ---------------------------------------------------------------- tiny builders
export const t = (text: string, ...marks: Mark[]): InlineNode =>
  marks.length ? { type: 'text', text, marks } : { type: 'text', text };
export const f = (
  fieldId: string,
  property?: 'name' | 'capacity' | 'appointedOn' | 'ceasedOn',
): InlineNode => (property ? { type: 'field', fieldId, property } : { type: 'field', fieldId });
const inline = (parts: (string | InlineNode)[]) =>
  parts.map((x) => (typeof x === 'string' ? t(x) : x));
export const p = (...parts: (string | InlineNode)[]): BlockNode => ({
  type: 'paragraph',
  content: inline(parts),
});
export const pc = (...parts: (string | InlineNode)[]): BlockNode => ({
  type: 'paragraph',
  align: 'center',
  content: inline(parts),
});
export const h = (level: 1 | 2 | 3, text: string, align?: 'center'): BlockNode => ({
  type: 'heading',
  level,
  ...(align ? { align } : {}),
  content: [t(text)],
});
export const when = (predicate: Predicate, ...content: BlockNode[]): BlockNode => ({
  type: 'condition',
  when: predicate,
  content,
});
export const repeat = (fieldId: string, ...content: BlockNode[]): BlockNode => ({
  type: 'repeat',
  fieldId,
  content,
});
const question = (
  id: string,
  label: string,
  valueType: FieldDefinition['valueType'],
  extra: Partial<FieldDefinition> = {},
): FieldDefinition => ({
  id,
  label,
  valueType,
  source: { kind: 'question' },
  scope: 'clause',
  required: true,
  ...extra,
});
const bound = (
  id: string,
  label: string,
  path: string,
  extra: Partial<FieldDefinition> = {},
): FieldDefinition => ({
  id,
  label,
  valueType: 'text',
  source: { kind: 'binding', path },
  scope: 'clause',
  required: true,
  ...extra,
});
const resolutionDate = question('resolution_date', 'Resolution date', 'date', {
  scope: 'case',
  format: { date: 'long' },
});

// ---------------------------------------------------------------- starter clauses
export type StarterClause = {
  key: string;
  name: string;
  category: ClauseCategory;
  usageContexts: UsageContext[];
  displayOrder: number;
  description: string;
  content: Pick<ClauseVersion, 'wordings' | 'fields'>;
};
export const STARTER_CLAUSES: StarterClause[] = [
  {
    key: 'appointment',
    name: 'Appointment of director',
    category: 'Director',
    usageContexts: ['board', 'director_appointment'],
    displayOrder: 10,
    description: 'Appoints one proposed director from a date. Fictional sample wording.',
    content: {
      fields: [
        question('appointee', 'Proposed director', 'recordReference', {
          record: { context: 'proposedPerson' },
        }),
        bound('appointee_name', 'Proposed director name', 'selection.appointee.name'),
        question('appointment_date', 'Appointment date', 'date', { format: { date: 'long' } }),
      ],
      wordings: {
        directors_written: [
          p(t('Appointment of director', 'bold')),
          p(
            'THAT ',
            f('appointee_name'),
            ', having consented to act, be and is hereby appointed as a director of the Company with effect from ',
            f('appointment_date'),
            '.',
          ),
        ],
        members_written: [
          p(t('Appointment of director', 'bold')),
          p(
            'THAT ',
            f('appointee_name'),
            ' be appointed as a director of the Company with effect from ',
            f('appointment_date'),
            '.',
          ),
        ],
      },
    },
  },
  {
    key: 'resignation',
    name: 'Resignation of director',
    category: 'Director',
    usageContexts: ['board', 'director_resignation'],
    displayOrder: 20,
    description: 'Notes a director’s written resignation. Fictional sample wording.',
    content: {
      fields: [
        question('resigning_director', 'Resigning director', 'recordReference', {
          record: { context: 'currentDirectors' },
        }),
        bound('resigning_name', 'Resigning director name', 'selection.resigning_director.name'),
        question('resignation_date', 'Resignation effective date', 'date', {
          format: { date: 'long' },
        }),
      ],
      wordings: {
        directors_written: [
          p(t('Resignation of director', 'bold')),
          p(
            'THAT the written notice of resignation of ',
            f('resigning_name'),
            ' as a director of the Company, effective ',
            f('resignation_date'),
            ', be received and noted, and that the Company Secretary be instructed to update the records of the Company accordingly.',
          ),
        ],
      },
    },
  },
  {
    key: 'auditors',
    name: 'Appointment of auditors',
    category: 'Auditor',
    usageContexts: ['board'],
    displayOrder: 10,
    description: 'Appoints or recommends auditors for a financial year. Fictional sample wording.',
    content: {
      fields: [
        question('auditor_firm', 'Audit firm', 'text'),
        question('audit_year_end', 'Financial year ending', 'date', { format: { date: 'long' } }),
      ],
      wordings: {
        directors_written: [
          p(t('Appointment of auditors', 'bold')),
          p(
            'THAT ',
            f('auditor_firm'),
            ' be recommended to the members for appointment as auditors of the Company for the financial year ending ',
            f('audit_year_end'),
            '.',
          ),
        ],
        members_written: [
          p(t('Appointment of auditors', 'bold')),
          p(
            'THAT ',
            f('auditor_firm'),
            ' be appointed as auditors of the Company for the financial year ending ',
            f('audit_year_end'),
            ' and that the directors be authorised to fix their remuneration.',
          ),
        ],
      },
    },
  },
  {
    key: 'fees',
    name: "Directors' fees",
    category: 'Members',
    usageContexts: ['board'],
    displayOrder: 20,
    description:
      'Approves a fee per director, or records that no fees are payable. Fictional sample wording.',
    content: {
      fields: [
        question('fees_payable', "Directors' fees are payable for the year", 'boolean'),
        question('fee_year_end', 'Financial year ending', 'date', { format: { date: 'long' } }),
        question('fee_directors', 'Directors receiving fees', 'recordList', {
          record: { context: 'currentDirectors' },
        }),
        question('fee_amount', 'Fee', 'number', {
          repeatScope: 'fee_directors',
          format: { decimals: 2, prefix: 'RM ' },
          validation: { min: '0' },
        }),
        {
          id: 'fee_total',
          label: 'Total fees',
          valueType: 'number',
          source: { kind: 'derived', op: 'sum', fieldId: 'fee_amount' },
          scope: 'clause',
          required: true,
          format: { decimals: 2, prefix: 'RM ' },
        },
      ],
      wordings: {
        members_written: [
          p(t("Directors' fees", 'bold')),
          when(
            { op: 'isTrue', fieldId: 'fees_payable' },
            p(
              "THAT the payment of directors' fees of ",
              f('fee_total'),
              ' for the financial year ending ',
              f('fee_year_end'),
              ' be approved, payable as follows:',
            ),
            repeat('fee_directors', {
              type: 'table',
              columnWidths: [70, 30],
              rows: [
                {
                  header: true,
                  cells: [
                    [p('Director')],
                    [{ type: 'paragraph', align: 'right', content: [t('Fee')] }],
                  ],
                },
                {
                  cells: [
                    [p(f('fee_directors', 'name'))],
                    [{ type: 'paragraph', align: 'right', content: [f('fee_amount')] }],
                  ],
                },
              ],
            }),
            {
              type: 'table',
              columnWidths: [70, 30],
              rows: [
                {
                  cells: [
                    [p(t('Total', 'bold'))],
                    [{ type: 'paragraph', align: 'right', content: [f('fee_total')] }],
                  ],
                },
              ],
            },
          ),
          when(
            { op: 'isFalse', fieldId: 'fees_payable' },
            p(
              "THAT no directors' fees be paid for the financial year ending ",
              f('fee_year_end'),
              '.',
            ),
          ),
        ],
        directors_written: [
          p(t("Directors' fees", 'bold')),
          when(
            { op: 'isTrue', fieldId: 'fees_payable' },
            p(
              "THAT the directors recommend to the members the payment of directors' fees totalling ",
              f('fee_total'),
              ' for the financial year ending ',
              f('fee_year_end'),
              ', namely:',
            ),
            repeat('fee_directors', {
              type: 'table',
              columnWidths: [70, 30],
              rows: [
                {
                  header: true,
                  cells: [
                    [p('Director')],
                    [{ type: 'paragraph', align: 'right', content: [t('Fee')] }],
                  ],
                },
                {
                  cells: [
                    [p(f('fee_directors', 'name'))],
                    [{ type: 'paragraph', align: 'right', content: [f('fee_amount')] }],
                  ],
                },
              ],
            }),
          ),
          when(
            { op: 'isFalse', fieldId: 'fees_payable' },
            p(
              "THAT the directors recommend that no directors' fees be paid for the financial year ending ",
              f('fee_year_end'),
              '.',
            ),
          ),
        ],
      },
    },
  },
  {
    key: 'authority',
    name: 'Authority to sign documents',
    category: 'Other',
    usageContexts: ['board', 'director_appointment', 'director_resignation'],
    displayOrder: 10,
    description: 'Authorises one director to sign named documents. Fictional sample wording.',
    content: {
      fields: [
        question('authorised_director', 'Authorised director', 'recordReference', {
          record: { context: 'currentDirectors' },
        }),
        question('documents_to_sign', 'Documents to sign', 'text', {
          validation: { maxLength: 300 },
        }),
      ],
      wordings: {
        directors_written: [
          p(t('Authority to sign documents', 'bold')),
          p(
            'THAT ',
            f('authorised_director', 'name'),
            ' be authorised to sign ',
            f('documents_to_sign'),
            ' and any other document needed to give effect to these resolutions.',
          ),
        ],
        members_written: [
          p(t('Authority to sign documents', 'bold')),
          p(
            'THAT ',
            f('authorised_director', 'name'),
            ' be authorised to sign ',
            f('documents_to_sign'),
            ' on behalf of the Company.',
          ),
        ],
      },
    },
  },
  {
    key: 'general',
    name: 'General business',
    category: 'Other',
    usageContexts: ['board'],
    displayOrder: 20,
    description:
      'Free-text resolution for business with no library clause. Fictional sample wording.',
    content: {
      fields: [
        question('business_title', 'Heading', 'text', { validation: { maxLength: 120 } }),
        question('business_text', 'Resolution text', 'multiline', {
          validation: { maxLength: 4000 },
        }),
      ],
      wordings: {
        directors_written: [p(f('business_title')), p(f('business_text'))],
        members_written: [p(f('business_title')), p(f('business_text'))],
      },
    },
  },
];

// ---------------------------------------------------------------- starter assemblies
export type StarterAssembly = {
  key: string;
  name: string;
  outputTypeId: string;
  usageContexts: UsageContext[];
  description: string;
  starterKeys: string[];
  content: Pick<AssemblyVersion, 'header' | 'closing' | 'signature' | 'fields' | 'layout'>;
};
const companyFields = (authority: 'directorAuthority' | 'memberAuthority'): FieldDefinition[] => [
  bound('company_name', 'Company name', 'company.name', {
    scope: 'case',
    format: { case: 'upper' },
  }),
  bound('company_number', 'Registration number', 'company.registrationNumber', { scope: 'case' }),
  bound(
    authority === 'directorAuthority' ? 'director_authority' : 'member_authority',
    authority === 'directorAuthority'
      ? "Directors' authority citation"
      : "Members' authority citation",
    `company.citation.${authority}`,
    { scope: 'case' },
  ),
  resolutionDate,
];
const companyBlock: BlockNode[] = [
  pc(f('company_name')),
  pc('(Registration No. ', f('company_number'), ')'),
];
const directorsAssembly = (title: string): StarterAssembly['content'] => ({
  fields: companyFields('directorAuthority'),
  header: [
    ...companyBlock,
    h(1, title, 'center'),
    p(
      'Pursuant to ',
      f('director_authority'),
      ', we, the undersigned, being all the directors of the Company, resolve as follows:',
    ),
    { type: 'clauseSlot', numbering: 'decimal' },
  ],
  closing: [
    p('Dated: ', f('resolution_date')),
    { type: 'signatureBlock', role: 'directors', heading: 'Directors' },
  ],
  signature: { columns: 2, showDate: false, label: '{name}\nDirector' },
  layout: {
    ...defaultLayout,
    header: [f('company_name')],
    footer: [t(`${title} — ${SAMPLE_SOURCE}`)],
  },
});
export const STARTER_ASSEMBLIES: StarterAssembly[] = [
  {
    key: 'directors',
    name: "Directors' written resolution",
    outputTypeId: 'directors_written',
    usageContexts: ['board', 'director_appointment', 'director_resignation'],
    description:
      'Header citing the directors’ authority, numbered clauses, directors’ signatures. Fictional sample.',
    starterKeys: [],
    content: directorsAssembly("DIRECTORS' WRITTEN RESOLUTION"),
  },
  {
    key: 'members',
    name: "Members' written resolution",
    outputTypeId: 'members_written',
    usageContexts: ['board'],
    description:
      'Header citing the members’ authority, numbered clauses, members’ signatures and a sample lapse notice.',
    starterKeys: [],
    content: {
      fields: [
        ...companyFields('memberAuthority'),
        {
          id: 'lapse_date',
          label: 'Lapse date',
          valueType: 'date',
          // No approved source for this period yet, so the value is labelled a sample.
          source: {
            kind: 'derived',
            op: 'addDays',
            fieldId: 'resolution_date',
            days: 28,
            sourceNote: '',
          },
          scope: 'case',
          required: true,
          format: { date: 'long' },
        },
      ],
      header: [
        ...companyBlock,
        h(1, "MEMBERS' WRITTEN RESOLUTION", 'center'),
        p(
          'Pursuant to ',
          f('member_authority'),
          ', we, the undersigned, being the members of the Company entitled to vote, resolve as follows:',
        ),
        { type: 'clauseSlot', numbering: 'decimal' },
      ],
      closing: [
        p('Dated: ', f('resolution_date')),
        { type: 'signatureBlock', role: 'members', heading: 'Members' },
        { type: 'pageBreak' },
        h(2, 'Notes for members (fictional sample)'),
        {
          type: 'list',
          ordered: true,
          items: [
            [p('Sign and return this resolution to the Company Secretary.')],
            [
              p(
                'This resolution lapses if it is not passed by ',
                f('lapse_date'),
                ' (sample period, no approved source).',
              ),
            ],
          ],
        },
      ],
      signature: { columns: 2, showDate: true, label: '{name}\nMember' },
      layout: {
        ...defaultLayout,
        header: [f('company_name')],
        footer: [t(`Members' written resolution — ${SAMPLE_SOURCE}`)],
      },
    },
  },
  {
    key: 'appointment',
    name: 'Director appointment resolution',
    outputTypeId: 'directors_written',
    usageContexts: ['director_appointment'],
    description: 'Starter: appointment of a director plus authority to sign. Fictional sample.',
    starterKeys: ['appointment', 'authority'],
    content: directorsAssembly("DIRECTORS' WRITTEN RESOLUTION"),
  },
  {
    key: 'resignation',
    name: 'Director resignation resolution',
    outputTypeId: 'directors_written',
    usageContexts: ['director_resignation'],
    description: 'Starter: resignation of a director plus authority to sign. Fictional sample.',
    starterKeys: ['resignation', 'authority'],
    content: directorsAssembly("DIRECTORS' WRITTEN RESOLUTION"),
  },
];

// ---------------------------------------------------------------- fictional context
const person = (
  id: string,
  name: string,
  capacity: string,
  appointedOn: string | null,
): PersonSnapshot => ({
  id,
  name,
  capacity,
  appointedOn,
  ceasedOn: null,
});
export function sampleContext(asAt = '2026-10-26'): ResolutionContext {
  const directors = [
    person('sample-d1', 'Nur Aisyah binti Abdullah Rahman (fictional)', 'Director', '2019-03-01'),
    person('sample-d2', 'Tan Wei Ming 陈伟明 (fictional)', 'Non-executive director', '2021-07-15'),
    person(
      'sample-d3',
      'Ravichandran a/l Subramaniam Pillai (fictional)',
      'Director',
      '2023-01-09',
    ),
  ];
  const members = [
    person('sample-m1', 'Example Holdings Nominees Sdn. Bhd. (fictional)', 'Member', null),
    person('sample-m2', 'Zoë Lefèvre-Østergaard (fictional)', 'Member', null),
    directors[0],
  ];
  return {
    asAt,
    preparedOn: '2026-10-26',
    firm: { name: 'Example Secretarial Services (fictional)' },
    company: {
      id: 'sample-company',
      name: 'Example Holdings Sdn. Bhd. (fictional)',
      registrationNumber: '202601999999 (fictional)',
      address: '1 Example Road, 50000 Kuala Lumpur (fictional)',
      incorporationDate: '2019-03-01',
      financialYearEnd: '12-31',
      revision: 1,
      profileRevision: 1,
      citations: {
        directorAuthority: 'Clause 99 of the Constitution (fictional citation)',
        memberAuthority: 'Clause 98 of the Constitution (fictional citation)',
        electionAuthority: 'Clause 97 of the Constitution (fictional citation)',
      },
      custom: {},
    },
    case: {
      id: 'sample-case',
      kind: 'board',
      title: 'Sample resolution (fictional)',
      revision: 1,
      instructionDate: asAt,
      resolutionDate: asAt,
      effectiveDate: asAt,
      custom: {},
    },
    job: null,
    directors,
    members,
    companyPeople: [
      ...directors,
      person('sample-s1', 'Lim Siew Ling (fictional secretary)', 'Secretary', '2019-03-01'),
    ],
    proposedPeople: [
      person('sample-p1', 'Aminah binti Yusof (fictional)', 'Proposed director', null),
    ],
  };
}

/** Plausible fictional answers for every question, by type. */
export function sampleAnswers(fields: FieldDefinition[], ctx: ResolutionContext): Answers {
  const answers: Answers = {};
  const pool = (field: FieldDefinition) =>
    field.record?.context === 'currentMembers'
      ? ctx.members
      : field.record?.context === 'companyPeople'
        ? ctx.companyPeople
        : field.record?.context === 'proposedPerson'
          ? ctx.proposedPeople
          : ctx.directors;
  for (const field of fields) {
    if (field.source.kind !== 'question') continue;
    if (field.repeatScope) {
      const list = fields.find((x) => x.id === field.repeatScope);
      const rows: Record<string, AnswerValue> = {};
      (list ? pool(list) : []).forEach((item, i) => (rows[item.id] = sampleScalar(field, i)));
      answers[field.id] = rows;
    } else if (field.valueType === 'recordReference')
      answers[field.id] = pool(field)[0]?.id ?? null;
    else if (field.valueType === 'recordList') answers[field.id] = pool(field).map((x) => x.id);
    else answers[field.id] = sampleScalar(field, 0);
  }
  return answers;
}
function sampleScalar(field: FieldDefinition, index: number): AnswerValue {
  switch (field.valueType) {
    case 'boolean':
      return true;
    case 'date':
      return '2026-11-02';
    case 'number':
      return ['1000.10', '2000.25', '1500.00'][index % 3];
    case 'choice':
      return field.options?.[0]?.id ?? null;
    case 'multiChoice':
      return field.options?.slice(0, 1).map((o) => o.id) ?? [];
    case 'multiline':
      return `Sample ${field.label.toLowerCase()} (fictional).\nSecond line of sample text.`;
    default:
      return `Sample ${field.label.toLowerCase()} (fictional)`;
  }
}
export function sampleSigners(ctx: ResolutionContext): SignerSelection {
  return {
    directors: ctx.directors.map((d) => d.id),
    members: ctx.members.map((m) => m.id),
    certifiers: ctx.companyPeople.slice(0, 1).map((p) => p.id),
  };
}
