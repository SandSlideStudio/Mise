import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { CHEF, dismissTour, ensureKitchen, signIn, signedInApi, unique } from './helpers.js';

/**
 * The kitchen's records, walked through as a chef and a cook use them: what
 * things cost (and that a cook never sees it), the use-by on a container's
 * label, how a recipe is kept, "may contain" on an ingredient reaching the
 * dish and its allergen record, and labels checked at delivery, by a cook
 * and while offline.
 *
 * Everything here is made with unique names and taken away again at the end,
 * so the kitchen is left as the other files expect it.
 */

// Far from UTC on purpose: a use-by worked out on the UTC date instead of the
// kitchen's own would be a day out here for half of every day.
const TIME_ZONE = 'Pacific/Auckland';
test.use({ timezoneId: TIME_ZONE });

test.beforeEach(async ({ request }) => ensureKitchen(request));

// ---------------------------------------------------------------------------
// What the tests make, taken away again afterwards (dishes before what they use).

const made = {
  tasks: [] as string[],
  menus: [] as string[],
  recipes: [] as string[],
  ingredients: [] as string[],
};

test.afterAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });
  await signedInApi(api);
  const remove = async (path: string) => {
    const response = await api.delete(path);
    expect([204, 404], `${path}: ${await response.text()}`).toContain(response.status());
  };
  for (const id of made.tasks) await remove(`/api/running/tasks/${id}`);
  for (const id of made.menus) await remove(`/api/menus/${id}`);
  for (const id of [...made.recipes].reverse()) await remove(`/api/recipes/${id}`);
  for (const id of made.ingredients) await remove(`/api/ingredients/${id}`);
  await api.dispose();
});

// ---------------------------------------------------------------------------
// Helpers

type Made = { id: string; name: string };

