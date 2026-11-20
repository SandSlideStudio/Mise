import { expect, test } from '@playwright/test';
import { ensureKitchen, signIn, unique } from './helpers.js';

test.beforeEach(async ({ request }) => ensureKitchen(request));

test('a cook signs in with a PIN on an enrolled tablet', async ({ page }) => {
  await signIn(page);
  const cook = unique('Sam');
  const created = await page.request.post('/api/users', {
    data: { displayName: cook, role: 'cook', pin: '4821' },
  });
  expect(created.ok(), await created.text()).toBe(true);

  // Enrol this browser as a kitchen tablet, from the tablet itself.
  await page.goto('/settings?tab=devices');
  await page.locator('#deviceName').fill(unique('Pass tablet'));
  await page.getByRole('button', { name: 'Enrol this device' }).click();
  await expect(page.getByText(/enrolled/i).first()).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/\/login$/);
  // Opened again in the morning, an enrolled tablet shows the names, not the email form.
  await page.goto('/');
  await page.waitForURL(/\/line$/);
  await page.getByRole('button', { name: new RegExp(cook) }).click();
  for (const digit of '4821') await page.getByRole('button', { name: digit, exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.getByText(cook).first()).toBeVisible();
});
