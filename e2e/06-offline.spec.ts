import { expect, test, type Page } from '@playwright/test';
import { ensureKitchen, signIn, signedInApi, unique } from './helpers.js';

test.beforeEach(async ({ request }) => ensureKitchen(request));

/** Wait until this recipe, as written, is in the copy saved on the device. */
async function keptOnDevice(page: Page, recipeId: string) {
  await expect
    .poll(
      () =>
        page.evaluate(
          (id) =>
            new Promise<boolean>((resolve) => {
              const open = indexedDB.open('keyval-store');
              open.onerror = () => resolve(false);
              open.onsuccess = () => {
                try {
                  const read = open.result
                    .transaction('keyval')
                    .objectStore('keyval')
                    .get('mise.cache');
                  read.onsuccess = () =>
                    resolve(String(read.result ?? '').includes(`"recipe-expanded","${id}"`));
                  read.onerror = () => resolve(false);
                } catch {
                  resolve(false);
                }
              };
            }),
          recipeId,
        ),
      { timeout: 45_000, intervals: [1_000] },
    )
    .toBe(true);
}

test('with Mise unreachable, the tablet opens, keeps changes, and sends them once back', async ({
  browser,
  request,
}) => {
  const api = await signedInApi(request);
  const recipe = await (
    await api.post('/api/recipes', {
      data: { name: unique('Brown butter'), type: 'prep', yield: { value: 500, unit: 'g' } },
    })
  ).json();

  const context = await browser.newContext({ viewport: { width: 1024, height: 1200 } });
  const tablet = await context.newPage();
  await signIn(tablet);
  await tablet.evaluate(() => navigator.serviceWorker.ready);
  // The kitchen loads ahead in the background shortly after sign-in, and is
  // saved on the device: wait until this recipe's page is in that copy.
  await keptOnDevice(tablet, recipe.id);

  await context.setOffline(true);
  await tablet.reload();
  await expect(tablet.getByText('Offline.')).toBeVisible({ timeout: 15_000 });

  const line = unique('Pick thyme');
  await tablet.getByLabel('What to do').fill(line);
  await tablet.getByRole('button', { name: 'Add the line' }).click();
  await expect(tablet.locator('li', { hasText: line })).toContainText('Waiting to be sent');

  // A recipe this tablet never opened, loaded ahead.
  await tablet.goto(`/recipes/${recipe.id}`).catch(() => undefined);
  await expect(tablet.getByRole('heading', { name: recipe.name }).first()).toBeVisible();

  // The office renames it meanwhile; the tablet edits it offline too.
  const office = unique('Office name');
  expect((await api.patch(`/api/recipes/${recipe.id}`, { data: { name: office } })).ok()).toBe(
    true,
  );
  await tablet.goto(`/recipes/${recipe.id}/edit`).catch(() => undefined);
  const mine = unique('Tablet name');
  await tablet.getByLabel('Name').first().fill(mine);
  await tablet.locator('form button[type=submit]').last().click();
  await expect(tablet.getByRole('heading', { name: mine }).first()).toBeVisible();

  await context.setOffline(false);
  await expect(tablet.getByText('Changed on another device')).toBeVisible({ timeout: 30_000 });
  await tablet.getByRole('button', { name: 'Keep mine' }).click();

  await expect
    .poll(async () => (await (await api.get(`/api/recipes/${recipe.id}`)).json()).name, {
      timeout: 15_000,
    })
    .toBe(mine);
  const lines = (await (await api.get('/api/running/tasks')).json()) as { description: string }[];
  expect(lines.filter((task) => task.description === line)).toHaveLength(1);
  await context.close();
});

test('an amount changed offline shows at once; its allergens say they update once sent', async ({
  browser,
  request,
}) => {
  const api = await signedInApi(request);
  const butter = await (
    await api.post('/api/ingredients', {
      data: { name: unique('Butter'), baseUnit: 'g', allergens: ['milk'] },
    })
  ).json();
  const recipe = await (
    await api.post('/api/recipes', {
      data: {
        name: unique('Beurre blanc'),
        type: 'prep',
        yield: { value: 500, unit: 'g' },
        components: [
          {
            ref: { kind: 'ingredient', ingredientId: butter.id },
            quantity: { value: 250, unit: 'g' },
            sortOrder: 0,
          },
        ],
      },
    })
  ).json();

  const context = await browser.newContext({ viewport: { width: 1024, height: 1200 } });
  const tablet = await context.newPage();
  await signIn(tablet);
  await tablet.evaluate(() => navigator.serviceWorker.ready);
  await keptOnDevice(tablet, recipe.id);

  await context.setOffline(true);
  await tablet.goto(`/recipes/${recipe.id}/edit`).catch(() => undefined);
  await tablet.getByLabel('How much').first().fill('400');
  await tablet.locator('form button[type=submit]').last().click();
  await tablet.waitForURL((url) => url.pathname === `/recipes/${recipe.id}`);

  const note = tablet.getByText('Allergens update once your changes are sent.');
  await expect(note).toBeVisible();
  await expect(tablet.locator('main')).toContainText('400 g');
  await expect(tablet.locator('main')).not.toContainText('250 g');

  await context.setOffline(false);
  await expect(note).toBeHidden({ timeout: 30_000 });
  const saved = (await (await api.get(`/api/recipes/${recipe.id}`)).json()) as {
    components: { quantity: { value: number } }[];
  };
  expect(saved.components[0]!.quantity.value).toBe(400);
  await context.close();
});
