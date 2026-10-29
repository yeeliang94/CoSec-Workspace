import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { signIn } from './sign-in';
import type { ClauseWithVersions } from '../../src/components/resolution/api';
import { answerPrompt } from './prompt';

async function login(page: Page) {
  const accounts: { key: string; email: string; password: string }[] = JSON.parse(
    await readFile('.local/accounts.json', 'utf8'),
  );
  await signIn(
    page,
    accounts.find((account) => account.key === 'owner')!,
  );
}

async function discard(page: Page, action: () => Promise<unknown>, accept: boolean) {
  await action();
  await answerPrompt(page, accept);
}

test('creation forms preserve meaningful edits until a confirmed discard', async ({ page }) => {
  await login(page);
  await page.goto('/templates');
  await page.getByRole('button', { name: 'New paragraph', exact: true }).click();
  const clause = page.getByRole('dialog', { name: 'New paragraph', exact: true });
  await clause.getByLabel('Description', { exact: true }).fill('Unsaved description only');
  await discard(
    page,
    () => clause.getByRole('button', { name: 'Close', exact: true }).click(),
    false,
  );
  await expect(clause.getByLabel('Description', { exact: true })).toHaveValue(
    'Unsaved description only',
  );
  await discard(page, () => clause.press('Escape'), false);
  await discard(
    page,
    () => clause.getByRole('button', { name: 'Cancel', exact: true }).click(),
    false,
  );
  await expect(clause.getByLabel('Description', { exact: true })).toHaveValue(
    'Unsaved description only',
  );
  await discard(
    page,
    () => clause.getByRole('button', { name: 'Close', exact: true }).click(),
    true,
  );
  await expect(clause).toHaveCount(0);
  await page.getByRole('button', { name: /^Layouts/ }).click();
  await page.getByRole('button', { name: 'New layout', exact: true }).click();
  const assembly = page.getByRole('dialog', { name: 'New layout', exact: true });
  await assembly.getByLabel('Description', { exact: true }).fill('Unsaved assembly description');
  await discard(
    page,
    () => assembly.getByRole('button', { name: 'Cancel', exact: true }).click(),
    false,
  );
  await expect(assembly.getByLabel('Description', { exact: true })).toHaveValue(
    'Unsaved assembly description',
  );
  await discard(
    page,
    () => assembly.getByRole('button', { name: 'Cancel', exact: true }).click(),
    true,
  );
  await page.goto('/resolutions');
  await page.getByRole('button', { name: 'New resolution', exact: true }).click();
  const resolution = page.getByRole('dialog', { name: 'New resolution', exact: true });
  await resolution.getByLabel('Instruction date', { exact: true }).fill('2026-10-27');
  await discard(
    page,
    () => resolution.getByRole('button', { name: 'Close', exact: true }).click(),
    false,
  );
  await expect(resolution.getByLabel('Instruction date', { exact: true })).toHaveValue(
    '2026-10-27',
  );
  await discard(
    page,
    () => resolution.getByRole('button', { name: 'Cancel', exact: true }).click(),
    true,
  );
  await expect(resolution).toHaveCount(0);
});

test('supporting routes keep their parent navigation current', async ({ page }) => {
  await login(page);
  for (const [route, parent] of [
    ['/templates', 'Resolutions'],
    ['/people', 'People'],
    ['/audit', 'Settings'],
  ]) {
    await page.goto(route);
    await expect(
      page.locator('.sidebar').getByRole('link', { name: parent, exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.sidebar a[aria-current="page"]')).toHaveCount(1);
  }
});

test('wording tabs support roving keyboard focus and wrap in both directions', async ({ page }) => {
  await login(page);
  await page.goto('/templates');
  await page.getByRole('link', { name: 'Appointment of director', exact: true }).click();
  const tabs = page.getByRole('tablist', { name: 'Wording per output type' }).getByRole('tab');
  await expect(tabs).toHaveCount(2);
  const first = tabs.nth(0);
  const last = tabs.nth(1);
  await first.focus();
  await first.press('ArrowRight');
  await expect(last).toBeFocused();
  await expect(last).toHaveAttribute('aria-selected', 'true');
  await expect(first).toHaveAttribute('tabindex', '-1');
  await last.press('ArrowRight');
  await expect(first).toBeFocused();
  await first.press('ArrowLeft');
  await expect(last).toBeFocused();
  await last.press('Home');
  await expect(first).toBeFocused();
  await first.press('End');
  await expect(last).toBeFocused();
  await expect(page.getByRole('tabpanel')).toHaveAttribute(
    'aria-labelledby',
    (await last.getAttribute('id'))!,
  );
});

test('larger text scales template controls and keeps the mobile page within its viewport', async ({
  page,
}) => {
  await login(page);
  const library: { clauses: ClauseWithVersions[] } = await (
    await page.request.get('/api/clause-templates')
  ).json();
  const editable = library.clauses.find((clause) =>
    clause.versions.some((version) => version.status === 'Draft' || version.status === 'Returned'),
  );
  test.skip(!editable, 'This preference check needs an existing editable clause.');
  await page.goto('/settings');
  const original = await page
    .getByRole('combobox', { name: 'Text size', exact: true })
    .inputValue();
  async function setSize(value: string) {
    await page.goto('/settings');
    await page.getByRole('combobox', { name: 'Text size', exact: true }).selectOption(value);
    await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Preferences saved');
  }
  async function openEditor() {
    await page.goto('/templates/clauses/' + editable!.id);
    await expect(page.getByRole('group', { name: 'Template formatting' })).toBeVisible();
  }
  try {
    await setSize('default');
    await openEditor();
    const button = page.getByRole('button', { name: 'Bold', exact: true });
    const baseline = await button.evaluate((element) =>
      parseFloat(getComputedStyle(element).fontSize),
    );
    await setSize('larger');
    await openEditor();
    await expect
      .poll(() => button.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)))
      .toBeGreaterThan(baseline);
    const selector = page.getByRole('combobox', { name: 'Text style', exact: true });
    await expect
      .poll(() => selector.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)))
      .toBeGreaterThan(baseline);
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
    }
  } finally {
    await setSize(original);
  }
});
