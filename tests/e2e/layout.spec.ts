import { signIn } from './sign-in';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('shared headers, form spacing and staff columns retain their layout', async ({ page }) => {
  const accounts = JSON.parse(await readFile('.local/accounts.json', 'utf8')) as {
    key: string;
    email: string;
    password: string;
  }[];
  const owner = accounts.find((account) => account.key === 'owner')!;
  await signIn(page, owner);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/companies');
  await page.getByRole('link', { name: 'Aster Advisory Sdn. Bhd.', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Aster Advisory Sdn. Bhd.', exact: true }),
  ).toBeVisible();
  const identity = page.locator('.page-header').first();
  const name = await identity.locator('h1').boundingBox();
  const registration = await page
    .locator('.facts > div')
    .filter({ has: page.getByText('Registration number', { exact: true }) })
    .boundingBox();
  expect(registration!.y).toBeGreaterThanOrEqual(name!.y + name!.height);
  const officerHeader = page
    .locator('.section-header')
    .filter({ has: page.getByLabel('Record as at', { exact: true }) });
  const heading = await officerHeader.locator('h2').boundingBox();
  const date = await officerHeader.locator('input').boundingBox();
  expect(Math.abs(heading!.y + heading!.height - date!.y - date!.height)).toBeLessThan(1);
  await page.getByRole('link', { name: 'Annual return 2026', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Next action', exact: true })).toBeVisible();
  const overviewY = (await page
    .getByRole('heading', { name: 'Next action', exact: true })
    .boundingBox())!.y;
  await page.getByRole('button', { name: 'Checklist', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Checklist · v/ })).toBeVisible();
  const checklistY = (await page.getByRole('heading', { name: /^Checklist · v/ }).boundingBox())!.y;
  expect(Math.abs(overviewY - checklistY)).toBeLessThan(1);
  const form = page.locator('.checklist-item .action-form').first();
  const fields = await form.locator('.form-grid').boundingBox();
  const actions = await form.locator('.actions').boundingBox();
  expect(actions!.y - fields!.y - fields!.height).toBe(16);
  expect(
    await form
      .locator('button')
      .first()
      .evaluate((el) => getComputedStyle(el).marginTop),
  ).toBe('0px');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Reduce motion' })).toBeVisible();
  const checkbox = await page.getByRole('checkbox', { name: 'Reduce motion' }).boundingBox();
  expect(checkbox!.width).toBe(17);
  expect(checkbox!.height).toBe(17);
  await page.getByRole('button', { name: 'Users', exact: true }).click();
  await expect(page.locator('.users-table')).toBeVisible();
  expect(
    await page
      .locator('.users-table td')
      .nth(3)
      .evaluate((el) => getComputedStyle(el).whiteSpace),
  ).toBe('nowrap');
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'My work', exact: true }).click();
  await page.getByRole('link', { name: 'New job', exact: true }).click();
  await expect(page.locator('.form-stack > .warning')).toBeVisible();
  const warning = await page.locator('.form-stack > .warning').boundingBox();
  const footer = await page.locator('.form-stack > .actions').boundingBox();
  expect(footer!.y - warning!.y - warning!.height).toBe(16);
  await page.goto('/login');
  await expect(page.getByText('Internal staff access', { exact: true })).toHaveCount(0);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
