import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor, Company, Job, OfficerEvent, Settings } from '../src/domain/model';
import { defaultPreferences, defaultSettings } from '../src/domain/model';
import { DomainError } from '../src/domain/access';
const memory = vi.hoisted(() => ({
  jobs: new Map<string, Job>(),
  events: [] as OfficerEvent[],
  actors: new Map<string, Actor>(),
  company: null as Company | null,
  requests: new Map<string, Job>(),
  settings: null as Settings | null,
}));
vi.mock('../src/server/record-store', () => ({
  memberSnapshot: async () => ({
    verification: 'Not established',
    classes: [],
    members: [],
    holdings: [],
    certificates: [],
  }),
  readRegisters: async () => ({ revision: 1, capitalEvents: [], boEvents: [] }),
}));
vi.mock('../src/server/repository', () => ({
  markSnapshotConsequences: async () => {},
  getActorById: async (id: string) => memory.actors.get(id) ?? null,
  getCompany: async () => memory.company,
  listOfficerEvents: async () => structuredClone(memory.events),
  getDocument: async (_actor: Actor, id: string) => {
    if (id.startsWith('other')) return { id, companyId: 'other' };
    return { id, companyId: 'company' };
  },
  getDocuments: async (_actor: Actor, ids: string[]) =>
    [...new Set(ids)].map((id) => ({
      id,
      companyId: id.startsWith('other') ? 'other' : 'company',
    })),
  getJob: async (actor: Actor, id: string) => {
    const job = memory.jobs.get(id);
    if (!job || !actor.companyIds.includes(job.companyId))
      throw new DomainError('Unavailable', 'NOT_FOUND', 404);
    return structuredClone(job);
  },
  listJobs: async (actor: Actor) =>
    [...memory.jobs.values()]
      .filter((j) => actor.companyIds.includes(j.companyId))
      .map((j) => structuredClone(j)),
  getSettings: async () => memory.settings ?? defaultSettings,
  createJob: async (_actor: Actor, job: Job, requestId: string) => {
    const prior = memory.requests.get(requestId);
    if (prior) return structuredClone(prior);
    if (
      job.activity === 'W03' &&
      [...memory.jobs.values()].some((j) => j.companyId === job.companyId && j.year === job.year)
    )
      throw new DomainError('Duplicate period', 'DUPLICATE', 409);
    memory.jobs.set(job.id, structuredClone(job));
    memory.requests.set(requestId, structuredClone(job));
    return structuredClone(job);
  },
  mutateJob: async (
    actor: Actor,
    id: string,
    revision: number,
    requestId: string,
    fn: (job: Job, tx: never) => Promise<Job>,
  ) => {
    const prior = memory.requests.get(requestId);
    if (prior) return structuredClone(prior);
    const old = memory.jobs.get(id)!;
    if (!actor.companyIds.includes(old.companyId))
      throw new DomainError('Unavailable', 'NOT_FOUND', 404);
    if (old.revision !== revision) throw new DomainError('Stale', 'STALE', 409);
    const next = await fn(structuredClone(old), undefined as never);
    next.revision++;
    memory.jobs.set(id, structuredClone(next));
    memory.requests.set(requestId, structuredClone(next));
    return structuredClone(next);
  },
  insertOfficerEvent: async (event: OfficerEvent) => {
    memory.events.push(structuredClone(event));
  },
}));
import { applyJobAction, calendarDate, createJob } from '../src/server/workflows';
import { approved, blockers, currentPack, nextAction, officersAt } from '../src/domain/workflows';
const executive: Actor = {
  id: 'executive',
  name: 'Executive',
  email: 'exec@test.invalid',
  companyIds: ['company'],
  capabilities: ['prepare_job'],
  preferences: defaultPreferences,
};
const reviewer: Actor = {
  ...executive,
  id: 'reviewer',
  name: 'Reviewer',
  capabilities: ['review_pack', 'confirm_record'],
};
const lodger: Actor = {
  ...executive,
  id: 'lodger',
  name: 'Lodger',
  capabilities: ['record_filing'],
};
let serial = 0;
const command = (
  job: Job,
  action: string,
  payload: Record<string, unknown> = {},
  actor = executive,
) =>
  applyJobAction(actor, job.id, {
    expectedRevision: job.revision,
    requestId: `request-${++serial}`,
    action,
    ...payload,
  });
