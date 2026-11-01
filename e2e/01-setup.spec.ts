import { expect, test } from '@playwright/test';
import { CHEF } from './helpers.js';

/** A new server, set up through its own screens, as a kitchen meets it. */
test('first-run setup creates the kitchen and signs the chef in', async ({ page }) => {
  await page.goto('/');
  await page.waitForURL(/\/setup/);
  await page.getByRole('button', { name: 'Set up this kitchen' }).click();

  await page.locator('#kitchenName').fill(CHEF.kitchenName);
  await page.getByRole('button', { name: 'Next' }).click();

  await page.locator('#displayName').fill(CHEF.displayName);
  await page.locator('#email').fill(CHEF.email);
  await page.locator('#password').fill(CHEF.password);
  await page.locator('#confirmPassword').fill(CHEF.password);
  await page.getByRole('button', { name: 'Next' }).click();

  // Stations come filled in; recipes and the rest can wait.
  for (let step = 0; step < 4; step += 1) {
    const create = page.getByRole('button', { name: 'Create the kitchen' });
    if (await create.isVisible()) break;
    const skip = page.getByRole('button', { name: 'Skip for now' });
    await ((await skip.isVisible()) ? skip : page.getByRole('button', { name: 'Next' })).click();
  }
  await page.getByRole('button', { name: 'Create the kitchen' }).click();

  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Today' })).toBeVisible();
  await expect(page.getByText(CHEF.displayName).first()).toBeVisible();
});
