import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { signIn } from './sign-in';
import type { Workspace } from '../../src/domain/model';
import type {
  ClauseVersion,
  CompanyProfile,
  ResolutionCase,
} from '../../src/domain/resolution/model';
import type { ClausesResponse } from '../../src/components/resolution/api';
import { answerPrompt } from './prompt';

const origin = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4300';
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

test('closing a company person drawer preserves an unsaved draft until discard is accepted', async ({
  page,
}) => {
  await login(page);
  const workspace: Workspace = await (await page.request.get('/api/workspace')).json();
  await page.goto('/companies/' + workspace.companies[0].id);
  await page.getByRole('button', { name: 'Add person', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Add a person', exact: true });
  await page.getByLabel('Capacity', { exact: true }).fill('Unsaved relationship draft');
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  await answerPrompt(page, false);
  await expect(page.getByLabel('Capacity', { exact: true })).toHaveValue(
    'Unsaved relationship draft',
  );
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  await answerPrompt(page, true);
  await expect(drawer).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'People', exact: true })
    .click();
  await page.waitForURL(/\/people$/);
});

test('per-person multi-choice answers save and generate, then record a signed copy', async ({
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
        id: 'include_options',
        label: 'Include options',
        valueType: 'boolean',
        scope: 'clause',
        required: true,
        source: { kind: 'question' },
        repeatScope: 'people_list',
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
            { type: 'paragraph', content: [{ type: 'field', fieldId: 'include_options' }] },
            {
              type: 'condition',
              when: { op: 'isTrue', fieldId: 'include_options' },
              content: [
                { type: 'paragraph', content: [{ type: 'field', fieldId: 'selected_options' }] },
              ],
            },
          ],
        },
      ],
    },
  });
  ({ version } = await post<{ version: ClauseVersion }>(page, versionPath, {
    action: 'submit',
    expectedRevision: version.revision,
  }));
  await login(page, 'admin');
  await post(page, versionPath, {
    action: 'publish',
    expectedRevision: version.revision,
    confirm: true,
  });
  await login(page);
  let item = await post<ResolutionCase>(page, '/api/resolution-cases', {
    companyId,
    kind: 'board',
    title: `E2E choice and signed copy ${Date.now()}`,
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
  const include = page.getByRole('combobox', { name: `Include options for ${person.name}` });
  await expect(choices).toHaveCount(0);
  await include.selectOption('true');
  await expect(choices).toHaveCount(1, { timeout: 1000 });
  await choices.getByRole('checkbox', { name: 'First option', exact: true }).check();
  await choices.getByRole('checkbox', { name: 'Second option', exact: true }).check();
  await choices.getByRole('checkbox', { name: 'First option', exact: true }).uncheck();
  await include.selectOption('false');
  await expect(choices).toHaveCount(0);
  await include.selectOption('true');
  await expect(choices.getByRole('checkbox', { name: 'Second option', exact: true })).toBeChecked();
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
  await page.getByRole('button', { name: 'Word documents', exact: true }).click();
  await page.getByRole('button', { name: 'Create Word document', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download version 1' })).toBeVisible();
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('link', { name: 'Download version 1' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  const detail = await (await page.request.get(`/api/resolution-cases/${item.id}`)).json();
  const uploaded = await page.request.post('/api/documents', {
    headers: { Origin: origin },
    multipart: {
      companyId,
      title: `E2E signed role evidence ${Date.now()}`,
      file: {
        name: 'signed-copy.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Fictional signed-copy evidence'),
      },
    },
  });
  expect(uploaded.ok(), await uploaded.text()).toBe(true);
  const evidence: { id: string } = await uploaded.json();
  await page.reload();
  await page.getByRole('button', { name: 'Record signed copy', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Signer', exact: true })
    .selectOption(`directors:${person.id}`);
  await expect(page.getByLabel('Capacity', { exact: true })).toHaveValue('Director');
  await page.getByLabel('Signed on', { exact: true }).fill(today);
  await page.getByRole('combobox', { name: 'Signed copy', exact: true }).selectOption(evidence.id);
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('combobox', { name: 'Signer', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByRole('button', { name: 'Record signed copy', exact: true }).click();
  await expect(
    page.getByText('Signed copy recorded against version 1', { exact: true }),
  ).toBeVisible();
  const recorded = await (
    await page.request.get(`/api/document-generations/${detail.generations[0].id}`)
  ).json();
  expect(recorded.records).toContainEqual(
    expect.objectContaining({
      kind: 'execution',
      signerPersonId: person.id,
      signerRole: 'directors',
      capacity: 'Director',
      evidenceId: evidence.id,
    }),
  );
});

test('conditional fee questions and per-person inputs update before saving and retain hidden answers', async ({
  page,
}) => {
  await login(page);
  const workspace: Workspace = await (await page.request.get('/api/workspace')).json();
  let item = await post<ResolutionCase>(page, '/api/resolution-cases', {
    companyId: workspace.companies[0].id,
    kind: 'board',
    title: `E2E live fee questions ${Date.now()}`,
    resolutionDate: today,
  });
  const available: ClausesResponse = await (
    await page.request.get(`/api/resolution-cases/${item.id}/clauses`)
  ).json();
  const assembly = available.available.assemblies.find(
    (a) => a.outputTypeId === 'directors_written' && a.name === "Directors' written resolution",
  )!;
  const clause = available.available.clauses.find((c) => c.name === "Directors' fees")!;
  expect(clause).toBeTruthy();
  item = await post<ResolutionCase>(page, `/api/resolution-cases/${item.id}/clauses`, {
    action: 'set_selection',
    expectedRevision: item.revision,
    outputTypeId: 'directors_written',
    assemblyVersionId: assembly.assemblyVersionId,
    clauses: [{ clauseId: clause.clauseId, clauseVersionId: clause.clauseVersionId }],
  });
  await page.goto(`/resolutions/${item.id}#questions`);
  const payable = page.getByRole('combobox', { name: /Directors' fees are payable for the year/ });
  await payable.waitFor();
  const people = page.getByRole('group', { name: /Directors receiving fees/ });
  await payable.selectOption('true');
  await expect(people).toHaveCount(1, { timeout: 1000 });
  const picker = people.getByRole('combobox');
  const selected = await picker.locator('option').nth(1).getAttribute('value');
  expect(selected).toBeTruthy();
  await picker.selectOption(selected!);
  await people.getByRole('button', { name: 'Add', exact: true }).click();
  const fee = page.getByRole('textbox', { name: /^Fee for / });
  await expect(fee).toHaveCount(1, { timeout: 1000 });
  await fee.fill('123.45');
  await payable.selectOption('false');
  await expect(people).toHaveCount(0);
  await payable.selectOption('true');
  await expect(fee).toHaveValue('123.45');
  // UI derivation must not save the answers or advance the case revision.
  const stored: { case: ResolutionCase } = await (
    await page.request.get(`/api/resolution-cases/${item.id}`)
  ).json();
  expect(stored.case.revision).toBe(item.revision);
  expect(stored.case.answers.clauses).toEqual({});
});

test('retired job fields become answerable questions and generate without changing the wording version', async ({
  page,
}) => {
  await login(page);
  const workspace: Workspace = await (await page.request.get('/api/workspace')).json();
  const companyId = workspace.companies[0].id;
  const created = await post<{ id: string; versions: ClauseVersion[] }>(
    page,
    '/api/clause-templates',
    {
      action: 'create',
      name: `Existing job wording ${Date.now()}`,
      category: 'Other',
      governingAct: 'Fictional evaluation',
      usageContexts: ['board'],
    },
  );
  const path = `/api/clause-templates/${created.id}/versions/${created.versions[0].id}`;
  const fields: ClauseVersion['fields'] = [
    {
      id: 'retired_name',
      label: 'Director name',
      valueType: 'text',
      scope: 'clause',
      required: true,
      source: { kind: 'binding', path: 'job.personName' },
    },
    {
      id: 'retired_date',
      label: 'Change date',
      valueType: 'date',
      scope: 'clause',
      required: true,
      source: { kind: 'binding', path: 'job.effectiveDate' },
    },
    {
      id: 'retired_route',
      label: 'Change route',
      valueType: 'text',
      scope: 'clause',
      required: true,
      source: { kind: 'binding', path: 'job.route' },
    },
  ];
  let { version } = await post<{ version: ClauseVersion }>(page, path, {
    action: 'save_draft',
    expectedRevision: created.versions[0].revision,
    source: 'Fictional legacy fixture',
    effectiveDate: '2020-01-01',
    fields,
    wordings: {
      directors_written: [
        {
          type: 'paragraph',
          content: fields.map((field) => ({ type: 'field', fieldId: field.id })),
        },
      ],
    },
  });
  ({ version } = await post<{ version: ClauseVersion }>(page, path, {
    action: 'submit',
    expectedRevision: version.revision,
  }));
  await login(page, 'admin');
  await post(page, path, { action: 'publish', expectedRevision: version.revision, confirm: true });
  await login(page);
  let item = await post<ResolutionCase>(page, '/api/resolution-cases', {
    companyId,
    kind: 'board',
    title: 'Existing wording migration',
    resolutionDate: today,
  });
  const response: ClausesResponse = await (
    await page.request.get(`/api/resolution-cases/${item.id}/clauses`)
  ).json();
  const layout = response.available.assemblies.find(
    (a) => a.outputTypeId === 'directors_written' && a.name === "Directors' written resolution",
  )!;
  item = await post<ResolutionCase>(page, `/api/resolution-cases/${item.id}/clauses`, {
    action: 'set_selection',
    expectedRevision: item.revision,
    outputTypeId: 'directors_written',
    assemblyVersionId: layout.assemblyVersionId,
    clauses: [{ clauseId: created.id, clauseVersionId: version.id }],
  });
  const form: ClausesResponse = await (
    await page.request.get(`/api/resolution-cases/${item.id}/clauses`)
  ).json();
  const director = form.form!.signers.find((role) => role.role === 'directors')!.pool[0];
  item = await post<ResolutionCase>(page, `/api/resolution-cases/${item.id}/clauses`, {
    action: 'save_answers',
    expectedRevision: item.revision,
    selectionRevision: item.selection!.revision,
    shared: { resolution_date: today },
    clauses: {},
    signers: { directors: [director.id], members: [], certifiers: [] },
  });
  await mkdir('.local/previews', { recursive: true });
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/resolutions/${item.id}`);
    await expect(page.getByRole('textbox', { name: /^Director name \(required\)/ })).toBeEditable();
    await expect(page.getByLabel(/^Change date \(required\)/)).toBeEditable();
    await page
      .getByRole('textbox', { name: /^Director name \(required\)/ })
      .fill(`Fictional Nora Director ${width}`);
    await page.getByLabel(/^Change date \(required\)/).fill(today);
    await page.getByRole('textbox', { name: /^Change route \(required\)/ }).fill('Appointment');
    await page.getByRole('button', { name: 'Save answers', exact: true }).first().click();
    await expect(page.locator('.question-save [aria-live]')).toHaveText('Answers saved');
    await page.screenshot({ path: `.local/previews/retired-fields-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByRole('button', { name: 'Word documents', exact: true }).click();
  await page.getByRole('button', { name: 'Create Word document', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download version 1' })).toBeVisible();
  const stored: { version: ClauseVersion } = await (await page.request.get(path)).json();
  expect(stored.version.fields).toEqual(fields);
});
