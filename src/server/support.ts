import { createHash, randomUUID } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import { assertCapability, DomainError, today } from '../domain/access';
import type { Actor, CatalogueVersion, Settings } from '../domain/model';
import {
  getCompany,
  getJob,
  getSettings,
  listCompanyIds,
  listDocuments,
  listJobs,
  listReminders,
  mutateSettings,
  pruneRequests,
  reconcileCompanyReminders,
  saveActorPreferences,
  getActorById,
} from './repository';
import { storeUpload } from './storage';
export { deriveReminders } from '../domain/reminders';

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value,
    'Enter a valid calendar date.',
  );
const nullableDate = date.nullable().default(null);
const base = { expectedRevision: z.number().int().positive(), requestId: z.string().uuid() };
const settingsAction = z.discriminatedUnion('action', [
  z.object({
    ...base,
    action: z.literal('defaults'),
    firmName: z.string().trim().min(1).max(120),
    preparationLeadDays: z.number().int().min(0).max(365),
    chaseIntervalDays: z.number().int().min(1).max(90),
    defaultOwnerId: z.string().min(1).max(64).nullable(),
  }),
  z.object({
    ...base,
    action: z.literal('catalogue_draft'),
    kind: z.enum(['template', 'checklist', 'rule']),
    name: z.string().trim().min(1).max(160),
    content: z.string().min(1).max(100_000),
    source: z.string().trim().max(2000).default(''),
    effectiveDate: nullableDate,
    predecessorId: z.string().min(1).max(64).nullable().optional(),
  }),
  z.object({
    ...base,
    action: z.literal('catalogue_publish'),
    versionId: z.string().min(1).max(64),
    confirmImpact: z.literal(true),
  }),
]);
export const preferencesSchema = z
  .object({
    textSize: z.enum(['default', 'large', 'larger']),
    density: z.enum(['comfortable', 'compact']),
    reducedMotion: z.boolean(),
  })
  .strict();
const placeholders = [
  'company.name',
  'company.registrationNumber',
  'company.address',
  'job.title',
  'job.year',
  'job.anniversaryDate',
  'job.effectiveDate',
  'firm.name',
  'today',
] as const;
export function cleanRichText(content: string) {
  return sanitizeHtml(content, {
    allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li'],
    allowedAttributes: {},
  });
}
export function validateTemplate(content: string) {
  const found = [...content.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) => match[1]);
  const unknown = found.filter(
    (key) => !placeholders.includes(key as (typeof placeholders)[number]),
  );
  if (unknown.length)
    throw new DomainError(`Unknown template placeholder: ${[...new Set(unknown)].join(', ')}.`);
  const remainder = content.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, '');
  if (remainder.includes('{{') || remainder.includes('}}'))
    throw new DomainError('Complete or remove the malformed template placeholder.');
  if (!sanitizeHtml(content, { allowedTags: [], allowedAttributes: {} }).trim())
    throw new DomainError('Enter catalogue content before publication.');
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
export function renderTemplate(content: string, values: Record<string, string>) {
  validateTemplate(content);
  return cleanRichText(content).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match: string, key: string) =>
    escape(values[key] ?? '—'),
  );
}

/** Read-only: reminders are kept current by job changes and the worker, never by page loads. */
export async function getWorkspaceSupport(actor: Actor) {
  const [documents, settings, reminders] = await Promise.all([
    listDocuments(actor),
    getSettings(),
    listReminders(actor),
  ]);
  return {
    documents: documents.map(({ storageKey, ...metadata }) => {
      void storageKey;
      return metadata;
    }),
    settings,
    reminders,
  };
}

