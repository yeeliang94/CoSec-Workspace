import { signIn as authenticate } from './sign-in';
import { removeBrowserFixture } from './cleanup';
import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
let createdJobId = '';
test.afterEach(async () => {
  if (createdJobId) await removeBrowserFixture(createdJobId);
  createdJobId = '';
});
type Account = { key: string; email: string; password: string };
test('annual return creation, retained duplicate validation, evidence, versions and independent review through UI', async ({
  page,
}) => {
  test.setTimeout(120000);
  const accounts = JSON.parse(await readFile('.local/accounts.json', 'utf8')) as Account[];
  async function signIn(key: string) {
    await authenticate(
      page,
      accounts.find((account) => account.key === key)!,
    );
  }
  await signIn('executive');
  const workspace = await (await page.request.get('/api/workspace')).json();
  const company = workspace.companies[0];
  let year = 2021;
  while (
    workspace.jobs.some(
      (j: { companyId: string; year: number }) => j.companyId === company.id && j.year === year,
    )
  )
    year++;
  await page.goto('/jobs/new');
  await expect(page.getByRole('heading', { name: 'New job', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Company', exact: true }).selectOption(company.id);
  await page.locator('[name=ownerId]').selectOption(workspace.actor.id);
  await page.locator('[name=year]').fill(String(year));
  await page
    .locator('[name=anniversaryDate]')
    .fill(`${year}-${company.incorporationDate.slice(5)}`);
  await page.getByRole('button', { name: 'Create job', exact: true }).click();
  await expect(page).toHaveURL(/\/jobs\/[a-f0-9-]+$/);
  const jobUrl = page.url();
  createdJobId = jobUrl.split('/').at(-1)!;
  await page.goto('/jobs/new');
  await page.getByRole('combobox', { name: 'Company', exact: true }).selectOption(company.id);
  await page.locator('[name=ownerId]').selectOption(workspace.actor.id);
  await page.locator('[name=year]').fill(String(year));
  await page
    .locator('[name=anniversaryDate]')
    .fill(`${year}-${company.incorporationDate.slice(5)}`);
  await page.getByRole('button', { name: 'Create job', exact: true }).click();
  await expect(page.locator('.feedback.error')).toContainText(/already|exists|duplicate/i);
  await expect(page.locator('[name=year]')).toHaveValue(String(year));
  page.once('dialog', (dialog) => dialog.accept());
  await page.goto(jobUrl);
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await page.getByLabel('Evidence title', { exact: true }).fill('UI acceptance source');
  await page.locator('input[type=file]').setInputFiles({
    name: 'ui-source.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Fictional UI acceptance evidence; not a legal document.'),
  });
  await page.getByRole('button', { name: 'Upload evidence', exact: true }).click();
  await expect(page.getByText('Evidence uploaded', { exact: true })).toBeVisible();
  const updated = await (await page.request.get('/api/workspace')).json();
  const doc = updated.documents.find(
    (d: { jobId: string; title: string }) =>
      d.jobId === jobUrl.split('/').at(-1) && d.title === 'UI acceptance source',
  );
  expect(doc).toBeTruthy();
  await page.getByText('Prepare a new pack version', { exact: true }).click();
  await page.locator('[name=notes]').fill('Prepared external output for fictional UI test');
  await page.getByRole('button', { name: 'Save new pack version', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Choose at least one item for “Pack documents”.',
  );
  await page.locator(`[name=documentIds][value="${doc.id}"]`).check();
  await page.getByRole('button', { name: 'Save new pack version', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Current pack · v2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Checklist', exact: true }).click();
  const items = page.locator('.checklist-item');
  for (let index = 0; index < (await items.count()); index++) {
    const item = items.nth(index);
    await item.locator(`[name=evidenceIds][value="${doc.id}"]`).check();
    await item.getByRole('button', { name: 'Link evidence', exact: true }).click();
    await expect(item.getByText('Saved', { exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  const confirm = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Record client confirmation', exact: true }) });
  await confirm.locator('[name=evidenceId]').selectOption(doc.id);
  await confirm.getByRole('button', { name: 'Record client confirmation', exact: true }).click();
  await expect(page.getByText('Client confirmation evidenced', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Request review of v/ }).click();
  await expect(page.locator('.track-facts')).toContainText('Awaiting review');
  await signIn('reviewer');
  await page.goto(jobUrl);
  const review = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: /Record decision for v/ }) });
  await review.locator('[name=scope]').selectOption('pack');
  await review.locator('[name=decision]').selectOption('Approved');
  await review
    .locator('[name=reason]')
    .fill('Checked fictional sources and exact pack through UI acceptance.');
  await review.getByRole('button', { name: /Record decision for v/ }).click();
  await expect(page.locator('.track-facts')).toContainText('Action in progress');
  await expect(page.locator('.track-facts')).toContainText('Reviewed');
  await mkdir('.local/ui-review', { recursive: true });
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `.local/ui-review/job-reviewed-${width}.png`, fullPage: true });
  }
  await page.goto('/settings');
  await page.getByRole('combobox', { name: 'Text size', exact: true }).selectOption('larger');
  await page.getByRole('checkbox', { name: 'Reduce motion', exact: true }).check();
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Preferences saved');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Text size', exact: true })).toHaveValue(
    'larger',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: '.local/ui-review/settings-larger-reduced-320.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Reset preferences', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Preferences saved');
});
