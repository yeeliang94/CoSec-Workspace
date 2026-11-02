import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { signIn } from './sign-in';
import { answerPrompt } from './prompt';

async function login(page: Page, key = 'owner') {
  const accounts: { key: string; email: string; password: string }[] = JSON.parse(
    await readFile('.local/accounts.json', 'utf8'),
  );
  await page.context().clearCookies();
  await signIn(
    page,
    accounts.find((account) => account.key === key)!,
  );
  await page.goto('/resolutions');
  await expect(page.getByRole('heading', { name: 'Resolutions', exact: true })).toBeVisible();
}

/** Opens the new-resolution form on /resolutions and types an unsaved title. */
async function draftResolution(page: Page, value: string) {
  await page.getByRole('button', { name: 'New resolution', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'New resolution', exact: true })
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill(value);
}
const draftTitle = (page: Page) =>
  page
    .getByRole('dialog', { name: 'New resolution', exact: true })
    .getByRole('textbox', { name: 'Title', exact: true });

async function traverse(page: Page, delta: number, discard: boolean) {
  await page.evaluate((distance) => window.history.go(distance), delta);
  await answerPrompt(page, discard);
}

test('Back and Forward preserve dirty drafts on cancellation and navigate on discard', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'Companies', exact: true }).click();
  await expect(page).toHaveURL(/\/companies$/);
  await page.getByRole('link', { name: 'Resolutions', exact: true }).click();
  await expect(page).toHaveURL(/\/resolutions$/);
  await draftResolution(page, 'Unsaved resolution one');
  for (let attempt = 0; attempt < 2; attempt++) {
    await traverse(page, -1, false);
    await expect(page).toHaveURL(/\/resolutions$/);
    await expect(draftTitle(page)).toHaveValue('Unsaved resolution one');
  }
  await traverse(page, -1, true);
  await expect(page).toHaveURL(/\/companies$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/resolutions$/);
  await page.getByRole('link', { name: 'People', exact: true }).click();
  await expect(page).toHaveURL(/\/people$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/resolutions$/);
  await draftResolution(page, 'Unsaved resolution two');
  await traverse(page, 1, false);
  await expect(page).toHaveURL(/\/resolutions$/);
  await expect(draftTitle(page)).toHaveValue('Unsaved resolution two');
  await traverse(page, 1, true);
  await expect(page).toHaveURL(/\/people$/);
});

test('company opening edits survive cancelled close and navigation', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Companies', exact: true }).click();
  await page.getByRole('button', { name: 'New company', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'Legal name', exact: true });
  await name.fill('Unsaved fictional company');
  await page
    .getByRole('dialog', { name: 'New company', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await answerPrompt(page, false);
  await expect(name).toHaveValue('Unsaved fictional company');
  await traverse(page, -1, false);
  await expect(page).toHaveURL(/\/companies$/);
  await expect(name).toHaveValue('Unsaved fictional company');
  await page
    .getByRole('dialog', { name: 'New company', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await answerPrompt(page, true);
  await expect(name).toHaveCount(0);
  await page.getByRole('button', { name: 'New company', exact: true }).click();
  await expect(name).toHaveValue('');
});

test('Back after a native skip link still protects the draft and restores the previous page', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'Companies', exact: true }).click();
  await expect(page).toHaveURL(/\/companies$/);
  await page.locator('.skip-link').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/companies#main$/);
  await page.getByRole('link', { name: 'Resolutions', exact: true }).click();
  await draftResolution(page, 'Unsaved after skip link');
  await traverse(page, -1, false);
  await expect(page).toHaveURL(/\/resolutions$/);
  await expect(draftTitle(page)).toHaveValue('Unsaved after skip link');
  await traverse(page, -1, true);
  await expect(page).toHaveURL(/\/companies#main$/);
  await expect(page.getByRole('heading', { name: 'Companies', exact: true })).toBeVisible();
});

test('changing upload company requires discard and clears the previous evidence', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'Documents', exact: true }).click();
  const company = page.getByRole('combobox', { name: 'Company', exact: true });
  // evaluateAll does not wait, so wait for the Documents page before reading its options.
  await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
  const ids = await company
    .locator('option')
    .evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value).filter(Boolean),
    );
  expect(ids.length).toBeGreaterThan(1);
  await company.selectOption(ids[0]);
  await page.getByText('Upload company evidence', { exact: true }).click();
  const title = page.getByRole('textbox', { name: 'Evidence title', exact: true });
  const file = page.locator('input[type=file]');
  await title.fill('Company A source');
  await file.setInputFiles({
    name: 'company-a.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Fictional A'),
  });
  await company.selectOption(ids[1]);
  await answerPrompt(page, false);
  await expect(company).toHaveValue(ids[0]);
  await expect(title).toHaveValue('Company A source');
  expect(await file.evaluate((input) => (input as HTMLInputElement).files?.[0]?.name)).toBe(
    'company-a.txt',
  );
  await company.selectOption(ids[1]);
  await answerPrompt(page, true);
  await expect(company).toHaveValue(ids[1]);
  await expect(title).toHaveValue('');
  expect(await file.evaluate((input) => (input as HTMLInputElement).files?.length)).toBe(0);
  await expect(page.locator('[data-dirty=true]')).toHaveCount(0);
});

test('only company administrators can open company creation', async ({ page }) => {
  await login(page, 'admin');
  await page.getByRole('link', { name: 'Companies', exact: true }).click();
  await page.getByRole('button', { name: 'New company', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Legal name', exact: true })).toBeVisible();
  await login(page, 'executive');
  await page.getByRole('link', { name: 'Companies', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New company', exact: true })).toHaveCount(0);
});
