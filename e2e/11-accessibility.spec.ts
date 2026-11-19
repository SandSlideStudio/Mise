import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { A11Y_WIDTHS, THEMES, expectAccessible, useTheme } from './axe.js';
import { ensureKitchen, signIn, signedInApi, unique } from './helpers.js';

/**
 * Every main page through axe-core, for a chef and for a cook on the tablet,
 * by day and by night, at a laptop's width and a phone's. Setup's own screens
 * are checked in 01-setup, the only time the database is empty.
 *
 * Then the prep list by keyboard alone: everything a cook does to a line can
 * be reached with Tab and done with Enter or Space, and shows where it is.
 */

type Seed = {
  prepId: string;
  prepName: string;
  dishId: string;
  dishName: string;
  menuId: string;
  menuName: string;
  cookPin: string;
  checklistItem: string;
};
let seed = undefined as unknown as Seed;

test.describe.configure({ timeout: 240_000 });
test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });
  await ensureKitchen(api);
  await signedInApi(api);
  seed = await seedKitchen(api);
  await api.dispose();
});

test('the licences of what Mise is built on open from Settings', async ({ page }) => {
  await signIn(page);
  await page.goto('/settings');
  const link = page.getByRole('link', { name: 'Licences' });
  await expect(link).toHaveAttribute('href', '/THIRD-PARTY-NOTICES.txt');
  const notices = await page.request.get('/THIRD-PARTY-NOTICES.txt');
  expect(notices.ok()).toBe(true);
  expect(notices.headers()['content-type']).toMatch(/^text\/plain/);
  const text = await notices.text();
  expect(text).toContain('Copyright 2017 The Barlow Project Authors');
  expect(text).toContain('## fastify ');
});

// The checklist is switched on for these pages; the kitchen gets it back off.
test.afterAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });
  await signedInApi(api);
  const off = await api.patch('/api/kitchen', { data: { prepChecklist: false } });
  expect(off.ok(), await off.text()).toBe(true);
  await api.dispose();
});

async function seedKitchen(api: APIRequestContext): Promise<Seed> {
  const post = async (url: string, data: unknown) => {
    const response = await api.post(url, { data });
    expect(response.ok(), `${url}: ${await response.text()}`).toBe(true);
    return response.json();
  };
  const butter = await post('/api/ingredients', {
    name: unique('Butter'),
    baseUnit: 'g',
    allergens: ['milk'],
  });
  const base = {
    status: 'published',
    yield: { value: 1000, unit: 'g' },
    portions: null,
    method: [{ text: 'Brown the butter until it smells of hazelnut.' }],
    tags: [],
    declaredAllergens: [],
    mayContain: [],
    flavourProfile: [],
    servingTemperature: null,
    course: null,
    drinkPairings: [],
    cutlery: [],
  };
  const prep = await post('/api/recipes', {
    ...base,
    name: unique('Brown butter'),
    type: 'prep',
    components: [
      {
        sortOrder: 0,
        quantity: { value: 500, unit: 'g' },
        ref: { kind: 'ingredient', ingredientId: butter.id },
      },
    ],
  });
  const dish = await post('/api/recipes', {
    ...base,
    name: unique('Skate wing'),
    type: 'dish',
    yield: { value: 1, unit: 'each' },
    portions: 1,
    course: 'main',
    components: [
      {
        sortOrder: 0,
        quantity: { value: 40, unit: 'g' },
        ref: { kind: 'recipe', recipeId: prep.id },
      },
    ],
  });
  const menu = await post('/api/menus', { name: unique('Winter menu'), dishes: [dish.id] });
  await post('/api/running/tasks', {
    description: unique('Brown the butter'),
    recipeId: prep.id,
    quantity: { value: 1000, unit: 'g' },
  });
  // The prep checklist, on and with something in it, so Today shows it.
  const on = await api.patch('/api/kitchen', { data: { prepChecklist: true } });
  expect(on.ok(), await on.text()).toBe(true);
  const checklist = await (await api.get('/api/checklist')).json();
  const checklistItem = unique('Clarify butter');
  const put = await api.put('/api/checklist', {
    data: {
      items: [
        ...checklist.items.map((item: { id: string; stationId: string | null; name: string }) => ({
          id: item.id,
          stationId: item.stationId,
          name: item.name,
        })),
        { stationId: null, name: checklistItem, recipeId: prep.id },
      ],
    },
  });
  expect(put.ok(), await put.text()).toBe(true);
  return {
    prepId: prep.id,
    prepName: prep.name,
    dishId: dish.id,
    dishName: dish.name,
    menuId: menu.id,
    menuName: menu.name,
    cookPin: '5917',
    checklistItem,
  };
}