async function annual(year = 2025) {
  return createJob(
    executive,
    {
      companyId: 'company',
      activity: 'W03',
      ownerId: 'executive',
      year,
      anniversaryDate: `${year}-09-01`,
      statutoryDue: '2026-10-01',
      manualDateBasis: 'Fictional reviewed fixture only',
      manualDateEvidenceId: 'evidence-1',
    },
    `create-${++serial}`,
  );
}
async function prepared(job: Job, signers: string[] = []) {
  job = await command(job, 'revise_pack', {
    notes: 'Prepared internal output',
    documentIds: ['pack-output'],
    requiredSigners: signers,
  });
  for (const item of currentPack(job).checklist)
    job = await command(job, 'checklist_evidence', {
      itemId: item.id,
      evidenceIds: ['evidence-1'],
    });
  if (job.activity === 'W03')
    job = await command(job, 'confirm_client', { evidenceId: 'evidence-1' });
  job = await command(job, 'request_review');
  job = await command(
    job,
    'review',
    {
      scope: 'pack',
      decision: 'Approved',
      reason: 'Evidence and exact output reviewed',
      version: currentPack(job).version,
    },
    reviewer,
  );
  job = await command(
    job,
    'review',
    {
      scope: 'manual_date',
      decision: 'Approved',
      reason: 'Fictional manual due date source reviewed',
      version: currentPack(job).version,
    },
    reviewer,
  );
  return job;
}
async function submitted(job: Job) {
  job = await command(job, 'authorise_readiness', {}, reviewer);
  return command(
    job,
    'submit',
    {
      version: currentPack(job).version,
      documentIds: currentPack(job).documentIds,
      submittedDate: '2026-10-01',
      reference: 'REF-1',
      channel: 'External fictional channel',
      evidenceId: 'receipt',
    },
    lodger,
  );
}
beforeEach(() => {
  memory.jobs.clear();
  memory.events = [];
  memory.actors.clear();
  memory.requests.clear();
  memory.settings = structuredClone(defaultSettings);
  serial = 0;
  for (const actor of [executive, reviewer, lodger]) memory.actors.set(actor.id, actor);
  memory.company = {
    id: 'company',
    name: 'Fictional Sdn. Bhd.',
    registrationNumber: '000000000001',
    incorporationDate: '2020-09-01',
    financialYearEnd: '12-31',
    legalStatus: 'Existing',
    engagementStatus: 'Active',
    address: 'Fictional address',
    activity: 'Testing',
    verification: 'Unverified',
    sourceEvidenceId: null,
    revision: 1,
  };
});
describe('calendar and historical director positions', () => {
  it('rejects invalid calendar dates including non-leap February 29', () => {
    expect(calendarDate.safeParse('2026-02-29').success).toBe(false);
    expect(calendarDate.safeParse('2024-02-29').success).toBe(true);
    expect(calendarDate.safeParse('2026-13-01').success).toBe(false);
  });
  it('uses effective dates for appointments and cessations, independently of entry time', () => {
    const base = {
      id: 'one',
      companyId: 'company',
      jobId: 'job',
      personId: 'person',
      personName: 'Director',
      route: 'appointment' as const,
      effectiveDate: '2026-09-01',
      recordedAt: '2026-10-01T00:00:00Z',
      evidenceIds: ['evidence'],
      basis: 'Reviewed',
      reviewerId: 'reviewer',
      predecessorId: null,
    };
    const cease = {
      ...base,
      id: 'two',
      route: 'resignation' as const,
      effectiveDate: '2026-11-01',
      predecessorId: 'one',
    };
    expect(officersAt([cease, base], '2026-08-31')).toEqual([]);
    expect(officersAt([cease, base], '2026-10-01')).toHaveLength(1);
    expect(officersAt([cease, base], '2026-11-01')).toEqual([]);
  });
});
describe('annual return safeguards', () => {
  it('allows evidenced not-required filing closure without inventing a statutory deadline', async () => {
    let job = await prepared(await annual());
    job.statutoryDue = null;
    job.deadlineReviewRequired = false;
    memory.jobs.set(job.id, structuredClone(job));
    job = await command(
      job,
      'filing_not_required',
      { reason: 'Fictional reviewed applicability exclusion', evidenceId: 'evidence-1' },
      reviewer,
    );
    job = await command(job, 'complete', { confirmed: true });
    expect(job.state).toBe('Complete');
    expect(job.statutoryDue).toBeNull();
    expect(job.filingNotRequiredReason).toContain('Fictional reviewed');
  });
  it('rejects duplicate company-year and retains anniversary snapshot after live changes', async () => {
    const job = await annual();
    memory.company!.address = 'Later address';
    memory.events.push({
      id: 'later',
      companyId: 'company',
      jobId: 'event',
      personId: 'new',
      personName: 'Later Director',
      route: 'appointment',
      effectiveDate: '2026-01-01',
      recordedAt: '2026-02-01',
      evidenceIds: [],
      basis: 'fixture',
      reviewerId: 'reviewer',
      predecessorId: null,
    });
    expect(job.snapshot?.company.address).toBe('Fictional address');
    expect(job.snapshot?.officers).toEqual([]);
    await expect(annual()).rejects.toMatchObject({ code: 'DUPLICATE' });
  });
  it('blocks review/readiness with specific missing evidence and no approved deadline', async () => {
    let job = await createJob(
      executive,
      {
        companyId: 'company',
        activity: 'W03',
        ownerId: 'executive',
        year: 2024,
        anniversaryDate: '2024-09-01',
      },
      'create-empty',
    );
    expect(blockers(job)).toContain('No approved deadline rule or reviewed manual date.');
    await expect(command(job, 'request_review')).rejects.toThrow('evidence is missing');
    await expect(command(job, 'authorise_readiness', {}, reviewer)).rejects.toThrow(
      'evidence is missing',
    );
  });
  it('rejects admin without professional capability and company scope denial', async () => {
    const admin = {
      ...executive,
      id: 'admin',
      capabilities: ['manage_users'] as Actor['capabilities'],
    };
    await expect(
      createJob(
        admin,
        {
          companyId: 'company',
          activity: 'W03',
          ownerId: 'executive',
          year: 2025,
          anniversaryDate: '2025-09-01',
        },
        'admin-create',
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      createJob(
        { ...executive, companyIds: [] },
        {
          companyId: 'company',
          activity: 'W03',
          ownerId: 'executive',
          year: 2025,
          anniversaryDate: '2025-09-01',
        },
        'scope-create',
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('rejects cross-company evidence', async () => {
    const job = await annual();
    await expect(
      command(job, 'revise_pack', { notes: 'bad', documentIds: ['other-secret'] }),
    ).rejects.toThrow('Evidence must belong');
  });
  it('rejects self approval even when the preparer also has reviewer capability', async () => {
    const job = await prepared(await annual());
    const combined = {
      ...executive,
      capabilities: [...executive.capabilities, 'review_pack'] as Actor['capabilities'],
    };
    await expect(
      command(
        job,
        'review',
        { scope: 'pack', decision: 'Approved', reason: 'Self', version: currentPack(job).version },
        combined,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('material revision invalidates approval and readiness while preserving exact prior version', async () => {
    let job = await prepared(await annual());
    job = await command(job, 'authorise_readiness', {}, reviewer);
    const oldPack = structuredClone(currentPack(job));
    expect(job.filingState).toBe('Ready');
    job = await command(job, 'revise_pack', {
      notes: 'Revised particulars',
      documentIds: ['new-output'],
    });
    expect(approved(job, 'pack')).toBe(false);
    expect(job.filingState).toBe('Not ready');
    expect(job.packs.find((p) => p.version === oldPack.version)).toEqual(oldPack);
    expect(job.reviews.some((r) => r.scope === 'pack' && r.version === oldPack.version)).toBe(true);
  });
  it('retains the operative deadline while its replacement awaits independent review', async () => {
    let job = await prepared(await annual());
    job = await command(job, 'dates', {
      statutoryDue: '2026-11-01',
      manualDateBasis: 'Reviewed extension evidence',
      manualDateEvidenceId: 'extension',
    });
    expect(job.statutoryDue).toBe('2026-10-01');
    expect(job.manualDateProposal?.date).toBe('2026-11-01');
    job = await command(
      job,
      'review',
      {
        scope: 'manual_date',
        decision: 'Approved',
        reason: 'Extension outcome evidenced',
        version: currentPack(job).version,
      },
      reviewer,
    );
    expect(job.statutoryDue).toBe('2026-11-01');
    expect(job.deadlineHistory?.map((h) => h.date)).toEqual(['2026-10-01', '2026-11-01']);
  });
  it('submission leaves outcome open, query retains attempt and requires renewed readiness/resubmission', async () => {
    let job = await submitted(await prepared(await annual()));
    expect(job.filingState).toBe('Submitted');
    expect(nextAction(job)).toBe('Obtain filing outcome evidence');
    await expect(command(job, 'complete', { confirmed: true })).rejects.toThrow(
      'Confirm the filing outcome',
    );
    job = await command(
      job,
      'filing_message',
      {
        kind: 'Query',
        wording: 'Clarify particulars',
        date: '2026-10-02',
        responseDue: '2026-10-20',
        evidenceId: 'query',
      },
      lodger,
    );
    expect(job.filingAttempts[0].messages).toHaveLength(1);
    await expect(
      command(
        job,
        'confirm_outcome',
        { wording: 'Accepted', date: '2026-10-03', evidenceId: 'outcome', confirmed: true },
        lodger,
      ),
    ).rejects.toThrow('unresolved query');
    await expect(command(job, 'authorise_readiness', {}, reviewer)).rejects.toThrow(
      'evidenced response',
    );
    job = await command(
      job,
      'filing_response',
      { summary: 'Clarification provided externally', date: '2026-10-03', evidenceId: 'response' },
      lodger,
    );
    job = await command(job, 'authorise_readiness', {}, reviewer);
    job = await command(
      job,
      'submit',
      {
        version: currentPack(job).version,
        documentIds: currentPack(job).documentIds,
        submittedDate: '2026-10-03',
        reference: 'REF-2',
        channel: 'External channel',
        evidenceId: 'receipt2',
      },
      lodger,
    );
    expect(job.filingState).toBe('Resubmitted');
    expect(job.filingAttempts).toHaveLength(2);
    expect(job.filingAttempts[0].reference).toBe('REF-1');
    job = await command(
      job,
      'confirm_outcome',
      { wording: 'Acknowledged', date: '2026-10-04', evidenceId: 'outcome', confirmed: true },
      lodger,
    );
    job = await command(job, 'complete', { confirmed: true });
    expect(job.state).toBe('Complete');
    expect(job.billingState).toBe('Not ready');
    await expect(
      command(job, 'revise_pack', { notes: 'changed', documentIds: ['new-output'] }),
    ).rejects.toThrow();
  });
  it('requires exact package and authorised lodger; rejects stale edits', async () => {
    let job = await prepared(await annual());
    job = await command(job, 'authorise_readiness', {}, reviewer);
    const payload = {
      version: currentPack(job).version,
      documentIds: ['different-output'],
      submittedDate: '2026-10-01',
      reference: 'r',
      channel: 'channel',
      evidenceId: 'receipt',
    };
    await expect(command(job, 'submit', payload, lodger)).rejects.toThrow(
      'match the reviewed package',
    );
    await expect(
      command(job, 'submit', { ...payload, documentIds: currentPack(job).documentIds }),
    ).rejects.toMatchObject({ status: 403 });
    const changed = await command(job, 'note', { html: '<p>Saved</p>' });
    await expect(command(job, 'note', { html: '<p>Stale</p>' })).rejects.toMatchObject({
      code: 'STALE',
    });
    expect(changed.revision).toBe(job.revision + 1);
  });
  it('owned client chase stays outstanding until an evidenced response, note HTML is sanitised', async () => {
    let job = await annual();
    job = await command(job, 'correspondence', {
      direction: 'Outgoing',
      counterparty: 'Client',
      channel: 'Email outside app',
      date: '2026-10-01',
      summary: 'Please confirm',
      ownerId: 'executive',
      evidenceIds: [],
      nextChaseDate: '2026-10-08',
    });
    expect(job.state).toBe('Waiting on external information');
    expect(nextAction(job)).toBe('Follow up with Client');
    job = await command(job, 'note', {
      html: '<p onclick="x()">Keep<strong> this</strong></p><script>bad()</script><img src="bad" onerror="bad()">',
    });
    expect(job.notes[0].html).toBe('<p>Keep<strong> this</strong></p>');
    job = await command(job, 'correspondence_response', {
      correspondenceId: job.correspondence[0].id,
      respondedOn: '2026-10-04',
      evidenceId: 'reply',
    });
    expect(job.correspondence[0].respondedOn).toBe('2026-10-04');
    expect(job.state).toBe('Preparing');
  });
});
describe('director event tracks', () => {
  it('posts a future dated reviewed appointment without making current records or filing complete', async () => {
    let job = await createJob(
      executive,
      {
        companyId: 'company',
        activity: 'W04',
        ownerId: 'executive',
        route: 'appointment',
        personId: 'director-new',
        personName: 'Fictional New Director',
        effectiveDate: '2027-01-01',
        routeBasis: 'Fictional reviewed appointment decision',
        sourceEvidenceIds: ['instruction'],
        statutoryDue: '2027-02-01',
        manualDateBasis: 'Fictional fixture date',
        manualDateEvidenceId: 'date-source',
      },
      'director-create',
    );
    expect(job.packs[0].checklist.find((i) => i.id === 'consent')).toBeTruthy();
    await expect(command(job, 'post_record', { confirmed: true }, reviewer)).rejects.toThrow(
      'Review the exact pack',
    );
    job = await prepared(job, ['Director consent']);
    job = await command(job, 'sign', {
      signer: 'Director consent',
      evidenceId: 'consent-signature',
      receivedDate: '2026-10-01',
    });
    job = await command(
      job,
      'review',
      {
        scope: 'record',
        decision: 'Approved',
        reason: 'Route/effective date/source separately checked',
        version: currentPack(job).version,
      },
      reviewer,
    );
    job = await command(job, 'post_record', { confirmed: true }, reviewer);
    expect(job.recordEventId).toBeTruthy();
    expect(job.filingState).toBe('Not ready');
    expect(officersAt(memory.events, '2026-10-22')).toEqual([]);
    expect(officersAt(memory.events, '2027-01-01')).toHaveLength(1);
  });
  it('preserves resignation/removal route distinctions and rejects cessation without an appointment', async () => {
    for (const route of ['resignation', 'removal'] as const) {
      let job = await createJob(
        executive,
        {
          companyId: 'company',
          activity: 'W04',
          ownerId: 'executive',
          route,
          personId: `director-${route}`,
          personName: 'Director',
          effectiveDate: '2026-10-01',
          routeBasis: `Specific ${route} authority`,
          sourceEvidenceIds: ['source'],
          statutoryDue: '2026-10-20',
          manualDateBasis: 'Fixture',
          manualDateEvidenceId: 'date',
        },
        `create-${route}`,
      );
      expect(job.route).toBe(route);
      expect(job.packs[0].checklist.find((i) => i.id === 'consent')).toBeUndefined();
      job = await prepared(job);
      job = await command(
        job,
        'review',
        {
          scope: 'record',
          decision: 'Approved',
          reason: 'Reviewed route',
          version: currentPack(job).version,
        },
        reviewer,
      );
      await expect(command(job, 'post_record', { confirmed: true }, reviewer)).rejects.toThrow(
        'No active appointment',
      );
    }
  });
  it('linked unresolved changes block readiness, reject dependency cycles', async () => {
    let parent = await prepared(await annual(2024)),
      dependency = await annual(2025);
    parent = await command(parent, 'link_dependency', { dependencyId: dependency.id });
    await expect(command(parent, 'authorise_readiness', {}, reviewer)).rejects.toThrow(
      'Resolve linked job',
    );
    await expect(
      command(dependency, 'link_dependency', { dependencyId: parent.id }),
    ).rejects.toThrow('cycle');
  });
});

describe('historical snapshot and closure regressions', () => {
  it('creates upcoming work without pretending its future anniversary is a historical snapshot, captures once after date', async () => {
    let job = await annual(2199);
    expect(job.snapshot).toBeNull();
    await expect(command(job, 'confirm_client', { evidenceId: 'source' })).rejects.toThrow(
      'Capture or refresh',
    );
    expect(blockers(job).some((b) => b.includes('Capture the historical'))).toBe(true);
    await expect(command(job, 'capture_snapshot')).rejects.toThrow('on or after');
    memory.events.push({
      id: 'known-before-anniversary',
      companyId: 'company',
      jobId: 'source-job',
      personId: 'then-director',
      personName: 'Anniversary director',
      route: 'appointment',
      effectiveDate: '2199-08-15',
      recordedAt: '2199-08-16T00:00:00Z',
      evidenceIds: ['source'],
      basis: 'fixture',
      reviewerId: 'reviewer',
      predecessorId: null,
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2199-09-02T00:00:00Z'));
    try {
      job = await command(job, 'capture_snapshot');
      expect(job.snapshot?.asAt).toBe('2199-09-01');
      expect(job.snapshot?.officers[0].personName).toBe('Anniversary director');
      const frozen = structuredClone(job.snapshot);
      memory.company!.address = 'Later change';
      await expect(command(job, 'capture_snapshot')).rejects.toThrow('already frozen');
      expect(job.snapshot).toEqual(frozen);
    } finally {
      vi.useRealTimers();
    }
  });
  it('rejects wrong anniversary month/day and flags leap-day exception instead of inventing a date', async () => {
    await expect(
      createJob(
        executive,
        {
          companyId: 'company',
          activity: 'W03',
          ownerId: 'executive',
          year: 2025,
          anniversaryDate: '2025-10-01',
        },
        'bad-anniversary',
      ),
    ).rejects.toThrow('incorporation anniversary');
    memory.company!.incorporationDate = '2020-02-29';
    await expect(
      createJob(
        executive,
        {
          companyId: 'company',
          activity: 'W03',
          ownerId: 'executive',
          year: 2025,
          anniversaryDate: '2025-02-28',
        },
        'leap-anniversary',
      ),
    ).rejects.toThrow('Leap-day anniversary');
  });
  it('prevents cancelling annual work or a director job with an unresolved entered statutory date', async () => {
    const annualJob = await annual();
    await expect(
      command(annualJob, 'cancel', { reason: 'Stopped work', confirmed: true }),
    ).rejects.toThrow('Resolve filing obligations');
    const director = await createJob(
      executive,
      {
        companyId: 'company',
        activity: 'W04',
        ownerId: 'executive',
        route: 'resignation',
        personId: 'person',
        personName: 'Director',
        effectiveDate: '2026-10-01',
        routeBasis: 'Specific route',
        statutoryDue: '2026-10-20',
        manualDateBasis: 'Fixture',
        manualDateEvidenceId: 'evidence',
      },
      'cancel-director',
    );
    await expect(
      command(director, 'cancel', { reason: 'Stopped work', confirmed: true }),
    ).rejects.toThrow('Resolve filing obligations');
  });
  it('protects submitted exact-version review history from later returns and new review requests', async () => {
    const job = await submitted(await prepared(await annual()));
    await expect(
      command(
        job,
        'review',
        {
          scope: 'pack',
          decision: 'Returned',
          reason: 'Attempt to change filed history',
          version: currentPack(job).version,
        },
        reviewer,
      ),
    ).rejects.toThrow('retain their review history');
    await expect(command(job, 'request_review')).rejects.toThrow('retain their review history');
    expect((await memory.jobs.get(job.id))?.filingState).toBe('Submitted');
  });
  it('blocks backdated posting that would silently contradict a filed annual snapshot', async () => {
    await submitted(await prepared(await annual()));
    let director = await createJob(
      executive,
      {
        companyId: 'company',
        activity: 'W04',
        ownerId: 'executive',
        route: 'appointment',
        personId: 'old-person',
        personName: 'Director discovered late',
        effectiveDate: '2025-08-01',
        routeBasis: 'Late discovered appointment source',
        sourceEvidenceIds: ['source'],
        statutoryDue: '2026-10-20',
        manualDateBasis: 'Fixture',
        manualDateEvidenceId: 'date',
      },
      'backdated-director',
    );
    director = await prepared(director);
    director = await command(
      director,
      'review',
      {
        scope: 'record',
        decision: 'Approved',
        reason: 'Source route checked',
        version: currentPack(director).version,
      },
      reviewer,
    );
    await expect(command(director, 'post_record', { confirmed: true }, reviewer)).rejects.toThrow(
      'linked correction and consequence review',
    );
    expect(memory.events).toEqual([]);
  });
});

describe('operating defaults and versioned checklist use', () => {
  it('uses configured preparation/chase defaults and preserves explicit null choices', async () => {
    memory.settings!.preparationLeadDays = 14;
    memory.settings!.chaseIntervalDays = 3;
    let job = await annual();
    expect(job.internalTarget).toBe('2025-08-18');
    job = await command(job, 'correspondence', {
      direction: 'Outgoing',
      counterparty: 'Client',
      channel: 'Recorded external call',
      date: '2026-10-01',
      summary: 'Need confirmation',
      ownerId: 'executive',
      evidenceIds: [],
    });
    expect(job.correspondence.at(-1)?.nextChaseDate).toBe('2026-10-04');
    job = await command(job, 'correspondence', {
      direction: 'Outgoing',
      counterparty: 'Client',
      channel: 'Recorded external call',
      date: '2026-10-01',
      summary: 'No response needed',
      ownerId: 'executive',
      evidenceIds: [],
      nextChaseDate: null,
    });
    expect(job.correspondence.at(-1)?.nextChaseDate).toBeNull();
    const noTarget = await createJob(
      executive,
      {
        companyId: 'company',
        activity: 'W03',
        ownerId: 'executive',
        year: 2024,
        anniversaryDate: '2024-09-01',
        internalTarget: null,
      },
      'explicit-no-target',
    );
    expect(noTarget.internalTarget).toBeNull();
  });
  it('adds exact published checklist content without removing protected evidence requirements', async () => {
    memory.settings!.catalogue = [
      {
        id: 'published-checklist',
        kind: 'checklist',
        name: 'Firm additional checks',
        version: 3,
        status: 'Published',
        content: '<ul><li>Confirm authority to instruct</li><li>Check internal handoff</li></ul>',
        source: 'Fictional internal practice source',
        effectiveDate: '2026-01-01',
        createdBy: 'admin',
        createdAt: '2026-01-01T00:00:00Z',
        approvedBy: 'reviewer',
        approvedAt: '2026-01-02T00:00:00Z',
        predecessorId: null,
      },
    ];
    let job = await createJob(
      executive,
      {
        companyId: 'company',
        activity: 'W03',
        ownerId: 'executive',
        year: 2025,
        anniversaryDate: '2025-09-01',
        checklistVersionId: 'published-checklist',
      },
      'checklist-job',
    );
    expect(job.checklistVersionId).toBe('published-checklist');
    expect(currentPack(job).checklist.map((c) => c.id)).toEqual([
      'particulars',
      'client',
      'bo',
      'validation',
      'custom-1',
      'custom-2',
    ]);
    await expect(
      command(
        job,
        'checklist_na',
        {
          itemId: 'particulars',
          reason: 'Trying to waive protected check',
          evidenceIds: ['basis'],
        },
        reviewer,
      ),
    ).rejects.toThrow('cannot be waived');
    job = await command(
      job,
      'checklist_na',
      { itemId: 'custom-2', reason: 'No internal handoff for this case', evidenceIds: ['basis'] },
      reviewer,
    );
    expect(
      currentPack(job).checklist.find((c) => c.id === 'custom-2')?.notApplicable?.reason,
    ).toContain('No internal handoff');
  });
});

describe('multiple authority messages', () => {
  it('requires separate evidenced responses to every unresolved message before readiness', async () => {
    let job = await submitted(await prepared(await annual()));
    job = await command(
      job,
      'filing_message',
      {
        kind: 'Query',
        wording: 'First query',
        date: '2026-10-02',
        responseDue: '2026-10-20',
        evidenceId: 'query1',
      },
      lodger,
    );
    job = await command(
      job,
      'filing_message',
      {
        kind: 'Query',
        wording: 'Second query',
        date: '2026-10-03',
        responseDue: '2026-10-21',
        evidenceId: 'query2',
      },
      lodger,
    );
    const [first, second] = job.filingAttempts.at(-1)!.messages;
    job = await command(
      job,
      'filing_response',
      { summary: 'First query answered externally', date: '2026-10-04', evidenceId: 'response1' },
      lodger,
    );
    expect(job.filingAttempts.at(-1)!.messages[0].response?.evidenceId).toBe('response1');
    expect(job.filingAttempts.at(-1)!.messages[1].response).toBeUndefined();
    await expect(command(job, 'authorise_readiness', {}, reviewer)).rejects.toThrow(
      'evidenced response',
    );
    job = await command(
      job,
      'filing_response',
      {
        messageId: second.id,
        summary: 'Second query answered externally',
        date: '2026-10-04',
        evidenceId: 'response2',
      },
      lodger,
    );
    job = await command(job, 'authorise_readiness', {}, reviewer);
    expect(job.filingState).toBe('Ready');
    expect(job.filingAttempts.at(-1)!.messages.map((message) => message.id)).toEqual([
      first.id,
      second.id,
    ]);
  });
});
