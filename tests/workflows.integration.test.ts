import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray, like, or } from 'drizzle-orm';
import { closeDatabase, db, writerDb } from '../src/server/db';
import * as tables from '../src/server/schema';
import * as repo from '../src/server/repository';
import { applyJobAction, createJob } from '../src/server/workflows';
import { approved, currentPack, officersAt } from '../src/domain/workflows';
import type { Actor, Capability, Company, Job } from '../src/domain/model';
import { defaultPreferences } from '../src/domain/model';

// Uses isolated UUID fixture rows in the configured MySQL database; never truncates or resets user data.
const companyId = randomUUID(),
  docId = randomUUID();
function actor(name: string, capabilities: Capability[]): Actor {
  return {
    id: randomUUID(),
    name,
    email: `test-${randomUUID()}@example.invalid`,
    companyIds: [companyId],
    capabilities,
    preferences: defaultPreferences,
  };
}
const preparer = actor('Integration preparer', ['prepare_job']),
  reviewer = actor('Integration reviewer', ['review_pack', 'confirm_record']),
  lodger = actor('Integration lodger', ['record_filing']),
  outsider = actor('Integration outsider', ['prepare_job']);
outsider.companyIds = [];
const actors = [preparer, reviewer, lodger, outsider];
const company: Company = {
  id: companyId,
  name: 'Integration fictional Sdn. Bhd.',
  registrationNumber: `T-${randomUUID()}`,
  incorporationDate: '2020-09-01',
  financialYearEnd: '12-31',
  legalStatus: 'Existing',
  engagementStatus: 'Active',
  address: 'Fictional integration address',
  activity: 'Fictional integration',
  verification: 'Unverified',
  sourceEvidenceId: null,
  revision: 1,
};
let ready = false;
const run = (job: Job, action: string, payload: Record<string, unknown> = {}, who = preparer) =>
  applyJobAction(who, job.id, {
    expectedRevision: job.revision,
    requestId: randomUUID(),
    action,
    ...payload,
  });