export async function applySettingsAction(actor: Actor, input: unknown) {
  assertCapability(actor, 'manage_catalogue');
  const action = settingsAction.parse(input);
  if (action.action === 'defaults' && action.defaultOwnerId) {
    const owner = await getActorById(action.defaultOwnerId);
    if (!owner?.capabilities.includes('prepare_job'))
      throw new DomainError('Choose an active preparer as default owner.');
  }
  return mutateSettings(actor, action.expectedRevision, action.requestId, (settings: Settings) => {
    if (action.action === 'defaults')
      return {
        ...settings,
        firmName: action.firmName,
        preparationLeadDays: action.preparationLeadDays,
        chaseIntervalDays: action.chaseIntervalDays,
        defaultOwnerId: action.defaultOwnerId,
      };
    if (action.action === 'catalogue_draft') {
      const predecessor = action.predecessorId
        ? settings.catalogue.find((item) => item.id === action.predecessorId)
        : null;
      if (action.predecessorId && !predecessor)
        throw new DomainError('The predecessor version is unavailable.');
      if (predecessor && (predecessor.kind !== action.kind || predecessor.name !== action.name))
        throw new DomainError('A revision must preserve its catalogue name and type.');
      const content = cleanRichText(action.content);
      if (!sanitizeHtml(content, { allowedTags: [], allowedAttributes: {} }).trim())
        throw new DomainError('Enter catalogue content.');
      const version: CatalogueVersion = {
        id: randomUUID(),
        kind: action.kind,
        name: action.name,
        version:
          Math.max(
            0,
            ...settings.catalogue
              .filter((item) => item.name === action.name && item.kind === action.kind)
              .map((item) => item.version),
          ) + 1,
        status: 'Draft',
        content,
        source: action.source,
        effectiveDate: action.effectiveDate,
        createdBy: actor.id,
        createdAt: new Date().toISOString(),
        approvedBy: null,
        approvedAt: null,
        predecessorId: predecessor?.id || null,
      };
      return { ...settings, catalogue: [...settings.catalogue, version] };
    }
    assertCapability(actor, 'review_pack');
    const version = settings.catalogue.find((item) => item.id === action.versionId);
    if (!version) throw new DomainError('The catalogue version is unavailable.', 'NOT_FOUND', 404);
    if (version.status !== 'Draft')
      throw new DomainError('Only a draft catalogue version can be published.', 'CONFLICT', 409);
    if (version.createdBy === actor.id)
      throw new DomainError(
        'An independent reviewer must publish this version.',
        'SELF_APPROVAL',
        403,
      );
    if (version.kind === 'rule') assertCapability(actor, 'confirm_record');
    if (!version.source.trim())
      throw new DomainError('Record the source and version before publication.');
    if (!version.effectiveDate)
      throw new DomainError('Record an effective date before publication.');
    validateTemplate(version.content);
    return {
      ...settings,
      catalogue: settings.catalogue.map((item) =>
        item.id === version.id
          ? {
              ...item,
              status: 'Published',
              approvedBy: actor.id,
              approvedAt: new Date().toISOString(),
            }
          : item,
      ),
    };
  });
}

export async function savePreferences(actor: Actor, input: unknown) {
  const preferences = preferencesSchema.parse(input);
  await saveActorPreferences(actor, preferences);
  return preferences;
}

export async function previewCatalogue(actor: Actor, versionId: string) {
  assertCapability(actor, 'manage_catalogue');
  const [settings, jobs] = await Promise.all([getSettings(), listJobs(actor)]);
  const version = settings.catalogue.find((item) => item.id === versionId);
  if (!version) throw new DomainError('The catalogue version is unavailable.', 'NOT_FOUND', 404);
  const sampleHtml = renderTemplate(version.content, {
    'company.name': 'Aster Manufacturing Sdn. Bhd. (fictional)',
    'company.registrationNumber': '202601000001',
    'company.address': '12 Example Road, Kuala Lumpur',
    'job.title': 'Annual return 2026',
    'job.year': '2026',
    'job.anniversaryDate': '2026-10-22',
    'job.effectiveDate': '2026-10-22',
    'firm.name': settings.firmName,
    today: today(),
  });
  return {
    version,
    sampleHtml: `<p><strong>Illustrative internal document — not a regulator filing</strong></p>${sampleHtml}`,
    affectedJobs: jobs
      .filter((job) => !['Complete', 'Cancelled'].includes(job.state))
      .map((job) => ({ id: job.id, title: job.title, companyId: job.companyId })),
    effect:
      'Future selections only. Existing jobs retain their exact template/checklist/rule versions; no open or completed work is rewritten.',
  };
}

/** Worker sweep: catches date-driven changes (such as BO reviews falling due) one company at a time. */
export async function reconcileReminders() {
  let open = 0;
  for (const companyId of await listCompanyIds())
    open += await reconcileCompanyReminders(companyId);
  return open;
}

