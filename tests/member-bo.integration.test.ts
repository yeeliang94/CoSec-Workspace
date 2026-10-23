import 'dotenv/config';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import { db, pool } from '../src/server/db';
import * as tables from '../src/server/schema';
import * as repo from '../src/server/repository';
import { readRegisters, activeBoReviewJobs } from '../src/server/record-store';
import { createJob, applyJobAction } from '../src/server/workflows';
import { capitalRegister, boRegister } from '../src/server/register-queries';
import { deriveReminders } from '../src/server/support';
import { blockers, currentPack, approved, nextAction } from '../src/domain/workflows';
import { defaultPreferences, type Actor, type Company, type Job } from '../src/domain/model';
import type { CapitalProposal } from '../src/domain/records';
const companyId = randomUUID(),
  documentId = randomUUID(),
  privateId = randomUUID();
const actor = (name: string, capabilities: Actor['capabilities']): Actor => ({
  id: randomUUID(),
  name,
  email: `${randomUUID()}@example.invalid`,
  capabilities,
  companyIds: [companyId],
  preferences: defaultPreferences,
});
const preparer = actor('Fictional records preparer', ['prepare_job', 'view_bo']);
const reviewer = actor('Fictional records reviewer', ['review_pack', 'confirm_record', 'view_bo']);
const ordinary: Actor = { ...preparer, capabilities: ['prepare_job'] };
const company: Company = {
  id: companyId,
  name: 'Fictional ledger integration Sdn. Bhd.',
  registrationNumber: randomUUID(),
  incorporationDate: '2020-09-01',
  financialYearEnd: '2026-12-31',
  legalStatus: 'Existing',
  engagementStatus: 'Active',
  address: 'Fictional',
  activity: 'Fictional',
  verification: 'Unverified',
  sourceEvidenceId: null,
  revision: 1,
};
const shareClass = { id: randomUUID(), name: 'Ordinary', currency: 'MYR' };
const member = {
  id: randomUUID(),
  name: 'Fictional opening member',
  type: 'Individual' as const,
  address: 'Fictional address',
};
const proposal: CapitalProposal = {
  kind: 'opening',
  shareClass,
  allocations: [{ member, units: '100', certificateNumber: 'OPEN001' }],
  sourceCertificateId: null,
  remainingCertificateNumber: null,
  issuedAmount: '100.00',
  paidAmount: '100.00',
  consideration: '0',
  stamping: {
    disposition: 'Not applicable',
    basis: 'Fictional opening source reviewed',
    evidenceId: documentId,
  },
  authorityEvidenceIds: [documentId],
};
const run = (job: Job, action: string, payload: Record<string, unknown> = {}, who = preparer) =>
  applyJobAction(who, job.id, {
    expectedRevision: job.revision,
    requestId: randomUUID(),
    action,
    ...payload,
  });