type Visit = { path: string; ready: (page: Page) => ReturnType<Page['locator']> };
const h1 = (name: string | RegExp) => (page: Page) => page.getByRole('heading', { name, level: 1 });
const field = (label: string) => (page: Page) => page.getByLabel(label, { exact: true }).first();

function chefPages(s: Seed): [string, Visit][] {
  const settings = ['staff', 'stations', 'devices', 'kitchen', 'dishCards', 'privacy'].map(
    (tab): [string, Visit] => [
      `settings: ${tab}`,
      { path: `/settings?tab=${tab}`, ready: h1('Settings') },
    ],
  );
  return [
    ['today', { path: '/', ready: h1('Today') }],
    ['recipes', { path: '/recipes', ready: h1('Recipes') }],
    ['new recipe', { path: '/recipes/new', ready: field('Recipe name') }],
    ['recipe', { path: `/recipes/${s.prepId}`, ready: h1(s.prepName) }],
    ['recipe editor', { path: `/recipes/${s.prepId}/edit`, ready: field('Recipe name') }],
    ['dishes', { path: '/dishes', ready: h1('Dishes') }],
    ['new dish', { path: '/dishes/new', ready: field('Recipe name') }],
    [
      'dish card',
      {
        path: `/dishes/${s.dishId}`,
        ready: (p) => p.getByRole('heading', { name: s.dishName }).first(),
      },
    ],
    ['dish recipe', { path: `/dishes/${s.dishId}/recipe`, ready: h1(s.dishName) }],
    ['dish editor', { path: `/dishes/${s.dishId}/edit`, ready: field('Recipe name') }],
    ['dish print card', { path: `/dishes/${s.dishId}/card`, ready: h1(s.dishName) }],
    ['allergen notice', { path: '/dishes/allergen-notice', ready: h1('Allergen notice') }],
    ['menus', { path: '/menus', ready: h1('Menus') }],
    ['menu', { path: `/menus/${s.menuId}`, ready: field('Menu name') }],
    ['menu overview', { path: `/menus/${s.menuId}/overview`, ready: h1(s.menuName) }],
    ['ingredients', { path: '/ingredients', ready: h1('Ingredients') }],
    ...settings,
  ];
}

async function visit(page: Page, name: string, spec: Visit) {
  await page.goto(spec.path);
  await expect(spec.ready(page), `${name}: drawn`).toBeVisible();
  await expect(page.getByText('Loading…')).toHaveCount(0);
}

/** A new cook, and this browser enrolled as a kitchen tablet, at its sign-in. */
async function newCookAtTablet(page: Page): Promise<string> {
  await signIn(page);
  const name = unique('Cook Ada');
  const made = await page.request.post('/api/users', {
    data: { displayName: name, role: 'cook', pin: seed.cookPin },
  });
  expect(made.ok(), await made.text()).toBe(true);
  const enrol = await page.request.post('/api/auth/devices', {
    data: { name: unique('Pass tablet') },
  });
  expect(enrol.ok(), await enrol.text()).toBe(true);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto('/line');
  return name;
}