const REQUEST_RETENTION_DAYS = 30;
/** Duplicate-submission records only need to outlive client retries; audit events are kept separately. */
export function pruneRequestRecords() {
  return pruneRequests(REQUEST_RETENTION_DAYS);
}

const generateSchema = z
  .object({ jobId: z.string().min(1).max(64), templateVersionId: z.string().min(1).max(64) })
  .strict();
function plainText(html: string) {
  return sanitizeHtml(html.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/(p|li)>/gi, '\n'), {
    allowedTags: [],
    allowedAttributes: {},
  })
    .replace(
      /&(?:amp|lt|gt|quot|apos|#39|#x27|nbsp);/g,
      (entity) =>
        ({
          '&amp;': '&',
          '&lt;': '<',
          '&gt;': '>',
          '&quot;': '"',
          '&apos;': "'",
          '&#39;': "'",
          '&#x27;': "'",
          '&nbsp;': ' ',
        })[entity] ?? entity,
    )
    .trim();
}
/** The source revision and exact template version are embedded in immutable output, not inferred later. */
export async function generateIllustrativePack(actor: Actor, input: unknown) {
  assertCapability(actor, 'prepare_job');
  const { jobId, templateVersionId } = generateSchema.parse(input);
  const [job, settings] = await Promise.all([getJob(actor, jobId), getSettings()]);
  if (job.activity === 'W03' && !job.snapshot)
    throw new DomainError(
      'Capture the historical anniversary snapshot before generating this pack.',
    );
  const version = settings.catalogue.find(
    (item) =>
      item.id === templateVersionId && item.kind === 'template' && item.status === 'Published',
  );
  if (!version) throw new DomainError('Choose a published internal template.');
  if (!version.effectiveDate || version.effectiveDate > today())
    throw new DomainError('The template is not effective yet.');
  const company = job.snapshot?.company ?? (await getCompany(job.companyId));
  const pack = job.packs.at(-1);
  if (!pack)
    throw new DomainError('Create a pack version before generating its internal document.');
  const source = {
    jobId: job.id,
    jobRevision: job.revision,
    packVersion: pack.version,
    activity: job.activity,
    company,
    snapshot: job.snapshot,
    route: job.route,
    personId: job.personId,
    personName: job.personName,
    effectiveDate: job.effectiveDate,
    routeBasis: job.routeBasis,
    sourceEvidenceIds: job.sourceEvidenceIds,
    capitalProposal: job.capitalProposal,
    boCase: job.boCase,
    pack,
    templateVersionId: version.id,
    templateVersion: version.version,
  };
  const sourceHash = createHash('sha256').update(JSON.stringify(source)).digest('hex');
  const rendered = renderTemplate(version.content, {
    'company.name': company.name,
    'company.registrationNumber': company.registrationNumber,
    'company.address': company.address,
    'job.title': job.title,
    'job.year': job.year?.toString() ?? '—',
    'job.anniversaryDate': job.anniversaryDate ?? '—',
    'job.effectiveDate': job.effectiveDate ?? '—',
    'firm.name': settings.firmName,
    today: today(),
  });
  const output = [
    'ILLUSTRATIVE INTERNAL DOCUMENT — NOT A REGULATOR FILING',
    'Fictional/local evaluation. Professional and execution requirements remain separate.',
    '',
    plainText(rendered),
    '',
    `Source job: ${job.id}; revision ${job.revision}; pack v${pack.version}`,
    `Template: ${version.name} v${version.version} (${version.id})`,
    `Template source: ${version.source}`,
    `Generated: ${new Date().toISOString()}`,
    `Source SHA-256: ${sourceHash}`,
    '',
    'Immutable source record:',
    JSON.stringify(source, null, 2),
  ].join('\n');
  const document = await storeUpload(actor, {
    companyId: job.companyId,
    jobId: job.id,
    title: `Illustrative ${job.title} — pack v${pack.version}`,
    file: new File([output], `illustrative-pack-v${pack.version}.txt`, { type: 'text/plain' }),
  });
  return {
    ...document,
    sourceRevision: job.revision,
    packVersion: pack.version,
    templateVersionId: version.id,
  };
}
