import { expect, test } from '@playwright/test';
import { ensureKitchen, signIn, unique } from './helpers.js';

test.beforeEach(async ({ request }) => ensureKitchen(request));

test('a line goes on the list, gets ticked, and the next shift gets a note', async ({ page }) => {
  await signIn(page);
  const line = unique('Brunoise shallots');

  await page.getByLabel('What to do').fill(line);
  await page.getByLabel('How much').fill('2');
  await page.getByRole('button', { name: 'Add the line' }).click();
  const row = page.locator('li', { hasText: line });
  await expect(row).toBeVisible();

  const tick = row.locator('button[data-tour="task"]');
  await tick.click();
  await expect(tick).toHaveAttribute('aria-pressed', 'true');

  // Still ticked after a reload: it reached the server.
  await page.reload();
  await expect(
    page.locator('li', { hasText: line }).locator('button[data-tour="task"]'),
  ).toHaveAttribute('aria-pressed', 'true');

  const note = unique('Fish delivery moved to three');
  const write = page.getByRole('button', { name: /Leave a note for the next shift|Change/ });
  await write.first().click();
  await page.getByPlaceholder('Fish delivery is late; stock on at three.').fill(note);
  await page.getByRole('button', { name: 'Save the note' }).click();
  await expect(page.getByText(note)).toBeVisible();
});
