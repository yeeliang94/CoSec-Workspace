import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { closeDatabase, writerDb } from '../src/server/db';
import * as s from '../src/server/schema';
import { createCompany, insertDocument, listOfficerEvents } from '../src/server/repository';
import { changePerson } from '../src/server/records/people';
import { changeRelationship, listCompanyRelationships } from '../src/server/records/relationships';
import { changeCase, createCase } from '../src/server/records/cases';
import {
  defaultPreferences,
  ROLE_CAPABILITIES,
  type Actor,
  type Company,
} from '../src/domain/model';
import type { ResolutionCase } from '../src/domain/resolution/model';

const tag = randomBytes(4).toString('hex');
const companyId = randomUUID();
const preparer: Actor = {
  id: randomUUID(),
  name: 'Preparer (test)',
  email: `sw-prep-${tag}@example.invalid`,
  capabilities: ROLE_CAPABILITIES.user,
  companyIds: [],
  preferences: defaultPreferences,
};
const reviewer: Actor = {
  ...preparer,
  id: randomUUID(),
  name: 'Reviewer (test)',
  email: `sw-rev-${tag}@example.invalid`,
};
const company: Company = {
  id: companyId,
  name: `Simplified ${tag} Sdn. Bhd.`,
  registrationNumber: `2026${tag}`,
  incorporationDate: '2026-01-15',
  financialYearEnd: '06-30',
  legalStatus: 'Existing',
  engagementStatus: 'Active',
  address: '1 Jalan Ujian',
  industry: 'J',
  activity: '',
  verification: 'Unverified',
  sourceEvidenceId: null,
  revision: 1,
};

beforeAll(async () => {
  for (const actor of [preparer, reviewer])
    await writerDb.insert(s.user).values({
      id: actor.id,
      name: actor.name,
      email: actor.email,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      capabilities: actor.capabilities,
      companyIds: [],
      preferences: actor.preferences,
      active: true,
    });
});
afterAll(() => closeDatabase());

describe('company opened with its people', () => {
  it('records directors as appointments and others as relationships', async () => {
    await createCompany(
      preparer,
      [
        { fullName: `Nora ${tag}`, role: 'director', startDate: '2026-01-15' },
        { fullName: `Hadi ${tag}`, role: 'member', startDate: '2026-01-15' },
      ],
      company,
    );
    preparer.companyIds = [companyId];
    reviewer.companyIds = [companyId];
    await writerDb
      .update(s.user)
      .set({ companyIds: [companyId] })
      .where(eq(s.user.id, reviewer.id));
    const { relationships, directorsAsAt } = await listCompanyRelationships(
      preparer,
      companyId,
      '2026-02-01',
    );
    expect(relationships.map((r) => [r.personName, r.role]).sort()).toEqual(
      [
        [`Hadi ${tag}`, 'member'],
        [`Nora ${tag}`, 'director'],
      ].sort(),
    );
    expect(directorsAsAt.map((d) => d.name)).toEqual([`Nora ${tag}`]);
    expect((await listOfficerEvents(companyId)).map((e) => e.route)).toEqual(['appointment']);
  });

  it('adds and ends a director directly on the company', async () => {
    const person = await changePerson(preparer, {
      action: 'create',
      requestId: randomUUID(),
      fullName: `Siti ${tag}`,
    });
    const evidenceId = randomUUID();
    await insertDocument(preparer, {
      id: evidenceId,
      companyId,
      jobId: null,
      title: 'Appointment evidence',
      originalName: 'appointment.txt',
      mimeType: 'text/plain',
      size: 1,
      sha256: '0'.repeat(64),
      storageKey: 'unused-test-fixture',
      createdBy: preparer.id,
      createdAt: new Date().toISOString(),
      classification: 'General',
    });
    const added = await changeRelationship(preparer, companyId, {
      action: 'add',
      requestId: randomUUID(),
      personId: person.id,
      role: 'director',
      capacity: 'Non-executive',
      startDate: '2026-03-01',
      evidenceIds: [evidenceId],
    });
    expect(added).toMatchObject({ role: 'director', capacity: 'Non-executive', endDate: null });
    expect(added.evidenceIds).toEqual([evidenceId]);
    expect(
      (await listOfficerEvents(companyId)).find((e) => e.personId === person.id)?.evidenceIds,
    ).toEqual([evidenceId]);
    const ended = await changeRelationship(preparer, companyId, {
      action: 'end',
      id: added.id,
      expectedRevision: added.revision,
      requestId: randomUUID(),
      endDate: '2026-05-01',
      reason: 'Resigned',
    });
    expect(ended.endDate).toBe('2026-05-01');
    const { directorsAsAt } = await listCompanyRelationships(preparer, companyId, '2026-06-01');
    expect(directorsAsAt.map((d) => d.name)).toEqual([`Nora ${tag}`]);
  });
});

