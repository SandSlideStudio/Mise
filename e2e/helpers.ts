import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** The kitchen every test after setup works in. */
export const CHEF = {
  kitchenName: 'Test Kitchen',
  displayName: 'Chef Rosa',
  email: 'rosa@example.com',
  password: 'correct-horse-battery',
};

/**
 * Make sure the kitchen exists, whichever test runs first. The setup test
 * creates it through the screens; any other test on its own, through the API.
 */
export async function ensureKitchen(request: APIRequestContext): Promise<void> {
  const status = await (await request.get('/api/setup/status')).json();
  if (!status.needsSetup) return;
  const created = await request.post('/api/setup', { data: CHEF });
  expect(created.ok()).toBe(true);
}

export async function signIn(page: Page, email = CHEF.email, password = CHEF.password) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL((url) => url.pathname === '/');
  await dismissTour(page);
}

/** New people are offered a tour; the tests say no. */
export async function dismissTour(page: Page) {
  const notNow = page.getByRole('button', { name: 'Not now' });
  await notNow.click({ timeout: 3_000 }).catch(() => undefined);
}

/** Signed in through the API, for setting things up quickly in a test. */
export async function signedInApi(request: APIRequestContext) {
  const response = await request.post('/api/auth/login', {
    data: { email: CHEF.email, password: CHEF.password },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return request;
}

/** A unique name, so tests can run again on the same database. */
export const unique = (name: string) => `${name} ${Date.now().toString(36)}`;
