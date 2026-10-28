import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, inArray, like, or } from 'drizzle-orm';
import { closeDatabase, db, transaction, writerDb } from '../src/server/db';
import * as s from '../src/server/schema';
import * as repo from '../src/server/repository';
import { changePerson, getPerson, listPeople } from '../src/server/records/people';
import {
  assertDirectorChangePerson,
  changeRelationship,
  listCompanyRelationships,
  syncDirectorProjection,
} from '../src/server/records/relationships';
import { lockCompany } from '../src/server/records/scope';
import { createJob } from '../src/server/workflows';
import { changeProfile, getProfile } from '../src/server/records/profile';
import { changeFieldDefinition } from '../src/server/records/custom-fields';
import { changeCase, createCase, getCaseDetail } from '../src/server/records/cases';
import { exportAudit, queryAudit } from '../src/server/records/audit';
import { loadResolutionContext } from '../src/server/records/context';
import { readCase } from '../src/server/resolution/shared';
import { csvCell } from '../src/domain/resolution/records';
import {
  defaultPreferences,
  type Actor,
  type Company,
  type Job,
  type OfficerEvent,
} from '../src/domain/model';
import type { ResolutionCase } from '../src/domain/resolution/model';

const [A, B, C] = [randomUUID(), randomUUID(), randomUUID()];
const tag = randomBytes(4).toString('hex');
const shared = `rr-shared-${tag}`; // director of A, B and C
const backdated = `rr-back-${tag}`; // backdated appointment in A
const onlyB = `rr-onlyb-${tag}`; // director of B only
const fieldId = `rr_${tag}`;
const jobId = randomUUID();
const docId = randomUUID();
const createdPeople: string[] = [];