async function annual(year: number) {
  return createJob(
    preparer,
    {
      companyId,
      activity: 'W03',
      ownerId: preparer.id,
      year,
      anniversaryDate: `${year}-09-01`,
      statutoryDue: '2026-10-01',
      manualDateBasis: 'Fictional integration fixture date, not a statutory calculation',
      manualDateEvidenceId: docId,
    },
    randomUUID(),
  );
}
async function prepare(job: Job, signers: string[] = []) {
  job = await run(job, 'revise_pack', {
    notes: 'Fictional prepared output for integration test',
    documentIds: [docId],
    requiredSigners: signers,
  });
  for (const item of currentPack(job).checklist)
    job = await run(job, 'checklist_evidence', { itemId: item.id, evidenceIds: [docId] });
  if (job.activity === 'W03') job = await run(job, 'confirm_client', { evidenceId: docId });
  job = await run(job, 'request_review');
  job = await run(
    job,
    'review',
    {
      scope: 'pack',
      version: currentPack(job).version,
      decision: 'Approved',
      reason: 'Fictional integration exact-version review',
    },
    reviewer,
  );
  job = await run(
    job,
    'review',
    {
      scope: 'manual_date',
      version: currentPack(job).version,
      decision: 'Approved',
      reason: 'Fictional integration date source reviewed',
    },
    reviewer,
  );
  return job;
}
beforeAll(async () => {
  await writerDb.insert(tables.companies).values({ id: companyId, data: company });
  for (const a of actors)
    await writerDb.insert(tables.user).values({
      id: a.id,
      name: a.name,
      email: a.email,
      emailVerified: true,
      capabilities: a.capabilities,
      companyIds: a.companyIds,
      preferences: a.preferences,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  await repo.insertDocument(preparer, {
    id: docId,
    companyId,
    jobId: null,
    title: 'Fictional integration evidence',
    originalName: 'fixture.txt',
    mimeType: 'text/plain',
    size: 13,
    sha256: '0'.repeat(64),
    storageKey: 'integration-not-a-download',
    createdBy: preparer.id,
    createdAt: new Date().toISOString(),
    classification: 'General',
  });
  ready = true;
});
afterAll(async () => {
  if (ready) {
    await writerDb.delete(tables.reminders).where(eq(tables.reminders.companyId, companyId));
    // Posting projects director relationships and people; remove only this fixture's rows.
    const projected = await db
      .select({ personId: tables.companyRelationships.personId })
      .from(tables.companyRelationships)
      .where(eq(tables.companyRelationships.companyId, companyId));
    await writerDb
      .delete(tables.companyRelationships)
      .where(eq(tables.companyRelationships.companyId, companyId));
    if (projected.length)
      await writerDb.delete(tables.people).where(
        inArray(
          tables.people.id,
          projected.map((p) => p.personId),
        ),
      );
    await writerDb.delete(tables.auditEvents).where(eq(tables.auditEvents.companyId, companyId));
    await writerDb
      .delete(tables.officerEvents)
      .where(eq(tables.officerEvents.companyId, companyId));
    await writerDb.delete(tables.jobs).where(eq(tables.jobs.companyId, companyId));
    await writerDb.delete(tables.documents).where(eq(tables.documents.companyId, companyId));
    await writerDb.delete(tables.auditEvents).where(
      inArray(
        tables.auditEvents.actorId,
        actors.map((a) => a.id),
      ),
    );
    await writerDb
      .delete(tables.requests)
      .where(or(...actors.map((a) => like(tables.requests.id, `${a.id}:%`))));
    await writerDb.delete(tables.companies).where(eq(tables.companies.id, companyId));
    await writerDb.delete(tables.user).where(
      inArray(
        tables.user.id,
        actors.map((a) => a.id),
      ),
    );
  }
  closeDatabase();
});
describe('MySQL workflow integration', () => {
  it('commits full annual-return query/resubmission/outcome/closure with exact histories', async () => {
    let job = await prepare(await annual(2025));
    job = await run(job, 'authorise_readiness', {}, reviewer);
    job = await run(
      job,
      'submit',
      {
        version: currentPack(job).version,
        documentIds: [docId],
        submittedDate: '2026-10-01',
        reference: 'INTEGRATION-1',
        channel: 'Fictional external channel',
        evidenceId: docId,
      },
      lodger,
    );
    expect(job.filingState).toBe('Submitted');
    expect((await repo.getJob(preparer, job.id)).filingAttempts[0].outcome).toBeNull();
    await expect(run(job, 'complete', { confirmed: true })).rejects.toThrow(
      'Confirm the filing outcome',
    );
    job = await run(
      job,
      'filing_message',
      {
        kind: 'Query',
        wording: 'Fictional clarification request',
        date: '2026-10-02',
        responseDue: '2026-10-20',
        evidenceId: docId,
      },
      lodger,
    );
    job = await run(
      job,
      'filing_response',
      { summary: 'Fictional clarification provided', date: '2026-10-03', evidenceId: docId },
      lodger,
    );
    job = await run(job, 'authorise_readiness', {}, reviewer);
    job = await run(
      job,
      'submit',
      {
        version: currentPack(job).version,
        documentIds: [docId],
        submittedDate: '2026-10-03',
        reference: 'INTEGRATION-2',
        channel: 'Fictional external channel',
        evidenceId: docId,
      },
      lodger,
    );
    job = await run(
      job,
      'confirm_outcome',
      {
        wording: 'Acknowledged in fictional fixture',
        date: '2026-10-04',
        evidenceId: docId,
        confirmed: true,
      },
      lodger,
    );
    job = await run(job, 'complete', { confirmed: true });
    const persisted = await repo.getJob(preparer, job.id);
    expect(persisted.state).toBe('Complete');
    expect(persisted.billingState).toBe('Not ready');
    expect(persisted.snapshot?.asAt).toBe('2025-09-01');
    expect(persisted.filingAttempts).toHaveLength(2);
    expect(persisted.filingAttempts[0].messages[0].wording).toContain('clarification');
    expect(persisted.filingAttempts[1].outcome?.wording).toContain('Acknowledged');
    const audit = await db
      .select()
      .from(tables.auditEvents)
      .where(eq(tables.auditEvents.subjectId, job.id));
    expect(audit.length).toBe(persisted.revision);
  });
  it('posts future appointment then distinct resignation with independent filing tracks', async () => {
    const personId = randomUUID();
    let job = await createJob(
      preparer,
      {
        companyId,
        activity: 'W04',
        ownerId: preparer.id,
        route: 'appointment',
        personId,
        personName: 'Fictional Integration Director',
        effectiveDate: '2028-01-01',
        routeBasis: 'Fictional appointment authority fixture',
        sourceEvidenceIds: [docId],
        statutoryDue: '2028-02-01',
        manualDateBasis: 'Fictional manual date',
        manualDateEvidenceId: docId,
      },
      randomUUID(),
    );
    job = await prepare(job, ['Director']);
    job = await run(job, 'sign', {
      signer: 'Director',
      evidenceId: docId,
      receivedDate: '2026-10-01',
    });
    job = await run(
      job,
      'review',
      {
        scope: 'record',
        decision: 'Approved',
        version: currentPack(job).version,
        reason: 'Dated source and appointment route checked',
      },
      reviewer,
    );
    job = await run(job, 'post_record', { confirmed: true }, reviewer);
    expect(job.filingState).toBe('Not ready');
    expect(officersAt(await repo.listOfficerEvents(companyId), '2026-10-22')).toEqual([]);
    expect(
      officersAt(await repo.listOfficerEvents(companyId), '2028-01-01').find(
        (o) => o.personId === personId,
      ),
    ).toBeTruthy();
    let resignation = await createJob(
      preparer,
      {
        companyId,
        activity: 'W04',
        ownerId: preparer.id,
        route: 'resignation',
        personId,
        personName: 'Fictional Integration Director',
        effectiveDate: '2029-01-01',
        routeBasis: 'Fictional resignation notice fixture',
        sourceEvidenceIds: [docId],
        statutoryDue: '2029-02-01',
        manualDateBasis: 'Fictional manual date',
        manualDateEvidenceId: docId,
      },
      randomUUID(),
    );
    resignation = await prepare(resignation);
    resignation = await run(
      resignation,
      'review',
      {
        scope: 'record',
        decision: 'Approved',
        version: currentPack(resignation).version,
        reason: 'Resignation route separately checked',
      },
      reviewer,
    );
    resignation = await run(resignation, 'post_record', { confirmed: true }, reviewer);
    expect(resignation.route).toBe('resignation');
    expect(
      officersAt(await repo.listOfficerEvents(companyId), '2029-01-01').find(
        (o) => o.personId === personId,
      ),
    ).toBeUndefined();
    expect((await repo.getJob(preparer, job.id)).recordEventId).toBe(job.recordEventId);
  });
  it('serialises concurrent duplicate periods and concurrent stale edits with one winner', async () => {
    const attempts = await Promise.allSettled([annual(2023), annual(2023)]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const job = (attempts.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<Job>)
      .value;
    const edits = await Promise.allSettled([
      run(job, 'note', { html: '<p>First concurrent edit</p>' }),
      run(job, 'note', { html: '<p>Second concurrent edit</p>' }),
    ]);
    expect(edits.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(edits.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await repo.getJob(preparer, job.id)).notes).toHaveLength(1);
  });
  it('replays an identical idempotency key without extra revision or audit and enforces company scope', async () => {
    const job = await annual(2022),
      requestId = randomUUID(),
      payload = {
        expectedRevision: job.revision,
        requestId,
        action: 'note',
        html: '<p>One audit mutation</p>',
      };
    const first = await applyJobAction(preparer, job.id, payload);
    const second = await applyJobAction(preparer, job.id, payload);
    expect(second).toEqual(first);
    expect((await repo.getJob(preparer, job.id)).revision).toBe(job.revision + 1);
    const audit = await db
      .select()
      .from(tables.auditEvents)
      .where(eq(tables.auditEvents.subjectId, job.id));
    expect(audit).toHaveLength(2);
    await expect(repo.getJob(outsider, job.id)).rejects.toMatchObject({ status: 404 });
    await expect(repo.getDocument(outsider, docId)).rejects.toMatchObject({ status: 404 });
    await expect(
      applyJobAction(outsider, job.id, {
        ...payload,
        requestId: randomUUID(),
        expectedRevision: first.revision,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await repo.listJobs(outsider)).toEqual([]);
    expect(await repo.listDocuments(outsider)).toEqual([]);
  });
  it('flags open annual snapshot consequences transactionally and archives old position before refresh', async () => {
    let annualJob = await prepare(await annual(2026));
    annualJob = await run(annualJob, 'authorise_readiness', {}, reviewer);
    const oldSnapshot = structuredClone(annualJob.snapshot),
      oldVersion = currentPack(annualJob).version,
      oldRevision = annualJob.revision;
    const personId = randomUUID();
    let director = await createJob(
      preparer,
      {
        companyId,
        activity: 'W04',
        ownerId: preparer.id,
        route: 'appointment',
        personId,
        personName: 'Late-discovered fictional director',
        effectiveDate: '2026-08-01',
        routeBasis: 'Fictional reviewed source effective before open anniversary',
        sourceEvidenceIds: [docId],
        statutoryDue: '2026-10-20',
        manualDateBasis: 'Fictional date',
        manualDateEvidenceId: docId,
      },
      randomUUID(),
    );
    director = await prepare(director);
    director = await run(
      director,
      'review',
      {
        scope: 'record',
        decision: 'Approved',
        version: currentPack(director).version,
        reason: 'Backdated source separately checked',
      },
      reviewer,
    );
    director = await run(director, 'post_record', { confirmed: true }, reviewer);
    annualJob = await repo.getJob(preparer, annualJob.id);
    expect(annualJob.snapshot).toEqual(oldSnapshot);
    expect(annualJob.snapshotNeedsReview?.eventId).toBe(director.recordEventId);
    expect(annualJob.filingState).toBe('Not ready');
    expect(approved(annualJob, 'pack')).toBe(false);
    expect(annualJob.revision).toBe(oldRevision + 1);
    annualJob = await run(annualJob, 'refresh_snapshot');
    expect(annualJob.snapshotHistory?.at(-1)).toEqual({
      snapshot: oldSnapshot,
      packVersion: oldVersion,
    });
    expect(annualJob.snapshot?.officers.find((o) => o.personId === personId)).toBeTruthy();
    expect(annualJob.clientConfirmed).toBe(false);
    expect(annualJob.snapshotNeedsReview).toBeNull();
    expect(currentPack(annualJob).documentIds).toEqual([]);
    expect(currentPack(annualJob).checklist.every((item) => item.evidenceIds.length === 0)).toBe(
      true,
    );
    expect(currentPack(annualJob).version).toBe(oldVersion + 1);
  });
  it('rolls back record, job, request and audit when a consequential transaction fails', async () => {
    const job = await annual(2021),
      eventId = randomUUID(),
      requestId = randomUUID();
    const auditBefore = (
      await db.select().from(tables.auditEvents).where(eq(tables.auditEvents.subjectId, job.id))
    ).length;
    await expect(
      repo.mutateJob(preparer, job.id, job.revision, requestId, async (draft, tx) => {
        await repo.insertOfficerEvent(
          {
            id: eventId,
            companyId,
            jobId: job.id,
            personId: randomUUID(),
            personName: 'Rollback fixture',
            route: 'appointment',
            effectiveDate: '2030-01-01',
            recordedAt: new Date().toISOString(),
            evidenceIds: [docId],
            basis: 'Must roll back',
            reviewerId: reviewer.id,
            predecessorId: null,
          },
          tx,
        );
        draft.title = 'Must not commit';
        await repo.audit(preparer, companyId, 'test.rollback', job.id, {}, tx);
        throw new Error('Injected transactional failure');
      }),
    ).rejects.toThrow('Injected transactional failure');
    expect((await repo.getJob(preparer, job.id)).title).toBe(job.title);
    expect((await repo.listOfficerEvents(companyId)).find((e) => e.id === eventId)).toBeUndefined();
    expect(
      (await db.select().from(tables.auditEvents).where(eq(tables.auditEvents.subjectId, job.id)))
        .length,
    ).toBe(auditBefore);
    expect(
      await db
        .select()
        .from(tables.requests)
        .where(eq(tables.requests.id, `${preparer.id}:${job.id}:${requestId}`)),
    ).toEqual([]);
  });
});
describe('job change plumbing against SQLite', () => {
  it('keeps reminders current from job changes alone, without a page-load sweep', async () => {
    let job = await annual(2030);
    const open = async () =>
      (await repo.listReminders(preparer)).filter((item) => item.jobId === job.id);
    expect((await open()).map((item) => item.kind).sort()).toEqual([
      'Internal target',
      'Statutory date',
    ]);
    job = await run(job, 'dates', { internalTarget: '2030-07-01' });
    const target = (await open()).filter((item) => item.kind === 'Internal target');
    expect(target.map((item) => item.dueDate)).toEqual(['2030-07-01']);
  });
  it('completes more simultaneous changes than the connection pool holds', async () => {
    const jobs = await Promise.all(Array.from({ length: 12 }, (_, i) => annual(2032 + i)));
    const results = await Promise.all(
      jobs.map((job) => run(job, 'note', { html: '<p>Fictional concurrent note</p>' })),
    );
    expect(results.map((job) => job.notes.length)).toEqual(jobs.map(() => 1));
  });
  it('replays a request with the current job while storing only a small receipt', async () => {
    const job = await annual(2045);
    const requestId = randomUUID();
    const command = {
      expectedRevision: job.revision,
      requestId,
      action: 'note',
      html: '<p>Fictional replayed note</p>',
    };
    const first = await applyJobAction(preparer, job.id, command);
    const replay = await applyJobAction(preparer, job.id, command);
    expect(replay.revision).toBe(first.revision);
    expect(replay.notes).toHaveLength(1);
    const [receipt] = await db
      .select()
      .from(tables.requests)
      .where(eq(tables.requests.id, `${preparer.id}:${job.id}:${requestId}`));
    expect(receipt.result).toEqual({ id: job.id, revision: first.revision });
  });
});