async function post<T = Made>(api: APIRequestContext, url: string, data: unknown): Promise<T> {
  const response = await api.post(url, { data });
  expect(response.ok(), `${url}: ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
}

async function ingredient(api: APIRequestContext, data: Record<string, unknown>): Promise<Made> {
  const created = await post(api, '/api/ingredients', { baseUnit: 'g', ...data });
  made.ingredients.push(created.id);
  return created;
}

type Line = { ingredient?: string; recipe?: string; grams: number };

async function recipe(
  api: APIRequestContext,
  data: Record<string, unknown>,
  lines: Line[] = [],
): Promise<Made> {
  const created = await post(api, '/api/recipes', {
    ...data,
    components: lines.map((line, sortOrder) => ({
      sortOrder,
      quantity: { value: line.grams, unit: 'g' },
      ref: line.ingredient
        ? { kind: 'ingredient', ingredientId: line.ingredient }
        : { kind: 'recipe', recipeId: line.recipe },
    })),
  });
  made.recipes.push(created.id);
  return created;
}

async function menu(api: APIRequestContext, name: string, dishes: string[]): Promise<Made> {
  const created = await post(api, '/api/menus', { name, status: 'active', dishes });
  made.menus.push(created.id);
  return created;
}

/** A dish's allergens as Mise has them now. */
async function allergensOf(api: APIRequestContext, recipeId: string) {
  const response = await api.get(`/api/recipes/${recipeId}/allergens`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as { contains: string[]; mayContain: string[] };
}

const money = (amount: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' }).format(amount);
const percent = (value: number) =>
  new Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: 1 }).format(
    value / 100,
  );
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The day a label's use-by falls on, as the label prints it: the calendar
 * date where the kitchen is, plus `days`.
 */
function labelDay(at: Date, days: number): string {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(at)
    .split('-')
    .map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days, 12)).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** The use-by for something made between these two moments (one day either side of midnight). */
function useByBetween(from: Date, to: Date, days: number): RegExp {
  const options = [...new Set([labelDay(from, days), labelDay(to, days)])];
  return new RegExp(`^(${options.map(escape).join('|')})$`);
}

/** window.print, counted instead of opening a dialog nobody can close. */
async function stubPrint(page: Page) {
  await page.addInitScript(() => {
    const counted = window as unknown as { prints: number };
    counted.prints = 0;
    window.print = () => {
      counted.prints += 1;
    };
  });
}
const prints = (page: Page) =>
  page.evaluate(() => (window as unknown as { prints: number }).prints);

/** The recipe page's line on how it is kept, under the method. */
const storageLine = (page: Page) => page.getByRole('paragraph').filter({ hasText: /^Storage/ });

/** Opens an ingredient's form on the Ingredients page. */
async function openIngredient(page: Page, name: string) {
  await page.goto('/ingredients');
  await page.getByRole('textbox', { name: 'Search ingredients' }).first().fill(name);
  await page.locator('li', { hasText: name }).locator('button[aria-expanded]').first().click();
  await expect(page.locator('#priceAmount')).toBeVisible();
}

/**
 * A cook signed in with their PIN on an enrolled tablet, in a browser of its
 * own. The tablet is enrolled by the chef, who then signs out of it.
 */
async function cookTablet(
  browser: Browser,
  chef: APIRequestContext,
): Promise<{ context: BrowserContext; page: Page; name: string }> {
  const name = unique('Cook Lieke');
  // PINs are unique in a kitchen; other files have taken a few.
  let pin = '';
  for (let attempt = 0; attempt < 20 && !pin; attempt++) {
    const candidate = String(1000 + Math.floor(Math.random() * 9000));
    const created = await chef.post('/api/users', {
      data: { displayName: name, role: 'cook', pin: candidate },
    });
    if (created.ok()) pin = candidate;
    else expect(created.status(), await created.text()).toBe(409);
  }
  expect(pin, 'a free PIN').not.toBe('');

  const context = await browser.newContext({ viewport: { width: 1024, height: 1200 } });
  const page = await context.newPage();
  await signIn(page);
  const enrolled = await page.request.post('/api/auth/devices', {
    data: { name: unique('Records tablet') },
  });
  expect(enrolled.ok(), await enrolled.text()).toBe(true);
  await page.request.post('/api/auth/logout');
  await page.goto('/line');
  await page.getByRole('button', { name: new RegExp(escape(name)) }).click();
  for (const digit of pin) {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }
  await page.waitForURL((url) => url.pathname === '/');
  await dismissTour(page);
  return { context, page, name };
}

/** Wait until the copy of the kitchen saved on this device holds this text. */
async function keptOnDevice(page: Page, text: string) {
  await expect
    .poll(
      () =>
        page.evaluate(
          (wanted) =>
            new Promise<boolean>((resolve) => {
              const open = indexedDB.open('keyval-store');
              open.onerror = () => resolve(false);
              open.onsuccess = () => {
                try {
                  const read = open.result
                    .transaction('keyval')
                    .objectStore('keyval')
                    .get('mise.cache');
                  read.onsuccess = () => resolve(String(read.result ?? '').includes(wanted));
                  read.onerror = () => resolve(false);
                } catch {
                  resolve(false);
                }
              };
            }),
          text,
        ),
      { timeout: 45_000, intervals: [1_000] },
    )
    .toBe(true);
}

// ---------------------------------------------------------------------------
// Food cost

test('a chef prices ingredients and sees what a prep, a dish and a menu cost; a cook sees no price', async ({
  page,
  browser,
  request,
}) => {
  const api = await signedInApi(request);
  const kitchen = (await (await api.get('/api/kitchen')).json()) as {
    currency: string;
    foodVatPercent: number;
  };
  expect(kitchen.currency).toBe('EUR');
  const vat = kitchen.foodVatPercent;

  const shallots = await ingredient(api, { name: unique('Shallots') });
  const butter = await ingredient(api, { name: unique('Butter'), allergens: ['milk'] });
  const confit = await recipe(
    api,
    { name: unique('Shallot confit'), type: 'prep', yield: { value: 500, unit: 'g' } },
    [
      { ingredient: shallots.id, grams: 400 },
      { ingredient: butter.id, grams: 100 },
    ],
  );
  const dish = await recipe(
    api,
    {
      name: unique('Onion tart'),
      type: 'dish',
      yield: { value: 4, unit: 'each' },
      portions: 4,
      course: 'starter',
    },
    [
      { recipe: confit.id, grams: 250 },
      { ingredient: butter.id, grams: 40 },
    ],
  );
  const onMenu = await menu(api, unique('Bistro menu'), [dish.id]);

  // What it should all come to, worked out here.
  const shallotPerGram = 6 / (2000 * 0.8); // €6 for 2 kg, 80 % left once peeled
  const butterPerGram = 9 / 1000; // €9 a kilo, nothing trimmed
  const confitBatch = 400 * shallotPerGram + 100 * butterPerGram;
  const dishBatch = 250 * (confitBatch / 500) + 40 * butterPerGram;
  const perPortion = dishBatch / 4;
  const sellPrice = 6.5;
  const foodCost = (perPortion / (sellPrice / (1 + vat / 100))) * 100;

  await signIn(page);

  // Prices as on the invoice, one with a trim yield.
  for (const [item, amount, quantity, trim, perKg] of [
    [shallots, '6', '2', '80', shallotPerGram * 1000],
    [butter, '9', '1', '100', butterPerGram * 1000],
  ] as const) {
    await openIngredient(page, item.name);
    await page.locator('#priceAmount').fill(amount);
    await page.locator('#priceQuantity').fill(quantity);
    await page.locator('#priceUnit').selectOption('kg');
    await page.getByLabel('Trim yield, per cent').fill(trim);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('#priceAmount')).toBeHidden();
    await expect(page.locator('li', { hasText: item.name })).toContainText(
      `${money(perKg)} per kg`,
    );
  }

  // The prep: per batch, and per kilo of what it makes.
  await page.goto(`/recipes/${confit.id}`);
  await expect(page.getByRole('region', { name: 'Food cost' })).toContainText(
    `${money(confitBatch)} per batch · ${money((confitBatch / 500) * 1000)} per kg`,
  );

  // The dish: per batch and per portion; then a selling price.
  await page.goto(`/dishes/${dish.id}/recipe`);
  await expect(page.getByRole('region', { name: 'Food cost' })).toContainText(
    `${money(dishBatch)} per batch · ${money(perPortion)} per portion`,
  );
  await page.goto(`/dishes/${dish.id}/edit`);
  await page.getByLabel('Selling price').fill(String(sellPrice));
  await page.locator('form button[type=submit]').last().click();
  await page.waitForURL((url) => url.pathname === `/dishes/${dish.id}`);
  const dishCost = page.getByRole('region', { name: 'Food cost' });
  await expect(dishCost).toContainText(money(perPortion));
  await expect(dishCost).toContainText(money(sellPrice));
  await expect(dishCost).toContainText(percent(foodCost));

  // The menu: the dish's line, and the menu's average.
  await page.goto(`/menus/${onMenu.id}`);
  await expect(page.locator('main')).toContainText(
    `${money(perPortion)} per portion · food cost ${percent(foodCost)}`,
  );
  await expect(page.locator('main')).toContainText(
    `Menu average: ${money(perPortion)} per portion · food cost ${percent(foodCost)}`,
  );

  // A cook opens the same pages: no price anywhere.
  const tablet = await cookTablet(browser, page.request);
  try {
    const cook = tablet.page;
    const noPrices = async (where: string) => {
      const body = cook.locator('body');
      await expect(body, `${where}: no currency`).not.toContainText('€');
      await expect(body, `${where}: no price per kilo`).not.toContainText('per kg');
      await expect(body, `${where}: no food cost`).not.toContainText('Food cost');
      await expect(body, `${where}: no selling price`).not.toContainText('Selling price');
    };

    await cook.goto(`/recipes/${confit.id}`);
    await expect(cook.getByRole('heading', { name: confit.name, level: 1 })).toBeVisible();
    // Its lines come in the same answer the cost would.
    await expect(cook.locator('main')).toContainText(shallots.name);
    await noPrices('prep recipe');

    await cook.goto(`/dishes/${dish.id}`);
    await expect(cook.getByRole('heading', { name: dish.name }).first()).toBeVisible();
    await expect(cook.getByRole('list', { name: 'Allergens' }).first()).toContainText('Milk');
    await noPrices('dish');

    await cook.goto(`/dishes/${dish.id}/recipe`);
    await expect(cook.getByRole('heading', { name: dish.name, level: 1 })).toBeVisible();
    await expect(cook.locator('main')).toContainText(confit.name);
    await noPrices('dish recipe');

    await cook.goto(`/menus/${onMenu.id}`);
    await expect(cook.getByRole('heading', { name: onMenu.name, level: 1 })).toBeVisible();
    await expect(cook.locator('main')).toContainText(dish.name);
    await noPrices('menu');

    await cook.goto('/ingredients');
    await cook.getByRole('textbox', { name: 'Search ingredients' }).first().fill(shallots.name);
    await expect(cook.locator('li', { hasText: shallots.name })).toBeVisible();
    await noPrices('ingredients');

    // Not merely hidden: Mise never sends them to a cook.
    const asCook = cook.request;
    const expanded = await (await asCook.get(`/api/recipes/${dish.id}/expanded`)).json();
    expect(expanded).not.toHaveProperty('cost');
    expect(expanded.recipe).not.toHaveProperty('sellPrice');
    const list = (await (await asCook.get('/api/ingredients')).json()) as object[];
    for (const item of list) expect(item).not.toHaveProperty('price');
    expect(await (await asCook.get(`/api/menus/${onMenu.id}`)).json()).not.toHaveProperty('cost');
  } finally {
    await tablet.context.close();
  }
});

// ---------------------------------------------------------------------------
// How a recipe is kept, and the use-by on its labels

test('how a recipe is kept is chosen in the editor and shows on the recipe', async ({
  page,
  request,
}) => {
  const api = await signedInApi(request);
  const stock = await recipe(api, {
    name: unique('Brown chicken stock'),
    type: 'prep',
    yield: { value: 5, unit: 'l' },
  });

  await signIn(page);
  await page.goto(`/recipes/${stock.id}/edit`);
  await expect(page.getByLabel('How it is kept', { exact: true })).toHaveValue('');
  await page.getByLabel('How it is kept', { exact: true }).selectOption('chilled_7');
  await page.locator('#storage').fill('Walk-in, top shelf');
  await page.locator('form button[type=submit]').last().click();
  await page.waitForURL((url) => url.pathname === `/recipes/${stock.id}`);

  // On the page under Storage (the printable card, hidden on screen, says it too).
  await expect(storageLine(page)).toHaveText('StorageChilled, 7 °C or colder · Walk-in, top shelf');
  const saved = await (await api.get(`/api/recipes/${stock.id}`)).json();
  expect(saved.kept).toBe('chilled_7');
  expect(saved.storage).toBe('Walk-in, top shelf');

  // And the editor opens on it again.
  await page.goto(`/recipes/${stock.id}/edit`);
  await expect(page.getByLabel('How it is kept', { exact: true })).toHaveValue('chilled_7');
});

test('a chilled prep ticked off the list prints a label with the default use-by, and from its recipe', async ({
  page,
  request,
}) => {
  const api = await signedInApi(request);
  const kitchen = (await (await api.get('/api/kitchen')).json()) as { labelOnTick: boolean };
  // Ticking alone prints nothing: the Label button is what is tested here.
  expect(kitchen.labelOnTick).toBe(false);
  const cream = await ingredient(api, { name: unique('Cream'), allergens: ['milk'] });
  const fondue = await recipe(
    api,
    { name: unique('Leek fondue'), type: 'prep', yield: { value: 1, unit: 'kg' } },
    [{ ingredient: cream.id, grams: 300 }],
  );

  await stubPrint(page);
  await signIn(page);

  // Chilled at 4 °C and no shelf life of its own: the Hygiënecode's three days.
  await page.goto(`/recipes/${fondue.id}/edit`);
  await expect(page.locator('#shelfLife')).toHaveValue('');
  await page.getByLabel('How it is kept', { exact: true }).selectOption('chilled_4');
  await page.locator('form button[type=submit]').last().click();
  await page.waitForURL((url) => url.pathname === `/recipes/${fondue.id}`);
  await expect(storageLine(page)).toHaveText('StorageChilled, 4 °C or colder');

  // On the prep list, from the book. The whole list: lines other files gave
  // the chef can make it open on hers alone.
  await page.goto('/');
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByLabel('What to do').fill(fondue.name);
  await page.getByRole('button', { name: new RegExp(`^${escape(fondue.name)}`) }).click();
  await expect(page.getByText(`Linked to the recipe ${fondue.name}.`)).toBeVisible();
  await page.getByLabel('How much').fill('2');
  await page.getByLabel('Unit', { exact: true }).selectOption('kg');
  await page.getByRole('button', { name: 'Add the line' }).click();

  const line = page.locator('li', {
    hasText: fondue.name,
    has: page.locator('button[data-tour="task"]'),
  });
  await expect(line).toBeVisible();
  const lines = (await (await api.get('/api/running/tasks')).json()) as {
    id: string;
    description: string;
    recipeId: string | null;
  }[];
  const task = lines.find((item) => item.recipeId === fondue.id);
  expect(task, 'the line is linked to its recipe').toBeTruthy();
  made.tasks.push(task!.id);

  const before = new Date();
  await line.locator('button[data-tour="task"]').click();
  await expect(line.locator('button[data-tour="task"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await prints(page)).toBe(0);
  await page.getByRole('button', { name: `Print a label for ${fondue.name}` }).click();
  await expect.poll(() => prints(page)).toBe(1);
  const after = new Date();

  const label = page.locator('.print-label article');
  await expect(label).toHaveCount(1);
  await expect(label).toContainText(fondue.name);
  await expect(label.getByTestId('use-by')).toHaveText(useByBetween(before, after, 3));
  await expect(label).toContainText('Contains: Milk');
  await expect(label).toContainText('Chef R.');
  await expect(page.getByRole('status').filter({ hasText: 'plus 3 days' })).toBeVisible();

  // From the recipe page: the label as it will print, and how many.
  await page.goto(`/recipes/${fondue.id}`);
  await page.getByRole('button', { name: 'Label', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Label for the container' });
  const opened = new Date();
  await expect(panel.getByTestId('use-by')).toHaveText(useByBetween(opened, new Date(), 3));
  await expect(panel.getByRole('status')).toContainText('the day it was made plus 3 days');
  await panel.getByLabel('How many').fill('3');
  await panel.getByRole('button', { name: 'Print 3 labels' }).click();
  await expect.poll(() => prints(page)).toBe(1); // counted afresh on this page
  const sheets = page.locator('.print-label .print-label-page');
  await expect(sheets).toHaveCount(3);
  for (const sheet of await sheets.all()) {
    await expect(sheet.getByTestId('use-by')).toHaveText(useByBetween(opened, new Date(), 3));
    await expect(sheet).toContainText(fondue.name);
  }
});

// ---------------------------------------------------------------------------
// Allergens: "may contain", and labels checked at delivery

test('"may contain" on an ingredient shows on the dish and in its allergen history', async ({
  page,
  request,
}) => {
  const api = await signedInApi(request);
  const dukkah = await ingredient(api, { name: unique('Dukkah') });
  const dish = await recipe(
    api,
    {
      name: unique('Roast carrots, dukkah'),
      type: 'dish',
      yield: { value: 1, unit: 'each' },
      portions: 1,
      course: 'starter',
    },
    [{ ingredient: dukkah.id, grams: 15 }],
  );
  expect((await allergensOf(api, dish.id)).mayContain).toEqual([]);

  await signIn(page);
  await openIngredient(page, dukkah.name);
  await page
    .getByRole('group', { name: /^May contain/ })
    .getByRole('button', { name: 'Sesame', exact: true })
    .click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('li', { hasText: dukkah.name })).toContainText('May contain Sesame.');

  await page.goto(`/dishes/${dish.id}`);
  await expect(page.getByRole('list', { name: 'Allergens' }).first()).toContainText('(Sesame)');
  await page.locator('summary', { hasText: /^History$/ }).click();
  const entry = page.locator('li', { hasText: 'Now may contain: Sesame' });
  await expect(entry).toBeVisible();
  await expect(entry).toContainText(`After a change to ${dukkah.name}`);
  await expect(entry).toContainText(`By ${CHEF.displayName}`);
  expect((await allergensOf(api, dish.id)).mayContain).toEqual(['sesame']);
});

test('a label a cook checks at delivery waits for a chef, and changes the dish once approved', async ({
  page,
  browser,
  request,
}) => {
  const api = await signedInApi(request);
  const mayo = await ingredient(api, { name: unique('Mayonnaise'), allergens: ['eggs'] });
  const dish = await recipe(
    api,
    {
      name: unique('Egg sandwich'),
      type: 'dish',
      yield: { value: 1, unit: 'each' },
      portions: 1,
      course: 'main',
    },
    [{ ingredient: mayo.id, grams: 30 }],
  );

  await signIn(page);
  const tablet = await cookTablet(browser, page.request);
  try {
    const cook = tablet.page;
    await cook.goto('/ingredients');
    await cook.getByRole('button', { name: 'Check a delivery' }).click();
    const delivery = cook.getByRole('region', { name: 'Check a delivery' });
    await delivery.getByRole('textbox', { name: 'Search ingredients' }).fill(mayo.name);
    await delivery.getByLabel(mayo.name).check();
    await delivery.getByRole('button', { name: 'Check 1 label' }).click();

    const check = cook.getByRole('region', { name: `Check the label: ${mayo.name}` });
    await expect(check).toContainText('Label 1 of 1');
    await check
      .getByRole('group', { name: 'Allergens' })
      .getByRole('button', { name: 'Mustard', exact: true })
      .click();
    await expect(check.getByText(dish.name)).toBeVisible({ timeout: 15_000 });
    await expect(check.getByText('Now contains: Mustard')).toBeVisible();
    await expect(
      check.getByText('A chef approves this before the allergens change.'),
    ).toBeVisible();
    await check.getByRole('button', { name: 'Send to a chef' }).click();
    await expect(cook.getByText('Delivery checked: 1 label.')).toBeVisible();
    await cook.getByRole('button', { name: 'Done', exact: true }).click();

    await cook.getByRole('textbox', { name: 'Search ingredients' }).first().fill(mayo.name);
    await expect(cook.locator('li', { hasText: mayo.name })).toContainText(
      'A label change is waiting for a chef',
    );
  } finally {
    await tablet.context.close();
  }

  // Waiting: the ingredient and the dish are as they were.
  const waiting = (await (await api.get(`/api/ingredients/${mayo.id}`)).json()) as {
    allergens: string[];
  };
  expect(waiting.allergens).toEqual(['eggs']);
  expect((await allergensOf(api, dish.id)).contains).toEqual(['eggs']);
  await page.goto(`/dishes/${dish.id}`);
  await expect(page.getByRole('heading', { name: dish.name }).first()).toBeVisible();
  await expect(page.getByRole('list', { name: 'Allergens' }).first()).not.toContainText('Mustard');

  // The chef approves it.
  await page.goto('/ingredients');
  const pending = page.getByRole('region', { name: /label changes? waiting/ });
  await expect(pending).toContainText(mayo.name);
  await expect(pending).toContainText(`Checked by ${tablet.name}`);
  await pending.getByRole('button', { name: `Approve: ${mayo.name}` }).click();
  await expect(page.getByRole('button', { name: `Approve: ${mayo.name}` })).toHaveCount(0);

  // The dish has it now, and its record says where it came from.
  expect((await allergensOf(api, dish.id)).contains.sort()).toEqual(['eggs', 'mustard']);
  await page.goto(`/dishes/${dish.id}`);
  await expect(page.getByRole('list', { name: 'Allergens' }).first()).toContainText('Mustard');
  await page.locator('summary', { hasText: /^History$/ }).click();
  await expect(page.getByText(`After the label of ${mayo.name} was checked`)).toBeVisible();
});

test('a label checked offline is kept on the tablet and applied once Mise is back', async ({
  browser,
  request,
}) => {
  const api = await signedInApi(request);
  const stock = await ingredient(api, { name: unique('Vegetable bouillon') });
  const dish = await recipe(
    api,
    {
      name: unique('Minestrone'),
      type: 'dish',
      yield: { value: 1, unit: 'each' },
      portions: 1,
      course: 'starter',
    },
    [{ ingredient: stock.id, grams: 20 }],
  );

  const context = await browser.newContext({ viewport: { width: 1024, height: 1200 } });
  try {
    const tablet = await context.newPage();
    await signIn(tablet);
    await tablet.evaluate(() => navigator.serviceWorker.ready);
    await tablet.goto('/ingredients');
    await expect(tablet.getByText(stock.name)).toBeVisible();
    // The ingredient is in the copy of the kitchen saved on the tablet.
    await keptOnDevice(tablet, stock.id);

    await context.setOffline(true);
    await tablet.reload();
    await expect(tablet.getByText('Offline.')).toBeVisible({ timeout: 15_000 });

    await tablet.getByRole('textbox', { name: 'Search ingredients' }).first().fill(stock.name);
    await tablet.getByRole('button', { name: `Check label: ${stock.name}` }).click();
    const check = tablet.getByRole('region', { name: `Check the label: ${stock.name}` });
    await check
      .getByRole('group', { name: 'Allergens' })
      .getByRole('button', { name: 'Celery', exact: true })
      .click();
    await check.getByRole('button', { name: 'Save the new label' }).click();
    await expect(tablet.getByRole('status').getByText('Label check saved.')).toBeVisible();
    // Shown on the tablet as Mise will have it.
    await expect(tablet.locator('li', { hasText: stock.name })).toContainText('Celery');

    // Nothing has reached Mise yet.
    expect((await allergensOf(api, dish.id)).contains).toEqual([]);

    await context.setOffline(false);
    await expect
      .poll(async () => (await allergensOf(api, dish.id)).contains, { timeout: 30_000 })
      .toEqual(['celery']);
    const checks = (await (await api.get(`/api/ingredients/${stock.id}/label-checks`)).json()) as {
      status: string;
      changed: boolean;
    }[];
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ status: 'applied', changed: true });
  } finally {
    await context.close();
  }
});
