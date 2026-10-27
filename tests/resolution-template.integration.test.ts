import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { and, eq, inArray, like, or } from 'drizzle-orm';
import { db, pool } from '../src/server/db';
import * as s from '../src/server/schema';
import {
  defaultPreferences,
  type Actor,
  type Company,
  type Job,
  type OfficerEvent,
} from '../src/domain/model';
import type {
  CompanyProfile,
  DocumentGeneration,
  ResolutionCase,
} from '../src/domain/resolution/model';
import { changeCase, createCase } from '../src/server/records/cases';
import { mutateCase, readCase } from '../src/server/resolution/shared';
import {
  applyOutputTypeAction,
  applyVersionAction,
  getVersion,
  listTemplates,
  previewTemplate,
  templateAction,
  type Kind,
} from '../src/server/resolution/templates';
import { applyClauseAction, getCaseClauses, previewCase } from '../src/server/resolution/selection';
import {
  applyGenerationAction,
  attachGenerationToPack,
  downloadGeneration,
  generateDocument,
  getGeneration,
  reconcilePendingGenerations,
} from '../src/server/resolution/generation';
import { readZip } from '../src/server/resolution/render-docx';
import { canonical, sha256 } from '../src/server/resolution/templates';
import { loadResolutionContext } from '../src/server/records/context';
import { insertDocument } from '../src/server/repository';
import { reviewActions } from '../src/server/job-actions/review';
import {
  generatedExecutionStatus,
  reviewedExecutionState,
} from '../src/server/resolution/execution';
import { DOCX_MIME, safeStoragePath, validateFile } from '../src/server/storage';
import { STARTER_ASSEMBLIES, STARTER_CLAUSES } from '../src/server/resolution/samples';

const enabled = Boolean(process.env.DATABASE_URL);
const tag = randomBytes(4).toString('hex');
const X = randomUUID();
const Y = randomUUID();
const actor = (name: string, capabilities: Actor['capabilities'], companyIds = [X]): Actor => ({
  id: randomUUID(),
  name,
  email: `tt-${name.toLowerCase()}-${tag}@example.invalid`,
  capabilities,
  companyIds,
  preferences: defaultPreferences,
});
const author = actor('Author', [
  'manage_templates',
  'generate_documents',
  'prepare_job',
  'review_pack',
]);
const reviewer = actor('Reviewer', ['manage_templates', 'review_pack', 'generate_documents']);
const outsider = actor(
  'Outsider',
  ['manage_templates', 'generate_documents', 'prepare_job', 'review_pack'],
  [Y],
);
// Preparer with access to both companies: generating for X must not leak Y's people.
const both = actor('Both', ['generate_documents', 'prepare_job'], [X, Y]);
const users = [author, reviewer, outsider, both];
const yPersonId = `tt-y-only-${tag}`;
const directors = [
  { id: `tt-d1-${tag}`, name: 'Nur Aisyah binti Abdullah Rahman (fictional)' },
  { id: `tt-d2-${tag}`, name: 'Tan Wei Ming 陈伟明 (fictional)' },
  { id: `tt-d3-${tag}`, name: 'Ravichandran a/l Subramaniam Pillai (fictional)' },
];
const outputTypeId = `tt_${tag}`;
const templateIds: { kind: Kind; id: string }[] = [];
const jobId = randomUUID();
let storageDirectory = '';
const previousStorage = process.env.STORAGE_DIR;

const company = (id: string): Company => ({
  id,
  name: `Template test ${tag} Sdn. Bhd. (fictional)`,
  registrationNumber: `TT-${tag}`,
  incorporationDate: '2019-01-01',
  financialYearEnd: '2026-12-31',
  legalStatus: 'Existing',
  engagementStatus: 'Active',
  address: 'Fictional address',
  activity: 'Fictional',
  verification: 'Unverified',
  sourceEvidenceId: null,
  revision: 1,
});
const event = (personId: string, personName: string): OfficerEvent => ({
  id: randomUUID(),
  companyId: X,
  jobId: 'template-test-fixture',
  personId,
  personName,
  route: 'appointment',
  effectiveDate: '2020-01-01',
  recordedAt: '2020-01-02T00:00:00.000Z',
  evidenceIds: [],
  basis: 'Fictional test fixture',
  reviewerId: author.id,
  predecessorId: null,
});
const citation = (value: string, effectiveDate = '2020-01-01') => ({
  value,
  effectiveDate,
  recordedAt: new Date().toISOString(),
  actorId: author.id,
  reason: 'Fictional fixture',
});
const profile: CompanyProfile = {
  companyId: X,
  revision: 1,
  citations: {
    directorAuthority: [citation('Clause 11 of the Constitution (fictional)')],
    memberAuthority: [citation('Clause 12 of the Constitution (fictional)')],
  },
  customValues: {},
};
const rid = () => randomUUID();
const starter = (key: string) => STARTER_CLAUSES.find((c) => c.key === key)!;
const errorOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as {
      code: string;
      status: number;
      message: string;
      issues?: { location: string; message: string }[];
    };
  }
  throw new Error('Expected a failure');
};

async function publish(
  kind: Kind,
  create: Record<string, unknown>,
  content: Record<string, unknown>,
  effectiveDate = '2026-10-01',
) {
  const template = await templateAction(author, kind, {
    action: 'create',
    requestId: rid(),
    ...create,
  });
  templateIds.push({ kind, id: template.id });
  let version = template.versions[0];
  version = (
    await applyVersionAction(author, kind, template.id, version.id, {
      action: 'save_draft',
      requestId: rid(),
      expectedRevision: version.revision,
      ...content,
      source: 'Fictional test wording',
      effectiveDate,
    })
  ).version;
  version = (
    await applyVersionAction(author, kind, template.id, version.id, {
      action: 'submit',
      requestId: rid(),
      expectedRevision: version.revision,
    })
  ).version;
  version = (
    await applyVersionAction(reviewer, kind, template.id, version.id, {
      action: 'publish',
      requestId: rid(),
      expectedRevision: version.revision,
      confirm: true,
    })
  ).version;
  return { templateId: template.id, versionId: version.id, version };
}
const clauseMeta = (key: string, extra: Record<string, unknown> = {}) => {
  const c = starter(key);
  return {
    name: `${c.name} (${tag})`,
    category: c.category,
    usageContexts: c.usageContexts,
    governingAct: 'Companies Act 2016',
    displayOrder: c.displayOrder,
    description: 'Template integration fixture',
    ...extra,
  };
};
const assemblyContent = (key: string, starterClauseIds: string[] = []) => ({
  ...STARTER_ASSEMBLIES.find((a) => a.key === key)!.content,
  starterClauseIds,
});

let lib: Record<string, { templateId: string; versionId: string }> = {};
let directorsAssembly: { templateId: string; versionId: string };
let boardCase: ResolutionCase;

