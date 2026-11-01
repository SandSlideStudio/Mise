import { expect, test } from '@playwright/test';
import { CHEF, ensureKitchen, signIn, unique } from './helpers.js';

test.beforeEach(async ({ request }) => ensureKitchen(request));

/**
 * From outside the kitchen (here: through a proxy Mise doesn't trust), the
 * sign-in page isn't even reachable until the device is approved.
 */
test('a phone outside asks, the chef approves it, then it can sign in', async ({
  browser,
  page,
}) => {
  const phoneContext = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': '203.0.113.9' },
    viewport: { width: 390, height: 844 },
  });
  const phone = await phoneContext.newPage();
  await phone.goto('/');
  const name = unique('Rosa’s phone');
  await phone.getByLabel('Name for this device').fill(name);
  await phone.getByRole('button', { name: 'Ask for access' }).click();
  await expect(phone.getByText('Waiting for approval')).toBeVisible();
  const code = (await phone.getByLabel('Code').textContent())!.trim();

  await signIn(page);
  await page.goto('/settings?tab=devices');
  const request = page.locator('li', { hasText: name });
  await expect(request).toContainText(code);
  await request.getByRole('button', { name: 'Approve' }).click();

  // The phone opens by itself, on the ordinary sign-in.
  await phone.locator('#email').waitFor({ timeout: 15_000 });
  await phone.locator('#email').fill(CHEF.email);
  await phone.locator('#password').fill(CHEF.password);
  await phone.locator('form button[type=submit]').click();
  await phone.waitForURL((url) => url.pathname === '/');
  await phoneContext.close();
});
