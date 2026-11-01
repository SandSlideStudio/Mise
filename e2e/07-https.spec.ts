import https from 'node:https';
import { expect, test } from '@playwright/test';
import { HTTPS_PORT } from '../playwright.config.js';
import { ensureKitchen, signIn } from './helpers.js';

test.beforeEach(async ({ request }) => ensureKitchen(request));

function overHttps(path: string, ca?: string) {
  return new Promise<number>((resolve, reject) => {
    https
      .get({ host: '127.0.0.1', port: HTTPS_PORT, path, ca }, (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      })
      .on('error', reject);
  });
}

test('HTTPS for the kitchen network is turned on from Settings, and tablets get the steps', async ({
  page,
  browser,
}) => {
  await signIn(page);
  await page.goto('/settings?tab=connection');
  await page.locator('#kitchenNames').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByRole('link', { name: `https://127.0.0.1:${HTTPS_PORT}` })).toBeVisible();

  // A device trusting the kitchen certificate connects; one that doesn't is refused.
  const authority = await (
    await page.request.get('/api/connection/kitchen-certificate.crt')
  ).text();
  expect(await overHttps('/api/health', authority)).toBe(200);
  await expect(overHttps('/api/health')).rejects.toThrow();

  // The trust page, on a tablet nobody has signed in on.
  const tablet = await (
    await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Tab) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    })
  ).newPage();
  await tablet.goto('/trust');
  await expect(tablet.getByRole('tab', { name: 'Android', selected: true })).toBeVisible();
  const download = tablet.waitForEvent('download');
  await tablet.getByRole('link', { name: 'Download certificate' }).click();
  expect((await download).suggestedFilename()).toBe('mise-kitchen.crt');

  await page.getByRole('button', { name: 'Turn off' }).first().click();
  // HTTPS stops once that answer is out; give it the moment it takes.
  await expect
    .poll(() =>
      overHttps('/api/health', authority).then(
        () => 'still on',
        () => 'off',
      ),
    )
    .toBe('off');
});
