import { signIn as authenticate } from './sign-in';
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Fictional data only. Records created here are prefixed "E2E" so they can be identified;
// published template versions are immutable and cannot be removed afterwards.
test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36);
const clauseName = `E2E Fee approval ${stamp}`;
const caseTitle = `E2E Board resolution ${stamp}`;
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kuala_Lumpur',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
let clauseUrl = '';
let companyId = '';

async function as(page: Page, key: string) {
  const accounts = JSON.parse(await readFile('.local/accounts.json', 'utf8')) as {
    key: string;
    email: string;
    password: string;
  }[];
  await authenticate(
    page,
    accounts.find((account) => account.key === key)!,
  );
}

async function noOverflow(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(300);
  const size = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(size.scroll, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(size.viewport);
}

async function createQuestion(page: Page, label: string, type?: string) {
  const inspector = page.locator('.template-inspector');
  if (type)
    await inspector.getByRole('combobox', { name: 'Answer type' }).first().selectOption(type);
  await inspector.getByLabel('New question label').fill(label);
  await inspector.getByRole('button', { name: 'Create and insert' }).click();
  await expect(
    page.locator('.template-canvas .field-chip', { hasText: label }).first(),
  ).toBeVisible();
}

async function insertExisting(page: Page, label: string) {
  const inspector = page.locator('.template-inspector');
  await inspector.getByLabel('Find an existing field').fill(label);
  await inspector.getByRole('button', { name: `Insert ${label}`, exact: true }).click();
}

test('preparer company has the constitution citations the assemblies cite', async ({ page }) => {
  await as(page, 'executive');
  const workspace = await (await page.request.get('/api/workspace')).json();
  companyId = workspace.companies[0].id;
  await as(page, 'owner');
  await page.goto('/resolutions/companies/' + companyId);
  for (const label of ["Directors' authority", "Members' authority"]) {
    const entry = page.locator('.citation-list > li', { hasText: label }).first();
    await expect(entry.locator('h3')).toBeVisible();
    if (!(await entry.getByText('Not recorded').count())) continue;
    await entry.getByRole('button', { name: `Record ${label}` }).click();
    await entry.getByLabel('Citation').fill(`Fictional E2E article for ${label.toLowerCase()}`);
    await entry.getByLabel('Applies from').fill('2020-01-01');
    await entry.getByLabel('Reason and source').fill('Fictional E2E constitution');
    await entry.getByRole('button', { name: `Record ${label.toLowerCase()}` }).click();
    await expect(entry.getByText('Not recorded')).toHaveCount(0);
  }
});

test('author writes a clause with a bound value, reused question and two wordings', async ({
  page,
}) => {
  test.setTimeout(180000);
  await as(page, 'owner');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/templates');
  await page.getByRole('button', { name: 'New clause' }).click();
  const form = page.locator('.new-resolution');
  await form.getByLabel('Name').fill(clauseName);
  await form.getByLabel('Category').selectOption('Dividend');
  await form.getByRole('button', { name: 'Create clause' }).click();
  await page.waitForURL(/\/templates\/clauses\//);
  clauseUrl = new URL(page.url()).pathname;
  await expect(page.getByRole('heading', { name: clauseName })).toBeVisible();

  // Directors' written wording: one bound company name and two questions, one used twice.
  await page.getByRole('tab', { name: /Directors' written resolution/ }).click();
  const canvas = page.locator('.template-canvas .tiptap');
  await canvas.click();
  await page.keyboard.type('RESOLVED that ');
  await createQuestion(page, 'Company name');
  await page.keyboard.type(' approves a fee of ');
  await createQuestion(page, 'Fee amount', 'number');
  await page.keyboard.type(' with the note ');
  await createQuestion(page, 'Approval note', 'text');
  await page.keyboard.type('. The fee of ');
  await insertExisting(page, 'Fee amount');
  await page.keyboard.type(' is final. Payable: ');
  await createQuestion(page, 'Fees payable', 'boolean');
  await expect(canvas.locator('.field-chip', { hasText: 'Fee amount' })).toHaveCount(2);

  // Bind the company name to the company record instead of asking for it.
  await page.getByRole('button', { name: 'Edit Company name' }).click();
  await page.locator('.field-editor').getByLabel('Value comes from').selectOption('binding');
  await expect(page.locator('.field-editor').getByLabel('Record value')).toHaveValue(
    'company.name',
  );

  // Members' written wording reuses the same question; it is still one field.
  await page.getByRole('tab', { name: /Members' written resolution/ }).click();
  await page.locator('.template-canvas .tiptap').click();
  await page.keyboard.type('The members note a fee of ');
  await insertExisting(page, 'Fee amount');
  await expect(page.locator('.template-inspector').getByText('Fields (4)')).toBeVisible();

  await page.getByRole('button', { name: 'Details', exact: true }).click();
  await page.getByLabel('Source or basis of wording').fill('Fictional E2E wording, not approved');
  await page.getByLabel('Effective date').fill(today);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.locator('.save-bar [role=status]')).toHaveText('Draft saved');

  // Reopen: nothing is lost.
  await page.reload();
  await page.getByRole('tab', { name: /Directors' written resolution/ }).click();
  await expect(page.locator('.template-canvas .field-chip', { hasText: 'Fee amount' })).toHaveCount(
    2,
  );
  await expect(
    page.locator('.template-canvas .field-chip', { hasText: 'Company name' }),
  ).toHaveCount(1);
  await page.getByRole('tab', { name: /Members' written resolution/ }).click();
  await expect(page.locator('.template-canvas')).toContainText('The members note a fee of');
  await expect(page.getByText(/From records: company\.name/)).toBeVisible();

  await noOverflow(page, 768);
  await noOverflow(page, 390);
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByRole('button', { name: 'Submit v1 for review' }).click();
  await expect(page.locator('.lifecycle-state')).toContainText('v1 · In review');
  await expect(page.getByText('Waiting for review by a different person.')).toBeVisible();
});

test('a different reviewer publishes the clause', async ({ page }) => {
  test.skip(!clauseUrl, 'Clause not created');
  await as(page, 'reviewer');
  await page.goto(clauseUrl);
  await page.getByRole('button', { name: 'Review and publish v1' }).click();
  await expect(page.locator('.diff-summary')).toContainText('First version');
  await page.getByLabel('I have reviewed these changes and the sample preview').check();
  await page.getByRole('button', { name: 'Publish v1' }).click();
  await expect(page.locator('.lifecycle-state')).toContainText('v1 · Published');
});

test('preparer assembles, answers, previews and generates a Word document', async ({ page }) => {
  test.skip(!clauseUrl, 'Clause not published');
  test.setTimeout(180000);
  await as(page, 'executive');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/resolutions');
  await page.getByRole('button', { name: 'New resolution' }).first().click();
  const form = page.locator('.new-resolution');
  await form.getByLabel('Company').selectOption(companyId);
  await form.getByLabel('Title').fill(caseTitle);
  await form.getByRole('button', { name: 'Create resolution' }).click();
  await page.waitForURL(/\/resolutions\/[^/]+$/);
  await expect(page.getByRole('heading', { name: caseTitle })).toBeVisible();

  await page.getByRole('button', { name: 'Clauses', exact: true }).click();
  await page.getByLabel('Output type').selectOption({ label: "Directors' written resolution" });
  const assembly = page.getByLabel('Assembly');
  const option = await assembly
    .locator('option', { hasText: /^Directors' written resolution · v/ })
    .first()
    .getAttribute('value');
  await assembly.selectOption(option!);
  await page.getByRole('button', { name: 'Use this assembly' }).click();
  await expect(page.getByRole('heading', { name: /Selected clauses/ })).toBeVisible();

  const selected = page.locator('.selected-clause-list > li');
  for (const name of [clauseName, 'Appointment of auditors', 'General business']) {
    const before = await selected.count();
    await page.getByLabel('Search clause library').fill(name);
    await page.getByRole('button', { name: `Add ${name}`, exact: true }).click();
    await expect(selected).toHaveCount(before + 1);
  }
  await page.getByLabel('Search clause library').fill('');
  const names = () => selected.locator('.clause-meta strong').allTextContents();
  const order = await names();
  expect(order.slice(-3)).toEqual([clauseName, 'Appointment of auditors', 'General business']);
  await page.getByRole('button', { name: 'Move General business up' }).click();
  await expect
    .poll(async () => (await names()).slice(-3))
    .toEqual([clauseName, 'General business', 'Appointment of auditors']);

  // Questions: the reused fee question is asked once; the bound company name is read only.
  await page.getByRole('button', { name: 'Questions', exact: true }).click();
  const questions = page.locator('.question-form');
  const ours = questions.locator('.question-section', { hasText: clauseName });
  await expect(ours.getByLabel(/Fee amount/)).toHaveCount(1);
  await expect(ours.locator('.bound-value', { hasText: 'Company name' })).toBeVisible();
  await expect(ours.getByLabel(/Fee amount/)).toHaveAttribute('inputmode', 'decimal');
  for (const input of await questions.locator('input:not([type]), input[type=text]').all())
    if (await input.isEditable())
      await input.fill(
        (await input.getAttribute('inputmode')) === 'decimal' ? '1500.00' : 'E2E answer',
      );
  for (const input of await questions.locator('input[type=date]').all())
    if (await input.isEditable()) await input.fill(today);
  for (const area of await questions.locator('textarea').all())
    if (await area.isEditable()) await area.fill('Fictional E2E business text.');
  for (const add of await questions.locator('.add-person').all()) {
    const select = add.locator('select');
    const value = await select.locator('option').nth(1).getAttribute('value');
    if (value) {
      await select.selectOption(value);
      await add.getByRole('button', { name: 'Add' }).click();
    }
  }
  await questions.getByLabel('Fees payable', { exact: false }).selectOption('false');
  await questions.getByRole('button', { name: 'Save answers' }).first().click();
  await expect(questions.locator('.question-save [aria-live]')).toHaveText('Answers saved');

  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('.document-page')).toContainText('approves a fee of');
  await expect(page.locator('.document-page')).toContainText('Payable: No');
  await expect(page.getByText('Word decides the final page breaks')).toBeVisible();

  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await page.getByRole('button', { name: 'Generate Word document' }).click();
  const link = page.getByRole('link', { name: 'Download version 1' });
  await expect(link).toBeVisible({ timeout: 45000 });
  const response = await page.request.get((await link.getAttribute('href'))!);
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain(
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  expect((await response.body()).length).toBeGreaterThan(1000);

  // Switch output type: each clause now uses its members' wording.
  await page.getByRole('button', { name: 'Clauses', exact: true }).click();
  await page.getByLabel('Output type').selectOption({ label: "Members' written resolution" });
  await page.getByRole('button', { name: 'Apply output type and assembly' }).click();
  await expect(page.getByRole('button', { name: 'Apply output type and assembly' })).toHaveCount(0);
  await expect(page.locator('.clause-picker [role=alert], section > .feedback.error')).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('.document-page')).toContainText('The members note a fee of');

  for (const section of ['Clauses', 'Questions', 'Documents']) {
    await page.getByRole('button', { name: section, exact: true }).click();
    await noOverflow(page, 768);
    await noOverflow(page, 390);
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
});

test('version-history links preserve a dirty draft when discard is cancelled', async ({ page }) => {
  test.skip(!clauseUrl, 'Clause not created');
  await as(page, 'owner');
  await page.goto(clauseUrl);
  await page.getByRole('button', { name: 'Create new version', exact: true }).click();
  await expect(page.locator('.lifecycle-state')).toContainText('v2 · Draft');
  await page.getByRole('tab', { name: /Directors' written resolution/ }).click();
  const canvas = page.locator('.template-canvas .tiptap');
  await canvas.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' Unsaved version-history regression.');
  await page.getByRole('button', { name: 'Versions', exact: true }).click();
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe('Discard unsaved changes?');
    await dialog.dismiss();
  });
  await page.getByRole('link', { name: 'v1', exact: true }).click();
  await expect(page.locator('.lifecycle-state')).toContainText('v2 · Draft');
  await page.getByRole('button', { name: 'Wording', exact: true }).click();
  await expect(canvas).toContainText('Unsaved version-history regression.');
  await page.getByRole('button', { name: 'Versions', exact: true }).click();
  page.once('dialog', async (dialog) => dialog.accept());
  await page.getByRole('link', { name: 'v1', exact: true }).click();
  await expect(page.locator('.lifecycle-state')).toContainText('v1 · Published');
  await page.getByRole('button', { name: 'Versions', exact: true }).click();
  await page.getByRole('link', { name: 'v2', exact: true }).click();
  await expect(page.locator('.lifecycle-state')).toContainText('v2 · Draft');
  await expect(canvas).not.toContainText('Unsaved version-history regression.');
});

test('an unlinked director resolution can link its W04 job from Overview', async ({ page }) => {
  await as(page, 'owner');
  const workspace = await (await page.request.get('/api/workspace')).json();
  const job = workspace.jobs.find(
    (item: { activity: string; route: string }) =>
      item.activity === 'W04' && item.route === 'appointment',
  );
  expect(job, 'seeded appointment job').toBeTruthy();
  const response = await page.request.post('/api/resolution-cases', {
    headers: { Origin: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000' },
    data: {
      requestId: crypto.randomUUID(),
      companyId: job.companyId,
      kind: 'director_appointment',
      title: `E2E unlinked director ${stamp}`,
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const item = await response.json();
  await page.goto('/resolutions/' + item.id);
  const section = page.getByRole('region', { name: 'Link director change', exact: true });
  await noOverflow(page, 390);
  await noOverflow(page, 768);
  await section
    .getByRole('combobox', { name: 'Director change (W04)', exact: true })
    .selectOption(job.id);
  await section.getByRole('button', { name: 'Link W04 job', exact: true }).click();
  await expect(section).toHaveCount(0);
  await expect(page.locator('.record-heading')).toContainText(job.title);
  const result = await (await page.request.get('/api/resolution-cases/' + item.id)).json();
  expect(result.case).toMatchObject({
    jobId: job.id,
    personId: job.personId,
    effectiveDate: job.effectiveDate,
  });
  await noOverflow(page, 390);
});
