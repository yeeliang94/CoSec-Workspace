import { expect, test, type APIRequestContext, type Cookie, type Page } from '@playwright/test';

// Reuse real issued sessions when changing roles; do not burst repeated password
// attempts through the application's unchanged production rate limiter.
const sessions = new Map<string, Cookie[]>();
const origin = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
export async function signIn(page: Page, account: { email: string; password: string }) {
  const cookies = sessions.get(account.email);
  if (cookies) {
    await page.context().clearCookies();
    await page.context().addCookies(cookies);
    return;
  }
  await passwordLogin(page.request, account);
  sessions.set(account.email, await page.context().cookies(origin));
}

export async function passwordLogin(
  context: APIRequestContext,
  account: { email: string; password: string },
) {
  test.setTimeout(120000);
  const attempt = () =>
    context.post(origin + '/api/auth/sign-in/email', {
      headers: { Origin: origin },
      data: { email: account.email, password: account.password },
    });
  let response = await attempt();
  if (response.status() === 429) {
    const seconds = Number(
      response.headers()['retry-after'] ?? response.headers()['x-retry-after'],
    );
    expect(Number.isFinite(seconds) && seconds > 0 && seconds <= 60).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000 + 250));
    response = await attempt();
  }
  expect(response.status(), await response.text()).toBe(200);
}