async function create(activity: 'W05' | 'W06', effectiveDate = '2026-01-01') {
  return createJob(
    preparer,
    {
      companyId,
      activity,
      ownerId: preparer.id,
      effectiveDate,
      routeBasis: 'Fictional reviewed route; not a legal rule',
    },
    randomUUID(),
  );
}
async function prepare(job: Job, doc = documentId, signers: string[] = []) {
  job = await run(job, 'revise_pack', {
    notes: 'Fictional prepared output',
    documentIds: [doc],
    requiredSigners: signers,
  });
  for (const item of currentPack(job).checklist)
    job = await run(job, 'checklist_evidence', { itemId: item.id, evidenceIds: [doc] });
  job = await run(job, 'request_review');
  for (const scope of ['pack', 'record'])
    job = await run(
      job,
      'review',
      {
        scope,
        decision: 'Approved',
        version: currentPack(job).version,
        reason: 'Fictional exact-version independent review',
      },
      reviewer,
    );
  for (const signer of signers)
    job = await run(job, 'sign', { signer, evidenceId: doc, receivedDate: '2026-10-22' });
  return job;
}
beforeAll(async () => {
  await db.insert(tables.companies).values({ id: companyId, data: company });
  for (const a of [preparer, reviewer])
    await db.insert(tables.user).values({
      id: a.id,
      name: a.name,
      email: a.email,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      capabilities: a.capabilities,
      companyIds: a.companyIds,
      preferences: a.preferences,
      active: true,
    });
  for (const [id, classification] of [
    [documentId, 'General'],
    [privateId, 'BO'],
  ] as const)
    await repo.insertDocument(preparer, {
      id,
      companyId,
      jobId: null,
      title:
        classification === 'BO'
          ? 'Fictional private ownership evidence'
          : 'Fictional general authority',
      originalName: 'fictional.txt',
      mimeType: 'text/plain',
      size: 1,
      sha256: '0'.repeat(64),
      storageKey: 'unused-test-fixture',
      createdBy: preparer.id,
      createdAt: new Date().toISOString(),
      classification,
    });
});
afterAll(async () => {
  await db.delete(tables.reminders).where(eq(tables.reminders.companyId, companyId));
  await db.delete(tables.companyRegisters).where(eq(tables.companyRegisters.companyId, companyId));
  await db.delete(tables.auditEvents).where(eq(tables.auditEvents.companyId, companyId));
  for (const a of [preparer, reviewer])
    await db.delete(tables.requests).where(like(tables.requests.id, `${a.id}:%`));
  await db.delete(tables.documents).where(eq(tables.documents.companyId, companyId));
  await db.delete(tables.jobs).where(eq(tables.jobs.companyId, companyId));
  await db.delete(tables.companies).where(eq(tables.companies.id, companyId));
  await db.delete(tables.user).where(inArray(tables.user.id, [preparer.id, reviewer.id]));
  await pool.end();
});
let opening: Job;
it('posts reviewed opening balances once and keeps record and filing states separate', async () => {
  opening = await create('W05');
  opening = await run(opening, 'capital_proposal', { proposal, expectedRegisterRevision: 1 });
  await expect(run(opening, 'post_record', { confirmed: true }, reviewer)).rejects.toThrow(
    'Review',
  );
  opening = await prepare(opening);
  await expect(run(opening, 'post_record', { confirmed: true }, preparer)).rejects.toThrow(
    'permission',
  );
  const command = {
    expectedRevision: opening.revision,
    requestId: randomUUID(),
    action: 'post_record',
    confirmed: true,
  };
  const retries = await Promise.all([
    applyJobAction(reviewer, opening.id, command),
    applyJobAction(reviewer, opening.id, command),
  ]);
  expect(retries[0]).toEqual(retries[1]);
  opening = retries[0];
  expect(await applyJobAction(reviewer, opening.id, command)).toEqual(opening);
  const ledger = await capitalRegister(preparer, companyId, '2026-10-22');
  expect(ledger.position.classes[0].units).toBe('100');
  expect(ledger.events).toHaveLength(1);
  expect(opening.filingState).toBe('Not ready');
  expect((await capitalRegister(preparer, companyId, '2025-12-31')).position.verification).toBe(
    'Not established',
  );
  await expect(
    run(opening, 'capital_proposal', { proposal, expectedRegisterRevision: ledger.revision }),
  ).rejects.toThrow('immutable');
});
it('serializes conflicting transfers and rolls back the losing job and ledger', async () => {
  const records = await readRegisters(companyId);
  const source = records.capitalEvents[0].id + ':0';
  const prepared: Job[] = [];
  for (let i = 0; i < 2; i++) {
    let job = await create('W05', '2026-02-01');
    const transfer: CapitalProposal = {
      ...proposal,
      kind: 'transfer',
      sourceCertificateId: source,
      remainingCertificateNumber: `BAL${i}`,
      issuedAmount: '0',
      paidAmount: '0',
      allocations: [
        {
          member: { ...member, id: randomUUID(), name: `Fictional transferee ${i}` },
          units: '80',
          certificateNumber: `TRANSFER${i}`,
        },
      ],
    };
    job = await run(job, 'capital_proposal', {
      proposal: transfer,
      expectedRegisterRevision: records.revision,
    });
    prepared.push(await prepare(job, documentId, ['Fictional director']));
  }
  const results = await Promise.allSettled(
    prepared.map((job) => run(job, 'post_record', { confirmed: true }, reviewer)),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect((await readRegisters(companyId)).capitalEvents).toHaveLength(2);
  const loser = prepared[results[0].status === 'rejected' ? 0 : 1];
  expect((await repo.getJob(preparer, loser.id)).revision).toBe(loser.revision);
  expect((await repo.getJob(preparer, loser.id)).recordEventId).toBeNull();
  expect(
    (await capitalRegister(preparer, companyId, '2026-10-22')).position.holdings
      .map((h) => h.units)
      .sort(),
  ).toEqual(['20', '80']);
});
it('captures dated member snapshots, flags open consequences and protects filed originals', async () => {
  let annual = await createJob(
    preparer,
    { companyId, activity: 'W03', ownerId: preparer.id, year: 2026, anniversaryDate: '2026-09-01' },
    randomUUID(),
  );
  expect(annual.snapshot?.members?.classes[0].units).toBe('100');
  let allotment = await create('W05', '2026-08-01');
  const proposed = {
    ...proposal,
    kind: 'allotment',
    allocations: [{ member, units: '10', certificateNumber: 'ALLOT001' }],
    issuedAmount: '10',
    paidAmount: '10',
  };
  allotment = await run(allotment, 'capital_proposal', {
    proposal: proposed,
    expectedRegisterRevision: (await readRegisters(companyId)).revision,
  });
  allotment = await prepare(allotment, documentId, ['Fictional director']);
  allotment = await run(allotment, 'post_record', { confirmed: true }, reviewer);
  annual = await repo.getJob(preparer, annual.id);
  expect(annual.snapshot?.members?.classes[0].units).toBe('100');
  expect(annual.snapshotNeedsReview?.eventId).toBe(allotment.recordEventId);
  annual = await run(annual, 'refresh_snapshot');
  expect(annual.snapshotHistory?.[0].snapshot.members?.classes[0].units).toBe('100');
  expect(annual.snapshot?.members?.classes[0].units).toBe('110');
  await db
    .update(tables.jobs)
    .set({
      data: {
        ...annual,
        filingAttempts: [
          {
            id: randomUUID(),
            version: currentPack(annual).version,
            documentIds: [documentId],
            submittedDate: '2026-10-01',
            reference: 'Fictional original',
            channel: 'External fixture',
            evidenceId: documentId,
            paymentEvidenceId: null,
            lodgerId: reviewer.id,
            at: new Date().toISOString(),
            messages: [],
            outcome: {
              wording: 'Fictional confirmed outcome',
              date: '2026-10-02',
              evidenceId: documentId,
              actorId: reviewer.id,
            },
          },
        ],
        filingState: 'Outcome confirmed',
        state: 'Complete',
      },
    })
    .where(eq(tables.jobs.id, annual.id));
  let blocked = await create('W05', '2026-08-02');
  blocked = await run(blocked, 'capital_proposal', {
    proposal: { ...proposed, allocations: [{ member, units: '1', certificateNumber: 'BLOCK001' }] },
    expectedRegisterRevision: (await readRegisters(companyId)).revision,
  });
  blocked = await prepare(blocked, documentId, ['Fictional director']);
  const before = (await readRegisters(companyId)).revision;
  await expect(run(blocked, 'post_record', { confirmed: true }, reviewer)).rejects.toThrow('filed');
  expect((await readRegisters(companyId)).revision).toBe(before);
  expect((await repo.getJob(preparer, blocked.id)).recordEventId).toBeNull();
});
let bo: Job;
it('keeps BO notices and escalations unresolved until replies, source assessment and discrepancies are reviewed', async () => {
  bo = await create('W06', '2026-10-01');
  await expect(
    run(bo, 'bo_notice', {
      recipient: 'Fictional subject',
      sentDate: '2026-10-01',
      responseDue: '2026-10-10',
      nextChaseDate: '2026-10-05',
      evidenceId: documentId,
      ownerId: preparer.id,
    }),
  ).rejects.toThrow('classification');
  bo = await run(bo, 'bo_notice', {
    recipient: 'Fictional subject',
    sentDate: '2026-10-01',
    responseDue: '2026-10-10',
    nextChaseDate: '2026-10-05',
    evidenceId: privateId,
    ownerId: preparer.id,
  });
  await expect(
    run(bo, 'cancel', { confirmed: true, reason: 'Fictional cancellation attempt' }),
  ).rejects.toThrow('BO notices');
  const noticeId = bo.boCase!.notices[0].id;
  expect(nextAction(bo)).toBe('Escalate overdue BO response from Fictional subject');
  bo = await run(
    bo,
    'bo_escalate',
    { noticeId, evidenceId: privateId, reason: 'Fictional nonresponse escalated' },
    reviewer,
  );
  expect(blockers(bo).some((b) => b.includes('reply evidence outstanding'))).toBe(true);
  expect(nextAction(bo)).toBe('Obtain BO reply from Fictional subject');
  expect(deriveReminders([bo]).map((r) => r.kind)).toContain('BO response');
  bo = await run(bo, 'bo_reply', {
    noticeId,
    date: '2026-10-21',
    evidenceId: privateId,
    summary: 'Fictional reply reconciled',
  });
  bo = await run(bo, 'bo_discrepancy', {
    wording: 'Fictional discrepancy in chain',
    evidenceId: privateId,
  });
  const discrepancyId = bo.boCase!.discrepancies[0].id;
  await expect(
    run(bo, 'bo_resolve', { discrepancyId, evidenceId: privateId, basis: 'Fictional resolution' }),
  ).rejects.toThrow('permission');
  bo = await run(
    bo,
    'bo_resolve',
    { discrepancyId, evidenceId: privateId, basis: 'Independent fictional resolution' },
    reviewer,
  );
  bo = await run(bo, 'bo_assessment', {
    expectedRegisterRevision: (await readRegisters(companyId)).revision,
    assessment: {
      personId: randomUUID(),
      personName: 'Fictional private owner',
      kind: 'entry',
      effectiveDate: '2026-10-01',
      registerEntryDate: '2026-10-22',
      criteria: 'Fictional criteria independently assessed, not a computed legal threshold',
      sourceVersion: 'Fictional source v1, evaluation only',
      ownershipChain: 'Fictional chain checked against evidence',
      evidenceIds: [privateId],
      nextReviewDate: '2027-01-01',
      predecessorId: null,
    },
  });
  bo = await prepare(bo, privateId);
  bo = await run(bo, 'post_record', { confirmed: true }, reviewer);
  expect((await boRegister(reviewer, companyId, '2026-09-30')).owners).toHaveLength(0);
  expect((await boRegister(reviewer, companyId, '2026-10-22')).owners[0].personName).toBe(
    'Fictional private owner',
  );
  expect(bo.filingState).toBe('Not ready');
  const completed = { ...bo, state: 'Complete' as const };
  expect(deriveReminders([completed]).map((r) => r.kind)).toContain('BO review');
  expect(
    deriveReminders([{ ...bo, state: 'Cancelled' }], new Set([bo.id])).map((r) => r.kind),
  ).toContain('BO review');
});
it('filters restricted BO jobs, documents, reminders, detail and register queries without weakening company scope', async () => {
  expect((await repo.listJobs(ordinary)).some((j) => j.activity === 'W06')).toBe(false);
  expect((await repo.listDocuments(ordinary)).some((d) => d.classification === 'BO')).toBe(false);
  await expect(repo.getJob(ordinary, bo.id)).rejects.toThrow('unavailable');
  await expect(repo.getDocument(ordinary, privateId)).rejects.toThrow('unavailable');
  await expect(boRegister(ordinary, companyId, '2026-10-22')).rejects.toThrow('permission');
  await expect(
    boRegister({ ...reviewer, companyIds: [] }, companyId, '2026-10-22'),
  ).rejects.toThrow('unavailable');
  for (const reminder of deriveReminders([bo]))
    await db
      .insert(tables.reminders)
      .values({ id: reminder.id, companyId, data: reminder })
      .onDuplicateKeyUpdate({ set: { data: reminder } });
  expect((await repo.listReminders(ordinary)).some((r) => r.jobId === bo.id)).toBe(false);
  expect((await repo.listReminders(reviewer)).some((r) => r.jobId === bo.id)).toBe(true);
  let general = await create('W05', '2027-01-01');
  await expect(
    run(general, 'revise_pack', { notes: 'Should remain private', documentIds: [privateId] }),
  ).rejects.toThrow('classification');
  general = await repo.getJob(preparer, general.id);
  expect(currentPack(general).documentIds).toEqual([]);
  await expect(
    run(
      general,
      'filing_not_required',
      { reason: 'Fictional reason', evidenceId: privateId },
      reviewer,
    ),
  ).rejects.toThrow('classification');
  expect((await repo.getJob(preparer, general.id)).filingNotRequiredReason).toBeNull();
  await expect(run(general, 'link_dependency', { dependencyId: bo.id })).rejects.toThrow(
    'unavailable',
  );
});

it('retains reviewed record values in old versions and re-reviews a revised pack after posting', async () => {
  let draft = await create('W05', '2027-01-01');
  const change = {
    ...proposal,
    kind: 'allotment' as const,
    issuedAmount: '5',
    paidAmount: '5',
    allocations: [{ member, units: '5', certificateNumber: 'DRAFT005' }],
  };
  draft = await run(draft, 'capital_proposal', {
    proposal: change,
    expectedRegisterRevision: (await readRegisters(companyId)).revision,
  });
  draft = await prepare(draft, documentId, ['Fictional director']);
  const reviewedVersion = currentPack(draft).version;
  draft = await run(draft, 'capital_proposal', {
    proposal: { ...change, allocations: [{ member, units: '6', certificateNumber: 'DRAFT006' }] },
    expectedRegisterRevision: (await readRegisters(companyId)).revision,
  });
  expect(
    draft.packs.find((p) => p.version === reviewedVersion)?.recordSnapshot?.capitalProposal
      ?.allocations[0].units,
  ).toBe('5');
  expect(currentPack(draft).recordSnapshot?.capitalProposal?.allocations[0].units).toBe('6');
  expect(approved(draft, 'record')).toBe(false);
  opening = await run(opening, 'revise_pack', {
    notes: 'Fictional subsequent output correction; posted record unchanged',
    documentIds: [documentId],
  });
  for (const scope of ['pack', 'record'])
    opening = await run(
      opening,
      'review',
      {
        scope,
        decision: 'Approved',
        version: currentPack(opening).version,
        reason: 'Reconciled revised output to immutable posted record',
      },
      reviewer,
    );
  expect(approved(opening, 'record')).toBe(true);
  expect((await readRegisters(companyId)).capitalEvents[0].packVersion).toBeLessThan(
    currentPack(opening).version,
  );
});
it('rejects restricted cached creation replay and restricted opening evidence', async () => {
  const requestId = randomUUID();
  await createJob(
    preparer,
    {
      companyId,
      activity: 'W06',
      ownerId: preparer.id,
      effectiveDate: '2026-10-22',
      routeBasis: 'Fictional private instruction',
    },
    requestId,
  );
  await expect(
    createJob(
      ordinary,
      {
        companyId,
        activity: 'W05',
        ownerId: preparer.id,
        effectiveDate: '2026-10-22',
        routeBasis: 'Fictional public instruction',
      },
      requestId,
    ),
  ).rejects.toThrow('unavailable');
  await expect(
    repo.reviewOpening(reviewer, companyId, {
      expectedRevision: company.revision,
      requestId: randomUUID(),
      sourceEvidenceId: privateId,
      basis: 'Must not disclose BO evidence',
    }),
  ).rejects.toThrow('General evidence');
});
it('tracks next review only for effective posted BO entries and stops after cessation', async () => {
  async function postChange(
    kind: 'review' | 'cessation',
    effectiveDate: string,
    predecessorId: string,
  ) {
    let job = await create('W06', effectiveDate);
    job = await run(job, 'bo_notice', {
      recipient: 'Fictional private owner',
      sentDate: '2026-10-01',
      responseDue: '2026-10-10',
      nextChaseDate: '2026-10-05',
      evidenceId: privateId,
      ownerId: preparer.id,
    });
    job = await run(job, 'bo_reply', {
      noticeId: job.boCase!.notices[0].id,
      date: '2026-10-21',
      evidenceId: privateId,
      summary: 'Fictional reply',
    });
    job = await run(job, 'bo_assessment', {
      expectedRegisterRevision: (await readRegisters(companyId)).revision,
      assessment: {
        ...bo.boCase!.assessment!,
        kind,
        effectiveDate,
        predecessorId,
        nextReviewDate: '2027-06-01',
      },
    });
    job = await prepare(job, privateId);
    return run(job, 'post_record', { confirmed: true }, reviewer);
  }
  const reviewed = await postChange('review', '2027-01-01', bo.recordEventId!);
  const ceased = await postChange('cessation', '2027-02-01', reviewed.recordEventId!);
  const jobs = [bo, reviewed, ceased];
  const reviewJobIds = async (date: string) =>
    deriveReminders(jobs, await activeBoReviewJobs(date))
      .filter((r) => r.kind === 'BO review')
      .map((r) => r.jobId);
  expect(await reviewJobIds('2026-10-22')).toEqual([bo.id]);
  expect(await reviewJobIds('2027-01-01')).toEqual([reviewed.id]);
  expect(await reviewJobIds('2027-02-01')).toEqual([]);
  expect(
    deriveReminders([{ ...bo, recordEventId: null, state: 'Cancelled' }]).filter(
      (r) => r.kind === 'BO review',
    ),
  ).toEqual([]);
});