for (const { label, viewport } of A11Y_WIDTHS) {
  for (const theme of THEMES) {
    test.describe(`${theme}, ${label} px wide`, () => {
      test.use({ viewport });
      test.beforeEach(async ({ page }) => useTheme(page, theme));

      test('the sign-in page', async ({ page }) => {
        await page.goto('/login');
        await expect(page.locator('#email')).toBeVisible();
        await expectAccessible(page, `sign-in, ${theme}, ${label}`);
      });

      test('every main page, as a chef', async ({ page }) => {
        await signIn(page);
        for (const [name, spec] of chefPages(seed)) {
          await visit(page, name, spec);
          await expectAccessible(page, `${name}, ${theme}, ${label}`);
        }
      });

      test('the tablet sign-in, the tour and Today, as a cook', async ({ page }) => {
        // A cook of their own, so they are asked about the tour like anyone new.
        const name = await newCookAtTablet(page);
        const cook = page.getByRole('button', { name: new RegExp(name) });
        await expect(cook).toBeVisible();
        await expectAccessible(page, `tablet sign-in, ${theme}, ${label}`);
        await cook.click();
        await expect(page.getByRole('button', { name: '1', exact: true })).toBeVisible();
        await expectAccessible(page, `tablet PIN, ${theme}, ${label}`);
        for (const digit of seed.cookPin) {
          await page.getByRole('button', { name: digit, exact: true }).click();
        }
        await page.waitForURL((url) => url.pathname === '/');

        await expect(page.getByRole('dialog')).toBeVisible();
        await expectAccessible(page, `tour prompt, ${theme}, ${label}`);
        await page.getByRole('button', { name: 'Show me around' }).click();
        await expect(page.getByRole('dialog', { name: 'Tour' })).toBeVisible();
        await expectAccessible(page, `tour, ${theme}, ${label}`);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toBeHidden();

        await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
        await expectAccessible(page, `cook Today, ${theme}, ${label}`);
      });
    });
  }
}

for (const { label, viewport } of A11Y_WIDTHS) {
  for (const theme of THEMES) {
    test.describe(`the prep list's panels, ${theme}, ${label} px wide`, () => {
      test.use({ viewport });
      test.beforeEach(async ({ page }) => useTheme(page, theme));

      test('the checklist open and being edited, and a line asking to be removed', async ({
        page,
      }) => {
        await signIn(page);
        await page.getByRole('button', { name: /^Prep checklist/ }).click();
        await expect(page.getByRole('checkbox', { name: seed.checklistItem })).toBeVisible();
        await expectAccessible(page, `checklist, ${theme}, ${label}`);
        await page.getByRole('button', { name: 'Edit checklist' }).click();
        await expect(page.getByRole('button', { name: 'Save checklist' })).toBeVisible();
        await expectAccessible(page, `checklist editor, ${theme}, ${label}`);
        await page.getByRole('button', { name: 'Cancel' }).click();

        const remove = page.getByRole('button', { name: /Take .* off the list$/ }).first();
        await remove.click();
        await expect(remove).toHaveText('Remove?');
        // It turns red with a fade; checked once it has.
        await page.waitForTimeout(300);
        await expectAccessible(page, `remove confirm, ${theme}, ${label}`);
      });
    });
  }
}

// ---------------------------------------------------------------------------
// By keyboard alone

/** Where the keyboard is now. */
const focused = (page: Page) => page.locator(':focus');

/**
 * Presses Tab (or Shift+Tab) until `target` has the focus, checking on the
 * way that whatever has it can be seen: on screen and drawn with a ring.
 */
async function tabTo(page: Page, target: ReturnType<Page['locator']>, back = false) {
  for (let presses = 0; presses < 80; presses += 1) {
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
    const shown = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return { ok: true, what: 'body' };
      const style = getComputedStyle(el);
      const ring =
        (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
        style.boxShadow !== 'none';
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40);
      return { ok: ring, what: `${el.tagName.toLowerCase()} "${name}"` };
    });
    expect.soft(shown.ok, `the focus ring on ${shown.what}`).toBe(true);
    if (shown.what !== 'body') await expect(focused(page)).toBeInViewport();
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`Tab never reached ${target}`);
}

