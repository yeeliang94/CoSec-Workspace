/**
 * Seeds FICTIONAL starter clauses and assemblies for the resolution builder. Idempotent: a template
 * that already exists by name is resumed (or left alone once published), never duplicated.
 *
 * Fictional sample wording — not approved legal precedent. Every version records that source.
 *
 * Authoring follows the normal lifecycle: the owner account creates, drafts and submits; the
 * reviewer account (a different person) publishes. Where those accounts do not yet hold the new
 * capabilities (`manage_templates`, `review_pack`), this script passes actor objects with those
 * capabilities added explicitly. That grant applies to this script run only (it is not stored on
 * the user), and every change is still audited under the real user ids.
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import type { Actor, Capability } from '../src/domain/model';
import { closeDatabase, db } from '../src/server/db';
import { getActorById } from '../src/server/repository';
import {
  SAMPLE_SOURCE,
  STARTER_ASSEMBLIES,
  STARTER_CLAUSES,
} from '../src/server/resolution/samples';
import {
  applyVersionAction,
  listTemplates,
  templateAction,
  type Kind,
} from '../src/server/resolution/templates';
import * as s from '../src/server/schema';

const EFFECTIVE = '2026-10-01';
async function actorFor(email: string, needed: Capability[]) {
  const [row] = await db.select({ id: s.user.id }).from(s.user).where(eq(s.user.email, email));
  const actor = row ? await getActorById(row.id) : null;
  if (!actor) throw new Error(`Seed user ${email} is missing. Run npm run db:seed first.`);
  const added = needed.filter((c) => !actor.capabilities.includes(c));
  if (added.length)
    console.info(
      `Note: ${email} lacks ${added.join(', ')}; granted to this seed run only (audited as ${actor.id}).`,
    );
  return { ...actor, capabilities: [...actor.capabilities, ...added] } as Actor;
}

type Listed = Awaited<ReturnType<typeof listTemplates>>[number];
async function ensure(
  kind: Kind,
  key: string,
  create: Record<string, unknown>,
  content: Record<string, unknown>,
  author: Actor,
  publisher: Actor,
) {
  const rid = (step: string) => `seedres-${kind}-${key}-${step}`;
  const name = create.name as string;
  let template: Listed | undefined = (
    await listTemplates(author, kind, { includeHidden: true })
  ).find((t) => t.name === name);
  if (!template)
    template = (await templateAction(author, kind, {
      action: 'create',
      requestId: rid('create'),
      ...create,
    })) as Listed;
  let version = template.versions.at(-1)!;
  if (version.status === 'Published') return { id: template.id, status: 'already published' };
  if (version.status === 'Draft' || version.status === 'Returned') {
    version = (
      await applyVersionAction(author, kind, template.id, version.id, {
        action: 'save_draft',
        requestId: rid(`save-${version.revision}`),
        expectedRevision: version.revision,
        ...content,
        source: SAMPLE_SOURCE,
        effectiveDate: EFFECTIVE,
      })
    ).version;
    version = (
      await applyVersionAction(author, kind, template.id, version.id, {
        action: 'submit',
        requestId: rid(`submit-${version.revision}`),
        expectedRevision: version.revision,
      })
    ).version;
  }
  if (version.status === 'In review')
    version = (
      await applyVersionAction(publisher, kind, template.id, version.id, {
        action: 'publish',
        requestId: rid(`publish-${version.revision}`),
        expectedRevision: version.revision,
        confirm: true,
      })
    ).version;
  return { id: template.id, status: version.status };
}

const author = await actorFor('owner@cosec.local', ['manage_templates']);
const publisher = await actorFor('reviewer@cosec.local', ['manage_templates', 'review_pack']);
if (author.id === publisher.id) throw new Error('Author and publisher must be different people.');
const clauseIds = new Map<string, string>();
for (const c of STARTER_CLAUSES) {
  const result = await ensure(
    'clause',
    c.key,
    {
      name: c.name,
      category: c.category,
      usageContexts: c.usageContexts,
      governingAct: 'Companies Act 2016',
      displayOrder: c.displayOrder,
      description: c.description,
    },
    c.content,
    author,
    publisher,
  );
  clauseIds.set(c.key, result.id);
  console.info(`clause   ${c.name.padEnd(36)} ${result.status}`);
}
for (const a of STARTER_ASSEMBLIES) {
  const result = await ensure(
    'assembly',
    a.key,
    {
      name: a.name,
      outputTypeId: a.outputTypeId,
      usageContexts: a.usageContexts,
      description: a.description,
    },
    { ...a.content, starterClauseIds: a.starterKeys.map((k) => clauseIds.get(k)!) },
    author,
    publisher,
  );
  console.info(`assembly ${a.name.padEnd(36)} ${result.status}`);
}
console.info(`Fictional resolution samples ready (${SAMPLE_SOURCE}).`);
closeDatabase();
