import { signIn } from './sign-in';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { answerPrompt } from './prompt';
test('work context and unsaved plain/rich edits survive navigation attempts', async ({ page }) => {
  const accounts = JSON.parse(await readFile('.local/accounts.json', 'utf8')) as {
    key: string;
    email: string;
    password: string;
  }[];
  const account = accounts.find((a) => a.key === 'owner')!;
  await signIn(page, account);
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto('/work');
  await page.getByRole('searchbox', { name: 'Search jobs and companies' }).fill('Aster');
  await page.getByRole('combobox', { name: 'Sort work' }).selectOption('company');
  const target = page.locator('.work-table tbody tr').last().locator('td').nth(1).getByRole('link');
  await target.scrollIntoViewIfNeeded();
  const focusId = await target.getAttribute('id');
  const workUrl = page.url();
  await target.click();
  await page.locator('.record-heading').waitFor();
  const jobUrl = page.url();
  await page.locator('.back-link').click();
  await expect(page).toHaveURL(workUrl);
  await expect(page.locator('#' + focusId)).toBeFocused();
  await expect(page.getByRole('searchbox', { name: 'Search jobs and companies' })).toHaveValue(
    'Aster',
  );
  await page.getByRole('link', { name: 'New job', exact: true }).click();
  await page.locator('[name=year]').fill('2022');
  await page.getByRole('link', { name: 'Companies', exact: true }).click();
  await answerPrompt(page, false);
  await expect(page).toHaveURL(/\/jobs\/new/);
  await expect(page.locator('[name=year]')).toHaveValue('2022');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await answerPrompt(page, false);
  await expect(page).toHaveURL(/\/jobs\/new/);
  await page.getByRole('link', { name: 'Companies', exact: true }).click();
  await answerPrompt(page, true);
  await expect(page).toHaveURL(/\/companies$/);
  await page.goto(jobUrl);
  const editor = page.locator('[contenteditable=true]');
  await editor.fill('Unsaved fictional note');
  await page.getByRole('button', { name: 'Checklist', exact: true }).click();
  await answerPrompt(page, false);
  await expect(editor).toContainText('Unsaved fictional note');
  await page.getByRole('button', { name: 'Checklist', exact: true }).click();
  await answerPrompt(page, true);
  await expect(page.getByRole('heading', { name: /^Checklist · v/ })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Text size', exact: true }).selectOption('larger');
  await expect(page.locator('.application')).toHaveClass(/text-larger/);
  await page.getByRole('button', { name: 'Work defaults', exact: true }).click();
  await answerPrompt(page, true);
  await expect(page.locator('.application')).toHaveClass(/text-default/);
  await page.getByRole('button', { name: 'Personal', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Text size', exact: true })).toHaveValue(
    'default',
  );
});
