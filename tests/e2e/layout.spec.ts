import { signIn } from './sign-in';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('shared headers, controls and staff columns retain their layout', async ({ page }) => {
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
  const registration = await identity.locator('.record-number').boundingBox();
  expect(registration!.y).toBeGreaterThanOrEqual(name!.y + name!.height);
  const recordDate = page.getByLabel('Record as at', { exact: true });
  const date = await recordDate.boundingBox();
  const people = await page.getByRole('heading', { name: 'People', exact: true }).boundingBox();
  expect(date!.y + date!.height).toBeLessThan(people!.y);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Reduce motion' })).toBeVisible();
  const checkbox = await page.getByRole('checkbox', { name: 'Reduce motion' }).boundingBox();
  expect(checkbox!.width).toBe(17);
  expect(checkbox!.height).toBe(17);
  await expect(page.locator('.users-table')).toBeVisible();
  expect(
    await page
      .locator('.users-table td')
      .nth(2)
      .evaluate((el) => getComputedStyle(el).whiteSpace),
  ).toBe('nowrap');
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/login');
  await expect(page.getByText('Internal staff access', { exact: true })).toHaveCount(0);
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test('shared form rows stay aligned with fieldsets and dependent identity controls', async ({
  page,
}) => {
  const accounts: { key: string; email: string; password: string }[] = JSON.parse(
    await readFile('.local/accounts.json', 'utf8'),
  );
  await signIn(
    page,
    accounts.find((a) => a.key === 'owner')!,
  );
  await page.route('**/api/people', (route) =>
    route.fulfill({
      json: {
        people: [
          {
            id: 'layout-person',
            fullName: 'Tan Wei Ming Abdullah',
            email: 'tan.wei.ming@example.invalid',
          },
        ],
      },
    }),
  );
  const cases: { cases: { id: string }[] } = await (
    await page.request.get('/api/resolution-cases')
  ).json();
  async function aligned(controls: import('@playwright/test').Locator[]) {
    const boxes = await Promise.all(controls.map((control) => control.boundingBox()));
    expect(boxes.every(Boolean)).toBe(true);
    expect(
      Math.max(...boxes.map((box) => box!.y)) - Math.min(...boxes.map((box) => box!.y)),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.max(...boxes.map((box) => box!.height)) - Math.min(...boxes.map((box) => box!.height)),
    ).toBeLessThanOrEqual(1);
  }
  async function vertical(controls: import('@playwright/test').Locator[]) {
    const boxes = await Promise.all(controls.map((control) => control.boundingBox()));
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i]!.y).toBeGreaterThan(boxes[i - 1]!.y + boxes[i - 1]!.height);
      expect(Math.abs(boxes[i]!.x - boxes[i - 1]!.x)).toBeLessThanOrEqual(1);
    }
  }
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/companies');
    await page.getByRole('button', { name: 'New company', exact: true }).click();
    const legalName = page.getByRole('textbox', { name: 'Legal name', exact: true });
    const registration = page.getByRole('textbox', { name: 'Registration number', exact: true });
    const incorporation = page.getByLabel('Incorporation date', { exact: true });
    await vertical([legalName, registration, incorporation]);
    await aligned([
      page.getByRole('combobox', { name: 'Day', exact: true }),
      page.getByRole('combobox', { name: 'Month', exact: true }),
    ]);
    const longField = await legalName.boundingBox();
    const shortField = await registration.boundingBox();
    expect(longField!.width).toBeGreaterThanOrEqual(shortField!.width);
    await legalName.fill('Fictional long company legal name Sdn. Bhd.');
    await registration.fill('202600009998');
    await incorporation.fill('2026-01-01');
    await page
      .getByLabel('Registered address', { exact: true })
      .fill('1 Fictional Street, Kuala Lumpur');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('combobox', { name: 'Industry', exact: true }).selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const name = page.getByRole('combobox', { name: 'Name', exact: true });
    await name.fill('Tan Wei Ming Abdullah');
    await expect(
      page.getByRole('combobox', { name: 'Which Tan Wei Ming Abdullah', exact: true }),
    ).toBeVisible();
    await vertical([name, page.getByRole('combobox', { name: 'Role', exact: true })]);
    await name.press('Tab');
    await expect(
      page.getByRole('combobox', { name: 'Which Tan Wei Ming Abdullah', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('combobox', { name: 'Role', exact: true })).toBeFocused();
    await aligned([
      page.getByRole('combobox', { name: 'Role', exact: true }),
      page.getByLabel('From', { exact: true }),
    ]);
    await page.getByRole('button', { name: 'Add person', exact: true }).click();
    await aligned([
      page.getByRole('combobox', { name: 'Role', exact: true }).nth(1),
      page.getByLabel('From', { exact: true }).nth(1),
    ]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Discard changes', exact: true })
      .click();
    await page.goto('/settings');
    await aligned([
      page.getByRole('combobox', { name: 'Text size', exact: true }),
      page.getByRole('combobox', { name: 'List density', exact: true }),
    ]);
    await page.goto('/resolutions/' + cases.cases[0].id);
    const details = page.getByRole('region', { name: '1. Details', exact: true });
    await vertical([
      details.getByRole('combobox', { name: 'Owner', exact: true }),
      details.getByLabel('Instruction date', { exact: true }),
    ]);
    const titleBox = await details
      .getByRole('textbox', { name: 'Title', exact: true })
      .locator('..')
      .boundingBox();
    const ownerBox = await details
      .getByRole('combobox', { name: 'Owner', exact: true })
      .locator('..')
      .boundingBox();
    expect(Math.abs(ownerBox!.y - titleBox!.y - titleBox!.height - 24)).toBeLessThanOrEqual(1);
    await aligned([
      details.getByLabel('Resolution date', { exact: true }),
      details.getByLabel('Effective date', { exact: true }),
    ]);
    await aligned([
      page.getByRole('combobox', { name: 'Document type', exact: true }),
      page.getByRole('combobox', { name: 'Layout', exact: true }),
    ]);
    await page.goto('/audit');
    await aligned([
      page.getByRole('combobox', { name: 'Company', exact: true }),
      page.getByRole('combobox', { name: 'Record type', exact: true }),
      page.getByRole('textbox', { name: 'Action', exact: true }),
    ]);
    await aligned([
      page.getByRole('combobox', { name: 'Actor', exact: true }),
      page.getByLabel('From', { exact: true }),
      page.getByLabel('To', { exact: true }),
    ]);
  }
});
