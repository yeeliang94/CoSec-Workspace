import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor, Job, Settings } from '../src/domain/model';
import { defaultPreferences, defaultSettings } from '../src/domain/model';
const mock = vi.hoisted(() => ({
  settings: null as unknown,
  save: vi.fn(),
  reminders: vi.fn(),
  jobs: [] as unknown[],
  revision: 0,
  generated: vi.fn(),
  getJob: vi.fn(),
  getCompany: vi.fn(),
  getActorById: vi.fn(),
}));
vi.mock('../src/server/record-store', () => ({
  activeBoReviewJobs: async () => new Set<string>(),
}));
vi.mock('../src/server/repository', () => ({
  getSettings: async () => mock.settings,
  getActorById: mock.getActorById,
  listUsers: async () => [{ id: 'executive', name: 'Executive' }],
  mutateSettings: async (
    _actor: unknown,
    expected: number,
    _requestId: string,
    fn: (settings: unknown) => unknown,
  ) => {
    const current = mock.settings as Settings;
    if (current.revision !== expected) throw new Error('Stale settings');
    mock.settings = await fn(structuredClone(current));
    (mock.settings as Settings).revision = current.revision + 1;
    return mock.settings;
  },
  saveActorPreferences: mock.save,
  listCompanyIds: async () => ['company', 'second'],
  reconcileCompanyReminders: mock.reminders,
  pruneRequests: async () => 0,
  listDocuments: async () => [],
  listReminders: async () => [],
  listJobs: async () => mock.jobs,
  getCompany: mock.getCompany,
  getJob: mock.getJob,
}));
vi.mock('../src/server/storage', () => ({ storeUpload: mock.generated }));
import {
  applySettingsAction,
  generateIllustrativePack,
  cleanRichText,
  deriveReminders,
  getWorkspaceSupport,
  preferencesSchema,
  reconcileReminders,
  renderTemplate,
  savePreferences,
  validateTemplate,
} from '../src/server/support';
const actor: Actor = {
  id: 'admin',
  name: 'Admin',
  email: 'admin@example.test',
  capabilities: ['manage_catalogue'],
  companyIds: ['company'],
  preferences: defaultPreferences,
};
const requestId = () => crypto.randomUUID();
function baseJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job',
    companyId: 'company',
    activity: 'W03',
    title: 'Annual return 2026',
    year: 2026,
    anniversaryDate: '2026-10-22',
    snapshot: null,
    route: null,
    personId: null,
    personName: null,
    effectiveDate: null,
    routeBasis: '',
    sourceEvidenceIds: [],
    recordEventId: null,
    ownerId: 'executive',
    createdBy: 'executive',
    state: 'Preparing',
    revision: 1,
    createdAt: '2026-10-22T00:00:00Z',
    updatedAt: '2026-10-22T00:00:00Z',
    internalTarget: '2026-10-01',
    statutoryDue: '2026-10-30',
    manualDateBasis: 'evidenced manual date',
    manualDateEvidenceId: 'doc',
    deadlineReviewRequired: true,
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
    ...overrides,
  };
}
beforeEach(() => {
  mock.settings = structuredClone(defaultSettings);
  mock.jobs = [];
  mock.save.mockReset();
  mock.reminders.mockReset();
  mock.generated.mockReset();
  mock.getJob.mockReset();
  mock.getCompany.mockReset();
  mock.getActorById.mockReset();
  mock.getActorById.mockResolvedValue({ ...actor, id: 'executive', capabilities: ['prepare_job'] });
});
describe('controlled settings', () => {
  it('stores a sanitised draft but rejects invalid placeholders at publication, keeping the draft intact', async () => {
    const result = await applySettingsAction(actor, {
      action: 'catalogue_draft',
      expectedRevision: 1,
      requestId: requestId(),
      kind: 'template',
      name: 'Confirmation',
      content: '<p>{{company.secret}}</p><script>alert(1)</script>',
      source: 'Fictional internal example v1',
      effectiveDate: '2026-10-22',
    });
    expect(result.catalogue[0].content).not.toContain('script');
    const reviewer = {
      ...actor,
      id: 'reviewer',
      capabilities: ['manage_catalogue', 'review_pack'] as Actor['capabilities'],
    };
    await expect(
      applySettingsAction(reviewer, {
        action: 'catalogue_publish',
        expectedRevision: 2,
        requestId: requestId(),
        versionId: result.catalogue[0].id,
        confirmImpact: true,
      }),
    ).rejects.toThrow('Unknown template placeholder');
    expect((mock.settings as Settings).catalogue[0].status).toBe('Draft');
  });
  it('requires an independent professional reviewer even for administrators', async () => {
    const result = await applySettingsAction(actor, {
      action: 'catalogue_draft',
      expectedRevision: 1,
      requestId: requestId(),
      kind: 'template',
      name: 'Confirmation',
      content: '<p>{{company.name}}</p>',
      source: 'Internal example v1',
      effectiveDate: '2026-10-22',
    });
    const payload = {
      action: 'catalogue_publish',
      expectedRevision: 2,
      requestId: requestId(),
      versionId: result.catalogue[0].id,
      confirmImpact: true,
    };
    await expect(applySettingsAction(actor, payload)).rejects.toThrow('permission');
    await expect(
      applySettingsAction({ ...actor, capabilities: ['manage_catalogue', 'review_pack'] }, payload),
    ).rejects.toThrow('independent reviewer');
    const published = await applySettingsAction(
      { ...actor, id: 'reviewer', capabilities: ['manage_catalogue', 'review_pack'] },
      payload,
    );
    expect(published.catalogue[0].approvedBy).toBe('reviewer');
    expect(published.catalogue[0].status).toBe('Published');
  });
  it('never permits changing the self approval policy or document formatting with personal preferences', async () => {
    expect(() =>
      preferencesSchema.parse({ ...defaultPreferences, documentFontSize: 18 }),
    ).toThrow();
    await savePreferences(actor, { textSize: 'larger', density: 'compact', reducedMotion: true });
    expect(mock.save).toHaveBeenCalledWith(actor, {
      textSize: 'larger',
      density: 'compact',
      reducedMotion: true,
    });
    const result = await applySettingsAction(actor, {
      action: 'defaults',
      expectedRevision: 1,
      requestId: requestId(),
      firmName: 'Example Firm',
      preparationLeadDays: 30,
      chaseIntervalDays: 7,
      defaultOwnerId: 'executive',
      selfApproval: true,
    });
    expect(result.selfApproval).toBe(false);
  });
  it('rejects a default owner who lacks preparation authority', async () => {
    mock.getActorById.mockResolvedValue({
      ...actor,
      id: 'account-admin',
      capabilities: ['manage_users'],
    });
    await expect(
      applySettingsAction(actor, {
        action: 'defaults',
        expectedRevision: 1,
        requestId: requestId(),
        firmName: 'Example Firm',
        preparationLeadDays: 30,
        chaseIntervalDays: 7,
        defaultOwnerId: 'account-admin',
      }),
    ).rejects.toThrow('active preparer');
    expect((mock.settings as Settings).revision).toBe(1);
    mock.getActorById.mockResolvedValue(null);
    await expect(
      applySettingsAction(actor, {
        action: 'defaults',
        expectedRevision: 1,
        requestId: requestId(),
        firmName: 'Example Firm',
        preparationLeadDays: 30,
        chaseIntervalDays: 7,
        defaultOwnerId: 'inactive-user',
      }),
    ).rejects.toThrow('active preparer');
  });
  it('escapes substitutions and strips active markup', () => {
    const html = renderTemplate(
      '<p onclick="bad()">{{company.name}}</p><img src=x onerror=bad()>',
      { 'company.name': '<script>bad()</script>' },
    );
    expect(html).toBe('<p>&lt;script&gt;bad()&lt;/script&gt;</p>');
    expect(cleanRichText('<p><strong>Keep</strong> <a href="javascript:bad()">link</a></p>')).toBe(
      '<p><strong>Keep</strong> link</p>',
    );
    expect(() => validateTemplate('<p>{{company.name</p>')).toThrow('malformed');
  });
});
describe('durable reminder reconciliation', () => {
  it('serves the workspace without rewriting reminders on page load', async () => {
    mock.reminders.mockClear();
    await getWorkspaceSupport(actor);
    expect(mock.reminders).not.toHaveBeenCalled();
  });
  it('regenerates stable overdue occurrences after restart and changes occurrence ids when dates change', async () => {
    mock.jobs = [
      baseJob({
        correspondence: [
          {
            id: 'request',
            direction: 'Outgoing',
            counterparty: 'Client',
            channel: 'Email',
            date: '2026-09-20',
            summary: 'Confirm particulars',
            ownerId: 'executive',
            evidenceIds: [],
            nextChaseDate: '2026-09-27',
            respondedOn: null,
          },
        ],
      }),
    ];
    mock.reminders.mockResolvedValue(2);
    expect(await reconcileReminders()).toBe(4);
    expect(mock.reminders.mock.calls.map(([companyId]) => companyId)).toEqual([
      'company',
      'second',
    ]);
    const first = deriveReminders(mock.jobs as Job[]);
    const second = deriveReminders(mock.jobs as Job[]);
    expect(first.map((item) => item.id)).toEqual(second.map((item) => item.id));
    expect(first.map((item) => item.kind)).toEqual([
      'Internal target',
      'Statutory date',
      'Client chase',
    ]);
    const changed = deriveReminders([baseJob({ internalTarget: '2026-10-02' })]);
    expect(changed[0].id).not.toBe(first[0].id);
  });
  it('does not erase incurred filing reminders merely because a job is cancelled', () => {
    const reminders = deriveReminders([baseJob({ state: 'Cancelled' })]);
    expect(reminders.map((item) => item.kind)).toEqual(['Statutory date']);
    expect(
      deriveReminders([baseJob({ state: 'Complete', filingState: 'Outcome confirmed' })]),
    ).toEqual([]);
  });
  it('retains an authority response deadline during readiness preparation until evidenced response or resubmission', () => {
    const attempt: Job['filingAttempts'][number] = {
      id: 'attempt-1',
      version: 1,
      documentIds: ['output'],
      submittedDate: '2026-10-01',
      reference: 'REF-1',
      channel: 'External channel',
      evidenceId: 'receipt',
      paymentEvidenceId: null,
      lodgerId: 'lodger',
      at: '2026-10-01T00:00:00Z',
      messages: [
        {
          id: 'query-1',
          kind: 'Query',
          wording: 'Clarify particulars',
          date: '2026-10-02',
          responseDue: '2026-10-20',
          evidenceId: 'query-evidence',
        },
      ],
      outcome: null,
    };
    const queried = baseJob({ filingState: 'Queried', filingAttempts: [attempt] });
    const first = deriveReminders([queried]).filter((item) => item.kind === 'Query response');
    const preparing = deriveReminders([{ ...queried, filingState: 'Ready' }]).filter(
      (item) => item.kind === 'Query response',
    );
    expect(first).toHaveLength(1);
    expect(preparing.map((item) => item.id)).toEqual(first.map((item) => item.id));
    expect(
      deriveReminders([{ ...queried, filingState: 'Not ready' }]).filter(
        (item) => item.kind === 'Query response',
      ),
    ).toHaveLength(1);
    const responded = structuredClone(attempt);
    responded.messages[0].response = {
      summary: 'Clarification sent externally',
      date: '2026-10-10',
      evidenceId: 'response-evidence',
      actorId: 'lodger',
    };
    expect(
      deriveReminders([{ ...queried, filingState: 'Ready', filingAttempts: [responded] }]).some(
        (item) => item.kind === 'Query response',
      ),
    ).toBe(false);
    const resubmitted = {
      ...attempt,
      id: 'attempt-2',
      reference: 'REF-2',
      submittedDate: '2026-10-10',
      messages: [],
    };
    expect(
      deriveReminders([
        { ...queried, filingState: 'Resubmitted', filingAttempts: [attempt, resubmitted] },
      ]).some((item) => item.kind === 'Query response'),
    ).toBe(false);
  });
  it('closes a chase only after its correspondence response is recorded', () => {
    const entry = {
      id: 'request',
      direction: 'Outgoing' as const,
      counterparty: 'Client',
      channel: 'Email',
      date: '2026-10-01',
      summary: 'Confirm',
      ownerId: 'executive',
      evidenceIds: [],
      nextChaseDate: '2026-10-08',
      respondedOn: '2026-10-07',
    };
    expect(
      deriveReminders([baseJob({ correspondence: [entry] })]).some(
        (item) => item.kind === 'Client chase',
      ),
    ).toBe(false);
  });
});

