import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { signIn } from './sign-in';
import type { Job, Workspace } from '../../src/domain/model';
import type {
  ClauseVersion,
  CompanyProfile,
  ResolutionCase,
} from '../../src/domain/resolution/model';
import type { ClausesResponse } from '../../src/components/resolution/api';

const origin = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kuala_Lumpur',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
async function login(page: Page, key = 'owner') {
  const accounts: { key: string; email: string; password: string }[] = JSON.parse(
    await readFile('.local/accounts.json', 'utf8'),
  );
  await signIn(
    page,
    accounts.find((account) => account.key === key)!,
  );
}
async function post<T>(page: Page, path: string, data: object): Promise<T> {
  const response = await page.request.post(path, {
    headers: { Origin: origin },
    data: { requestId: crypto.randomUUID(), ...data },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

test('company and view changes preserve relationship drafts until discard is accepted', async ({
  page,
}) => {
  await login(page);
  await page.goto('/people');
  await page.getByRole('button', { name: 'Company relationships', exact: true }).click();
  const company = page.getByRole('combobox', { name: 'Company', exact: true });
  const first = await company.inputValue();
  const second = await company
    .locator('option')
    .evaluateAll(
      (options, first) =>
        options
          .map((option) => (option as HTMLOptionElement).value)
          .find((value) => value !== first),
      first,
    );
  expect(second).toBeTruthy();
  await page.getByText('Add a relationship', { exact: true }).click();
  await page.getByLabel('Capacity', { exact: true }).fill('Unsaved relationship draft');
  page.once('dialog', (dialog) => dialog.dismiss());
  await company.selectOption(second!);
  await expect(company).toHaveValue(first);
  await expect(page.getByLabel('Capacity', { exact: true })).toHaveValue(
    'Unsaved relationship draft',
  );
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Directory', exact: true }).click();
  await expect(page.getByLabel('Capacity', { exact: true })).toHaveValue(
    'Unsaved relationship draft',
  );
  page.once('dialog', (dialog) => dialog.accept());
  await company.selectOption(second!);
  await expect(company).toHaveValue(second!);
  await page.getByText('Add a relationship', { exact: true }).click();
  await expect(page.getByLabel('Capacity', { exact: true })).toHaveValue('');
});

test('per-person multi-choice answers save and generate, then attach the exact document to a W04 pack', async ({
  page,
}) => {
  await login(page);
  const workspace: Workspace = await (await page.request.get('/api/workspace')).json();
  const companyId = workspace.companies[0].id;
  const profile: CompanyProfile = await (
    await page.request.get(`/api/companies/${companyId}/profile`)
  ).json();
  if (!profile.citations.directorAuthority?.length)
    await post(page, `/api/companies/${companyId}/profile`, {
      action: 'set_citation',
      expectedRevision: profile.revision,
      key: 'directorAuthority',
      value: 'Fictional E2E authority',
      effectiveDate: '2020-01-01',
      reason: 'Fictional E2E source',
    });
  const job = await post<Job>(page, '/api/jobs', {
    companyId,
    activity: 'W04',
    ownerId: workspace.actor.id,
    route: 'appointment',
    personId: crypto.randomUUID(),
    personName: 'E2E Review Appointee (fictional)',
    effectiveDate: today,
    routeBasis: 'Fictional E2E appointment',
  });
  const created = await post<{ id: string; versions: ClauseVersion[] }>(
    page,
    '/api/clause-templates',
    {
      action: 'create',
      name: `E2E per-person choices ${Date.now()}`,
      category: 'Other',
      governingAct: 'Fictional evaluation',
      usageContexts: ['board'],
    },
  );
  const versionPath = `/api/clause-templates/${created.id}/versions/${created.versions[0].id}`;
  let { version } = await post<{ version: ClauseVersion }>(page, versionPath, {
    action: 'save_draft',
    expectedRevision: created.versions[0].revision,
    source: 'Fictional E2E wording',
    effectiveDate: '2020-01-01',
    fields: [
      {
        id: 'people_list',
        label: 'People to answer',
        valueType: 'recordList',
        scope: 'clause',
        required: true,
        source: { kind: 'question' },
        record: { context: 'currentDirectors' },
      },
      {
        id: 'selected_options',
        label: 'Selected options',
        valueType: 'multiChoice',
        scope: 'clause',
        required: true,
        source: { kind: 'question' },
        repeatScope: 'people_list',
        options: [
          { id: 'first', label: 'First option' },
          { id: 'second', label: 'Second option' },
        ],
      },
    ],
    wordings: {
      directors_written: [
        {
          type: 'repeat',
          fieldId: 'people_list',
          content: [
            { type: 'paragraph', content: [{ type: 'field', fieldId: 'selected_options' }] },
          ],
        },
      ],
    },
  });
  ({ version } = await post<{ version: ClauseVersion }>(page, versionPath, {
    action: 'submit',
    expectedRevision: version.revision,
  }));
  await login(page, 'reviewer');
  await post(page, versionPath, {
    action: 'publish',
    expectedRevision: version.revision,
    confirm: true,
  });
  await login(page);
  let item = await post<ResolutionCase>(page, '/api/resolution-cases', {
    companyId,
    kind: 'board',
    title: `E2E choice and attachment ${Date.now()}`,
    jobId: job.id,
    resolutionDate: today,
  });
  let clauses: ClausesResponse = await (
    await page.request.get(`/api/resolution-cases/${item.id}/clauses`)
  ).json();
  const assembly = clauses.available.assemblies.find(
    (a) => a.outputTypeId === 'directors_written' && a.name === "Directors' written resolution",
  )!;
  expect(assembly).toBeTruthy();
  item = await post<ResolutionCase>(page, `/api/resolution-cases/${item.id}/clauses`, {
    action: 'set_selection',
    expectedRevision: item.revision,
    outputTypeId: 'directors_written',
    assemblyVersionId: assembly.assemblyVersionId,
    clauses: [{ clauseId: created.id, clauseVersionId: version.id }],
  });
  clauses = await (await page.request.get(`/api/resolution-cases/${item.id}/clauses`)).json();
  const person = clauses.form!.clauses[0].fields.find((field) => field.id === 'people_list')!
    .choices![0];
  expect(person).toBeTruthy();
  item = await post<ResolutionCase>(page, `/api/resolution-cases/${item.id}/clauses`, {
    action: 'save_answers',
    expectedRevision: item.revision,
    selectionRevision: item.selection!.revision,
    shared: { resolution_date: today },
    clauses: { [item.selection!.clauses[0].key]: { people_list: [person.id] } },
    signers: { directors: [person.id], members: [], certifiers: [] },
  });
  await page.goto(`/resolutions/${item.id}#questions`);
  const choices = page.getByRole('group', { name: `Selected options for ${person.name}` });
  await choices.getByRole('checkbox', { name: 'First option', exact: true }).check();
  await choices.getByRole('checkbox', { name: 'Second option', exact: true }).check();
  await choices.getByRole('checkbox', { name: 'First option', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save answers', exact: true }).first().click();
  await expect(page.locator('.question-save [aria-live]')).toHaveText('Answers saved');
  await page.reload();
  await expect(
    choices.getByRole('checkbox', { name: 'First option', exact: true }),
  ).not.toBeChecked();
  await expect(choices.getByRole('checkbox', { name: 'Second option', exact: true })).toBeChecked();
  const saved: { case: ResolutionCase } = await (
    await page.request.get(`/api/resolution-cases/${item.id}`)
  ).json();
  expect(saved.case.answers.clauses[item.selection!.clauses[0].key].selected_options).toEqual({
    [person.id]: ['second'],
  });
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await page.getByRole('button', { name: 'Generate Word document', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download version 1' })).toBeVisible();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole('button', { name: 'Attach to director change pack', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.getByRole('button', { name: 'Attach to director change pack', exact: true }).click();
  const newPack = job.packs.at(-1)!.version + 1;
  await page.getByRole('button', { name: `Attach to pack v${newPack}`, exact: true }).click();
  await expect(
    page.getByText(`Attached to pack v${newPack}`, { exact: true }).first(),
  ).toBeVisible();
  const latest: Workspace = await (await page.request.get('/api/workspace')).json();
  const updated = latest.jobs.find((item) => item.id === job.id)!;
  const detail = await (await page.request.get(`/api/resolution-cases/${item.id}`)).json();
  expect(updated.packs.at(-1)!.documentIds).toContain(detail.generations[0].documentId);
  expect(updated.packs.at(-1)!.state).toBe('Draft');
  expect(updated.reviews.filter((review) => review.version === newPack)).toEqual([]);
});