describe('resolution review hand-off', () => {
  const act = (actor: Actor, c: ResolutionCase, input: Record<string, unknown>) =>
    changeCase(actor, c.id, {
      expectedRevision: c.revision,
      requestId: randomUUID(),
      ...input,
    } as Parameters<typeof changeCase>[2]);

  it('locks drafting during optional colleague review', async () => {
    let c = await createCase(preparer, {
      requestId: randomUUID(),
      companyId,
      kind: 'board',
      title: 'Review hand-off',
    });
    await expect(
      act(preparer, c, { action: 'send_for_review', reviewerId: reviewer.id }),
    ).rejects.toThrow('Choose the wording');
    c = {
      ...c,
      selection: {
        revision: 1,
        outputTypeId: 'directors_written',
        assemblyVersionId: 'test',
        clauses: [],
        removals: [],
      },
    };
    await writerDb.update(s.resolutionCases).set({ data: c }).where(eq(s.resolutionCases.id, c.id));
    await expect(
      act(preparer, c, { action: 'send_for_review', reviewerId: preparer.id }),
    ).rejects.toThrow('someone else');
    c = await act(preparer, c, { action: 'send_for_review', reviewerId: reviewer.id });
    expect(c.review).toMatchObject({ status: 'With reviewer', reviewerId: reviewer.id });
    await expect(act(preparer, c, { action: 'update_details', title: 'Changed' })).rejects.toThrow(
      'with a reviewer',
    );
    await expect(act(preparer, c, { action: 'review', decision: 'Approved' })).rejects.toThrow(
      'Only the chosen reviewer',
    );
    await expect(
      act(reviewer, c, { action: 'review', decision: 'Returned', comment: '' }),
    ).rejects.toThrow('Say what needs changing');
    c = await act(reviewer, c, { action: 'review', decision: 'Returned', comment: 'Fix the date' });
    expect(c.review).toMatchObject({ status: 'Returned', comment: 'Fix the date' });
    c = await act(preparer, c, { action: 'update_details', title: 'Fixed' });
    c = await act(preparer, c, { action: 'send_for_review', reviewerId: reviewer.id });
    c = await act(reviewer, c, { action: 'review', decision: 'Approved', comment: '' });
    await expect(
      act(preparer, c, {
        action: 'set_custom',
        definitionId: 'missing',
        value: 'Unreviewed',
        effectiveDate: '2026-01-01',
        reason: 'Test',
      }),
    ).rejects.toThrow('Reopen it');
    c = await act(preparer, c, { action: 'complete' });
    expect(c.state).toBe('Complete');
  });

  it('lets a preparer complete a draft without review or evidence', async () => {
    const draft = await createCase(preparer, {
      requestId: randomUUID(),
      companyId,
      kind: 'board',
      title: 'Direct completion',
    });
    const completed = await act(preparer, draft, { action: 'complete' });
    expect(completed.state).toBe('Complete');
    expect(completed.review).toBeUndefined();
  });

  it('lets the preparer take a resolution back', async () => {
    let c = await createCase(preparer, {
      requestId: randomUUID(),
      companyId,
      kind: 'board',
      title: 'Take back',
    });
    c = {
      ...c,
      review: {
        status: 'With reviewer',
        reviewerId: reviewer.id,
        sentBy: preparer.id,
        sentAt: new Date().toISOString(),
        decidedAt: null,
        comment: '',
      },
    };
    await writerDb.update(s.resolutionCases).set({ data: c }).where(eq(s.resolutionCases.id, c.id));
    c = await act(preparer, c, { action: 'reopen' });
    expect(c.review).toBeNull();
    c = await act(preparer, c, { action: 'update_details', title: 'Editable again' });
    expect(c.title).toBe('Editable again');
  });
});