async function newCase(
  kind: ResolutionCase['kind'] = 'board',
  extra: Record<string, unknown> = {},
) {
  return createCase(author, {
    requestId: rid(),
    companyId: X,
    kind,
    title: `Template test case ${tag}`,
    resolutionDate: '2026-10-26',
    ...extra,
  } as Parameters<typeof createCase>[1]);
}
async function select(
  rc: ResolutionCase,
  clauses: { key?: string; clauseId: string; clauseVersionId: string }[],
  assemblyVersionId = directorsAssembly.versionId,
  output = 'directors_written',
  extra: Record<string, unknown> = {},
) {
  return applyClauseAction(author, rc.id, {
    action: 'set_selection',
    expectedRevision: rc.revision,
    requestId: rid(),
    outputTypeId: output,
    assemblyVersionId,
    clauses,
    ...extra,
  });
}
const pin = (key: string) => ({
  clauseId: lib[key].templateId,
  clauseVersionId: lib[key].versionId,
});
async function answer(
  rc: ResolutionCase,
  byClause: Record<string, Record<string, unknown>>,
  signers = directors.map((d) => d.id),
) {
  const clauses: Record<string, Record<string, unknown>> = {};
  for (const entry of rc.selection!.clauses) {
    const name = Object.entries(lib).find(([, v]) => v.templateId === entry.clauseId)?.[0];
    if (name && byClause[name]) clauses[entry.key] = byClause[name];
  }
  return applyClauseAction(author, rc.id, {
    action: 'save_answers',
    expectedRevision: rc.revision,
    requestId: rid(),
    selectionRevision: rc.selection!.revision,
    shared: { resolution_date: '2026-10-26' },
    clauses,
    signers: { directors: signers, members: [], certifiers: [] },
  });
}
const generate = (
  rc: ResolutionCase,
  extra: Record<string, unknown> = {},
  deps?: Parameters<typeof generateDocument>[2],
) =>
  generateDocument(
    author,
    {
      requestId: rid(),
      caseId: rc.id,
      expectedCaseRevision: rc.revision,
      selectionRevision: rc.selection!.revision,
      ...extra,
    },
    deps,
  );
