import { inArray } from 'drizzle-orm';
import { compileDocument } from '../../domain/resolution/compile';
import type { CaseTemplate } from '../../domain/resolution/form';
import type { ResolvedDocument } from '../../domain/resolution/model';
import { renderDocx } from './render-docx';
import { h, p, SAMPLE_BANNER, sampleAnswers, sampleContext, sampleSigners } from './samples';
import { z } from 'zod';
import { DomainError, today } from '../../domain/access';
import type { Actor } from '../../domain/model';
import {
  assemblyContentSchema,
  clauseContentSchema,
  defaultLayout,
  wordingFor,
} from '../../domain/resolution/schema';
import { validateAssembly, validateClause, type Issue } from '../../domain/resolution/validate';
import { db } from '../db';
import * as s from '../schema';
import { loadTemplate, loadVersion, assertTemplateReader } from './templates';
import { listOutputTypes } from './output-types';

// ---------------------------------------------------------------- template preview service
const previewInput = z.strictObject({
  kind: z.enum(['clause', 'assembly']),
  versionId: z.string().min(1).max(36),
  outputTypeId: z.string().min(1).max(64).optional(),
  draft: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Previews a clause or assembly (saved version or unsaved draft) with fictional values only.
 * No company data is read, so a shared template never carries real data from a preview.
 */
export async function previewTemplate(actor: Actor, input: unknown) {
  assertTemplateReader(actor);
  const request = previewInput.parse(input);
  const ctx = sampleContext(today());
  const types = await listOutputTypes();
  let template: CaseTemplate;
  let issues: Issue[];
  if (request.kind === 'clause') {
    const version = await loadVersion(db, 'clause', request.versionId);
    const clause = await loadTemplate(db, 'clause', version.clauseId);
    const content = request.draft
      ? clauseContentSchema.parse({ source: '', effectiveDate: null, ...request.draft })
      : version;
    const outputTypeId =
      request.outputTypeId ?? Object.keys(content.wordings)[0] ?? 'directors_written';
    const outputType = types.find((t) => t.id === outputTypeId);
    if (!outputType) throw new DomainError('Choose a configured output type.');
    issues = validateClause(clause.name, content, types);
    template = {
      outputType,
      assembly: {
        name: SAMPLE_BANNER,
        version: {
          id: 'sample-assembly',
          header: [
            h(1, outputType.name.toUpperCase(), 'center'),
            { type: 'clauseSlot', numbering: 'decimal' },
          ],
          closing: [],
          signature: { columns: 2, showDate: false, label: '{name}' },
          fields: [],
          layout: defaultLayout,
        },
      },
      clauses: [
        {
          key: 'sample',
          name: clause.name,
          version: { id: version.id, wordings: content.wordings, fields: content.fields },
        },
      ],
    };
  } else {
    const version = await loadVersion(db, 'assembly', request.versionId);
    const assembly = await loadTemplate(db, 'assembly', version.assemblyId);
    const content = request.draft
      ? assemblyContentSchema.parse({
          source: '',
          effectiveDate: null,
          starterClauseIds: [],
          ...request.draft,
        })
      : version;
    const outputType = types.find((t) => t.id === (request.outputTypeId ?? assembly.outputTypeId));
    if (!outputType) throw new DomainError('Choose a configured output type.');
    issues = validateAssembly(assembly.name, content);
    const starters = content.starterClauseIds.length
      ? (
          await db
            .select()
            .from(s.clauseTemplateVersions)
            .where(inArray(s.clauseTemplateVersions.clauseId, content.starterClauseIds))
        )
          .map((r) => r.data)
          .filter((v) => v.status === 'Published' && wordingFor(v.wordings, outputType.id)?.length)
      : [];
    const names = starters.length
      ? (
          await db
            .select()
            .from(s.clauseTemplates)
            .where(
              inArray(
                s.clauseTemplates.id,
                starters.map((v) => v.clauseId),
              ),
            )
        ).map((r) => r.data)
      : [];
    const clauses = content.starterClauseIds.flatMap((id) => {
      const v = starters.find((x) => x.clauseId === id);
      return v
        ? [
            {
              key: `s${v.version}${id.slice(0, 6)}`.toLowerCase().replace(/[^a-z0-9]/g, ''),
              name: names.find((n) => n.id === id)?.name ?? 'Clause',
              version: v,
            },
          ]
        : [];
    });
    template = {
      outputType,
      assembly: { name: assembly.name, version: { id: version.id, ...content } },
      clauses: clauses.length
        ? clauses
        : [
            {
              key: 'placeholder',
              name: 'Selected clauses',
              version: {
                id: 'placeholder',
                fields: [],
                wordings: {
                  [outputType.id]: [p('[The clauses chosen for the case appear here.]')],
                },
              },
            },
          ],
    };
  }
  const allFields = [
    template.assembly.version.fields,
    ...template.clauses.map((c) => c.version.fields),
  ];
  const shared = sampleAnswers(
    allFields
      .flat()
      .filter(
        (field, i, list) =>
          (field.scope === 'case' || template.assembly.version.fields.includes(field)) &&
          list.findIndex((x) => x.id === field.id) === i,
      ),
    ctx,
  );
  const answers = {
    shared,
    clauses: Object.fromEntries(
      template.clauses.map((c) => [
        c.key,
        sampleAnswers(
          c.version.fields.filter((x) => x.scope === 'clause'),
          ctx,
        ),
      ]),
    ),
  };
  const compiled = compileDocument(
    { ...template, ctx, answers, signers: sampleSigners(ctx) },
    'sample',
  );
  const resolved: ResolvedDocument = {
    ...compiled.resolved,
    title: `${compiled.resolved.title} (${SAMPLE_BANNER})`,
    layout: {
      ...compiled.resolved.layout,
      header: [SAMPLE_BANNER, compiled.resolved.layout.header].filter(Boolean).join(' · '),
    },
    blocks: [
      { type: 'paragraph', align: 'center', runs: [{ text: SAMPLE_BANNER, marks: ['bold'] }] },
      ...compiled.resolved.blocks,
    ],
    containsSamples: true,
  };
  return { resolved, issues: [...issues, ...compiled.issues], values: compiled.values };
}

export async function previewTemplateDocx(actor: Actor, input: unknown) {
  const { resolved } = await previewTemplate(actor, input);
  return {
    bytes: await renderDocx(resolved),
    fileName: `${resolved.title.replace(/[^\p{L}\p{N} ._()-]+/gu, ' ').trim()}.docx`,
  };
}
