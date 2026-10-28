import { test, expect, request as apiRequest } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { passwordLogin } from './sign-in';
const origin = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4300';
async function credentials(key: string) {
  const items = JSON.parse(await readFile('.local/accounts.json', 'utf8')) as {
    key: string;
    email: string;
    password: string;
  }[];
  return items.find((c) => c.key === key)!;
}
async function loginApi(key: string) {
  const c = await credentials(key);
  const context = await apiRequest.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  await passwordLogin(context, c);
  return context;
}
test('real credential login, scoped queues, responsive navigation and preference persistence', async ({
  page,
}) => {
  const c = await credentials('owner');
  const errors: string[] = [];
  const remoteRequests: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(origin) && !request.url().startsWith('data:'))
      remoteRequests.push(request.url());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/login');
  await page.getByLabel('Email').fill(c.email);
  await page.getByLabel('Password').fill(c.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My work', exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Aster Advisory Sdn. Bhd.', exact: true }).first(),
  ).toBeVisible();
  await mkdir('.local/previews', { recursive: true });
  for (const width of [1440, 1280, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByRole('heading', { name: 'My work', exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: `.local/previews/work-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.screenshot({ path: '.local/previews/settings.png', fullPage: true });
  await page.getByRole('link', { name: 'Companies', exact: true }).click();
  await page.getByRole('link', { name: 'Aster Advisory Sdn. Bhd.', exact: true }).first().click();
  await expect(
    page.getByRole('heading', { name: 'Aster Advisory Sdn. Bhd.', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'View source evidence', exact: true })).toBeVisible();
  await expect(page.locator('a[href$="/jobs/opening-fixture"]')).toHaveCount(0);
  await page.screenshot({ path: '.local/previews/company.png', fullPage: true });
  expect(errors).toEqual([]);
  expect(remoteRequests).toEqual([]);
});
test('API role, company scope, private download and CSRF boundaries', async () => {
  const executive = await loginApi('executive'),
    limited = await loginApi('limited'),
    admin = await loginApi('admin'),
    lodger = await loginApi('lodger');
  const full = await (await executive.get('/api/workspace')).json();
  const partial = await (await limited.get('/api/workspace')).json();
  expect(partial.companies).toHaveLength(1);
  expect(
    partial.jobs.every((j: { companyId: string }) => j.companyId === partial.companies[0].id),
  ).toBe(true);
  const forbidden = full.jobs.find(
    (j: { companyId: string }) => j.companyId !== partial.companies[0].id,
  );
  expect((await limited.get(`/api/companies/${forbidden.companyId}`)).status()).toBe(404);
  expect(
    (
      await limited.post(`/api/jobs/${forbidden.id}`, {
        data: {
          action: 'note',
          html: 'secret',
          expectedRevision: forbidden.revision,
          requestId: crypto.randomUUID(),
        },
      })
    ).status(),
  ).toBe(404);
  const document = full.documents.find(
    (d: { companyId: string }) => d.companyId === forbidden.companyId,
  );
  expect((await limited.get(`/api/documents/${document.id}`)).status()).toBe(404);
  expect((await executive.get(`/api/documents/${document.id}`)).status()).toBe(200);
  const empty = await (await admin.get('/api/workspace')).json();
  expect(empty.companies).toEqual([]);
  expect(empty.jobs).toEqual([]);
  expect((await executive.get('/api/users')).status()).toBe(403);
  expect((await admin.get('/api/users')).status()).toBe(200);
  const job = full.jobs[0];
  expect(
    (
      await lodger.post(`/api/jobs/${job.id}`, {
        data: {
          action: 'note',
          html: 'no',
          expectedRevision: job.revision,
          requestId: crypto.randomUUID(),
        },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await executive.post(`/api/jobs/${job.id}`, {
        headers: { Origin: 'https://other.invalid' },
        data: {
          action: 'note',
          html: 'no',
          expectedRevision: job.revision,
          requestId: crypto.randomUUID(),
        },
      })
    ).status(),
  ).toBe(403);
  for (const context of [executive, limited, admin, lodger]) await context.dispose();
});
