import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { signIn } from './sign-in';

async function login(page: Page) {
  const accounts: { key: string; email: string; password: string }[] = JSON.parse(
    await readFile('.local/accounts.json', 'utf8'),
  );
  await signIn(
    page,
    accounts.find((account) => account.key === 'owner')!,
  );
}

async function captureDesktop(page: Page, name: string) {
  await mkdir('.local/guided-forms', { recursive: true });
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `.local/guided-forms/${name}-${width}.png`, fullPage: true });
  }
}

for (const width of [1280, 1440]) {
  test(`guided company creation validates, preserves edits and reviews before saving at ${width}px`, async ({
    page,
  }) => {
    await login(page);
    await page.setViewportSize({ width, height: 1000 });
    await mkdir('.local/guided-forms', { recursive: true });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let submissions = 0;
    await page.route('**/api/companies', (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      submissions++;
      return route.fulfill({
        status: 400,
        json: { error: 'Fictional connection failure; try again.' },
      });
    });
    await page.goto('/companies');
    await page.getByRole('button', { name: 'New company', exact: true }).click();
    const form = page.locator('form.guided-form');
    const nav = form.getByRole('navigation', { name: 'Form steps' });
    const legalName = form.getByLabel('Legal name', { exact: true });
    await nav.getByRole('button', { name: 'Review', exact: true }).click();
    await expect(legalName).toBeFocused();
    await expect(form.getByRole('heading', { name: 'Company details', exact: true })).toBeVisible();
    await legalName.fill('Fictional International Corporate Advisory Services Sdn. Bhd.');
    await form.getByLabel('Registration number', { exact: true }).fill('202600009997');
    await form.getByLabel('Incorporation date', { exact: true }).fill('2026-01-15');
    await form
      .getByLabel('Registered address', { exact: true })
      .fill('12 Jalan Contoh, Level 18\n50450 Kuala Lumpur');
    await page.screenshot({
      path: `.local/guided-forms/company-details-${width}.png`,
      fullPage: true,
    });
    await legalName.press('Enter');
    await expect(
      form.getByRole('heading', { name: 'Business details', exact: true }),
    ).toBeFocused();
    await form.getByRole('combobox', { name: 'Industry', exact: true }).selectOption({ index: 1 });
    await form
      .getByLabel('Business activity (optional)', { exact: true })
      .fill('Corporate secretarial and advisory services');
    await form.getByRole('button', { name: 'Continue', exact: true }).click();
    await form
      .getByRole('combobox', { name: 'Name', exact: true })
      .fill('Fictional New Director Abdullah');
    await form.getByLabel('From', { exact: true }).fill('2026-01-15');
    await page.screenshot({
      path: `.local/guided-forms/company-people-${width}.png`,
      fullPage: true,
    });
    await form.getByRole('button', { name: 'Review details', exact: true }).click();
    expect(submissions).toBe(0);
    await expect(form.locator('.guided-review')).toContainText('Fictional New Director Abdullah');
    await expect(form.locator('.guided-review')).toContainText('15 Jan 2026');
    await form.getByRole('button', { name: 'Change company details', exact: true }).click();
    await expect(legalName).toHaveValue(
      'Fictional International Corporate Advisory Services Sdn. Bhd.',
    );
    await legalName.fill('Fictional Revised Corporate Advisory Services Sdn. Bhd.');
    await nav.getByRole('button', { name: 'Review', exact: true }).click();
    await expect(form.locator('.guided-review')).toContainText(
      'Fictional Revised Corporate Advisory Services Sdn. Bhd.',
    );
    await expect(form.locator('.guided-review')).toContainText(
      'Corporate secretarial and advisory services',
    );
    await page.screenshot({
      path: `.local/guided-forms/company-review-${width}.png`,
      fullPage: true,
    });
    await form.getByRole('button', { name: 'Create company', exact: true }).click();
    await expect(form.getByRole('alert')).toContainText('Fictional connection failure');
    expect(submissions).toBe(1);
    await form.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(form.getByRole('combobox', { name: 'Name', exact: true })).toHaveValue(
      'Fictional New Director Abdullah',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}

test('a resolution keeps its full payload through guided review and failed saves', async ({
  page,
}) => {
  await login(page);
  const workspace = await (await page.request.get('/api/workspace')).json();
  const company = workspace.companies[0];
  const form = page.locator('form.guided-form');
  let resolutionPayload: Record<string, unknown> | undefined;
  await page.route('**/api/resolution-cases', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    resolutionPayload = route.request().postDataJSON();
    return route.fulfill({ status: 400, json: { error: 'Fictional resolution save failed' } });
  });
  await page.goto('/resolutions');
  await page.getByRole('button', { name: 'New resolution', exact: true }).click();
  await form.getByRole('combobox', { name: 'Company', exact: true }).selectOption(company.id);
  await form.getByLabel('Title', { exact: true }).fill('Fictional guided resolution');
  await captureDesktop(page, 'resolution-details');
  await form.getByRole('button', { name: 'Continue', exact: true }).click();
  await form.getByLabel('Resolution date', { exact: true }).fill('2026-11-10');
  await form.getByLabel('Effective date', { exact: true }).fill('2026-11-15');
  await form.getByRole('button', { name: 'Review details', exact: true }).click();
  await expect(form.locator('.guided-review')).toContainText('10 Nov 2026');
  await captureDesktop(page, 'resolution-review');
  await form.getByRole('button', { name: 'Create resolution', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('Fictional resolution save failed');
  expect(resolutionPayload).toMatchObject({
    companyId: company.id,
    title: 'Fictional guided resolution',
    resolutionDate: '2026-11-10',
    effectiveDate: '2026-11-15',
  });
  await form.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(form.getByLabel('Effective date', { exact: true })).toHaveValue('2026-11-15');
});
