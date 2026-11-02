import { expect, test } from '@playwright/test';
import { ensureKitchen, signIn, signedInApi, unique } from './helpers.js';

test.beforeEach(async ({ request }) => ensureKitchen(request));

test('a dish shows on the Dishes tab as its card, and free-from filters it', async ({
  page,
  request,
}) => {
  const api = await signedInApi(request);
  const butter = await (
    await api.post('/api/ingredients', {
      data: { name: unique('Butter'), baseUnit: 'g', allergens: ['milk'] },
    })
  ).json();
  const dish = unique('Pear tart');
  const created = await api.post('/api/recipes', {
    data: {
      name: dish,
      type: 'dish',
      yield: { value: 1, unit: 'each' },
      portions: 1,
      course: 'dessert',
      components: [
        {
          ref: { kind: 'ingredient', ingredientId: butter.id },
          quantity: { value: 20, unit: 'g' },
          sortOrder: 0,
        },
      ],
    },
  });
  expect(created.ok(), await created.text()).toBe(true);

  await signIn(page);
  await page.getByRole('navigation').getByRole('link', { name: 'Dishes' }).click();
  const tile = page.getByRole('link', { name: new RegExp(dish) });
  await expect(tile).toBeVisible();
  await expect(tile).toContainText('Milk');

  await page.getByLabel('Free from').selectOption({ label: 'Free from milk' });
  await expect(tile).toBeHidden();
  await page.getByLabel('Free from').selectOption({ index: 0 });

  await tile.click();
  await expect(page.getByRole('heading', { name: dish }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Print or PDF' })).toBeVisible();
});

/** Dishes are made and kept under Dishes; Recipes is preps and components. */
test('a new dish is made under Dishes, and Recipes cannot make one', async ({ page }) => {
  await signIn(page);
  const nav = page.getByRole('navigation');

  await nav.getByRole('link', { name: 'Dishes' }).click();
  await page.getByRole('link', { name: 'New dish' }).click();
  await page.waitForURL(/\/dishes\/new$/);
  await expect(nav.getByRole('link', { name: 'Dishes' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#type')).toHaveCount(0);

  const dish = unique('Beetroot tartare');
  await page.getByLabel('Recipe name').fill(dish);
  await page.locator('form button[type=submit]').last().click();
  await page.waitForURL(/\/dishes\/[0-9a-f-]{36}$/);
  const dishId = page.url().split('/').at(-1)!;
  await expect(nav.getByRole('link', { name: 'Dishes' })).toHaveAttribute('aria-current', 'page');

  // Its recipe, editor and print page are all under Dishes too.
  for (const [link, path] of [
    ['Recipe', `/dishes/${dishId}/recipe`],
    ['Edit', `/dishes/${dishId}/edit`],
  ] as const) {
    await page.goto(`/dishes/${dishId}`);
    await page.getByRole('link', { name: link, exact: true }).click();
    await page.waitForURL((url) => url.pathname === path);
    await expect(nav.getByRole('link', { name: 'Dishes' })).toHaveAttribute('aria-current', 'page');
  }

  // The Recipes editor offers preps and components, never a dish.
  await page.goto('/recipes/new');
  await expect(nav.getByRole('link', { name: 'Recipes' })).toHaveAttribute('aria-current', 'page');
  const kinds = await page
    .locator('#type option')
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  expect(kinds).toEqual(['prep', 'component']);

  // Older links to a dish under Recipes move to Dishes.
  await page.goto(`/recipes/${dishId}`);
  await page.waitForURL((url) => url.pathname === `/dishes/${dishId}/recipe`);
  await page.goto(`/recipes/${dishId}/edit`);
  await page.waitForURL((url) => url.pathname === `/dishes/${dishId}/edit`);
  await page.goto(`/recipes/${dishId}/card`);
  await page.waitForURL((url) => url.pathname === `/dishes/${dishId}/card`);
});

test('a recipe prints as a card, as written, whatever size is on screen', async ({
  page,
  request,
}) => {
  const api = await signedInApi(request);
  const name = unique('Vanilla custard');
  const created = await api.post('/api/recipes', {
    data: {
      name,
      type: 'prep',
      yield: { value: 1, unit: 'l' },
      prepMinutes: 35,
      shelfLifeHours: 72,
      method: [{ text: 'Bring the milk to a simmer.' }],
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = await created.json();

  await signIn(page);
  // Scaled on screen to 3 l; the card is still the 1 l recipe.
  await page.goto(`/recipes/${id}?amount=3000&unit=ml`);
  await expect(page.getByRole('heading', { name }).first()).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  const card = page.locator('article', { hasText: name });
  await expect(card).toBeVisible();
  expect(await card.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await expect(card).toContainText('1 l');
  await expect(card).toContainText('3 days');
  await expect(card).toContainText('35 min');
  await expect(card).toContainText('Bring the milk to a simmer.');
  await expect(card).not.toContainText('3 l');
});
