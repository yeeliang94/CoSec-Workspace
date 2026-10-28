import { signIn as authenticate } from './sign-in';
import { removeBrowserFixture } from './cleanup';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Job, Workspace } from '../../src/domain/model';
let createdJobId = '';
test.afterEach(async () => {
  if (createdJobId) await removeBrowserFixture(createdJobId);
  createdJobId = '';
});
test('director review, execution, dated record, external submission and outcome stay independent', async ({
  page,
}) => {
  const accounts = JSON.parse(await readFile('.local/accounts.json', 'utf8')) as {
    key: string;
    email: string;
    password: string;
  }[];
  const origin = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4300';
  async function signIn(key: string) {
    await authenticate(
      page,
      accounts.find((account) => account.key === key)!,
    );
  }
  async function post<T>(url: string, body: unknown): Promise<T> {
    const r = await page.request.post(url, { headers: { Origin: origin }, data: body });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  }
  await signIn('executive');
  const data: Workspace = await (await page.request.get('/api/workspace')).json();
  const company = data.companies[0];
  // This case exercises ordinary pack execution. A generated resolution has its own
  // immutable signer/hash requirements and cannot stand in for the uploaded source.
  const evidence = data.documents.find(
    (document) =>
      document.companyId === company.id &&
      document.classification === 'General' &&
      !document.jobId &&
      !document.generationId,
  );
  if (!evidence) throw new Error('The director test needs an unlinked uploaded source fixture.');
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  let job = await post<Job>('/api/jobs', {
    companyId: company.id,
    activity: 'W04',
    ownerId: data.actor.id,
    route: 'appointment',
    personId: crypto.randomUUID(),
    personName: 'Fictional UI appointment',
    effectiveDate: date,
    routeBasis: 'Fictional appointment route for evaluation only',
    sourceEvidenceIds: [evidence.id],
    statutoryDue: date,
    manualDateBasis: 'Fictional manually reviewed date — no statutory calculation',
    manualDateEvidenceId: evidence.id,
    requestId: crypto.randomUUID(),
  });
  createdJobId = job.id;
  async function action(action: string, payload: Record<string, unknown> = {}) {
    job = await post<Job>('/api/jobs/' + job.id, {
      expectedRevision: job.revision,
      requestId: crypto.randomUUID(),
      action,
      ...payload,
    });
  }
  await action('revise_pack', {
    notes: 'Fictional exact output',
    documentIds: [evidence.id],
    requiredSigners: ['Director consent'],
  });
  for (const item of job.packs.at(-1)!.checklist)
    await action('checklist_evidence', { itemId: item.id, evidenceIds: [evidence.id] });
  await action('request_review');
  await signIn('reviewer');
  await page.goto('/jobs/' + job.id);
  const review = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: /Record decision for v/ }) });
  for (const scope of ['pack', 'manual_date', 'record']) {
    await review.locator('[name=scope]').selectOption(scope);
    await review.locator('[name=decision]').selectOption('Approved');
    await review.locator('[name=reason]').fill('Fictional exact version and source checked');
    await review.getByRole('button', { name: /Record decision for v/ }).click();
    await expect(review.getByText('Saved', { exact: true })).toBeVisible();
  }
  await signIn('executive');
  await page.goto('/jobs/' + job.id);
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  const sign = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: /Record signature on v/ }) });
  await sign.locator('[name=signer]').selectOption('Director consent');
  await sign.locator('[name=evidenceId]').selectOption(evidence.id);
  await sign.getByRole('button', { name: /Record signature on v/ }).click();
  await expect(page.locator('.track-facts')).toContainText('Fully signed');
  await signIn('reviewer');
  await page.goto('/jobs/' + job.id);
  await page.getByRole('button', { name: 'Record changes', exact: true }).click();
  await page.getByRole('button', { name: 'Post appointment record', exact: true }).click();
  await page.getByRole('button', { name: 'Post appointment record', exact: true }).click();
  await expect(
    page.getByText('Record event posted. Filing remains not ready.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Filing', exact: true }).click();
  await page.getByRole('button', { name: /Authorise filing readiness for v/ }).click();
  await expect(page.locator('.track-facts').getByText('Ready', { exact: true })).toBeVisible();
  await signIn('lodger');
  await page.goto('/jobs/' + job.id);
  await page.getByRole('button', { name: 'Filing', exact: true }).click();
  const submit = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Record external submission', exact: true }) });
  await submit.locator('[name=reference]').fill('FICTIONAL-UI-' + job.id.slice(0, 8));
  await submit.locator('[name=channel]').fill('Fictional external channel');
  await submit.locator('[name=evidenceId]').selectOption(evidence.id);
  await submit.locator('[name=documentIds]').selectOption(evidence.id);
  await submit.getByRole('button', { name: 'Record external submission', exact: true }).click();
  await expect(page.locator('.track-facts').getByText('Submitted', { exact: true })).toBeVisible();
  await expect(page.getByText('Outcome confirmation outstanding', { exact: true })).toBeVisible();
  const outcome = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Confirm filing outcome', exact: true }) });
  await outcome.locator('[name=evidenceId]').selectOption(evidence.id);
  await outcome.locator('[name=wording]').fill('Acknowledged in fictional evaluation');
  await outcome.getByRole('button', { name: 'Confirm filing outcome', exact: true }).click();
  await outcome.getByRole('button', { name: 'Confirm filing outcome', exact: true }).click();
  await expect(
    page.locator('.track-facts').getByText('Outcome confirmed', { exact: true }),
  ).toBeVisible();
  expect(
    (await (await page.request.get('/api/workspace')).json()).jobs.find((j: Job) => j.id === job.id)
      .state,
  ).not.toBe('Complete');
});
