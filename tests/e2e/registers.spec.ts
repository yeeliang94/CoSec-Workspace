import { test, expect, type Page } from '@playwright/test';
import { signIn } from './sign-in';
import { mkdir } from 'node:fs/promises';
import type { Job, Workspace } from '../../src/domain/model';
import { createRecordFixture, removeRecordFixture, type RecordFixture } from './record-fixture';
test.describe.configure({ mode: 'serial' });
let fixture: RecordFixture;
const origin = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4300';
test.beforeAll(async () => {
  fixture = await createRecordFixture();
  await mkdir('.local/record-previews', { recursive: true });
});
test.afterAll(async () => {
  if (fixture) await removeRecordFixture(fixture);
});
async function login(page: Page, account: RecordFixture['preparer']) {
  await signIn(page, account);
}
async function state(page: Page): Promise<Workspace> {
  return (await page.request.get('/api/workspace')).json();
}
async function create(page: Page, activity: 'W05' | 'W06') {
  await page.goto(`/jobs/new?company=${fixture.companyId}&activity=${activity}`);
  await expect(page.getByRole('combobox', { name: 'Activity', exact: true })).toHaveValue(activity);
  await expect(page.getByRole('combobox', { name: 'Company', exact: true })).toHaveValue(
    fixture.companyId,
  );
  await page
    .getByRole('combobox', { name: 'Owner', exact: true })
    .selectOption(fixture.preparer.id);
  await page.getByLabel('Proposed effective date').fill('2026-10-01');
  await page
    .getByLabel('Instruction and authority basis')
    .fill('Fictional browser evidence and reviewed route');
  await page.getByRole('button', { name: 'Create job', exact: true }).click();
  await expect(page.locator('.record-heading')).toBeVisible();
  return page.url().split('/').at(-1)!;
}
async function upload(page: Page, title: string) {
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await page.getByLabel('Evidence title', { exact: true }).fill(title);
  await page.locator('input[type=file]').setInputFiles({
    name: 'fictional.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Fictional browser evidence only; no legal or personal records.'),
  });
  await page.getByRole('button', { name: 'Upload evidence', exact: true }).click();
  await expect(page.getByText('Evidence uploaded', { exact: true })).toBeVisible();
  return (await state(page)).documents.find((d) => d.title === title)!.id;
}
async function preparePack(page: Page, doc: string, signers: string[] = []) {
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await page.getByText('Prepare a new pack version', { exact: true }).click();
  await page
    .getByLabel('Preparation and revision notes')
    .fill('Fictional exact output, evidence and record proposal');
  await page.getByRole('listbox', { name: 'Pack documents', exact: true }).selectOption(doc);
  if (signers.length)
    await page.getByLabel('Required signers (one per line)').fill(signers.join('\n'));
  await page.getByRole('button', { name: 'Save new pack version', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Checklist', exact: true }).click();
  const checks = page.locator('.checklist-item');
  for (let i = 0; i < (await checks.count()); i++) {
    await checks.nth(i).locator('select').selectOption(doc);
    await checks.nth(i).getByRole('button', { name: 'Link evidence', exact: true }).click();
    await expect(checks.nth(i).getByText('Saved', { exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: /Request review of v/ }).click();
  await expect(page.locator('.track-facts')).toContainText('Awaiting review');
}
async function reviewPack(page: Page, jobId: string) {
  await login(page, fixture.reviewer);
  await page.goto('/jobs/' + jobId);
  const form = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: /Record decision for v/ }) });
  for (const scope of ['pack', 'record']) {
    await form.locator('[name=scope]').selectOption(scope);
    await form
      .locator('[name=reason]')
      .fill('Fictional browser independent exact-version decision');
    await form.getByRole('button', { name: /Record decision for v/ }).click();
    await expect(form.getByText('Saved', { exact: true })).toBeVisible();
  }
}
test('W05 opening allocation is prepared, independently reviewed and posted through the UI', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, fixture.preparer);
  const id = await create(page, 'W05');
  const doc = await upload(page, 'Fictional share source');
  await page.getByRole('button', { name: 'Record changes', exact: true }).click();
  await page.getByLabel('Class name', { exact: true }).fill('Ordinary');
  await page.getByLabel('Issued amount', { exact: true }).fill('100.00');
  await page.getByLabel('Paid-up amount', { exact: true }).fill('100.00');
  await page.getByLabel('Member name', { exact: true }).fill('Fictional browser member');
  await page.getByLabel('Registered address', { exact: true }).fill('Fictional member address');
  await page.getByLabel('Share units', { exact: true }).fill('100');
  await page.getByLabel('Certificate number', { exact: true }).fill('BROWSER001');
  await page
    .getByRole('combobox', { name: 'Stamping disposition', exact: true })
    .selectOption('Not applicable');
  await page.getByRole('combobox', { name: 'Stamping evidence', exact: true }).selectOption(doc);
  await page.getByLabel('Stamping basis').fill('Fictional opening source checked');
  await page
    .getByRole('listbox', { name: 'Decision and authority evidence', exact: true })
    .selectOption(doc);
  await page.getByRole('button', { name: 'Save transaction for review', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Opening balances · Ordinary', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('table', { name: 'Reviewed before and after class totals' }),
  ).toContainText('100');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `.local/record-previews/capital-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
  await preparePack(page, doc);
  await reviewPack(page, id);
  await page.getByRole('button', { name: 'Record changes', exact: true }).click();
  const post = page.getByRole('button', { name: 'Post reviewed share transaction', exact: true });
  await post.click();
  await post.click();
  await expect(page.getByText('Effective', { exact: true })).toBeVisible();
  expect((await state(page)).jobs.find((j) => j.id === id)?.filingState).toBe('Not ready');
  await page.goto('/companies/' + fixture.companyId);
  await expect(page.getByRole('table', { name: 'Members by share class' })).toContainText(
    'Fictional browser member',
  );
  await expect(page.getByRole('table', { name: 'Share class totals' })).toContainText('100.00');
  expect(errors).toEqual([]);
});
test('BO notice nonresponse, assessment, restricted evidence and posting stay separate', async ({
  page,
}) => {
  await login(page, fixture.preparer);
  const id = await create(page, 'W06'),
    doc = await upload(page, 'Fictional BO chain');
  expect((await state(page)).documents.find((d) => d.id === doc)?.classification).toBe('BO');
  await page.getByRole('button', { name: 'Record changes', exact: true }).click();
  await page
    .getByLabel('Person full name', { exact: true })
    .fill('Fictional private browser owner');
  const notice = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Record external notice', exact: true }) });
  await notice.locator('[name=recipient]').fill('Fictional BO recipient');
  await notice.locator('[name=sentDate]').fill('2026-10-01');
  await notice.locator('[name=responseDue]').fill('2026-10-10');
  await notice.locator('[name=nextChaseDate]').fill('2026-10-05');
  await notice.locator('[name=evidenceId]').selectOption(doc);
  await notice.getByRole('button', { name: 'Record external notice', exact: true }).click();
  await expect(page.getByText('Reply outstanding', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Person full name', { exact: true })).toHaveValue(
    'Fictional private browser owner',
  );
  await page.getByText('Record reply', { exact: true }).click();
  const reply = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Record notice reply', exact: true }) });
  await reply.locator('[name=date]').fill('2026-10-21');
  await reply.locator('[name=evidenceId]').selectOption(doc);
  await reply.locator('[name=summary]').fill('Fictional notice reply reconciled');
  await reply.getByRole('button', { name: 'Record notice reply', exact: true }).click();
  await expect(page.getByText(/Reply received/)).toBeVisible();
  await page
    .getByLabel('Person full name', { exact: true })
    .fill('Fictional private browser owner');
  await page
    .getByLabel('Assessed criteria', { exact: true })
    .fill('Fictional assessed criteria, not an encoded legal threshold');
  await page
    .getByLabel('Source and version', { exact: true })
    .fill('Fictional approved source v1 for evaluation');
  await page
    .getByLabel('Ownership chain and decision basis')
    .fill('Fictional chain evidence independently checked');
  await page
    .getByRole('listbox', { name: 'Chain and criteria evidence', exact: true })
    .selectOption(doc);
  await page.getByLabel('Next review date', { exact: true }).fill('2027-01-01');
  await page.getByRole('button', { name: 'Save assessment for review', exact: true }).click();
  await expect(
    page
      .getByRole('definition')
      .filter({ hasText: 'Fictional assessed criteria, not an encoded legal threshold' }),
  ).toBeVisible();
  await expect(
    page.getByRole('definition').filter({ hasText: 'Fictional approved source v1 for evaluation' }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/record-previews/bo-390.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await preparePack(page, doc);
  await reviewPack(page, id);
  await page.getByRole('button', { name: 'Record changes', exact: true }).click();
  const post = page.getByRole('button', { name: 'Post reviewed BO register entry', exact: true });
  await post.click();
  await post.click();
  await expect(
    page.getByText('BO register entry recorded · Filing: Not ready', { exact: true }),
  ).toBeVisible();
  await page.goto('/companies/' + fixture.companyId);
  await expect(
    page.getByRole('table', { name: 'Reviewed beneficial ownership register' }),
  ).toContainText('Fictional private browser owner');
  await login(page, fixture.ordinary);
  await page.goto('/work');
  expect((await state(page)).jobs.some((j: Job) => j.id === id)).toBe(false);
  expect((await state(page)).documents.some((d) => d.id === doc)).toBe(false);
  expect((await page.request.get('/api/documents/' + doc)).status()).toBe(404);
  expect(
    (
      await page.request.post('/api/jobs/' + id, {
        headers: { Origin: origin },
        data: {
          action: 'note',
          expectedRevision: 1,
          requestId: crypto.randomUUID(),
          html: 'Must remain unavailable',
        },
      })
    ).status(),
  ).toBe(404);
  expect((await page.request.get('/api/companies/' + fixture.companyId + '/bo')).status()).toBe(
    403,
  );
  await page.goto('/companies/' + fixture.companyId);
  await expect(page.getByRole('heading', { name: /Beneficial ownership as at/ })).toHaveCount(0);
  await expect(page.getByText('Fictional private browser owner', { exact: true })).toHaveCount(0);
});

async function sign(page: Page, id: string, doc: string, signer: string) {
  await login(page, fixture.preparer);
  await page.goto('/jobs/' + id);
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  const form = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: /Record signature on v/ }) });
  await form.locator('[name=signer]').selectOption(signer);
  await form.locator('[name=evidenceId]').selectOption(doc);
  await form.getByRole('button', { name: /Record signature on v/ }).click();
  await expect(form.getByText('Saved', { exact: true })).toBeVisible();
}
async function postCapital(page: Page, id: string) {
  await login(page, fixture.reviewer);
  await page.goto('/jobs/' + id);
  await page.getByRole('button', { name: 'Record changes', exact: true }).click();
  const post = page.getByRole('button', { name: 'Post reviewed share transaction', exact: true });
  await post.click();
  await post.click();
}
test('signed transfer conserves units, retains certificates and allows an allotment into a new class', async ({
  page,
}) => {
  await login(page, fixture.preparer);
  const id = await create(page, 'W05'),
    doc = await upload(page, 'Fictional transfer source');
  await page.getByRole('button', { name: 'Record changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Transaction', exact: true }).selectOption('transfer');
  const before = await (
    await page.request.get('/api/companies/' + fixture.companyId + '/registers?asAt=2026-10-01')
  ).json();
  await page
    .getByRole('combobox', { name: 'Source certificate', exact: true })
    .selectOption(
      before.position.certificates.find((c: { number: string }) => c.number === 'BROWSER001').id,
    );
  await page.getByLabel('Transferor replacement certificate').fill('BROWSER003');
  await page.getByLabel('Member name', { exact: true }).fill('Fictional browser transferee');
  await page.getByLabel('Registered address', { exact: true }).fill('Fictional recipient address');
  await page.getByLabel('Share units', { exact: true }).fill('40');
  await page.getByLabel('Certificate number', { exact: true }).fill('BROWSER002');
  await page
    .getByRole('combobox', { name: 'Stamping disposition', exact: true })
    .selectOption('Evidence recorded');
  await page.getByRole('combobox', { name: 'Stamping evidence', exact: true }).selectOption(doc);
  await page.getByLabel('Stamping basis').fill('Fictional stamped transfer evidence');
  await page
    .getByRole('listbox', { name: 'Decision and authority evidence', exact: true })
    .selectOption(doc);
  await page.getByRole('button', { name: 'Save transaction for review', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Transfer · Ordinary', exact: true }),
  ).toBeVisible();
  await preparePack(page, doc, ['Fictional director', 'Fictional member']);
  await reviewPack(page, id);
  await sign(page, id, doc, 'Fictional director');
  await expect(page.locator('.track-facts')).toContainText('Partly signed');
  await postCapital(page, id);
  await expect(page.locator('.feedback.error[role=alert]')).toContainText(
    'Fictional member: signature evidence is missing',
  );
  expect((await state(page)).jobs.find((j) => j.id === id)?.recordEventId).toBeNull();
  await sign(page, id, doc, 'Fictional member');
  await expect(page.locator('.track-facts')).toContainText('Fully signed');
  await postCapital(page, id);
  await expect(page.getByText('Effective', { exact: true })).toBeVisible();
  const after = await (
    await page.request.get('/api/companies/' + fixture.companyId + '/registers?asAt=2026-10-01')
  ).json();
  expect(after.position.classes[0].units).toBe('100');
  expect(after.position.holdings.map((h: { units: string }) => h.units).sort()).toEqual([
    '40',
    '60',
  ]);
  expect(
    after.position.certificates.find((c: { number: string }) => c.number === 'BROWSER001')
      .cancelledOn,
  ).toBe('2026-10-01');
  await login(page, fixture.preparer);
  const allot = await create(page, 'W05'),
    allotDoc = await upload(page, 'Fictional new-class allotment');
  await page.getByRole('button', { name: 'Record changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Share class', exact: true }).selectOption('');
  await page.getByLabel('Class name', { exact: true }).fill('Preference');
  await page.getByLabel('Issued amount', { exact: true }).fill('200.00');
  await page.getByLabel('Paid-up amount', { exact: true }).fill('150.00');
  await page
    .getByRole('combobox', { name: 'Member', exact: true })
    .selectOption(
      after.position.members.find((m: { name: string }) => m.name === 'Fictional browser member')
        .id,
    );
  await page.getByLabel('Share units', { exact: true }).fill('20');
  await page.getByLabel('Certificate number', { exact: true }).fill('PREF001');
  await page
    .getByRole('combobox', { name: 'Stamping disposition', exact: true })
    .selectOption('Not applicable');
  await page
    .getByRole('combobox', { name: 'Stamping evidence', exact: true })
    .selectOption(allotDoc);
  await page.getByLabel('Stamping basis').fill('Fictional assessed allotment route');
  await page
    .getByRole('listbox', { name: 'Decision and authority evidence', exact: true })
    .selectOption(allotDoc);
  await page.getByRole('button', { name: 'Save transaction for review', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Allotment · Preference', exact: true }),
  ).toBeVisible();
  await preparePack(page, allotDoc, ['Fictional director']);
  await reviewPack(page, allot);
  await sign(page, allot, allotDoc, 'Fictional director');
  await postCapital(page, allot);
  await expect(page.getByText('Effective', { exact: true })).toBeVisible();
  await page.goto('/companies/' + fixture.companyId);
  await expect(page.getByRole('table', { name: 'Share class totals' })).toContainText('Preference');
  await expect(page.getByRole('table', { name: 'Members by share class' })).toContainText(
    'Fictional browser transferee',
  );
});
