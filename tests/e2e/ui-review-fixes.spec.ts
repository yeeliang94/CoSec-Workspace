import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { signIn } from './sign-in';
import { answerPrompt } from './prompt';
import type { Document, Workspace } from '../../src/domain/model';

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
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  await answerPrompt(page, true);
  await expect(drawer).toHaveCount(0);
  await page.getByRole('button', { name: 'New document type', exact: true }).click();
  await expect(drawer.getByLabel('Name', { exact: true })).toHaveValue('');
  await expect(drawer.getByRole('alert')).toHaveCount(0);
});

test('document type drafts survive cancelled closes and reset after accepted discards', async ({
  page,
}) => {
  await login(page);
  await page.goto('/templates#outputs');
  for (const closeMethod of ['Close', 'Cancel', 'Escape'] as const) {
    await page.getByRole('button', { name: 'New document type', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'New document type', exact: true });
    const name = closeMethod === 'Escape' ? '' : 'Fictional unsaved document type';
    await drawer.getByLabel('Name', { exact: true }).fill(name);
    await drawer.getByLabel('Body', { exact: true }).selectOption('members');
    const close = () =>
      closeMethod === 'Escape'
        ? drawer.press('Escape')
        : drawer.getByRole('button', { name: closeMethod, exact: true }).click();
    await close();
    await answerPrompt(page, false);
    await expect(drawer.getByLabel('Name', { exact: true })).toHaveValue(name);
    await expect(drawer.getByLabel('Body', { exact: true })).toHaveValue('members');
    await close();
    await answerPrompt(page, true);
    await expect(drawer).toHaveCount(0);
    await page.getByRole('button', { name: 'New document type', exact: true }).click();
    await expect(drawer.getByLabel('Name', { exact: true })).toHaveValue('');
    await expect(drawer.getByLabel('Body', { exact: true })).toHaveValue('directors');
    await drawer.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(drawer).toHaveCount(0);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  }
});

test('relationship drawers protect date-only, role-only and evidence-only edits', async ({
  page,
}) => {
  await login(page);
  await page.clock.setFixedTime(new Date());
  const workspace: Workspace = await (await page.request.get('/api/workspace')).json();
  const companyId = workspace.companies[0].id;
  const evidence: Document = {
    id: 'fictional-drawer-evidence',
    companyId,
    jobId: null,
    title: 'Fictional drawer evidence',
    originalName: 'fictional.txt',
    mimeType: 'text/plain',
    size: 1,
    sha256: '',
    storageKey: '',
    createdBy: workspace.actor.id,
    createdAt: '2026-10-01T00:00:00Z',
    classification: 'General',
  };
  await page.route('**/api/workspace', (route) =>
    route.fulfill({
      json: {
        ...workspace,
        documents: [...workspace.documents, evidence],
      },
    }),
  );
  await page.route(`**/api/companies/${companyId}/relationships**`, (route) =>
    route.fulfill({
      json: {
        relationships: [
          {
            id: 'fictional-drawer-relationship',
            companyId,
            personId: 'fictional-person',
            personName: 'Fictional drawer director',
            role: 'director',
            capacity: '',
            startDate: '2020-01-01',
            endDate: null,
            revision: 1,
          },
        ],
        directorsAsAt: [],
      },
    }),
  );
  await page.goto(`/companies/${companyId}`);
  const end = page.getByRole('button', {
    name: 'End Director relationship for Fictional drawer director',
    exact: true,
  });
  await end.click();
  const ending = page.getByRole('dialog', {
    name: 'End Fictional drawer director as director',
    exact: true,
  });
  const originalDate = await ending.getByLabel('End date', { exact: true }).inputValue();
  const changedDate = originalDate === '2026-10-01' ? '2026-10-02' : '2026-10-01';
  await ending.getByLabel('End date', { exact: true }).fill(changedDate);
  await ending.press('Escape');
  await answerPrompt(page, false);
  await expect(ending.getByLabel('End date', { exact: true })).toHaveValue(changedDate);
  await expect(ending.getByLabel('Reason', { exact: true })).toHaveValue('');
  await ending.press('Escape');
  await answerPrompt(page, true);
  await expect(ending).toHaveCount(0);
  await end.click();
  await expect(ending.getByLabel('End date', { exact: true })).toHaveValue(originalDate);
  await ending.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(ending).toHaveCount(0);

  for (const field of ['role', 'evidence'] as const) {
    await page.getByRole('button', { name: 'Add person', exact: true }).click();
    const adding = page.getByRole('dialog', { name: 'Add a person', exact: true });
    if (field === 'role')
      await adding.getByLabel('Role', { exact: true }).selectOption('secretary');
    else await adding.getByRole('checkbox', { name: evidence.title, exact: true }).check();
    await adding.getByRole('button', { name: 'Cancel', exact: true }).click();
    await answerPrompt(page, false);
    if (field === 'role')
      await expect(adding.getByLabel('Role', { exact: true })).toHaveValue('secretary');
    else
      await expect(
        adding.getByRole('checkbox', { name: evidence.title, exact: true }),
      ).toBeChecked();
    await adding.getByRole('button', { name: 'Cancel', exact: true }).click();
    await answerPrompt(page, true);
    await expect(adding).toHaveCount(0);
    await page.getByRole('button', { name: 'Add person', exact: true }).click();
    await expect(adding.getByLabel('Role', { exact: true })).toHaveValue('director');
    await expect(
      adding.getByRole('checkbox', { name: evidence.title, exact: true }),
    ).not.toBeChecked();
    await adding.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(adding).toHaveCount(0);
  }
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
