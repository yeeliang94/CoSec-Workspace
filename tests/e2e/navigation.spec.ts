import { signIn } from './sign-in';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { answerPrompt } from './prompt';
test('unsaved edits survive navigation and sign-out attempts', async ({ page }) => {
  const accounts = JSON.parse(await readFile('.local/accounts.json', 'utf8')) as {
    key: string;
    email: string;
    password: string;
  }[];
  const account = accounts.find((a) => a.key === 'owner')!;
  await signIn(page, account);
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto('/settings');
  const firmName = page.getByRole('textbox', { name: 'Firm name', exact: true });
  await firmName.fill('Unsaved fictional firm');
  await page.getByRole('link', { name: 'Companies', exact: true }).click();
  await answerPrompt(page, false);
  await expect(page).toHaveURL(/\/settings$/);
  await expect(firmName).toHaveValue('Unsaved fictional firm');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await answerPrompt(page, false);
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole('link', { name: 'Companies', exact: true }).click();
  await answerPrompt(page, true);
  await expect(page).toHaveURL(/\/companies$/);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Text size', exact: true }).selectOption('larger');
  await expect(page.locator('.application')).toHaveClass(/text-larger/);
  await page.getByRole('link', { name: 'Companies', exact: true }).click();
  await answerPrompt(page, true);
  await expect(page.locator('.application')).toHaveClass(/text-default/);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Text size', exact: true })).toHaveValue(
    'default',
  );
});