const documentXml = (bytes: Buffer) => readZip(bytes).get('word/document.xml')!.toString('utf8');
const plain = (xml: string) =>
  [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
const answers = {
  auditors: { auditor_firm: 'Example & Co (fictional)', audit_year_end: '2026-12-31' },
  authority: { authorised_director: directors[0].id, documents_to_sign: 'the bank mandate' },
  general: {
    business_title: 'Bank account',
    business_text: 'Open an account with a fictional bank.',
  },
};

describe.skipIf(!enabled)('resolution templates, selection and generation against MySQL', () => {
  beforeAll(async () => {
    storageDirectory = await mkdtemp(path.join(os.tmpdir(), 'cosec-template-db-'));
    process.env.STORAGE_DIR = storageDirectory;
    for (const id of [X, Y]) await db.insert(s.companies).values({ id, data: company(id) });
    for (const u of users)
      await db.insert(s.user).values({
        id: u.id,
        name: u.name,
        email: u.email,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        capabilities: u.capabilities,
        companyIds: u.companyIds,
        preferences: u.preferences,
        active: true,
      });
    for (const d of directors) {
      const e = event(d.id, d.name);
      await db.insert(s.officerEvents).values({ id: e.id, companyId: X, data: e });
    }
    await db.insert(s.companyProfiles).values({ companyId: X, revision: 1, data: profile });
    const created = new Date().toISOString();
    await db.insert(s.people).values({
      id: yPersonId,
      fullName: `Y-only person ${tag} (fictional)`,
      revision: 1,
      data: {
        id: yPersonId,
        fullName: `Y-only person ${tag} (fictional)`,
        nameHistory: [],
        email: null,
        notes: '',
        customValues: {},
        createdBy: author.id,
        createdAt: created,
        updatedAt: created,
        revision: 1,
      },
    });
    const relationshipId = randomUUID();
    await db.insert(s.companyRelationships).values({
      id: relationshipId,
      companyId: Y,
      personId: yPersonId,
      role: 'member',
      revision: 1,
      data: {
        id: relationshipId,
        companyId: Y,
        personId: yPersonId,
        role: 'member',
        capacity: '',
        startDate: '2020-01-01',
        endDate: null,
        projectedFrom: null,
        evidenceIds: [],
        createdBy: author.id,
        createdAt: created,
        revision: 1,
      },
    });
    for (const key of ['auditors', 'authority', 'general', 'fees'])
      lib[key] = await publish('clause', clauseMeta(key), starter(key).content);
    lib.appointment = await publish(
      'clause',
      clauseMeta('appointment', { displayOrder: 0 }),
      starter('appointment').content,
    );
    directorsAssembly = await publish(
      'assembly',
      {
        name: `Directors assembly (${tag})`,
        outputTypeId: 'directors_written',
        usageContexts: ['board', 'director_appointment'],
      },
      assemblyContent('directors'),
    );
    lib.membersAssembly = await publish(
      'assembly',
      {
        name: `Members assembly (${tag})`,
        outputTypeId: 'members_written',
        usageContexts: ['board'],
      },
      assemblyContent('members'),
    );
    lib.appointmentAssembly = await publish(
      'assembly',
      {
        name: `Appointment starter (${tag})`,
        outputTypeId: 'directors_written',
        usageContexts: ['director_appointment'],
      },
      assemblyContent('appointment', [lib.appointment.templateId, lib.authority.templateId]),
    );
    boardCase = await newCase();
  });

  afterAll(async () => {
    const ids = users.map((u) => u.id);
    const generations = (
      await db
        .select({ id: s.documentGenerations.id })
        .from(s.documentGenerations)
        .where(eq(s.documentGenerations.companyId, X))
    ).map((r) => r.id);
    if (generations.length)
      await db
        .delete(s.generationRecords)
        .where(inArray(s.generationRecords.generationId, generations));
    await db.delete(s.documentGenerations).where(eq(s.documentGenerations.companyId, X));
    await db.delete(s.documents).where(inArray(s.documents.companyId, [X, Y]));
    await db.delete(s.resolutionCases).where(inArray(s.resolutionCases.companyId, [X, Y]));
    await db.delete(s.jobs).where(eq(s.jobs.id, jobId));
    for (const { kind, id } of templateIds)
      if (kind === 'clause') {
        await db.delete(s.clauseTemplateVersions).where(eq(s.clauseTemplateVersions.clauseId, id));
        await db.delete(s.clauseTemplates).where(eq(s.clauseTemplates.id, id));
      } else {
        await db
          .delete(s.resolutionAssemblyVersions)
          .where(eq(s.resolutionAssemblyVersions.assemblyId, id));
        await db.delete(s.resolutionAssemblies).where(eq(s.resolutionAssemblies.id, id));
      }
    await db.delete(s.outputTypes).where(eq(s.outputTypes.id, outputTypeId));
    await db.delete(s.auditEvents).where(
      or(
        inArray(s.auditEvents.actorId, ids),
        inArray(s.auditEvents.companyId, [X, Y]),
        and(
          eq(s.auditEvents.actorId, 'system'),
          inArray(
            s.auditEvents.subjectId,
            directors.map((d) => d.id),
          ),
        ),
      ),
    );
    for (const id of ids) await db.delete(s.requests).where(like(s.requests.id, `${id}:%`));
    await db
      .delete(s.companyRelationships)
      .where(inArray(s.companyRelationships.companyId, [X, Y]));
    await db
      .delete(s.people)
      .where(inArray(s.people.id, [...directors.map((d) => d.id), yPersonId]));
    await db.delete(s.companyProfiles).where(eq(s.companyProfiles.companyId, X));
    await db.delete(s.officerEvents).where(eq(s.officerEvents.companyId, X));
    await db.delete(s.companies).where(inArray(s.companies.id, [X, Y]));
    await db.delete(s.user).where(inArray(s.user.id, ids));
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
    if (previousStorage === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = previousStorage;
    await pool.end();
  });

  it('A08 requires an independent publisher, keeps returned drafts and blocks incomplete publication with locations', async () => {
    const created = await templateAction(author, 'clause', {
      action: 'create',
      requestId: rid(),
      ...clauseMeta('general', { name: `Lifecycle ${tag}` }),
    });
    templateIds.push({ kind: 'clause', id: created.id });
    let v = created.versions[0];
    const saved = await applyVersionAction(author, 'clause', created.id, v.id, {
      action: 'save_draft',
      requestId: rid(),
      expectedRevision: v.revision,
      ...starter('general').content,
      wordings: {
        directors_written: [{ type: 'paragraph', content: [{ type: 'field', fieldId: 'nope' }] }],
      },
      source: '',
      effectiveDate: null,
    });
    // A13: the draft is saved with its issues; submission is blocked with the location.
    expect(saved.issues.some((i) => i.location.endsWith('block 1 › field "nope"'))).toBe(true);
    v = saved.version;
    const blocked = await errorOf(
      applyVersionAction(author, 'clause', created.id, v.id, {
        action: 'submit',
        requestId: rid(),
        expectedRevision: v.revision,
      }),
    );
    expect(blocked.code).toBe('INCOMPLETE');
    expect(blocked.issues!.map((i) => i.location)).toEqual(
      expect.arrayContaining([
        `clause "Lifecycle ${tag}" › wording "Directors' written resolution" › block 1 › field "nope"`,
        `clause "Lifecycle ${tag}" › source`,
        `clause "Lifecycle ${tag}" › effective date`,
      ]),
    );
    v = (
      await applyVersionAction(author, 'clause', created.id, v.id, {
        action: 'save_draft',
        requestId: rid(),
        expectedRevision: v.revision,
        ...starter('general').content,
        source: 'Fictional test wording',
        effectiveDate: '2026-10-01',
      })
    ).version;
    v = (
      await applyVersionAction(author, 'clause', created.id, v.id, {
        action: 'submit',
        requestId: rid(),
        expectedRevision: v.revision,
      })
    ).version;
    expect(v.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const self = await errorOf(
      applyVersionAction(author, 'clause', created.id, v.id, {
        action: 'publish',
        requestId: rid(),
        expectedRevision: v.revision,
        confirm: true,
      }),
    );
    expect(self).toMatchObject({ code: 'SELF_APPROVAL', status: 403 });
    v = (
      await applyVersionAction(reviewer, 'clause', created.id, v.id, {
        action: 'return',
        requestId: rid(),
        expectedRevision: v.revision,
        reason: 'Tighten the heading.',
      })
    ).version;
    expect(v).toMatchObject({ status: 'Returned', returnReason: 'Tighten the heading.' });
    expect(v.wordings).toEqual(starter('general').content.wordings);
    v = (
      await applyVersionAction(author, 'clause', created.id, v.id, {
        action: 'submit',
        requestId: rid(),
        expectedRevision: v.revision,
      })
    ).version;
    v = (
      await applyVersionAction(reviewer, 'clause', created.id, v.id, {
        action: 'publish',
        requestId: rid(),
        expectedRevision: v.revision,
        confirm: true,
      })
    ).version;
    expect(v).toMatchObject({ status: 'Published', reviewedBy: reviewer.id, createdBy: author.id });
    const immutable = await errorOf(
      applyVersionAction(author, 'clause', created.id, v.id, {
        action: 'save_draft',
        requestId: rid(),
        expectedRevision: v.revision,
        ...starter('general').content,
        source: 'x',
        effectiveDate: '2026-10-01',
      }),
    );
    expect(immutable.status).toBe(409);
    const audit = await db.select().from(s.auditEvents).where(eq(s.auditEvents.subjectId, v.id));
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'clause_version.draft_saved',
        'clause_version.submitted',
        'clause_version.returned',
        'clause_version.published',
      ]),
    );
  });

  it('A10 rejects a stale draft save and replays a repeated request', async () => {
    const created = await templateAction(author, 'clause', {
      action: 'create',
      requestId: rid(),
      ...clauseMeta('general', { name: `Stale ${tag}` }),
    });
    templateIds.push({ kind: 'clause', id: created.id });
    const v = created.versions[0];
    const body = {
      action: 'save_draft',
      expectedRevision: v.revision,
      ...starter('general').content,
      source: '',
      effectiveDate: null,
    };
    const requestId = rid();
    const first = await applyVersionAction(author, 'clause', created.id, v.id, {
      ...body,
      requestId,
    });
    const replay = await applyVersionAction(author, 'clause', created.id, v.id, {
      ...body,
      requestId,
    });
    expect(replay.version.revision).toBe(first.version.revision);
    const stale = await errorOf(
      applyVersionAction(reviewer, 'clause', created.id, v.id, { ...body, requestId: rid() }),
    );
    expect(stale).toMatchObject({ code: 'STALE', status: 409 });
  });

  it('A02 keeps field references through a rename and leaves the published version unchanged', async () => {
    const original = await getVersion(
      author,
      'clause',
      lib.auditors.templateId,
      lib.auditors.versionId,
    );
    const successor = (
      await applyVersionAction(author, 'clause', lib.auditors.templateId, lib.auditors.versionId, {
        action: 'new_version',
        requestId: rid(),
      })
    ).version;
    expect(successor).toMatchObject({
      status: 'Draft',
      version: 2,
      predecessorId: lib.auditors.versionId,
    });
    const fields = original.version.fields.map((f) =>
      f.id === 'auditor_firm' ? { ...f, label: 'Name of audit firm' } : f,
    );
    const saved = await applyVersionAction(
      author,
      'clause',
      lib.auditors.templateId,
      successor.id,
      {
        action: 'save_draft',
        requestId: rid(),
        expectedRevision: successor.revision,
        wordings: (original.version as unknown as { wordings: unknown }).wordings,
        fields,
        source: 'Fictional test wording',
        effectiveDate: '2026-10-01',
      },
    );
    expect(saved.issues.filter((i) => i.severity !== 'warning')).toEqual([]);
    const after = await getVersion(
      author,
      'clause',
      lib.auditors.templateId,
      lib.auditors.versionId,
    );
    expect(after.version).toEqual(original.version);
    expect(after.version.fields.find((f) => f.id === 'auditor_firm')?.label).toBe('Audit firm');
    const draft = await getVersion(author, 'clause', lib.auditors.templateId, successor.id);
    expect(
      draft.changes.some((c) => c.path.endsWith('label') && c.after === 'Name of audit firm'),
    ).toBe(true);
    const twice = await errorOf(
      applyVersionAction(author, 'clause', lib.auditors.templateId, lib.auditors.versionId, {
        action: 'new_version',
        requestId: rid(),
      }),
    );
    expect(twice.status).toBe(409);
  });

  it('A27/A28/A09/A11/A22: generates numbered clauses, is idempotent and keeps stored bytes', async () => {
    let rc = await select(boardCase, [pin('auditors'), pin('authority'), pin('general')]);
    expect(rc.selection!.clauses.map((c) => c.clauseId)).toEqual([
      lib.auditors.templateId,
      lib.authority.templateId,
      lib.general.templateId,
    ]);
    const view = await getCaseClauses(author, rc.id);
    expect(view.available.clauses.some((c) => c.clauseId === lib.auditors.templateId)).toBe(true);
    expect(view.form!.shared.filter((f) => !f.readOnly).map((f) => f.id)).toEqual([
      'resolution_date',
    ]);
    rc = await answer(rc, answers);
    const preview = await previewCase(author, rc.id);
    expect(preview.placeholders).toBe(false);

    const requestId = rid();
    const body = {
      requestId,
      caseId: rc.id,
      expectedCaseRevision: rc.revision,
      selectionRevision: rc.selection!.revision,
    };
    const first = await generateDocument(author, body);
    expect(first).toMatchObject({ status: 'Ready', predecessorId: null });
    const again = await generateDocument(author, body);
    expect(again.id).toBe(first.id);
    const conflict = await errorOf(
      generateDocument(author, { ...body, expectedCaseRevision: rc.revision + 1 }),
    );
    expect(conflict).toMatchObject({ code: 'CONFLICT', status: 409 });
    expect(
      (await db.select().from(s.documentGenerations).where(eq(s.documentGenerations.caseId, rc.id)))
        .length,
    ).toBe(1);

    const download = await downloadGeneration(author, first.id);
    expect(download.document.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(download.document.originalName).toMatch(/\.docx$/);
    const text = plain(documentXml(download.bytes));
    expect(text).toContain(`TEMPLATE TEST ${tag.toUpperCase()} SDN. BHD. (FICTIONAL)`);
    expect(text).toContain('Clause 11 of the Constitution (fictional)');
    const order = [
      '1.',
      `Appointment of auditors`,
      '2.',
      'Authority to sign documents',
      '3.',
      'Bank account',
    ].map((t) => text.indexOf(t));
    expect(order.every((n, i) => n >= 0 && (i === 0 || n > order[i - 1]))).toBe(true);
    expect(text).toContain(directors[1].name);
    // A07: three signers → three signature labels in order.
    const signerAt = directors.map((d) => text.lastIndexOf(`${d.name}Director`));
    expect(signerAt.every((n, i) => n > 0 && (i === 0 || n > signerAt[i - 1]))).toBe(true);
    expect((await downloadGeneration(author, first.id)).bytes.equals(download.bytes)).toBe(true);

    // A09: a later citation change leaves the stored document untouched; a new generation differs.
    const updated: CompanyProfile = {
      ...profile,
      revision: 2,
      citations: {
        ...profile.citations,
        directorAuthority: [
          ...profile.citations.directorAuthority!,
          citation('Clause 21 (amended, fictional)', '2026-10-20'),
        ],
      },
    };
    await db
      .update(s.companyProfiles)
      .set({ revision: 2, data: updated })
      .where(eq(s.companyProfiles.companyId, X));
    rc = await readCase(author, rc.id);
    // A27: reordering affects only the new generation.
    rc = await select(rc, [...rc.selection!.clauses].reverse());
    const second = await generate(rc, { familyId: first.familyId });
    expect(second).toMatchObject({
      status: 'Ready',
      predecessorId: first.id,
      familyId: first.familyId,
    });
    expect(second.snapshotHash).not.toBe(first.snapshotHash);
    const secondText = plain(documentXml((await downloadGeneration(author, second.id)).bytes));
    expect(secondText).toContain('Clause 21 (amended, fictional)');
    expect(secondText.indexOf('1.')).toBeLessThan(secondText.indexOf('Bank account'));
    expect(secondText.indexOf('Bank account')).toBeLessThan(
      secondText.indexOf('Appointment of auditors'),
    );
    const firstAgain = await downloadGeneration(author, first.id);
    expect(firstAgain.bytes.equals(download.bytes)).toBe(true);
    expect((await getGeneration(author, first.id)).sha256).toBe(first.sha256);

    // A28: switching to the members' output uses the members' wording and header.
    rc = await readCase(author, rc.id);
    rc = await select(rc, rc.selection!.clauses, lib.membersAssembly.versionId, 'members_written');
    rc = await applyClauseAction(author, rc.id, {
      action: 'save_answers',
      expectedRevision: rc.revision,
      requestId: rid(),
      selectionRevision: rc.selection!.revision,
      shared: { resolution_date: '2026-10-26' },
      clauses: rc.answers.clauses,
      signers: { directors: [], members: [], certifiers: [] },
    });
    const members = await previewCase(author, rc.id);
    const membersText = JSON.stringify(members.resolved);
    expect(membersText).toContain("MEMBERS' WRITTEN RESOLUTION");
    expect(membersText).toContain('authorised to fix their remuneration');
    expect(members.issues.some((i) => i.location.includes('Members signing'))).toBe(false);
    const blocked = await errorOf(generate(rc));
    expect(blocked.code).toBe('INCOMPLETE');
    expect(blocked.issues!.map((i) => i.location)).toContain('signers › Members signing');
    expect(
      (await db.select().from(s.documentGenerations).where(eq(s.documentGenerations.caseId, rc.id)))
        .length,
    ).toBe(2);

    // Outsiders cannot read the case, generations or downloads.
    expect(await errorOf(getGeneration(outsider, first.id))).toMatchObject({ status: 404 });
    expect(await errorOf(downloadGeneration(outsider, first.id))).toMatchObject({ status: 404 });
    expect(await errorOf(getCaseClauses(outsider, rc.id))).toMatchObject({ status: 404 });

    // Review is independent and bound to the exact bytes; execution needs company evidence.
    expect(
      await errorOf(
        applyGenerationAction(author, first.id, {
          action: 'review',
          requestId: rid(),
          decision: 'Approved',
        }),
      ),
    ).toMatchObject({
      code: 'SELF_APPROVAL',
    });
    const reviewed = await applyGenerationAction(reviewer, first.id, {
      action: 'review',
      requestId: rid(),
      decision: 'Approved',
      reason: 'Checked.',
    });
    expect(reviewed.records[0]).toMatchObject({
      kind: 'review',
      sha256: first.sha256,
      decision: 'Approved',
      actorId: reviewer.id,
    });
    const evidenceId = randomUUID();
    await insertDocument(author, {
      id: evidenceId,
      companyId: X,
      jobId: null,
      title: 'Signed copy (fictional)',
      originalName: 'signed.txt',
      mimeType: 'text/plain',
      size: 1,
      sha256: '0'.repeat(64),
      storageKey: `${randomUUID()}.txt`,
      createdBy: author.id,
      createdAt: new Date().toISOString(),
      classification: 'General',
    });
    const executed = await applyGenerationAction(author, first.id, {
      action: 'record_execution',
      requestId: rid(),
      signerPersonId: directors[0].id,
      capacity: 'Director',
      signedDate: '2026-10-26',
      evidenceId,
    });
    expect(executed.records.map((r) => r.kind)).toEqual(['review', 'execution']);
    expect(executed.status).toBe('Ready');
    expect(
      (
        await errorOf(
          applyGenerationAction(author, first.id, {
            action: 'record_execution',
            requestId: rid(),
            signerPersonId: 'stranger',
            capacity: 'Director',
            signedDate: '2026-10-26',
            evidenceId,
          }),
        )
      ).message,
    ).toMatch(/signer named/);
  });

  it('reads committed profile changes after generation and answer mutations wait for the company lock', async () => {
    const rc = await answer(await select(await newCase(), [pin('authority')]), answers);
    const [original] = await db
      .select()
      .from(s.companyProfiles)
      .where(eq(s.companyProfiles.companyId, X));
    const changed: CompanyProfile = {
      ...original.data,
      revision: original.revision + 1,
      citations: {
        ...original.data.citations,
        directorAuthority: [citation('Updated authority after lock wait (fictional)')],
      },
    };
    // Hold a real writer transaction until the reader is blocked on the company row. This
    // catches a repeatable-read snapshot established before the writer commits.
    async function duringUpdate<T>(read: () => Promise<T>) {
      const writer = await pool.getConnection();
      let reading: Promise<T> | undefined;
      try {
        await writer.beginTransaction();
        await writer.query('SELECT id FROM companies WHERE id = ? FOR UPDATE', [X]);
        await writer.query(
          'UPDATE company_profiles SET revision = ?, data = ? WHERE company_id = ?',
          [changed.revision, JSON.stringify(changed), X],
        );
        reading = read();
        // Attach a rejection handler immediately while we wait for the lock observation.
        void reading.catch(() => undefined);
        let waiting = false;
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const [rows] =
            await pool.query<import('mysql2').RowDataPacket[]>('SHOW FULL PROCESSLIST');
          if (
            rows.some(
              (row) =>
                typeof row.Info === 'string' && /from `companies`.*for update/i.test(row.Info),
            )
          ) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(waiting, 'reader reached the company lock before the writer committed').toBe(true);
        await writer.commit();
        return await reading;
      } finally {
        await writer.rollback();
        writer.release();
        if (reading) await reading.catch(() => undefined);
        await db
          .update(s.companyProfiles)
          .set({ revision: original.revision, data: original.data })
          .where(eq(s.companyProfiles.companyId, X));
      }
    }
    const generation = await duringUpdate(() =>
      generateDocument(author, {
        requestId: rid(),
        caseId: rc.id,
        expectedCaseRevision: rc.revision,
        selectionRevision: rc.selection!.revision,
      }),
    );
    expect(generation.snapshot.company).toMatchObject({
      profileRevision: changed.revision,
      citations: { directorAuthority: 'Updated authority after lock wait (fictional)' },
    });
    const current = await readCase(author, rc.id);
    let observedRevision: number | undefined;
    await duringUpdate(() =>
      mutateCase(author, rc.id, current.revision, rid(), 'save_answers', async (next, tx) => {
        observedRevision = (await loadResolutionContext(author, next.id, '2026-10-26', tx)).company
          .profileRevision;
        return { next, detail: 'Test current source records' };
      }),
    );
    expect(observedRevision).toBe(changed.revision);
  });

  it('A12 records render and storage failures without a downloadable artifact or orphan file', async () => {
    let rc = await newCase();
    rc = await select(rc, [pin('general')]);
    rc = await answer(rc, { general: answers.general });
    const failed = await generate(
      rc,
      {},
      {
        render: async () => {
          throw new Error('renderer crashed');
        },
        store: (await import('../src/server/storage')).storeGenerated,
      },
    );
    expect(failed).toMatchObject({ status: 'Failed', documentId: null, sha256: null });
    expect(failed.failure).toMatch(/renderer crashed/);
    expect(await errorOf(downloadGeneration(author, failed.id))).toMatchObject({
      code: 'NOT_READY',
    });
    const { storeGenerated } = await import('../src/server/storage');
    const before = (await readdir(storageDirectory)).length;
    rc = await readCase(author, rc.id);
    const storeFailed = await generate(
      rc,
      {},
      {
        render: async (doc) =>
          (await import('../src/server/resolution/render-docx')).renderDocx(doc),
        store: async (...args) => {
          await storeGenerated(...args);
          throw new Error('disk full');
        },
      },
    );
    expect(storeFailed.status).toBe('Failed');
    expect((await readdir(storageDirectory)).length).toBe(before);
    expect(
      (await db.select().from(s.documents).where(eq(s.documents.companyId, X))).some(
        (d) => d.data.generationId === storeFailed.id,
      ),
    ).toBe(false);
    const audit = await db
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.subjectId, failed.id));
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['document_generation.created', 'document_generation.failed']),
    );
  });

  it('reconciles stale pending generations and removes orphan files', async () => {
    let rc = await newCase();
    rc = await select(rc, [pin('general')]);
    const pending = await getGeneration(
      author,
      (await generate(await answer(rc, { general: answers.general }))).id,
    );
    const stale: DocumentGeneration = {
      ...pending,
      id: randomUUID(),
      status: 'Pending',
      documentId: null,
      sha256: null,
      finalisedAt: null,
    };
    await db.insert(s.documentGenerations).values({
      id: stale.id,
      familyId: stale.familyId,
      caseId: stale.caseId,
      companyId: X,
      status: 'Pending',
      requestKey: `${author.id}:generate:stale-${tag}`,
      data: stale,
      createdAt: new Date(Date.now() - 11 * 60_000),
    });
    const orphan = path.join(storageDirectory, `${randomUUID()}.docx`);
    await writeFile(orphan, 'PK');
    const old = new Date(Date.now() - 11 * 60_000);
    await utimes(orphan, old, old);
    const result = await reconcilePendingGenerations();
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(result.removedFiles).toBeGreaterThanOrEqual(1);
    expect((await getGeneration(author, stale.id)).status).toBe('Failed');
    expect((await readdir(storageDirectory)).includes(path.basename(orphan))).toBe(false);
    expect((await getGeneration(author, pending.id)).status).toBe('Ready');
  });

  it('A06/fees: conditional variant, exact per-director total and guessed ids rejected', async () => {
    let rc = await newCase();
    rc = await select(rc, [pin('fees')], lib.membersAssembly.versionId, 'members_written');
    const key = rc.selection!.clauses[0].key;
    const save = (fees: Record<string, unknown>, selectionRevision = rc.selection!.revision) =>
      applyClauseAction(author, rc.id, {
        action: 'save_answers',
        expectedRevision: rc.revision,
        requestId: rid(),
        selectionRevision,
        shared: { resolution_date: '2026-10-26' },
        clauses: { [key]: fees },
        signers: { directors: [], members: [], certifiers: [] },
      });
    const guessed = await errorOf(
      save({ fees_payable: true, fee_directors: [directors[0].id, 'someone-else'] }),
    );
    expect(guessed.code).toBe('INCOMPLETE');
    expect(await errorOf(save({ fees_payable: true }, rc.selection!.revision + 5))).toMatchObject({
      code: 'STALE',
      status: 409,
    });
    rc = await save({
      fees_payable: true,
      fee_year_end: '2026-12-31',
      fee_directors: [directors[0].id, directors[1].id],
      fee_amount: { [directors[0].id]: '1000.10', [directors[1].id]: '2000.25' },
    });
    const paid = await previewCase(author, rc.id);
    expect(paid.values[`${key}.fee_total`]).toBe('RM 3,000.35');
    expect(paid.values.lapse_date).toBe('23 November 2026');
    expect(paid.resolved.containsSamples).toBe(true);
    rc = await save({ fees_payable: false, fee_year_end: '2026-12-31' });
    const none = JSON.stringify((await previewCase(author, rc.id)).resolved);
    expect(none).toContain("THAT no directors' fees be paid");
    expect(none).not.toContain('RM ');
  });

  it('A30/A31: newer versions are offered not applied; hidden clauses leave the library but stay readable', async () => {
    let rc = await newCase();
    rc = await select(rc, [pin('authority')]);
    const pinned = rc.selection!.clauses[0].clauseVersionId;
    const successor = (
      await applyVersionAction(author, 'clause', lib.authority.templateId, pinned, {
        action: 'new_version',
        requestId: rid(),
      })
    ).version;
    let v = (
      await applyVersionAction(author, 'clause', lib.authority.templateId, successor.id, {
        action: 'save_draft',
        requestId: rid(),
        expectedRevision: successor.revision,
        ...starter('authority').content,
        source: 'Fictional test wording v2',
        effectiveDate: '2026-10-01',
      })
    ).version;
    v = (
      await applyVersionAction(author, 'clause', lib.authority.templateId, v.id, {
        action: 'submit',
        requestId: rid(),
        expectedRevision: v.revision,
      })
    ).version;
    v = (
      await applyVersionAction(reviewer, 'clause', lib.authority.templateId, v.id, {
        action: 'publish',
        requestId: rid(),
        expectedRevision: v.revision,
        confirm: true,
      })
    ).version;
    expect(
      (await getVersion(author, 'clause', lib.authority.templateId, pinned)).version.status,
    ).toBe('Superseded');
    rc = await readCase(author, rc.id);
    expect(rc.selection!.clauses[0].clauseVersionId).toBe(pinned);
    const view = await getCaseClauses(author, rc.id);
    expect(view.available.newerVersions).toEqual([
      expect.objectContaining({
        key: rc.selection!.clauses[0].key,
        pinnedVersionId: pinned,
        newerVersionId: v.id,
        newerVersion: 2,
      }),
    ]);
    // A superseded pin is still usable when the selection is saved again.
    rc = await select(rc, rc.selection!.clauses);
    rc = await applyClauseAction(author, rc.id, {
      action: 'accept_version',
      expectedRevision: rc.revision,
      requestId: rid(),
      key: rc.selection!.clauses[0].key,
      clauseVersionId: v.id,
    });
    expect(rc.selection!.clauses[0].clauseVersionId).toBe(v.id);
    lib.authority.versionId = v.id;

    const template = (await listTemplates(author, 'clause', { includeHidden: true })).find(
      (t) => t.id === lib.general.templateId,
    )!;
    await templateAction(author, 'clause', {
      action: 'update',
      requestId: rid(),
      id: template.id,
      expectedRevision: template.revision,
      hidden: true,
      reason: 'Retired (test)',
    });
    const fresh = await newCase();
    const available = await getCaseClauses(author, fresh.id);
    expect(available.available.clauses.some((c) => c.clauseId === lib.general.templateId)).toBe(
      false,
    );
    expect(
      (await listTemplates(author, 'clause')).some((t) => t.id === lib.general.templateId),
    ).toBe(false);
    expect(
      (await listTemplates(author, 'clause', { includeHidden: true })).some(
        (t) => t.id === lib.general.templateId,
      ),
    ).toBe(true);
    expect(
      (await getVersion(author, 'clause', lib.general.templateId, lib.general.versionId)).version
        .status,
    ).toBe('Published');
    expect(await errorOf(select(fresh, [pin('general')]))).toMatchObject({
      message: expect.stringMatching(/hidden/),
    });
    expect(
      (await listTemplates(author, 'clause', { category: 'Auditor' })).every(
        (t) => 'category' in t && t.category === 'Auditor',
      ),
    ).toBe(true);
    const updatedTemplate = (await listTemplates(author, 'clause', { includeHidden: true })).find(
      (t) => t.id === lib.general.templateId,
    )!;
    await templateAction(author, 'clause', {
      action: 'update',
      requestId: rid(),
      id: updatedTemplate.id,
      expectedRevision: updatedTemplate.revision,
      hidden: false,
    });
  });

  it('starts a director-change case from the starter assembly and requires a reason to remove its director clause', async () => {
    const now = new Date().toISOString();
    const job = {
      id: jobId,
      companyId: X,
      activity: 'W04',
      title: 'Fictional appointment',
      year: null,
      anniversaryDate: null,
      snapshot: null,
      route: 'appointment',
      personId: null,
      personName: 'Aminah binti Yusof (fictional)',
      effectiveDate: '2026-11-01',
      routeBasis: '',
      sourceEvidenceIds: [],
      recordEventId: null,
      ownerId: author.id,
      createdBy: author.id,
      state: 'Preparing',
      revision: 1,
      createdAt: now,
      updatedAt: now,
      internalTarget: null,
      statutoryDue: null,
      manualDateBasis: '',
      manualDateEvidenceId: null,
      deadlineReviewRequired: false,
      ruleVersionId: null,
      dependencyIds: [],
      packs: [],
      reviews: [],
      correspondence: [],
      clientConfirmed: false,
      clientConfirmationEvidenceId: null,
      filingState: 'Not ready',
      filingNotRequiredReason: null,
      filingAttempts: [],
      billingState: 'Not ready',
      notes: [],
      history: [],
    } as unknown as Job;
    await db
      .insert(s.jobs)
      .values({ id: jobId, companyId: X, periodKey: null, revision: 1, data: job });
    let rc = await newCase('director_appointment', { jobId });
    rc = await select(rc, [], lib.appointmentAssembly.versionId);
    expect(rc.selection!.clauses.map((c) => c.clauseId)).toEqual([
      lib.appointment.templateId,
      lib.authority.templateId,
    ]);
    const withoutReason = await errorOf(
      select(rc, [rc.selection!.clauses[1]], lib.appointmentAssembly.versionId),
    );
    expect(withoutReason.code).toBe('REASON_REQUIRED');
    const kept = rc.selection!.clauses[1];
    rc = await select(rc, [kept], lib.appointmentAssembly.versionId, 'directors_written', {
      removalReasons: {
        [lib.appointment.templateId]: 'Appointment handled in a separate resolution (test).',
      },
    });
    expect(rc.selection!.removals).toEqual([
      expect.objectContaining({
        clauseId: lib.appointment.templateId,
        actorId: author.id,
        reason: 'Appointment handled in a separate resolution (test).',
      }),
    ]);
    expect(rc.selection!.clauses[0].key).toBe(kept.key);
  });

  it('M9/A15/A18: binds a W04 appointment, attaches the exact document to a new pack version and blocks stale use', async () => {
    const appointeeId = `tt-appointee-${tag}`;
    const [row] = await db.select().from(s.jobs).where(eq(s.jobs.id, jobId));
    const job: Job = {
      ...row.data,
      personId: appointeeId,
      revision: row.revision + 1,
      packs: [
        {
          version: 1,
          createdAt: new Date().toISOString(),
          createdBy: author.id,
          notes: '',
          documentIds: [],
          checklist: [],
          requiredSigners: [],
          signatures: [],
          templateVersionId: null,
          state: 'Draft',
        },
      ],
    };
    await db.update(s.jobs).set({ data: job, revision: job.revision }).where(eq(s.jobs.id, jobId));
    let rc = await newCase('director_appointment', { jobId });
    rc = await select(rc, [], lib.appointmentAssembly.versionId);
    const appointment = rc.selection!.clauses.find(
      (c) => c.clauseId === lib.appointment.templateId,
    )!;
    // The job's proposed person and effective date are bound into the director clause.
    expect(rc.answers.clauses[appointment.key]).toEqual({
      appointee: appointeeId,
      appointment_date: '2026-11-01',
    });
    rc = await answer(rc, {
      appointment: rc.answers.clauses[appointment.key] as Record<string, unknown>,
      authority: answers.authority,
    });
    const generation = await generate(rc);
    expect(generation.status).toBe('Ready');
    const text = plain(documentXml((await downloadGeneration(author, generation.id)).bytes));
    expect(text).toContain('Aminah binti Yusof (fictional)');
    expect(text).toContain('1 November 2026');

    const self = await errorOf(
      attachGenerationToPack(reviewer, generation.id, {
        action: 'attach_to_pack',
        requestId: rid(),
        expectedJobRevision: job.revision,
      }),
    );
    expect(self.code).toBe('FORBIDDEN'); // reviewer lacks prepare_job
    const attached = (await attachGenerationToPack(author, generation.id, {
      action: 'attach_to_pack',
      requestId: rid(),
      expectedJobRevision: job.revision,
    })) as Job;
    expect(attached.packs.at(-1)).toMatchObject({ version: 2, state: 'Draft' });
    expect(attached.packs.at(-1)!.documentIds).toEqual([generation.documentId]);
    expect(attached.history.at(-1)!.action).toBe('resolution_attached');
    // Approvals of pack v1 do not carry to v2: the new version starts unreviewed.
    expect(attached.reviews.filter((r) => r.version === 2)).toEqual([]);

    // A generic pack signature cannot satisfy the three named signers of this exact document.
    const signedCopy = {
      ...(await downloadGeneration(author, generation.id)).document,
      id: rid(),
      generationId: undefined,
      title: 'Signed resolution evidence (fictional)',
    };
    await insertDocument(author, signedCopy);
    const reviewed = structuredClone(attached);
    reviewed.sourceEvidenceIds = [signedCopy.id];
    reviewed.routeBasis = 'Fictional authority';
    // Posting re-checks the appointee; the fixture's placeholder id stands for a new person.
    reviewed.personId = randomUUID();
    const reviewedPack = reviewed.packs.at(-1)!;
    reviewedPack.requiredSigners = ['Legacy signer'];
    reviewedPack.signatures = [
      { signer: 'Legacy signer', evidenceId: signedCopy.id, receivedDate: '2026-10-26' },
    ];
    reviewed.reviews = ['pack', 'record'].map((scope) => ({
      id: rid(),
      version: reviewedPack.version,
      scope: scope as 'pack' | 'record',
      decision: 'Approved',
      actorId: reviewer.id,
      at: new Date().toISOString(),
      reason: 'Fictional independent review',
    }));
    const poster = {
      ...reviewer,
      capabilities: [...reviewer.capabilities, 'confirm_record' as const],
    };
    const post = () =>
      db.transaction(async (tx) =>
        reviewActions.post_record.run(
          {
            actor: poster,
            job: reviewed,
            tx,
            now: new Date().toISOString(),
            input: { confirmed: true },
          },
          { confirmed: true },
        ),
      );
    expect((await errorOf(post())).message).toMatch(/signature evidence is missing for generation/);
    for (const [i, director] of directors.entries()) {
      await applyGenerationAction(author, generation.id, {
        action: 'record_execution',
        requestId: rid(),
        signerPersonId: director.id,
        capacity: 'Director',
        signedDate: '2026-10-26',
        evidenceId: signedCopy.id,
      });
      const status = await db.transaction((tx) => generatedExecutionStatus(poster, reviewed, tx));
      expect(status).toMatchObject({ required: 3, signed: i + 1 });
      expect(status.blockers).toHaveLength(2 - i);
      if (i < 2) {
        expect((await errorOf(post())).message).toMatch(
          /signature evidence is missing for generation/,
        );
        expect(await db.transaction((tx) => reviewedExecutionState(poster, reviewed, tx))).toBe(
          'Partly signed',
        );
      }
    }
    expect(await db.transaction((tx) => reviewedExecutionState(poster, reviewed, tx))).toBe(
      'Fully signed',
    );
    // Exercise actual posting, then roll its event/projection/audit back to preserve this fixture.
    const rollback = new Error('rollback verified posting');
    await expect(
      db.transaction(async (tx) => {
        await reviewActions.post_record.run(
          {
            actor: poster,
            job: reviewed,
            tx,
            now: new Date().toISOString(),
            input: { confirmed: true },
          },
          { confirmed: true },
        );
        expect(reviewed.recordEventId).toBeTruthy();
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    const again = await errorOf(
      attachGenerationToPack(author, generation.id, {
        action: 'attach_to_pack',
        requestId: rid(),
        expectedJobRevision: attached.revision,
      }),
    );
    expect(again.message).toMatch(/already in the current pack/);

    // A later change to the proposed date makes this generation stale for the pack.
    const changed = { ...attached, effectiveDate: '2026-11-02', revision: attached.revision + 1 };
    await db
      .update(s.jobs)
      .set({ data: changed, revision: changed.revision })
      .where(eq(s.jobs.id, jobId));
    const stale = await errorOf(
      attachGenerationToPack(author, generation.id, {
        action: 'attach_to_pack',
        requestId: rid(),
        expectedJobRevision: changed.revision,
      }),
    );
    expect(stale.code).toBe('STALE');
  });

  it('attach rejects director answers that differ from the job, replaces earlier family versions and never reopens a closed job', async () => {
    const appointeeId = `tt-appointee-${tag}`;
    const [row] = await db.select().from(s.jobs).where(eq(s.jobs.id, jobId));
    let job: Job = {
      ...row.data,
      personId: appointeeId,
      effectiveDate: '2026-11-01',
      state: 'Preparing',
      revision: row.revision + 1,
    };
    await db.update(s.jobs).set({ data: job, revision: job.revision }).where(eq(s.jobs.id, jobId));
    const otherFamilyDocs = job.packs.at(-1)!.documentIds;

    let rc = await newCase('director_appointment', { jobId });
    rc = await select(rc, [], lib.appointmentAssembly.versionId);
    const key = rc.selection!.clauses.find((c) => c.clauseId === lib.appointment.templateId)!.key;
    const bound = rc.answers.clauses[key] as Record<string, unknown>;
    // The preparer changes the prefilled date after binding: the job itself is unchanged.
    rc = await answer(rc, {
      appointment: { ...bound, appointment_date: '2026-11-05' },
      authority: answers.authority,
    });
    const drifted = await generate(rc);
    expect(drifted.status).toBe('Ready');
    const mismatch = await errorOf(
      attachGenerationToPack(author, drifted.id, {
        action: 'attach_to_pack',
        requestId: rid(),
        expectedJobRevision: job.revision,
      }),
    );
    expect(mismatch).toMatchObject({ code: 'STALE', status: 409 });
    expect(mismatch.message).toMatch(/effective date/);

    // A8: every generation advances the case revision, so a duplicate on the old revision is stale.
    const duplicate = await errorOf(generate(rc, { familyId: drifted.familyId }));
    expect(duplicate).toMatchObject({ code: 'STALE', status: 409 });

    rc = await readCase(author, rc.id);
    rc = await answer(rc, { appointment: bound, authority: answers.authority });
    const first = await generate(rc, { familyId: drifted.familyId });
    job = (await attachGenerationToPack(author, first.id, {
      action: 'attach_to_pack',
      requestId: rid(),
      expectedJobRevision: job.revision,
    })) as Job;
    expect(job.packs.at(-1)!.documentIds).toEqual([...otherFamilyDocs, first.documentId]);

    rc = await readCase(author, rc.id);
    const second = await generate(rc, { familyId: first.familyId });
    expect(second.predecessorId).toBe(first.id);
    job = (await attachGenerationToPack(author, second.id, {
      action: 'attach_to_pack',
      requestId: rid(),
      expectedJobRevision: job.revision,
    })) as Job;
    // The newer version replaces the earlier one of the same family; other documents stay.
    expect(job.packs.at(-1)!.documentIds).toEqual([...otherFamilyDocs, second.documentId]);
    expect(job.history.at(-1)!.detail).toMatch(/replacing 1 earlier version/);

    for (const state of ['Complete', 'Cancelled'] as const) {
      const closed = { ...job, state, revision: job.revision + 1 };
      await db
        .update(s.jobs)
        .set({ data: closed, revision: closed.revision })
        .where(eq(s.jobs.id, jobId));
      job = closed;
      const refused = await errorOf(
        attachGenerationToPack(author, first.id, {
          action: 'attach_to_pack',
          requestId: rid(),
          expectedJobRevision: job.revision,
        }),
      );
      expect(refused).toMatchObject({ code: 'CONFLICT', status: 409 });
      const [after] = await db.select().from(s.jobs).where(eq(s.jobs.id, jobId));
      expect(after.data.state).toBe(state);
      expect(after.revision).toBe(job.revision);
    }
  });

  it("stores and returns only the people a generation uses, never the preparer's other companies", async () => {
    let rc = await newCase();
    rc = await select(rc, [pin('authority')]);
    rc = await answer(rc, { authority: answers.authority });
    const wide = await loadResolutionContext(both, rc.id, '2026-10-26');
    expect(wide.proposedPeople.some((p) => p.id === yPersonId)).toBe(true);

    const generation = await generateDocument(both, {
      requestId: rid(),
      caseId: rc.id,
      expectedCaseRevision: rc.revision,
      selectionRevision: rc.selection!.revision,
    });
    expect(generation.status).toBe('Ready');
    const [stored] = await db
      .select()
      .from(s.documentGenerations)
      .where(eq(s.documentGenerations.id, generation.id));
    for (const view of [stored.data, generation, await getGeneration(both, generation.id)])
      expect(JSON.stringify(view)).not.toContain(yPersonId);
    const snapshot = stored.data.snapshot;
    expect(snapshot.company.id).toBe(X);
    expect(snapshot.directors.map((d) => d.id).sort()).toEqual(directors.map((d) => d.id).sort());
    expect(snapshot.proposedPeople.every((p) => directors.some((d) => d.id === p.id))).toBe(true);
    expect(stored.data.snapshotHash).toBe(sha256(canonical(snapshot)));
  });

  it('a reviewer who edited a draft cannot publish it', async () => {
    const created = await templateAction(author, 'clause', {
      action: 'create',
      requestId: rid(),
      ...clauseMeta('general', { name: `Editors ${tag}` }),
    });
    templateIds.push({ kind: 'clause', id: created.id });
    const step = async (who: Actor, body: Record<string, unknown>, revision: number) =>
      (
        await applyVersionAction(who, 'clause', created.id, created.versions[0].id, {
          requestId: rid(),
          expectedRevision: revision,
          ...body,
        })
      ).version;
    const content = {
      action: 'save_draft',
      ...starter('general').content,
      source: 'Fictional test wording',
      effectiveDate: '2026-10-01',
    };
    let v = await step(author, content, created.versions[0].revision);
    v = await step(author, { action: 'submit' }, v.revision);
    v = await step(reviewer, { action: 'return', reason: 'I will tidy it.' }, v.revision);
    v = await step(reviewer, content, v.revision);
    expect(v.editors).toEqual([author.id, reviewer.id]);
    v = await step(author, { action: 'submit' }, v.revision);
    const own = await errorOf(step(reviewer, { action: 'publish', confirm: true }, v.revision));
    expect(own).toMatchObject({ code: 'SELF_APPROVAL', status: 403 });
    const independent = { ...outsider, id: randomUUID() };
    v = await step(independent, { action: 'publish', confirm: true }, v.revision);
    expect(v.status).toBe('Published');
  });

  it('a future-dated successor keeps the version in force selectable until its effective date', async () => {
    const lineage = await publish(
      'clause',
      clauseMeta('general', { name: `Future ${tag}` }),
      starter('general').content,
    );
    const draft = (
      await applyVersionAction(author, 'clause', lineage.templateId, lineage.versionId, {
        action: 'new_version',
        requestId: rid(),
      })
    ).version;
    let v = (
      await applyVersionAction(author, 'clause', lineage.templateId, draft.id, {
        action: 'save_draft',
        requestId: rid(),
        expectedRevision: draft.revision,
        ...starter('general').content,
        source: 'Fictional future wording',
        effectiveDate: '2099-01-01',
      })
    ).version;
    v = (
      await applyVersionAction(author, 'clause', lineage.templateId, v.id, {
        action: 'submit',
        requestId: rid(),
        expectedRevision: v.revision,
      })
    ).version;
    v = (
      await applyVersionAction(reviewer, 'clause', lineage.templateId, v.id, {
        action: 'publish',
        requestId: rid(),
        expectedRevision: v.revision,
        confirm: true,
      })
    ).version;
    expect(v.status).toBe('Published');
    const fresh = await newCase();
    const view = await getCaseClauses(author, fresh.id);
    const offered = view.available.clauses.filter((c) => c.clauseId === lineage.templateId);
    expect(offered.map((c) => c.clauseVersionId)).toEqual([lineage.versionId]);
    const rc = await select(fresh, [
      { clauseId: lineage.templateId, clauseVersionId: lineage.versionId },
    ]);
    expect(rc.selection!.clauses[0].clauseVersionId).toBe(lineage.versionId);
    expect((await getCaseClauses(author, rc.id)).available.newerVersions).toEqual([]);
    const early = await errorOf(
      select(rc, [{ clauseId: lineage.templateId, clauseVersionId: v.id }]),
    );
    expect(early.message).toMatch(/not effective yet/);
  });

  it('previews starters and generates only with wording in force on the case date', async () => {
    const lineage = await publish(
      'clause',
      clauseMeta('general', { name: `In force ${tag}` }),
      starter('general').content,
    );
    const futureContent = structuredClone(starter('general').content);
    futureContent.wordings.directors_written = [
      { type: 'paragraph', content: [{ type: 'text', text: `Future wording ${tag}` }] },
      ...futureContent.wordings.directors_written!,
    ];
    const draft = (
      await applyVersionAction(author, 'clause', lineage.templateId, lineage.versionId, {
        action: 'new_version',
        requestId: rid(),
      })
    ).version;
    let v = (
      await applyVersionAction(author, 'clause', lineage.templateId, draft.id, {
        action: 'save_draft',
        requestId: rid(),
        expectedRevision: draft.revision,
        ...futureContent,
        source: 'Fictional future wording',
        effectiveDate: '2099-01-01',
      })
    ).version;
    v = (
      await applyVersionAction(author, 'clause', lineage.templateId, v.id, {
        action: 'submit',
        requestId: rid(),
        expectedRevision: v.revision,
      })
    ).version;
    await applyVersionAction(reviewer, 'clause', lineage.templateId, v.id, {
      action: 'publish',
      requestId: rid(),
      expectedRevision: v.revision,
      confirm: true,
    });
    // The predecessor is now Superseded but still in force, so the preview keeps its wording.
    const preview = await previewTemplate(author, {
      kind: 'assembly',
      versionId: directorsAssembly.versionId,
      draft: assemblyContent('directors', [lineage.templateId]),
    });
    const previewText = JSON.stringify(preview.resolved);
    expect(previewText).not.toContain('The clauses chosen for the case appear here.');
    expect(previewText).not.toContain(`Future wording ${tag}`);

    // A case dated after the version took effect is moved back before it.
    let rc = await select(await newCase(), [pin('general')]);
    rc = await changeCase(author, rc.id, {
      action: 'update_details',
      requestId: rid(),
      expectedRevision: rc.revision,
      resolutionDate: '2026-09-01',
    });
    const blocked = await errorOf(generate(rc));
    expect(blocked.message).toMatch(/takes effect after the resolution date \(2026-09-01\)/);
  });

  it('copies a template into a new lineage keeping field ids, and uploads still reject Word files', async () => {
    const copy = await templateAction(author, 'clause', {
      action: 'copy',
      requestId: rid(),
      sourceId: lib.fees.templateId,
      name: `Fees copy ${tag}`,
    });
    templateIds.push({ kind: 'clause', id: copy.id });
    expect(copy.id).not.toBe(lib.fees.templateId);
    expect(copy.versions).toHaveLength(1);
    const [v] = copy.versions as {
      status: string;
      version: number;
      predecessorId: string | null;
      fields: { id: string }[];
    }[];
    expect(v).toMatchObject({ status: 'Draft', version: 1, predecessorId: null });
    expect(v.fields.map((f) => f.id)).toEqual(starter('fees').content.fields.map((f) => f.id));
    const docx = Buffer.from('PK\u0003\u0004fake');
    expect(() => validateFile('resolution.docx', DOCX_MIME, docx)).toThrow(
      /PDF, PNG, JPEG or plain text/,
    );
    expect(safeStoragePath(`${randomUUID()}.docx`)).toMatch(/\.docx$/);
    expect(() => safeStoragePath('../escape.docx')).toThrow();
  });

  it('previews templates with fictional values only and manages output types', async () => {
    const preview = await previewTemplate(author, {
      kind: 'assembly',
      versionId: lib.appointmentAssembly.versionId,
    });
    const text = JSON.stringify(preview.resolved);
    expect(text).toContain('SAMPLE — fictional values');
    expect(text).toContain('EXAMPLE HOLDINGS SDN. BHD. (FICTIONAL)');
    expect(text).not.toContain(`Template test ${tag}`);
    expect(preview.resolved.containsSamples).toBe(true);
    const draft = await previewTemplate(author, {
      kind: 'clause',
      versionId: lib.auditors.versionId,
      outputTypeId: 'members_written',
      draft: {
        wordings: {
          members_written: [{ type: 'paragraph', content: [{ type: 'text', text: 'Draft only' }] }],
        },
        fields: [],
      },
    });
    expect(JSON.stringify(draft.resolved)).toContain('Draft only');
    const types = await applyOutputTypeAction(author, {
      action: 'create',
      requestId: rid(),
      id: outputTypeId,
      name: 'Extract (test)',
      body: 'directors',
    });
    expect(types.some((t) => t.id === outputTypeId && t.active)).toBe(true);
    expect(
      await errorOf(
        applyOutputTypeAction(outsider, {
          action: 'create',
          requestId: rid(),
          id: outputTypeId,
          name: 'x',
          body: 'members',
        }),
      ),
    ).toMatchObject({
      status: 409,
    });
    const noRights = { ...outsider, capabilities: ['generate_documents' as const] };
    expect(
      await errorOf(
        applyOutputTypeAction(noRights, {
          action: 'update',
          requestId: rid(),
          id: outputTypeId,
          active: false,
        }),
      ),
    ).toMatchObject({ status: 403 });
  });
});
