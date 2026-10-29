import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
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

test('document type creation keeps a rejected request visible inside its drawer', async ({
  page,
}) => {
  await login(page);
  await page.route('**/api/output-types', async (route) => {
    if (route.request().method() === 'POST')
      await route.fulfill({ status: 400, json: { error: 'Document type could not be saved.' } });
    else await route.continue();
  });
  await page.goto('/templates#outputs');
  await page.getByRole('button', { name: 'New document type', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'New document type', exact: true });
  await drawer.getByLabel('Name', { exact: true }).fill('Fictional document type');
  await drawer.getByRole('button', { name: 'Add document type', exact: true }).click();
  await expect(drawer.getByRole('alert')).toHaveText('Document type could not be saved.');
  await expect(drawer.getByLabel('Name', { exact: true })).toHaveValue('Fictional document type');
});

test('relationship conflict reload preserves entries and retries with the latest revision', async ({
  page,
}) => {
  await login(page);
  const workspace = await (await page.request.get('/api/workspace')).json();
  const companyId: string = workspace.companies[0].id;
  let revision = 1;
  const submissions: { expectedRevision: number; endDate: string; reason: string }[] = [];
  await page.route(`**/api/companies/${companyId}/relationships**`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        json: {
          relationships: [
            {
              id: 'fictional-relationship',
              companyId,
              personId: 'fictional-person',
              personName: 'Fictional test director',
              role: 'director',
              capacity: revision === 2 ? 'Updated capacity' : '',
              startDate: '2020-01-01',
              endDate: null,
              revision,
            },
          ],
          directorsAsAt: [],
        },
      });
    } else {
      submissions.push(route.request().postDataJSON());
      if (submissions.length === 1) {
        revision = 2;
        await route.fulfill({
          status: 409,
          json: { error: 'This relationship changed.', code: 'STALE' },
        });
      } else await route.fulfill({ json: { saved: true } });
    }
  });
  await page.goto(`/companies/${companyId}`);
  await page
    .getByRole('button', {
      name: 'End Director relationship for Fictional test director',
      exact: true,
    })
    .click();
  const drawer = page.getByRole('dialog', {
    name: 'End Fictional test director as director',
    exact: true,
  });
  await drawer.getByLabel('End date', { exact: true }).fill('2026-10-01');
  await drawer.getByLabel('Reason', { exact: true }).fill('Fictional cessation evidence');
  await drawer.getByRole('button', { name: 'End relationship', exact: true }).click();
  await expect(drawer.getByRole('alert')).toContainText('This relationship changed.');
  const reloaded = page.waitForResponse(
    (response) =>
      response.url().includes(`/companies/${companyId}/relationships`) &&
      response.request().method() === 'GET',
  );
  await drawer.getByRole('button', { name: 'Reload latest', exact: true }).click();
  await reloaded;
  await expect(
    page.locator('.relationship-table').getByText('Updated capacity', { exact: true }),
  ).toBeVisible();
  await expect(drawer.getByLabel('Reason', { exact: true })).toHaveValue(
    'Fictional cessation evidence',
  );
  await expect(drawer.getByLabel('End date', { exact: true })).toHaveValue('2026-10-01');
  await drawer.getByRole('button', { name: 'End relationship', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  expect(submissions.map((submission) => submission.expectedRevision)).toEqual([1, 2]);
});

test('job creation labels follow the selected activity rather than the entry URL', async ({
  page,
}) => {
  await login(page);
  await page.goto('/jobs/new?activity=W05');
  await expect(
    page.getByRole('heading', { name: 'New share transaction', exact: true }),
  ).toBeVisible();
  await page.getByRole('combobox', { name: 'Activity', exact: true }).selectOption('W06');
  await expect(page.getByRole('heading', { name: 'New BO assessment', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Create BO assessment', exact: true }),
  ).toBeVisible();
  await page.getByRole('combobox', { name: 'Activity', exact: true }).selectOption('W03');
  await expect(page.getByRole('heading', { name: 'New job', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create job', exact: true })).toBeVisible();
});
