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