describe('illustrative internal generation', () => {
  it('uses the immutable anniversary company and embeds exact source versions', async () => {
    const captured = {
      id: 'company',
      name: 'Historical Company Name',
      registrationNumber: '202601000001',
      incorporationDate: '2020-10-22',
      financialYearEnd: '2026-12-31',
      legalStatus: 'Existing',
      engagementStatus: 'Active',
      address: 'Historical address',
      activity: 'Manufacturing',
      verification: 'Reviewed' as const,
      sourceEvidenceId: null,
      revision: 1,
    };
    const job = baseJob({
      snapshot: {
        asAt: '2026-10-22',
        company: captured,
        officers: [],
        capturedAt: '2026-10-22T00:00:00Z',
      },
      packs: [
        {
          version: 2,
          createdAt: '2026-10-22T00:00:00Z',
          createdBy: 'executive',
          notes: '',
          documentIds: [],
          checklist: [],
          requiredSigners: [],
          signatures: [],
          templateVersionId: null,
          state: 'Draft',
        },
      ],
    });
    mock.getJob.mockResolvedValue(job);
    mock.getCompany.mockResolvedValue({ ...captured, name: 'New live name' });
    mock.settings = {
      ...defaultSettings,
      catalogue: [
        {
          id: 'template-1',
          kind: 'template',
          name: 'Confirmation',
          version: 1,
          status: 'Published',
          content: '<p>{{company.name}} — {{job.year}}</p>',
          source: 'Fictional internal example v1',
          effectiveDate: '2020-01-01',
          createdBy: 'admin',
          createdAt: '2020-01-01T00:00:00Z',
          approvedBy: 'reviewer',
          approvedAt: '2020-01-02T00:00:00Z',
          predecessorId: null,
        },
      ],
    };
    mock.generated.mockImplementation(async (_actor: Actor, input: { file: File }) => ({
      id: 'generated',
      text: await input.file.text(),
    }));
    const result = await generateIllustrativePack(
      { ...actor, capabilities: ['prepare_job'] },
      { jobId: 'job', templateVersionId: 'template-1' },
    );
    expect(result).toMatchObject({
      id: 'generated',
      packVersion: 2,
      sourceRevision: 1,
      templateVersionId: 'template-1',
    });
    const file = mock.generated.mock.calls[0][1].file as File;
    const output = await file.text();
    expect(output).toContain('ILLUSTRATIVE INTERNAL DOCUMENT');
    expect(output).toContain('Historical Company Name — 2026');
    expect(output).not.toContain('New live name');
    expect(output).toContain('Source SHA-256:');
    expect(mock.getCompany).not.toHaveBeenCalled();
  });
  it('refuses draft templates, uncaptured annual snapshots and administrator-only generation', async () => {
    mock.getJob.mockResolvedValue(baseJob());
    await expect(
      generateIllustrativePack(actor, { jobId: 'job', templateVersionId: 'draft' }),
    ).rejects.toThrow('permission');
    await expect(
      generateIllustrativePack(
        { ...actor, capabilities: ['prepare_job'] },
        { jobId: 'job', templateVersionId: 'draft' },
      ),
    ).rejects.toThrow('historical anniversary snapshot');
    mock.getJob.mockResolvedValue(baseJob({ activity: 'W04' }));
    await expect(
      generateIllustrativePack(
        { ...actor, capabilities: ['prepare_job'] },
        { jobId: 'job', templateVersionId: 'draft' },
      ),
    ).rejects.toThrow('published internal template');
  });
});