test.describe('by keyboard alone', () => {
  test.use({ viewport: { width: 1024, height: 768 } });
  test.beforeEach(async ({ page }) => {
    await useTheme(page, 'day');
    // Printing opens the browser's dialog; here it only says it was asked for.
    await page.addInitScript(() => {
      const counted = window as unknown as { printed: number };
      counted.printed = 0;
      window.print = () => {
        counted.printed += 1;
        window.dispatchEvent(new Event('afterprint'));
      };
    });
  });
  const printed = (page: Page) =>
    page.evaluate(() => (window as unknown as { printed: number }).printed);

  test('a line is added, started, ticked and the list printed, with Tab, Enter and Space', async ({
    page,
  }) => {
    await signIn(page);
    const line = unique('Zest the lemons');

    await tabTo(page, page.getByRole('button', { name: 'Print', exact: true }));
    await page.keyboard.press('Enter');
    await expect.poll(() => printed(page)).toBe(1);

    await tabTo(page, page.getByLabel('What to do'));
    await page.keyboard.type(line);
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('How much')).toBeFocused();
    await page.keyboard.type('3');
    await tabTo(page, page.getByRole('button', { name: 'Add the line' }));
    await page.keyboard.press('Enter');

    const row = page.locator('li', { hasText: line });
    await expect(row).toBeVisible();
    const start = page.getByRole('button', { name: `Start: ${line}` });
    await tabTo(page, start);
    await page.keyboard.press('Enter');
    await expect(row.locator('[data-tour="being-made"]')).toHaveAttribute('aria-pressed', 'true');

    const tick = row.locator('button[data-tour="task"]');
    await tabTo(page, tick, true);
    await page.keyboard.press('Space');
    await expect(tick).toHaveAttribute('aria-pressed', 'true');
  });

  test('the checklist is ticked, printed and changed with the keyboard', async ({ page }) => {
    await signIn(page);
    const toggle = page.getByRole('button', { name: /^Prep checklist/ });
    await tabTo(page, toggle);
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const item = page.getByRole('checkbox', { name: seed.checklistItem });
    await tabTo(page, item);
    await page.keyboard.press('Space');
    await expect(item).toBeChecked();
    await tabTo(page, page.getByRole('button', { name: 'Add to prep list (1)' }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: /prep list|already/ })).toBeVisible();

    await tabTo(page, page.getByRole('button', { name: 'Print checklist' }));
    await page.keyboard.press('Enter');
    await expect.poll(() => printed(page)).toBe(1);

    await tabTo(page, page.getByRole('button', { name: 'Edit checklist' }));
    await page.keyboard.press('Enter');
    const added = unique('Pick chervil');
    await tabTo(page, page.getByRole('textbox', { name: 'New item' }).first());
    await page.keyboard.type(added);
    await page.keyboard.press('Enter');
    // Rename what was just added, from the keyboard.
    const named = page.locator(`input[value="${added}"]`);
    await expect(named).toHaveCount(1);
    await tabTo(page, named, true);
    await page.keyboard.press('End');
    await page.keyboard.type(' tips');
    await tabTo(page, page.getByRole('button', { name: 'Save checklist' }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('checkbox', { name: `${added} tips` })).toBeVisible();
  });

  test('the tour keeps the keyboard inside it and Escape closes it', async ({ page }) => {
    const name = await newCookAtTablet(page);
    await page.getByRole('button', { name: new RegExp(name) }).click();
    for (const digit of seed.cookPin) {
      await page.getByRole('button', { name: digit, exact: true }).click();
    }
    await page.waitForURL((url) => url.pathname === '/');
    await page.getByRole('button', { name: 'Show me around' }).click();
    const tour = page.getByRole('dialog', { name: 'Tour' });
    await expect(tour).toBeVisible();
    await page.keyboard.press('Enter');
    for (let presses = 0; presses < 6; presses += 1) {
      await page.keyboard.press(presses % 2 ? 'Shift+Tab' : 'Tab');
      await expect(tour.locator(':focus')).toHaveCount(1);
    }
    await page.keyboard.press('Escape');
    await expect(tour).toBeHidden();
  });
});