const admin: Actor = {
  id: randomUUID(),
  name: 'Records admin (test)',
  email: `rr-admin-${tag}@example.invalid`,
  capabilities: [
    'prepare_job',
    'confirm_record',
    'manage_users',
    'manage_people',
    'manage_templates',
    'generate_documents',
    'view_audit',
    'export_audit',
  ],
  companyIds: [A, B, C],
  preferences: defaultPreferences,
};
const limited: Actor = {
  ...admin,
  id: randomUUID(),
  name: 'Records limited (test)',
  email: `rr-limited-${tag}@example.invalid`,
  capabilities: ['prepare_job', 'manage_people', 'generate_documents', 'view_audit'],
  companyIds: [A],
};
const company = (id: string, n: number): Company => ({
  id,
  name: `Records test ${n} ${tag} Sdn. Bhd.`,
  registrationNumber: randomUUID(),
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
const event = (
  companyId: string,
  personId: string,
  personName: string,
  route: OfficerEvent['route'],
  effectiveDate: string,
  recordedAt: string,
): OfficerEvent => ({
  id: randomUUID(),
  companyId,
  jobId: 'records-test-fixture',
  personId,
  personName,
  route,
  effectiveDate,
  recordedAt,
  evidenceIds: [],
  basis: 'Fictional test fixture',
  reviewerId: admin.id,
  predecessorId: null,
});
const events = [
  event(A, shared, 'Shared Director', 'appointment', '2020-01-01', '2020-01-02T00:00:00.000Z'),
  // Future cessation: still a director today, not after 2030-01-01.
  event(A, shared, 'Shared Director', 'resignation', '2030-01-01', '2026-01-01T00:00:00.000Z'),
  // Recorded in 2026 but effective in 2019 (backdated).
  event(
    A,
    backdated,
    'Backdated Director',
    'appointment',
    '2019-06-01',
    '2026-02-01T00:00:00.000Z',
  ),
  event(B, shared, 'Shared Director', 'appointment', '2021-01-01', '2021-01-02T00:00:00.000Z'),
  event(C, shared, 'Shared Director', 'appointment', '2022-01-01', '2022-01-02T00:00:00.000Z'),
  event(B, onlyB, 'Only B Director', 'appointment', '2021-01-01', '2021-01-02T00:00:00.000Z'),
];

beforeAll(async () => {
  for (const [i, id] of [A, B, C].entries())
    await writerDb.insert(s.companies).values({ id, data: company(id, i + 1) });
  for (const actor of [admin, limited])
    await writerDb.insert(s.user).values({
      id: actor.id,
      name: actor.name,
      email: actor.email,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      capabilities: actor.capabilities,
      companyIds: actor.companyIds,
      preferences: actor.preferences,
      active: true,
    });
  for (const e of events)
    await writerDb.insert(s.officerEvents).values({ id: e.id, companyId: e.companyId, data: e });
  // Reads do not project lazily; posting (and the people migration) project officer events.
  await project(A, B, C);
  await repo.insertDocument(admin, {
    id: docId,
    companyId: A,
    jobId: null,
    title: 'Fictional signed resolution',
    originalName: 'signed.txt',
    mimeType: 'text/plain',
    size: 1,
    sha256: '0'.repeat(64),
    storageKey: 'unused-test-fixture',
    createdBy: admin.id,
    createdAt: new Date().toISOString(),
    classification: 'General',
  });
  const job = {
    id: jobId,
    companyId: A,
    activity: 'W04',
    title: 'Appoint fictional director',
    route: 'appointment',
    personId: `rr-new-${tag}`,
    personName: 'New Appointee',
    effectiveDate: '2026-11-01',
    recordEventId: null,
    packs: [{ version: 1 }],
    revision: 1,
  } as unknown as Job;
  await writerDb.insert(s.jobs).values({ id: jobId, companyId: A, revision: 1, data: job });
});

afterAll(async () => {
  const companies = [A, B, C];
  const people = [shared, backdated, onlyB, ...createdPeople];
  const users = [admin.id, limited.id];
  await writerDb
    .delete(s.auditEvents)
    .where(
      or(
        inArray(s.auditEvents.companyId, companies),
        inArray(s.auditEvents.actorId, users),
        and(eq(s.auditEvents.actorId, 'system'), inArray(s.auditEvents.subjectId, people)),
      ),
    );
  for (const user of users)
    await writerDb.delete(s.requests).where(like(s.requests.id, `${user}:%`));
  await writerDb.delete(s.resolutionCases).where(inArray(s.resolutionCases.companyId, companies));
  await writerDb
    .delete(s.companyRelationships)
    .where(inArray(s.companyRelationships.companyId, companies));
  await writerDb.delete(s.people).where(inArray(s.people.id, people));
  await writerDb.delete(s.companyProfiles).where(inArray(s.companyProfiles.companyId, companies));
  await writerDb.delete(s.recordFieldDefinitions).where(eq(s.recordFieldDefinitions.id, fieldId));
  await writerDb.delete(s.officerEvents).where(inArray(s.officerEvents.companyId, companies));
  await writerDb.delete(s.jobs).where(eq(s.jobs.id, jobId));
  await writerDb.delete(s.documents).where(inArray(s.documents.companyId, companies));
  await writerDb.delete(s.companies).where(inArray(s.companies.id, companies));
  await writerDb.delete(s.user).where(inArray(s.user.id, users));
  closeDatabase();
});

async function project(...companyIds: string[]) {
  const results = [];
  for (const companyId of companyIds)
    results.push(
      await transaction(async (tx) => {
        await lockCompany(companyId, tx);
        return syncDirectorProjection(companyId, tx);
      }),
    );
  return results;
}
const people = async (actor: Actor, options: { q?: string; companyId?: string } = {}) =>
  (await listPeople(actor, options)).people;

const auditCount = async (subjectId: string) =>
  (await db.select().from(s.auditEvents).where(eq(s.auditEvents.subjectId, subjectId))).length;

describe('people and relationships', () => {
  it.each(['_', '%', '\\'])(
    'searches literal %s characters without expanding wildcards',
    async (character) => {
      const literalName = `Literal ${tag} A${character}B`;
      const otherName = `Literal ${tag} AxB`;
      for (const fullName of [literalName, otherName]) {
        const person = await changePerson(limited, {
          action: 'create',
          requestId: randomUUID(),
          fullName,
        });
        createdPeople.push(person.id);
      }
      expect((await people(limited, { q: literalName })).map((p) => p.fullName)).toEqual([
        literalName,
      ]);
      expect(await people(admin, { q: literalName })).toEqual([]);
    },
  );

  it('A04: one person across three companies; a one-company actor sees only that link', async () => {
    const all = (await people(admin)).find((p) => p.id === shared)!;
    expect(all.fullName).toBe('Shared Director');
    expect(all.relationships.map((r) => r.companyId).sort()).toEqual([A, B, C].sort());
    const scoped = (await people(limited)).find((p) => p.id === shared)!;
    expect(scoped.relationships.map((r) => r.companyId)).toEqual([A]);
    expect((await people(limited)).some((p) => p.id === onlyB)).toBe(false);
    const detail = await getPerson(limited, shared);
    expect(detail.relationships).toHaveLength(1);
    expect(JSON.stringify(detail)).not.toContain(B);
    // Shared identity cannot be changed by someone who lacks access to every linked company.
    await expect(
      changePerson(limited, {
        action: 'update',
        id: shared,
        expectedRevision: detail.person.revision,
        requestId: randomUUID(),
        fullName: 'Renamed',
        reason: 'Test',
      }),
    ).rejects.toMatchObject({ status: 403, message: 'You cannot change this shared identity.' });
  });

  it('A14: guessed or denied ids return the same not-found response', async () => {
    const denied = await getPerson(limited, onlyB).catch((e) => e);
    const missing = await getPerson(limited, randomUUID()).catch((e) => e);
    expect([denied.status, denied.message]).toEqual([404, 'Person access is unavailable.']);
    expect([missing.status, missing.message]).toEqual([404, 'Person access is unavailable.']);
    const bCase = await createCase(admin, {
      requestId: randomUUID(),
      companyId: B,
      kind: 'board',
      title: 'Company B case',
    });
    const caseDenied = await readCase(limited, bCase.id).catch((e) => e);
    const caseMissing = await readCase(limited, randomUUID()).catch((e) => e);
    expect(caseDenied.status).toBe(404);
    expect(caseMissing.status).toBe(404);
    await expect(getCaseDetail(limited, bCase.id)).rejects.toMatchObject({ status: 404 });
    await expect(queryAudit(limited, { companyId: B })).rejects.toMatchObject({ status: 404 });
    const visible = await queryAudit(limited, { entityId: bCase.id });
    expect(visible.total).toBe(0);
    await expect(
      changeRelationship(limited, A, {
        action: 'add',
        requestId: randomUUID(),
        personId: onlyB,
        role: 'secretary',
        capacity: '',
        startDate: '2026-01-01',
        evidenceIds: [],
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('A14: a W04 job cannot borrow a person from another company by guessing the id', async () => {
    const proposal = (personId: string, personName: string, route = 'appointment') =>
      createJob(
        limited,
        {
          companyId: A,
          activity: 'W04',
          ownerId: limited.id,
          route,
          personId,
          personName,
          effectiveDate: '2026-12-01',
          routeBasis: 'Fictional board decision',
        },
        randomUUID(),
      ).catch((e) => e);
    for (const attempt of [
      // Company B's director, with and without the right name: hidden from a company A preparer.
      await proposal(onlyB, 'Only B Director'),
      await proposal(onlyB, 'Impostor'),
      await proposal(onlyB, 'Only B Director', 'resignation'),
      // A visible person under a different name, or a non-UUID id with no person record.
      await proposal(shared, 'Someone Else'),
      await proposal(`guess-${tag}`, 'New Person'),
    ])
      expect([attempt.status, attempt.message]).toEqual([404, 'Person access is unavailable.']);
    // A visible person who is not related to this company cannot cease here.
    const unlinked = await changePerson(limited, {
      action: 'create',
      requestId: randomUUID(),
      fullName: `Unrelated ${tag}`,
    });
    createdPeople.push(unlinked.id);
    const cessation = await proposal(unlinked.id, unlinked.fullName, 'removal');
    expect([cessation.status, cessation.message]).toEqual([404, 'Person access is unavailable.']);
    // Ids longer than the people columns are rejected before anything is stored.
    expect((await proposal('x'.repeat(65), 'Long Id')).status).toBe(400);
    expect(await db.select().from(s.jobs).where(eq(s.jobs.companyId, A))).toHaveLength(1);
  });

  it('posting never links an existing person whose name this company records differently', async () => {
    const impostor = event(
      C,
      onlyB,
      'Impostor',
      'appointment',
      '2025-01-01',
      '2026-03-01T00:00:00.000Z',
    );
    await writerDb
      .insert(s.officerEvents)
      .values({ id: impostor.id, companyId: C, data: impostor });
    const [first] = await project(C);
    expect(first.peopleSkipped).toEqual([onlyB]);
    expect(first.relationshipsCreated).toEqual([]);
    const [again] = await project(C);
    expect(again.peopleSkipped).toEqual([onlyB]);
    const links = await db
      .select()
      .from(s.companyRelationships)
      .where(eq(s.companyRelationships.personId, onlyB));
    expect(links.map((l) => l.companyId)).toEqual([B]);
    const flagged = await queryAudit(admin, {
      companyId: C,
      action: 'relationship.projection_skipped',
    });
    expect(flagged.total).toBe(1);
    expect(JSON.stringify(flagged)).not.toContain('Only B Director');
  });

  it('keeps created people private to their creator until linked, and director links read-only', async () => {
    const person = await changePerson(limited, {
      action: 'create',
      requestId: randomUUID(),
      fullName: `Unlinked ${tag}`,
    });
    createdPeople.push(person.id);
    expect((await people(limited, { q: tag })).map((p) => p.id)).toContain(person.id);
    expect((await people(admin, { q: tag })).map((p) => p.id)).not.toContain(person.id);
    const rel = await changeRelationship(limited, A, {
      action: 'add',
      requestId: randomUUID(),
      personId: person.id,
      role: 'secretary',
      capacity: 'Company secretary',
      startDate: '2026-01-01',
      evidenceIds: [],
    });
    expect((await people(admin, { q: tag })).map((p) => p.id)).toContain(person.id);
    const { relationships } = await listCompanyRelationships(admin, A, '2026-06-01');
    const director = relationships.find((r) => r.personId === shared && r.role === 'director')!;
    expect(director.projectedFrom?.officerEventIds).toHaveLength(2);
    expect(director.endDate).toBe('2030-01-01');
    await expect(
      changeRelationship(admin, A, {
        action: 'end',
        id: director.id,
        expectedRevision: director.revision,
        requestId: randomUUID(),
        endDate: '2026-06-01',
        reason: 'Test',
      }),
    ).rejects.toThrow('W04');
    const capacity = await changeRelationship(admin, A, {
      action: 'set_capacity',
      id: director.id,
      expectedRevision: director.revision,
      requestId: randomUUID(),
      capacity: 'Non-executive',
      reason: 'Board minute',
    });
    expect(capacity.capacity).toBe('Non-executive');
    await expect(
      changeRelationship(admin, A, {
        action: 'set_capacity',
        id: director.id,
        expectedRevision: capacity.revision,
        requestId: randomUUID(),
        capacity: ' Non-executive ',
        reason: 'Repeat',
      }),
    ).rejects.toThrow('No change');
    const ended = await changeRelationship(limited, A, {
      action: 'end',
      id: rel.id,
      expectedRevision: rel.revision,
      requestId: randomUUID(),
      endDate: '2026-09-01',
      reason: 'Resigned as secretary',
    });
    expect(ended.endDate).toBe('2026-09-01');
  });

  it('re-checks person access on replay and at W04 posting', async () => {
    const requestId = randomUUID();
    const create = (actor: Actor) =>
      changePerson(actor, { action: 'create', requestId, fullName: `Replay ${tag}` });
    const person = await create(limited);
    createdPeople.push(person.id);
    const posting = (companyId: string) => ({
      companyId,
      route: 'appointment',
      personId: person.id,
      personName: person.fullName,
    });
    // Still unlinked: a poster other than the preparer who chose them is accepted.
    await expect(assertDirectorChangePerson(admin, posting(A))).rejects.toThrow('unavailable');
    await expect(
      assertDirectorChangePerson(admin, posting(A), undefined, true),
    ).resolves.toBeUndefined();
    // Once linked to company A, an actor who has since lost A cannot replay or post them.
    await changeRelationship(limited, A, {
      action: 'add',
      requestId: randomUUID(),
      personId: person.id,
      role: 'secretary',
      capacity: 'Company secretary',
      startDate: '2026-01-01',
      evidenceIds: [],
    });
    const moved: Actor = { ...limited, companyIds: [C] };
    expect((await create(limited)).id).toBe(person.id);
    const replay = await create(moved).catch((e) => e);
    expect([replay.status, replay.message]).toEqual([404, 'Person access is unavailable.']);
    await expect(assertDirectorChangePerson(moved, posting(C), undefined, true)).rejects.toThrow(
      'unavailable',
    );
  });

  it('A17: future and backdated director events give correct as-at directors', async () => {
    const ids = async (asAt: string) =>
      (await listCompanyRelationships(admin, A, asAt)).directorsAsAt.map((d) => d.id).sort();
    expect(await ids('2019-01-01')).toEqual([]);
    expect(await ids('2019-07-01')).toEqual([backdated]);
    expect(await ids('2026-10-27')).toEqual([backdated, shared].sort());
    expect(await ids('2030-01-01')).toEqual([backdated]);
    const now = (await listCompanyRelationships(admin, A, '2026-10-27')).directorsAsAt.find(
      (d) => d.id === shared,
    )!;
    expect(now).toMatchObject({ appointedOn: '2020-01-01', ceasedOn: '2030-01-01' });
  });
});

describe('audit', () => {
  it('A20: before/after, rollback, stale revision and replay', async () => {
    const requestId = randomUUID();
    const created = await changePerson(admin, {
      action: 'create',
      requestId,
      fullName: `Audit Person ${tag}`,
    });
    createdPeople.push(created.id);
    const replay = await changePerson(admin, {
      action: 'create',
      requestId,
      fullName: `Audit Person ${tag}`,
    });
    expect(replay.id).toBe(created.id);
    expect(await auditCount(created.id)).toBe(1);
    const updateId = randomUUID();
    const input = {
      action: 'update' as const,
      id: created.id,
      expectedRevision: 1,
      requestId: updateId,
      fullName: `Corrected Person ${tag}`,
      reason: 'Spelling corrected from passport',
    };
    const updated = await changePerson(admin, input);
    expect(updated.nameHistory[0]).toMatchObject({ name: `Audit Person ${tag}` });
    expect(await changePerson(admin, input)).toEqual(updated);
    expect(await auditCount(created.id)).toBe(2);
    const { entries } = await queryAudit(admin, { entityId: created.id, action: 'person.updated' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorName: admin.name,
      reason: 'Spelling corrected from passport',
      requestId: updateId,
    });
    expect(entries[0].changes).toContainEqual({
      path: 'fullName',
      before: `Audit Person ${tag}`,
      after: `Corrected Person ${tag}`,
    });
    await expect(
      changePerson(admin, { ...input, requestId: randomUUID(), fullName: 'Stale' }),
    ).rejects.toMatchObject({ status: 409, code: 'STALE' });
    // A failed mutation (unknown field definition) leaves no audit row and no change.
    await expect(
      changePerson(admin, {
        action: 'set_custom',
        id: created.id,
        expectedRevision: 2,
        requestId: randomUUID(),
        definitionId: 'missing_field',
        value: 'x',
        effectiveDate: '2026-01-01',
        reason: 'Test',
      }),
    ).rejects.toThrow();
    expect(await auditCount(created.id)).toBe(2);
    // A rolled-back case mutation leaves no audit row either.
    const c = await createCase(admin, {
      requestId: randomUUID(),
      companyId: A,
      kind: 'board',
      title: 'Rollback case',
    });
    await expect(
      changeCase(admin, c.id, { action: 'complete', expectedRevision: 1, requestId: randomUUID() }),
    ).rejects.toThrow('Complete or mark not applicable');
    expect((await queryAudit(admin, { entityId: c.id })).entries.map((e) => e.action)).toEqual([
      'resolution_case.created',
    ]);
  });

  it('A21: pagination and counts follow filters; scopes and CSV escaping are safe', async () => {
    let profile = await getProfile(admin, A);
    for (let i = 0; i < 5; i++)
      profile = await changeProfile(admin, A, {
        action: 'set_citation',
        key: 'electionAuthority',
        value: i === 4 ? '=HYPERLINK("http://example.invalid")' : `Article ${i}`,
        effectiveDate: `2020-0${i + 1}-01`,
        reason: i === 4 ? '+formula reason' : `Change ${i}`,
        expectedRevision: profile.revision,
        requestId: randomUUID(),
      });
    const filters = { companyId: A, entityType: 'company_profile' };
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await queryAudit(admin, filters, { cursor, limit: 2 });
      expect(page.total).toBe(cursor ? undefined : 5);
      expect(page.entries.length).toBeLessThanOrEqual(2);
      seen.push(...page.entries.map((e) => e.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    // Limited user: sees company A rows and person rows scoped to A, never firm-level rows.
    await changeFieldDefinition(admin, {
      action: 'create',
      requestId: randomUUID(),
      id: fieldId,
      scope: 'case',
      label: 'Board meeting venue',
      valueType: 'text',
    });
    expect((await queryAudit(limited, { entityId: fieldId })).total).toBe(0);
    expect((await queryAudit(admin, { entityId: fieldId })).total).toBe(1);
    const limitedPage = await queryAudit(limited, { entityType: 'company_relationship' });
    expect(limitedPage.entries.every((e) => e.companyId === A)).toBe(true);
    expect(limitedPage.entries.length).toBeGreaterThan(0);
    await expect(exportAudit(limited, filters)).rejects.toMatchObject({ status: 403 });
    const { csv, rowCount } = await exportAudit(admin, filters);
    expect(rowCount).toBe(5);
    expect(csv).toContain(`"'+formula reason"`);
    // The formula value sits inside the JSON changes cell; no cell may start with a formula.
    expect(csv).toContain('=HYPERLINK');
    expect(csv).not.toMatch(/(^|,)"[=+\-@\t\r]/m);
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvCell('\tx')).toBe(`"'\tx"`);
    expect(csvCell('-1')).toBe(`"'-1"`);
    expect((await queryAudit(admin, { companyId: A, action: 'audit.exported' })).total).toBe(1);
  });
});

describe('firm-level audit rows', () => {
  it('gates firm-level rows by entity type and redacts unlinked people for non-creators', async () => {
    const auditor: Actor = { ...admin, id: randomUUID(), capabilities: ['view_audit'] };
    const userAdmin: Actor = { ...auditor, capabilities: ['view_audit', 'manage_users'] };
    const templateAdmin: Actor = { ...auditor, capabilities: ['view_audit', 'manage_templates'] };
    const person = await changePerson(admin, {
      action: 'create',
      requestId: randomUUID(),
      fullName: `Private ${tag}`,
      email: `private-${tag}@example.invalid`,
      notes: 'Confidential fictional note',
    });
    createdPeople.push(person.id);
    // Unlinked people: hidden from user and template administrators without manage_people.
    for (const actor of [auditor, userAdmin, templateAdmin])
      expect((await queryAudit(actor, { entityId: person.id })).total).toBe(0);
    // A people manager who did not create the person sees the row without email or notes.
    const redacted = await queryAudit(limited, { entityId: person.id });
    expect(redacted.total).toBe(1);
    const text = JSON.stringify(redacted.entries);
    expect(text).toContain(`Private ${tag}`);
    expect(text).not.toContain(`private-${tag}@example.invalid`);
    expect(text).not.toContain('Confidential fictional note');
    // The creator sees the full row.
    expect(JSON.stringify((await queryAudit(admin, { entityId: person.id })).entries)).toContain(
      `private-${tag}@example.invalid`,
    );
    // Record field definitions (A21) are for template administrators, not user administrators.
    expect((await queryAudit(userAdmin, { entityId: fieldId })).total).toBe(0);
    expect((await queryAudit(templateAdmin, { entityId: fieldId })).total).toBe(1);
  });
});

describe('profile, context and cases', () => {
  it('A32: a dated citation change affects only as-at dates on or after it', async () => {
    let profile = await getProfile(admin, A);
    for (const [value, effectiveDate] of [
      ['Article 10 (fictional)', '2020-01-01'],
      ['Article 12 (fictional)', '2026-06-01'],
    ])
      profile = await changeProfile(admin, A, {
        action: 'set_citation',
        key: 'memberAuthority',
        value,
        effectiveDate,
        reason: 'Constitution amended',
        expectedRevision: profile.revision,
        requestId: randomUUID(),
      });
    const c = await createCase(limited, {
      requestId: randomUUID(),
      companyId: A,
      kind: 'board',
      title: 'Citation case',
    });
    const before = await loadResolutionContext(limited, c.id, '2026-01-01');
    const after = await loadResolutionContext(limited, c.id, '2026-07-01');
    expect(before.company.citations.memberAuthority).toBe('Article 10 (fictional)');
    expect(after.company.citations.memberAuthority).toBe('Article 12 (fictional)');
    expect(after.directors.map((d) => d.id).sort()).toEqual([backdated, shared].sort());
    expect(after.directors.find((d) => d.id === shared)?.capacity).toBe('Non-executive');
    expect(after.proposedPeople.map((p) => p.id)).not.toContain(onlyB);
    expect(JSON.stringify(after)).not.toContain(B);
  });

  it('rejects dependency cycles and requires reasons for not applicable', async () => {
    const c = await createCase(admin, {
      requestId: randomUUID(),
      companyId: A,
      kind: 'board',
      title: 'Cycle case',
    });
    expect(c.steps.map((st) => st.kind)).toEqual([
      'instruction',
      'preparation',
      'review',
      'execution',
    ]);
    const last = c.steps.at(-1)!;
    await expect(
      changeCase(admin, c.id, {
        action: 'update_step',
        expectedRevision: 1,
        requestId: randomUUID(),
        stepId: c.steps[0].id,
        dependsOn: [last.id],
      }),
    ).rejects.toThrow('cycle');
    await expect(
      changeCase(admin, c.id, {
        action: 'update_step',
        expectedRevision: 1,
        requestId: randomUUID(),
        stepId: c.steps[1].id,
        state: 'Complete',
      }),
    ).rejects.toThrow('before');
    await expect(
      changeCase(admin, c.id, {
        action: 'update_step',
        expectedRevision: 1,
        requestId: randomUUID(),
        stepId: c.steps[0].id,
        state: 'Not applicable',
      }),
    ).rejects.toThrow('reason');
    expect((await readCase(admin, c.id)).revision).toBe(1);
  });

  it('links an existing director case to a matching W04 job without bypassing posting', async () => {
    let c = await createCase(admin, {
      requestId: randomUUID(),
      companyId: A,
      kind: 'director_appointment',
      title: 'Initially unlinked appointment',
    });
    await expect(
      changeCase(admin, c.id, {
        action: 'link_job',
        jobId: randomUUID(),
        expectedRevision: c.revision,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow('unavailable');
    const originalJob = await repo.getJob(admin, jobId);
    try {
      await writerDb
        .update(s.jobs)
        .set({ data: { ...originalJob, state: 'Cancelled' } })
        .where(eq(s.jobs.id, jobId));
      await expect(
        changeCase(admin, c.id, {
          action: 'link_job',
          jobId,
          expectedRevision: c.revision,
          requestId: randomUUID(),
        }),
      ).rejects.toThrow('cancelled');
      await writerDb
        .update(s.jobs)
        .set({ data: { ...originalJob, companyId: B }, companyId: B })
        .where(eq(s.jobs.id, jobId));
      await expect(
        changeCase(admin, c.id, {
          action: 'link_job',
          jobId,
          expectedRevision: c.revision,
          requestId: randomUUID(),
        }),
      ).rejects.toThrow('same company');
    } finally {
      await writerDb
        .update(s.jobs)
        .set({ data: originalJob, companyId: originalJob.companyId })
        .where(eq(s.jobs.id, jobId));
    }
    c = await changeCase(admin, c.id, {
      action: 'link_job',
      jobId,
      expectedRevision: c.revision,
      requestId: randomUUID(),
    });
    expect(c).toMatchObject({ jobId, personId: `rr-new-${tag}`, effectiveDate: '2026-11-01' });
    await expect(
      changeCase(admin, c.id, {
        action: 'link_job',
        jobId,
        expectedRevision: c.revision,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow('already linked');
    const wrong = await createCase(admin, {
      requestId: randomUUID(),
      companyId: A,
      kind: 'director_resignation',
      title: 'Wrong route for linking',
    });
    await expect(
      changeCase(admin, wrong.id, {
        action: 'link_job',
        jobId,
        expectedRevision: wrong.revision,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow('route');
    for (const step of c.steps.filter((st) => st.kind !== 'registration'))
      c = await changeCase(admin, c.id, {
        action: 'update_step',
        stepId: step.id,
        state: 'Complete',
        expectedRevision: c.revision,
        requestId: randomUUID(),
      });
    const registration = c.steps.find((st) => st.kind === 'registration')!;
    await expect(
      changeCase(admin, c.id, {
        action: 'update_step',
        stepId: registration.id,
        state: 'Complete',
        expectedRevision: c.revision,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow('has not posted');
    const original = await repo.getJob(admin, jobId);
    try {
      await writerDb
        .update(s.jobs)
        .set({ data: { ...original, recordEventId: randomUUID() } })
        .where(eq(s.jobs.id, jobId));
      c = await changeCase(admin, c.id, {
        action: 'update_step',
        stepId: registration.id,
        state: 'Complete',
        expectedRevision: c.revision,
        requestId: randomUUID(),
      });
      c = await changeCase(admin, c.id, {
        action: 'complete',
        expectedRevision: c.revision,
        requestId: randomUUID(),
      });
      expect(c.state).toBe('Complete');
    } finally {
      await writerDb.update(s.jobs).set({ data: original }).where(eq(s.jobs.id, jobId));
    }
  });

  it('blocks registration until W04 posts, and never passes a decision automatically', async () => {
    await expect(
      createCase(admin, {
        requestId: randomUUID(),
        companyId: A,
        kind: 'director_resignation',
        title: 'Wrong route',
        jobId,
      }),
    ).rejects.toThrow('route');
    let c: ResolutionCase = await createCase(admin, {
      requestId: randomUUID(),
      companyId: A,
      kind: 'director_appointment',
      title: 'Appointment case',
      jobId,
    });
    expect(c.personId).toBe(`rr-new-${tag}`);
    expect(c.effectiveDate).toBe('2026-11-01');
    const registration = c.steps.find((st) => st.kind === 'registration')!;
    expect(registration.label).toBe('Record posting through W04');
    for (const step of c.steps.filter((st) => st.kind !== 'registration'))
      c = await changeCase(admin, c.id, {
        action: 'update_step',
        expectedRevision: c.revision,
        requestId: randomUUID(),
        stepId: step.id,
        state: 'Complete',
      });
    const complete = {
      action: 'update_step' as const,
      stepId: registration.id,
      state: 'Complete' as const,
    };
    await expect(
      changeCase(admin, c.id, {
        ...complete,
        expectedRevision: c.revision,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow('has not posted');
    await expect(
      changeCase(admin, c.id, {
        ...complete,
        state: 'Not applicable',
        reason: 'Skip',
        expectedRevision: c.revision,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow('not applicable');
    const [jobRow] = await db.select().from(s.jobs).where(eq(s.jobs.id, jobId));
    await writerDb
      .update(s.jobs)
      .set({ data: { ...jobRow.data, recordEventId: randomUUID() } })
      .where(eq(s.jobs.id, jobId));
    c = await changeCase(admin, c.id, {
      ...complete,
      expectedRevision: c.revision,
      requestId: randomUUID(),
    });
    expect(c.decision.status).toBe('Not recorded');
    await expect(
      changeCase(admin, c.id, {
        action: 'record_decision',
        expectedRevision: c.revision,
        requestId: randomUUID(),
        status: 'Passed',
        date: '2026-10-01',
        evidenceIds: [],
      }),
    ).rejects.toThrow('evidence');
    c = await changeCase(admin, c.id, {
      action: 'record_decision',
      expectedRevision: c.revision,
      requestId: randomUUID(),
      status: 'Passed',
      date: '2026-10-01',
      evidenceIds: [docId],
    });
    c = await changeCase(admin, c.id, {
      action: 'complete',
      expectedRevision: c.revision,
      requestId: randomUUID(),
    });
    expect(c.state).toBe('Complete');
    expect(c.decision).toMatchObject({ status: 'Passed', evidenceIds: [docId] });
    const detail = await getCaseDetail(admin, c.id);
    expect(detail).toMatchObject({ generations: [], records: [] });
  });
});
