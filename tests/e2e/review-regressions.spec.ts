import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Workspace } from '../../src/domain/model';
import { signIn } from './sign-in';
import { answerPrompt } from './prompt';

async function login(page: Page) {
  const accounts: { key: string; email: string; password: string }[] = JSON.parse(
    await readFile('.local/accounts.json', 'utf8'),
  );
  await signIn(
    page,
    accounts.find((a) => a.key === 'owner')!,
  );
  return (await (await page.request.get('/api/workspace')).json()) as Workspace;
}

test('company opening requires an explicit namesake choice and sends the selected identity', async ({
  page,
}) => {
  await login(page);
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  await page.route('**/api/people', (route) =>
    route.fulfill({
      json: {
        people: ids.map((id, i) => ({
          id,
          fullName: 'Tan Wei',
          email: `tan${i}@example.invalid`,
          relationships: [],
        })),
      },
    }),
  );
  let submitted: { people: { personId: string }[] } | undefined;
  await page.route('**/api/companies', (route) => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ json: { id: 'fictional-company' } });
  });
  await page.goto('/companies');
  await page.getByRole('button', { name: 'New company', exact: true }).click();
  const form = page.locator('form.guided-form');
  await form
    .getByRole('textbox', { name: 'Legal name', exact: true })
    .fill('Namesake review Sdn. Bhd.');
  await form
    .getByRole('textbox', { name: 'Registration number', exact: true })
    .fill('202600009999');
  await form.getByLabel('Incorporation date', { exact: true }).fill('2026-01-01');
  await form
    .getByRole('textbox', { name: 'Registered address', exact: true })
    .fill('1 Fictional Street, Kuala Lumpur');
  await form.getByRole('button', { name: 'Continue', exact: true }).click();
  await form.getByRole('combobox', { name: 'Industry', exact: true }).selectOption({ index: 1 });
  await form.getByRole('button', { name: 'Continue', exact: true }).click();
  await form.getByRole('combobox', { name: 'Name', exact: true }).fill('Tan Wei');
  const choice = form.getByRole('combobox', { name: 'Which Tan Wei', exact: true });
  await expect(choice.locator('option')).toHaveCount(4);
  await form.getByRole('button', { name: 'Review details', exact: true }).click();
  expect(submitted).toBeUndefined();
  await expect(choice).toBeFocused();
  await choice.selectOption(ids[1]);
  await form.getByRole('button', { name: 'Review details', exact: true }).click();
  await form.getByRole('button', { name: 'Create company', exact: true }).click();
  await expect.poll(() => submitted?.people[0].personId).toBe(ids[1]);
});

test('relationship edits survive cancelled navigation and historical views cannot add people', async ({
  page,
}) => {
  const workspace = await login(page);
  const companyId = workspace.companies[0].id;
  const evidence = { id: 'review-evidence', companyId, title: 'Fictional relationship evidence' };
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
            id: 'review-relationship',
            personId: 'review-person',
            companyId,
            personName: 'Fictional review director',
            role: 'director',
            startDate: '2020-01-01',
            endDate: null,
            capacity: '',
            revision: 1,
          },
        ],
        directorsAsAt: [],
      },
    }),
  );
  await page.goto(`/companies/${companyId}`);
  await page
    .getByRole('button', {
      name: 'End Director relationship for Fictional review director',
      exact: true,
    })
    .click();
  const endDate = page.getByLabel('End date', { exact: true });
  await endDate.fill('2026-01-01');
  await page.getByRole('link', { name: 'People', exact: true }).click();
  await answerPrompt(page, false);
  await expect(endDate).toHaveValue('2026-01-01');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await answerPrompt(page, true);
  await page.getByText('Add a person', { exact: true }).click();
  for (const field of ['role', 'evidence']) {
    if (field === 'role')
      await page.getByRole('combobox', { name: 'Role', exact: true }).selectOption('secretary');
    else await page.getByRole('checkbox', { name: evidence.title, exact: true }).check();
    await page.getByRole('link', { name: 'People', exact: true }).click();
    await answerPrompt(page, false);
  }
  const asAt = page.getByLabel('Record as at', { exact: true });
  await asAt.fill('2020-01-01');
  await answerPrompt(page, false);
  await expect(page.getByRole('checkbox', { name: evidence.title, exact: true })).toBeChecked();
  await asAt.fill('2020-01-01');
  await answerPrompt(page, true);
  await expect(page.getByText('Historical view, read only', { exact: true })).toBeVisible();
  await expect(page.getByText('Add a person', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^End Director/ })).toHaveCount(0);
});

test('the overview exposes signature and outcome blockers beyond a completed checklist', async ({
  page,
}) => {
  const workspace = await login(page);
  const job = workspace.jobs[0];
  const blockers = [
    'Fictional signer: signature evidence is missing for pack v1.',
    'Filing outcome is unresolved.',
  ];
  await page.route('**/api/workspace', (route) =>
    route.fulfill({
      json: {
        ...workspace,
        jobs: workspace.jobs.map((j) =>
          j.id === job.id
            ? {
                ...j,
                nextAction: 'Check closure requirements',
                blockers,
                packs: j.packs.map((pack) => ({
                  ...pack,
                  checklist: pack.checklist.map((item) => ({
                    ...item,
                    evidenceIds: ['fictional-evidence'],
                  })),
                })),
              }
            : j,
        ),
      },
    }),
  );
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/jobs/${job.id}`);
    const summary = page.getByText('View outstanding items', { exact: true });
    await summary.focus();
    await page.keyboard.press('Enter');
    for (const blocker of blockers)
      await expect(page.getByText(blocker, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'View filing requirements', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Filing', exact: true })).toBeVisible();
  }
});

test('retrying a failed relationship link reuses the person already created', async ({ page }) => {
  const workspace = await login(page);
  const companyId = workspace.companies[0].id;
  const person = { id: crypto.randomUUID(), fullName: 'Fictional retry person', email: null };
  let creations = 0;
  const links: string[] = [];
  await page.route('**/api/people', (route) => {
    if (route.request().method() === 'POST') {
      creations++;
      return route.fulfill({ json: person });
    }
    return route.fulfill({ json: { people: [] } });
  });
  await page.route(`**/api/companies/${companyId}/relationships**`, (route) => {
    if (route.request().method() === 'POST') {
      links.push(route.request().postDataJSON().personId);
      return links.length === 1
        ? route.fulfill({ status: 400, json: { error: 'Evidence is required.' } })
        : route.fulfill({ json: { saved: true } });
    }
    return route.fulfill({ json: { relationships: [], directorsAsAt: [] } });
  });
  await page.goto(`/companies/${companyId}`);
  await page.getByText('Add a person', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Name', exact: true }).fill(person.fullName);
  const save = page.getByRole('button', { name: 'Add person', exact: true });
  await save.click();
  await expect(page.locator('.relationships [role=alert]')).toContainText('Evidence is required.');
  await expect(
    page.getByRole('combobox', { name: `Which ${person.fullName}`, exact: true }),
  ).toHaveValue(person.id);
  await save.click();
  await expect(page.getByRole('combobox', { name: 'Name', exact: true })).toHaveValue('');
  expect(creations).toBe(1);
  expect(links).toEqual([person.id, person.id]);
});
