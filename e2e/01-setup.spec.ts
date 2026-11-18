import { expect, test, type Page } from '@playwright/test';
import { A11Y_WIDTHS, THEMES, expectAccessible, switchTheme, useTheme } from './axe.js';
import { CHEF } from './helpers.js';

/** One screen of setup through axe, by day and by night, at a laptop and a phone. */
async function checkEveryWay(page: Page, screen: string) {
  // Let the page that is arriving finish arriving.
  await page.waitForTimeout(400);
  for (const { label, viewport } of A11Y_WIDTHS) {
    await page.setViewportSize(viewport);
    for (const theme of THEMES) {
      await switchTheme(page, theme);
      await expectAccessible(page, `setup ${screen}, ${theme}, ${label}`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

/**
 * Setup's screens, before anything is created: the one time the database is
 * empty. Walks to the last step and stops short of creating the kitchen, which
 * the next test does through the same screens.
 */
test('every setup screen can be read and used by everyone', async ({ page, request }) => {
  const status = await (await request.get('/api/setup/status')).json();
  test.skip(!status.needsSetup, 'this kitchen is already set up');
  await useTheme(page, 'day');
  await page.goto('/');
  await page.waitForURL(/\/setup/);
  await expect(page.getByRole('button', { name: 'Set up this kitchen' })).toBeVisible();
  await checkEveryWay(page, 'welcome');
  await page.getByRole('button', { name: 'Set up this kitchen' }).click();

  await expect(page.locator('#kitchenName')).toBeVisible();
  await checkEveryWay(page, 'kitchen');
  await page.locator('#kitchenName').fill(CHEF.kitchenName);
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.locator('#displayName')).toBeVisible();
  await checkEveryWay(page, 'you');
  await page.locator('#displayName').fill(CHEF.displayName);
  await page.locator('#email').fill(CHEF.email);
  await page.locator('#password').fill(CHEF.password);
  await page.locator('#confirmPassword').fill(CHEF.password);
  await page.getByRole('button', { name: 'Next' }).click();

  for (let step = 3; step < 8; step += 1) {
    await checkEveryWay(page, `step ${step}`);
    const create = page.getByRole('button', { name: 'Create the kitchen' });
    if (await create.isVisible()) break;
    const skip = page.getByRole('button', { name: 'Skip for now' });
    await ((await skip.isVisible()) ? skip : page.getByRole('button', { name: 'Next' })).click();
  }
  await expect(page.getByRole('button', { name: 'Create the kitchen' })).toBeVisible();
});

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
