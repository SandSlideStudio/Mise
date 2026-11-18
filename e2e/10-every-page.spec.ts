import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { CHEF, dismissTour, ensureKitchen, signIn, signedInApi, unique } from './helpers.js';

/**
 * Every page, at a laptop and at a phone, for a chef and for a cook: it
 * renders, it logs no error, and every tab in the top bar and every way back
 * really goes there and is still there half a second later. (Mise 2.3.0 sent
 * you back to the recipe a moment after you left it, so the check is that the
 * address STAYS, not only that it changed.)
 *
 * Console noise that is ignored, and nothing else:
 *   - none. Errors are only collected once the person is signed in, which
 *     leaves out the 401 the session probe makes before sign-in. Service
 *     worker warnings are `warning`s, and only `error`s are collected.
 */

const SETTLE_MS = 500;
const PARALLEL = 8;

type Seed = {
  prepId: string;
  prepName: string;
  subId: string;
  subName: string;
  dishId: string;
  dishName: string;
  menuId: string;
  menuName: string;
  cookName: string;
};
let seed = undefined as unknown as Seed;

const WIDTHS = [
  { label: 'laptop 1024x768', viewport: { width: 1024, height: 768 } },
  { label: 'phone 390x844', viewport: { width: 390, height: 844 } },
] as const;

const TABS = [
  { name: 'Today', path: '/', heading: 'Today' },
  { name: 'Recipes', path: '/recipes', heading: 'Recipes' },
  { name: 'Dishes', path: '/dishes', heading: 'Dishes' },
  { name: 'Menus', path: '/menus', heading: 'Menus' },
  { name: 'Ingredients', path: '/ingredients', heading: 'Ingredients' },
  { name: 'Settings', path: '/settings', heading: 'Settings' },
] as const;
const COOK_TABS = TABS.filter((tab) => !['Ingredients', 'Settings'].includes(tab.name));

test.describe.configure({ timeout: 180_000 });
// A link that is not there fails in seconds, not at the end of the test.
test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

// The seed is kept in a file, so a worker that restarts after a failure uses
// the same recipes instead of making a second set (the prep list would then
// hold two lines with the same words).
const SEED_FILE = path.join(
  os.tmpdir(),
  `mise-e2e-every-page-${process.env.E2E_PORT ?? '3210'}.json`,
);

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });
  await ensureKitchen(api);
  await signedInApi(api);
  try {
    const kept = JSON.parse(readFileSync(SEED_FILE, 'utf8')) as Seed;
    const there = await api.get(`/api/menus/${kept.menuId}`);
    if (there.ok()) seed = kept;
  } catch {
    // Nothing kept, or from an earlier run of the server: make it again.
  }
  if (!seed?.menuId) {
    seed = await seedKitchen(api);
    writeFileSync(SEED_FILE, JSON.stringify(seed));
  }
  await api.dispose();
});

async function seedKitchen(api: APIRequestContext): Promise<Seed> {
  const post = async (url: string, data: unknown) => {
    const response = await api.post(url, { data });
    expect(response.ok(), `${url}: ${await response.text()}`).toBe(true);
    return response.json();
  };
  const flour = await post('/api/ingredients', {
    name: unique('Flour'),
    baseUnit: 'g',
    allergens: ['gluten'],
  });
  const salt = await post('/api/ingredients', { name: unique('Salt'), baseUnit: 'g' });
  const base = {
    status: 'published',
    yield: { value: 1000, unit: 'g' },
    portions: null,
    method: [],
    tags: [],
    declaredAllergens: [],
    mayContain: [],
    flavourProfile: [],
    servingTemperature: null,
    course: null,
    drinkPairings: [],
    cutlery: [],
  };
  const sub = await post('/api/recipes', {
    ...base,
    name: unique('Pickling brine'),
    type: 'prep',
    components: [
      {
        sortOrder: 0,
        quantity: { value: 50, unit: 'g' },
        ref: { kind: 'ingredient', ingredientId: salt.id },
      },
    ],
  });
  const prep = await post('/api/recipes', {
    ...base,
    name: unique('Pickled shallots'),
    type: 'prep',
    method: [{ text: 'Pour the brine over the shallots.' }],
    components: [
      {
        sortOrder: 0,
        quantity: { value: 200, unit: 'g' },
        ref: { kind: 'ingredient', ingredientId: flour.id },
      },
      {
        sortOrder: 1,
        quantity: { value: 300, unit: 'g' },
        ref: { kind: 'recipe', recipeId: sub.id },
      },
    ],
  });
  const dish = await post('/api/recipes', {
    ...base,
    name: unique('Shallot tart'),
    type: 'dish',
    yield: { value: 1, unit: 'each' },
    portions: 1,
    course: 'starter',
    components: [
      {
        sortOrder: 0,
        quantity: { value: 80, unit: 'g' },
        ref: { kind: 'recipe', recipeId: prep.id },
      },
    ],
  });
  const menu = await post('/api/menus', { name: unique('Autumn menu'), dishes: [dish.id] });
  await post('/api/running/tasks', {
    description: unique('Pickle the shallots'),
    recipeId: prep.id,
    quantity: { value: 2000, unit: 'g' },
  });
  const cookName = unique('Cook Sam');
  await post('/api/users', { displayName: cookName, role: 'cook', pin: '8264' });
  return {
    prepId: prep.id,
    prepName: prep.name,
    subId: sub.id,
    subName: sub.name,
    dishId: dish.id,
    dishName: dish.name,
    menuId: menu.id,
    menuName: menu.name,
    cookName,
  };
}

// ---------------------------------------------------------------------------
// Helpers

type Problems = string[];

/** Collects every uncaught exception and console error on a page. */
function watch(page: Page, problems: Problems) {
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    const why = request.failure()?.errorText ?? '';
    // A request cut off because the page moved on is not a failure.
    if (!why.includes('ERR_ABORTED')) problems.push(`request failed: ${request.url()} ${why}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      problems.push(`console.error: ${message.text()} (${message.location().url})`);
    }
  });
}

const nav = (page: Page) => page.locator('header nav');
const pathOf = (page: Page) => new URL(page.url()).pathname;

/** The address is `path` now, and still is after a moment (nothing navigates back). */
async function expectStaysAt(page: Page, path: string, what: string) {
  await page.waitForURL((url) => url.pathname === path, { timeout: 10_000 }).catch(() => undefined);
  expect(pathOf(page), `${what}: arrived at`).toBe(path);
  await page.waitForTimeout(SETTLE_MS);
  expect(pathOf(page), `${what}: still there after ${SETTLE_MS} ms`).toBe(path);
}

type PageSpec = {
  path: string;
  /** What shows when the page has opened properly. */
  ready: (page: Page) => ReturnType<Page['locator']>;
  /** Where it ends up, when opening it moves on. */
  lands?: string;
};

const headingText = (name: string | RegExp) => (page: Page) =>
  page.getByRole('heading', { name, level: 1 });
const field = (label: string) => (page: Page) => page.getByLabel(label, { exact: true }).first();
/** A dish card names its dish in a heading of its own level. */
const anyHeading = (name: string) => (page: Page) => page.getByRole('heading', { name }).first();

function chefPages(s: Seed, canManage = true): Record<string, PageSpec> {
  return {
    today: { path: '/', ready: headingText('Today') },
    recipes: { path: '/recipes', ready: headingText('Recipes') },
    'new recipe': { path: '/recipes/new', ready: field('Recipe name') },
    'prep recipe': { path: `/recipes/${s.prepId}`, ready: headingText(s.prepName) },
    'prep editor': { path: `/recipes/${s.prepId}/edit`, ready: field('Recipe name') },
    'sub-recipe': { path: `/recipes/${s.subId}`, ready: headingText(s.subName) },
    dishes: { path: '/dishes', ready: headingText('Dishes') },
    'new dish': { path: '/dishes/new', ready: field('Recipe name') },
    'dish card': { path: `/dishes/${s.dishId}`, ready: anyHeading(s.dishName) },
    'dish recipe': { path: `/dishes/${s.dishId}/recipe`, ready: headingText(s.dishName) },
    'dish editor': { path: `/dishes/${s.dishId}/edit`, ready: field('Recipe name') },
    'dish print card': { path: `/dishes/${s.dishId}/card`, ready: headingText(s.dishName) },
    menus: { path: '/menus', ready: headingText('Menus') },
    // A chef edits the menu's name in place; a cook reads it as a heading.
    menu: {
      path: `/menus/${s.menuId}`,
      ready: canManage ? field('Menu name') : headingText(s.menuName),
    },
    'menu overview': { path: `/menus/${s.menuId}/overview`, ready: headingText(s.menuName) },
    ingredients: { path: '/ingredients', ready: headingText('Ingredients') },
    settings: { path: '/settings', ready: headingText('Settings') },
  };
}

/** What a cook can open. Settings answers with a refusal; the rest are as for a chef. */
function cookPages(s: Seed): Record<string, PageSpec> {
  const all = chefPages(s, false);
  return {
    today: all.today!,
    recipes: all.recipes!,
    'prep recipe': all['prep recipe']!,
    dishes: all.dishes!,
    'dish card': all['dish card']!,
    'dish recipe': all['dish recipe']!,
    'dish print card': all['dish print card']!,
    menus: all.menus!,
    menu: all.menu!,
    'menu overview': all['menu overview']!,
    settings: all.settings!,
  };
}

/** Opens the page and checks it drew itself, with the top bar. */
async function openAndCheck(page: Page, name: string, spec: PageSpec) {
  await page.goto(spec.path);
  await expect(spec.ready(page), `${name}: its heading or form`)
    .toBeVisible()
    .catch(async (error: Error) => {
      const shown = (
        await page
          .locator('body')
          .innerText()
          .catch(() => '')
      ).slice(0, 300);
      throw new Error(`${error.message}\nat ${page.url()}, the page said: ${shown}`);
    });
  await expect(nav(page), `${name}: the top bar`).toBeVisible();
  await expect(page.getByText('Something went wrong'), `${name}: no error message`).toHaveCount(0);
  await expect(page.getByText('Loading…'), `${name}: done loading`).toHaveCount(0);
  expect(pathOf(page), `${name}: stays on its address`).toBe(spec.lands ?? spec.path);
}

/**
 * Every top-bar tab, from this page: each is one click away, lands on the
 * tab's own address and stays there. Each starts again from the page itself.
 */
async function everyTabFrom(page: Page, name: string, spec: PageSpec, tabs: typeof TABS) {
  await openAndCheck(page, name, spec);
  const home = spec.lands ?? spec.path;
  for (const tab of tabs) {
    await nav(page).getByRole('link', { name: tab.name, exact: true }).click();
    await expectStaysAt(page, tab.path, `${name} then ${tab.name}`);
    await expect(
      page.getByRole('heading', { name: tab.heading, level: 1 }),
      `${name} then ${tab.name}: its heading`,
    ).toBeVisible();
    await expect(nav(page).getByRole('link', { name: tab.name, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // Back to the page itself, with the browser's Back, for the next tab.
    if (tab.path === home) continue; // its own tab: nowhere to go back from
    await page.goBack();
    await expectStaysAt(page, home, `${name}: Back from ${tab.name}`);
    await expect(spec.ready(page), `${name}: Back from ${tab.name}: the page again`).toBeVisible();
  }
}

/** Runs one job per page, each on its own tab of the same signed-in browser. */
async function inParallel<T>(
  signedIn: Page,
  problems: Problems,
  jobs: [string, T][],
  run: (page: Page, name: string, item: T) => Promise<void>,
) {
  // Each in a browser of its own, signed in the same way. Browsers that share
  // one set of kept data trip over each other writing it (see the note on the
  // card-fonts test below), and a kitchen has one set of data per tablet.
  const context = signedIn.context();
  const state = await context.storageState();
  const browser = context.browser()!;
  const viewport = signedIn.viewportSize()!;
  const baseURL = new URL(signedIn.url()).origin;
  // A few tabs at a time: the pages are slower, and fail for it, when all open at once.
  const results: PromiseSettledResult<void>[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const index = next++;
      const [name, item] = jobs[index]!;
      const own = await browser.newContext({ storageState: state, viewport, baseURL });
      const page = await own.newPage();
      watch(page, problems);
      try {
        await run(page, name, item);
        results[index] = { status: 'fulfilled', value: undefined };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      } finally {
        await own.close();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, jobs.length) }, worker));
  const failed = results.flatMap((result, index) =>
    result.status === 'rejected' ? [`[${jobs[index]![0]}] ${String(result.reason)}`] : [],
  );
  expect(failed, `${failed.join('\n\n')}\n\nConsole: ${problems.join(' | ')}`).toEqual([]);
}

/** The cook, signed in by PIN on a tablet enrolled from the chef's own sign-in. */
async function signInCook(page: Page, cookName: string) {
  await signIn(page);
  const enrol = await page.request.post('/api/auth/devices', {
    data: { name: unique('Pass tablet') },
  });
  expect(enrol.ok(), await enrol.text()).toBe(true);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto('/line');
  await page.getByRole('button', { name: new RegExp(cookName) }).click();
  for (const digit of '8264') await page.getByRole('button', { name: digit, exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/');
  await dismissTour(page);
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
}

// ---------------------------------------------------------------------------

for (const { label, viewport } of WIDTHS) {
  test.describe(`a chef on a ${label}`, () => {
    test.use({ viewport });
    test.beforeEach(async ({ request }) => ensureKitchen(request));

    test('every page draws itself without a console error', async ({ page }) => {
      await signIn(page);
      const problems: Problems = [];
      const pages = Object.entries(chefPages(seed));
      await inParallel(page, problems, pages, async (tab, name, spec) => {
        await openAndCheck(tab, name, spec);
        await tab.waitForTimeout(SETTLE_MS);
        expect(pathOf(tab), `${name}: still at its address`).toBe(spec.lands ?? spec.path);
      });
      expect(problems).toEqual([]);
    });

    test('every top-bar tab works from every page and stays', async ({ page }) => {
      await signIn(page);
      const problems: Problems = [];
      const pages = Object.entries(chefPages(seed));
      await inParallel(page, problems, pages, (tab, name, spec) =>
        everyTabFrom(tab, name, spec, TABS),
      );
      expect(problems).toEqual([]);
    });

    // The navigation is the same at a phone's width (the matrix above covers its
    // scrolling top bar), so the long walks run once, at a laptop's.
    test.describe(`long walks`, () => {
      test.skip(viewport.width < 600, 'run at the laptop width only');
      test('moving through several pages without a reload, the tabs keep working', async ({
        page,
      }) => {
        await signIn(page);
        const problems: Problems = [];
        watch(page, problems);
        // One long visit, the way a person uses it: nothing is reloaded between pages.
        await page.locator('header a[href="/"]').first().click();
        await expectStaysAt(page, '/', 'the logo');
        await nav(page).getByRole('link', { name: 'Recipes', exact: true }).click();
        await page.getByRole('link', { name: seed.prepName }).first().click();
        await expectStaysAt(page, `/recipes/${seed.prepId}`, 'open the prep');
        await page
          .getByRole('main')
          .getByRole('link', { name: 'open', exact: true })
          .first()
          .click();
        await expectStaysAt(page, `/recipes/${seed.subId}`, 'open its sub-recipe');
        for (const tab of TABS.filter((t) => ['Dishes', 'Menus', 'Settings'].includes(t.name))) {
          await nav(page).getByRole('link', { name: tab.name, exact: true }).click();
          await expectStaysAt(page, tab.path, `tab ${tab.name}`);
          await nav(page).getByRole('link', { name: 'Recipes', exact: true }).click();
          await page.getByRole('link', { name: seed.prepName }).first().click();
          await expectStaysAt(page, `/recipes/${seed.prepId}`, 'open the prep again');
        }
        expect(problems).toEqual([]);
      });

      test('browser back and forward between a list and a detail page', async ({ page }) => {
        await signIn(page);
        const problems: Problems = [];
        watch(page, problems);
        const s = seed;
        const trips: [string, string, string, string, string][] = [
          ['Recipes', '/recipes', s.prepName, `/recipes/${s.prepId}`, 'recipe'],
          ['Dishes', '/dishes', s.dishName, `/dishes/${s.dishId}`, 'dish'],
          ['Menus', '/menus', s.menuName, `/menus/${s.menuId}`, 'menu'],
        ];
        for (const [tab, list, itemName, detail] of trips) {
          await nav(page).getByRole('link', { name: tab, exact: true }).click();
          await expectStaysAt(page, list, `${tab} list`);
          await page
            .getByRole('link', { name: new RegExp(itemName) })
            .first()
            .click();
          await expectStaysAt(page, detail, `${tab} detail`);
          await page.goBack();
          await expectStaysAt(page, list, `${tab}: back to the list`);
          await expect(page.getByRole('heading', { name: tab, level: 1 })).toBeVisible();
          await page.goForward();
          await expectStaysAt(page, detail, `${tab}: forward to the detail`);
          // A chef edits a menu's name in place; every other title is a heading.
          await expect(
            tab === 'Menus'
              ? page.getByLabel('Menu name', { exact: true })
              : page.getByRole('heading', { name: itemName }).first(),
          ).toBeVisible();
          await page.goBack();
          await expectStaysAt(page, list, `${tab}: back again`);
        }
        // A deeper trip: dish, its recipe, back to the dish, back to the list.
        await page.goto(`/dishes/${s.dishId}`);
        await page.getByRole('link', { name: 'Recipe', exact: true }).click();
        await expectStaysAt(page, `/dishes/${s.dishId}/recipe`, 'dish to recipe');
        await page.goBack();
        await expectStaysAt(page, `/dishes/${s.dishId}`, 'back to the dish');
        await page.goForward();
        await expectStaysAt(page, `/dishes/${s.dishId}/recipe`, 'forward to the recipe');
        await nav(page).getByRole('link', { name: 'Menus', exact: true }).click();
        await expectStaysAt(page, '/menus', 'a tab after going back and forward');
        expect(problems).toEqual([]);
      });
    });

    test('every way back from a detail page lands where it says and stays', async ({ page }) => {
      await signIn(page);
      const problems: Problems = [];
      const all = chefPages(seed);
      const s = seed;
      type Back = { from: string; click: (page: Page) => Promise<void>; to: string };
      const link = (name: string | RegExp) => (p: Page) =>
        p
          .getByRole('main')
          .getByRole('link', { name, exact: typeof name === 'string' })
          .first()
          .click();
      const button = (name: string) => (p: Page) =>
        p.getByRole('button', { name, exact: true }).first().click();
      const backs: [string, Back][] = [
        ['book from a prep', { from: 'prep recipe', click: link('← The book'), to: '/recipes' }],
        [
          'edit from a prep',
          { from: 'prep recipe', click: link('Edit'), to: `/recipes/${s.prepId}/edit` },
        ],
        [
          'cancel a prep editor',
          { from: 'prep editor', click: button('Cancel'), to: `/recipes/${s.prepId}` },
        ],
        ['cancel a new recipe', { from: 'new recipe', click: button('Cancel'), to: '/recipes' }],
        [
          'a sub-recipe from its parent',
          { from: 'prep recipe', click: link('open'), to: `/recipes/${s.subId}` },
        ],
        [
          'the parent from "used by"',
          {
            from: 'sub-recipe',
            click: link(new RegExp(s.prepName)),
            to: `/recipes/${s.prepId}`,
          },
        ],
        ['dishes from a dish', { from: 'dish card', click: link('← Dishes'), to: '/dishes' }],
        [
          'the recipe of a dish',
          { from: 'dish card', click: link('Recipe'), to: `/dishes/${s.dishId}/recipe` },
        ],
        ['edit a dish', { from: 'dish card', click: link('Edit'), to: `/dishes/${s.dishId}/edit` }],
        [
          'print a dish card',
          { from: 'dish card', click: link('Print or PDF'), to: `/dishes/${s.dishId}/card` },
        ],
        [
          'dish from its recipe',
          { from: 'dish recipe', click: link('← The dish'), to: `/dishes/${s.dishId}` },
        ],
        [
          'edit from a dish recipe',
          { from: 'dish recipe', click: link('Edit'), to: `/dishes/${s.dishId}/edit` },
        ],
        [
          'the prep from a dish recipe',
          { from: 'dish recipe', click: link('open'), to: `/recipes/${s.prepId}` },
        ],
        [
          'cancel a dish editor',
          { from: 'dish editor', click: button('Cancel'), to: `/dishes/${s.dishId}` },
        ],
        ['cancel a new dish', { from: 'new dish', click: button('Cancel'), to: '/dishes' }],
        [
          'dish from its print card',
          { from: 'dish print card', click: link('← The dish'), to: `/dishes/${s.dishId}` },
        ],
        ['menus from a menu', { from: 'menu', click: link('← Menus'), to: '/menus' }],
        [
          'a dish from a menu',
          { from: 'menu', click: link(new RegExp(s.dishName)), to: `/dishes/${s.dishId}` },
        ],
        [
          'the overview from a menu',
          { from: 'menu', click: link('Allergen overview'), to: `/menus/${s.menuId}/overview` },
        ],
        [
          'menu from its overview',
          { from: 'menu overview', click: link('← The menu'), to: `/menus/${s.menuId}` },
        ],
        [
          'the menu from the Menus list',
          { from: 'menus', click: link(new RegExp(s.menuName)), to: `/menus/${s.menuId}` },
        ],
        [
          'a prep from the Recipes list',
          { from: 'recipes', click: link(new RegExp(s.prepName)), to: `/recipes/${s.prepId}` },
        ],
        [
          'a dish from the Dishes list',
          { from: 'dishes', click: link(new RegExp(s.dishName)), to: `/dishes/${s.dishId}` },
        ],
        [
          'a prep line opens its recipe',
          {
            from: 'today',
            click: (p) =>
              p
                .getByRole('link', { name: /Pickle the shallots/ })
                .first()
                .click(),
            to: `/recipes/${s.prepId}`,
          },
        ],
      ];
      await inParallel(page, problems, backs, async (tab, name, step) => {
        const spec = all[step.from]!;
        await openAndCheck(tab, name, spec);
        await step.click(tab);
        await expectStaysAt(tab, step.to, name);
      });
      expect(problems).toEqual([]);
    });

    test('each settings tab opens its own content', async ({ page }) => {
      await signIn(page);
      const problems: Problems = [];
      watch(page, problems);
      await page.goto('/settings');
      // Some tabs have tabs of their own below (the dish card's sides): the first list is Settings'.
      const tabs = page.getByRole('tablist').first().getByRole('tab');
      await expect(tabs.first()).toBeVisible();
      const names = (await tabs.allTextContents()).map((text) => text.trim());
      expect(names, 'the administrator sees all eight tabs').toHaveLength(8);
      const seen = new Set<string>();
      for (const name of names) {
        await tabs.getByText(name, { exact: true }).click();
        await expect(tabs.getByText(name, { exact: true })).toHaveAttribute(
          'aria-selected',
          'true',
        );
        await expect(page.getByRole('tablist').first().locator('[aria-selected=true]')).toHaveCount(
          1,
        );
        await page.waitForTimeout(200);
        await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
        await expect(page.getByText('Something went wrong')).toHaveCount(0);
        // Each tab shows something of its own, not the last tab's content.
        const body = (await page.getByRole('main').innerText()).replace(/\s+/g, ' ');
        expect(body.length, `${name}: has content`).toBeGreaterThan(80);
        seen.add(body);
        expect(pathOf(page)).toBe('/settings');
      }
      expect(seen.size, 'every tab shows different content').toBe(names.length);

      // A link such as the backup warning's opens a tab directly.
      for (const [id, name] of [
        ['devices', names[2]!],
        ['backups', names[6]!],
        ['kitchen', names[3]!],
      ] as const) {
        await page.goto(`/settings?tab=${id}`);
        await expect(tabs.getByText(name, { exact: true })).toHaveAttribute(
          'aria-selected',
          'true',
        );
      }
      // Leaving Settings from a tab other than the first still works.
      await nav(page).getByRole('link', { name: 'Dishes', exact: true }).click();
      await expectStaysAt(page, '/dishes', 'Dishes from a settings tab');
      expect(problems).toEqual([]);
    });

    test('a recipe opened under the wrong section moves to the right one once, then the top bar works', async ({
      page,
    }) => {
      await signIn(page);
      const problems: Problems = [];
      watch(page, problems);
      const s = seed;
      const moves: [string, string, string][] = [
        // [address asked for, where it should end up, heading]
        [`/recipes/${s.dishId}`, `/dishes/${s.dishId}/recipe`, s.dishName],
        [`/recipes/${s.dishId}/edit`, `/dishes/${s.dishId}/edit`, ''],
        [`/dishes/${s.prepId}/recipe`, `/recipes/${s.prepId}`, s.prepName],
        [`/dishes/${s.prepId}/edit`, `/recipes/${s.prepId}/edit`, ''],
        [`/recipes/${s.dishId}/card`, `/dishes/${s.dishId}/card`, s.dishName],
        [`/recipes/${s.dishId}?amount=4&unit=each`, `/dishes/${s.dishId}/recipe`, s.dishName],
      ];
      const wide = viewport.width > 600;
      const tabsAfterMove = (at: number) =>
        at > 0
          ? TABS.filter((t) => t.name === 'Recipes')
          : wide
            ? TABS
            : TABS.filter((t) => ['Recipes', 'Settings'].includes(t.name));
      for (const [at, [asked, lands, heading]] of moves.entries()) {
        // The first, every tab at a laptop's width (two at a phone's); the others, the one a person goes to next.
        for (const tab of tabsAfterMove(at)) {
          await page.goto('/');
          await page.goto(asked);
          await page.waitForURL((url) => url.pathname === lands, { timeout: 10_000 });
          await page.waitForTimeout(SETTLE_MS);
          expect(pathOf(page), `${asked}: moved once and stayed`).toBe(lands);
          if (heading) {
            await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
          } else {
            await expect(page.getByLabel('Recipe name', { exact: true })).toBeVisible();
          }
          if (asked.includes('amount=4')) {
            expect(new URL(page.url()).search, 'the amount asked for is kept').toBe(
              '?amount=4&unit=each',
            );
          }
          await nav(page).getByRole('link', { name: tab.name, exact: true }).click();
          await expectStaysAt(page, tab.path, `${asked} then ${tab.name}`);
        }
      }

      // The move replaces the entry: Back goes to where it came from, not to the wrong address.
      await page.goto('/menus');
      await page.goto(`/recipes/${s.dishId}`);
      await page.waitForURL((url) => url.pathname === `/dishes/${s.dishId}/recipe`);
      await page.goBack();
      await expectStaysAt(page, '/menus', 'Back after a moved link');

      // Moved from inside the app (as an old link followed in the same tab does).
      await page.goto('/recipes');
      await page.evaluate((path) => {
        history.pushState({}, '', path);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, `/recipes/${s.dishId}`);
      await page.waitForURL((url) => url.pathname === `/dishes/${s.dishId}/recipe`);
      await nav(page).getByRole('link', { name: 'Recipes', exact: true }).click();
      await expectStaysAt(page, '/recipes', 'Recipes after an in-app move');
      await page.getByRole('link', { name: seed.prepName }).first().click();
      await expectStaysAt(page, `/recipes/${s.prepId}`, 'a prep under Recipes is left alone');

      // Leaving by the book link, and by the dish link, right after being moved.
      await page.goto(`/recipes/${s.dishId}`);
      await page.getByRole('link', { name: '← The dish' }).click();
      await expectStaysAt(page, `/dishes/${s.dishId}`, 'dish link right after a move');
      await page.goto(`/dishes/${s.prepId}/recipe`);
      await page.getByRole('link', { name: '← The book' }).click();
      await expectStaysAt(page, '/recipes', 'book link right after a move');
      expect(problems).toEqual([]);
    });
  });

  test.describe(`a cook by PIN on a ${label}`, () => {
    test.use({ viewport });
    test.beforeEach(async ({ request }) => ensureKitchen(request));

    test('the pages a cook can open, the tabs, and the refusals', async ({ browser, baseURL }) => {
      const context = await browser.newContext({ baseURL, viewport });
      const page = await context.newPage();
      await signInCook(page, seed.cookName);
      const problems: Problems = [];
      watch(page, problems);
      const s = seed;
      const pages = cookPages(s);

      // A cook sees four tabs, not Ingredients or Settings.
      await expect(nav(page).getByRole('link')).toHaveText(COOK_TABS.map((tab) => tab.name));

      // Every page draws itself, and the tabs from every page: only the tabs a cook has.
      await inParallel(page, problems, Object.entries(pages), (tab, name, spec) =>
        everyTabFrom(tab, name, spec, COOK_TABS as unknown as typeof TABS),
      );

      // Ways back that a cook has.
      const steps: [string, { path: string; back: string; to: string }][] = [
        ['prep recipe', { path: pages['prep recipe']!.path, back: '← The book', to: '/recipes' }],
        ['dish card', { path: pages['dish card']!.path, back: '← Dishes', to: '/dishes' }],
        [
          'dish recipe',
          { path: pages['dish recipe']!.path, back: '← The dish', to: `/dishes/${s.dishId}` },
        ],
        [
          'dish print card',
          { path: pages['dish print card']!.path, back: '← The dish', to: `/dishes/${s.dishId}` },
        ],
        ['menu', { path: pages.menu!.path, back: '← Menus', to: '/menus' }],
        [
          'menu overview',
          { path: pages['menu overview']!.path, back: '← The menu', to: `/menus/${s.menuId}` },
        ],
      ];
      await inParallel(page, problems, steps, async (tab, name, step) => {
        await tab.goto(step.path);
        await tab.getByRole('main').getByRole('link', { name: step.back }).first().click();
        await expectStaysAt(tab, step.to, name);
      });

      // Settings: the refusal, nothing broken.
      await page.goto('/settings');
      await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
      await expect(
        page.getByText('Only chefs and administrators can change how the kitchen is set up.'),
      ).toBeVisible();
      await expect(page.getByRole('tab')).toHaveCount(0);

      // The ingredient list is readable, nothing more.
      await page.goto('/ingredients');
      await expect(page.getByRole('heading', { name: 'Ingredients', level: 1 })).toBeVisible();
      await expect(page.getByText('Something went wrong')).toHaveCount(0);
      await expect(page.getByText('Loading…')).toHaveCount(0);

      // The editors open for anyone, but saving a recipe says no, in words, and stays put.
      for (const path of [
        '/recipes/new',
        '/dishes/new',
        `/recipes/${s.prepId}/edit`,
        `/dishes/${s.dishId}/edit`,
      ]) {
        await page.goto(path);
        const name = page.getByLabel('Recipe name', { exact: true });
        await expect(name, `${path}: the editor`).toBeVisible();
        if (!path.endsWith('/new')) {
          await page.getByRole('button', { name: 'Save', exact: true }).click();
          await expect(
            page.getByText('Your role doesn’t allow that.'),
            `${path}: the refusal`,
          ).toBeVisible();
        }
        await page.waitForTimeout(SETTLE_MS);
        expect(pathOf(page), `${path}: stays put after a refused save`).toBe(path);
        await nav(page).getByRole('link', { name: 'Recipes', exact: true }).click();
        await expectStaysAt(page, '/recipes', `${path} then Recipes`);
      }

      // Back and forward as a cook.
      await page.goto('/dishes');
      await page
        .getByRole('link', { name: new RegExp(s.dishName) })
        .first()
        .click();
      await expectStaysAt(page, `/dishes/${s.dishId}`, 'cook opens a dish');
      await page.goBack();
      await expectStaysAt(page, '/dishes', 'cook back');
      await page.goForward();
      await expectStaysAt(page, `/dishes/${s.dishId}`, 'cook forward');

      // The section move, as a cook.
      for (const [asked, lands] of [
        [`/recipes/${s.dishId}`, `/dishes/${s.dishId}/recipe`],
        [`/dishes/${s.prepId}/recipe`, `/recipes/${s.prepId}`],
      ] as const) {
        await page.goto(asked);
        await page.waitForURL((url) => url.pathname === lands);
        await page.waitForTimeout(SETTLE_MS);
        expect(pathOf(page)).toBe(lands);
        await nav(page).getByRole('link', { name: 'Menus', exact: true }).click();
        await expectStaysAt(page, '/menus', `${asked} then Menus`);
      }
      // The two refused saves above are logged by the browser as 403s: expected,
      // and the only console errors ignored in this test.
      const refusals = problems.filter((line) =>
        /status of 403.*\/api\/recipes\/[0-9a-f-]{36}\)$/.test(line),
      );
      expect(refusals, 'one logged refusal for each refused save').toHaveLength(2);
      expect(problems.filter((line) => !refusals.includes(line))).toEqual([]);
      await context.close();
    });
  });
}

/**
 * Found by this file in 2.3.0: the fonts dish cards are drawn with were saved
 * with the rest of the offline cache and came back unusable, so after a few
 * reloads in several tabs every card and menu overview failed to open, until
 * the browser's data was cleared. They are never saved now.
 */
test('the dish card and the menu overview open again after reloads in several tabs', async ({
  page,
}) => {
  await signIn(page);
  const problems: Problems = [];
  const context = page.context();
  await Promise.all(
    [0, 1, 2, 3, 4].map(async () => {
      const tab = await context.newPage();
      watch(tab, problems);
      for (let round = 0; round < 8; round++) {
        for (const address of [`/dishes/${seed.dishId}/card`, `/menus/${seed.menuId}/overview`]) {
          await tab.goto(address);
          await expect(tab.getByRole('heading', { level: 1 })).not.toHaveText(
            'This page didn’t open',
          );
          await tab.waitForTimeout(600);
        }
      }
    }),
  );
  expect(problems).toEqual([]);
});

test('the kitchen is left as it was found', async ({ request }) => {
  // Nothing in this file switches a kitchen setting; it only adds recipes, a
  // menu, a prep line, a cook and tablets, as the other files do.
  await signedInApi(request);
  const kitchen = await (await request.get('/api/kitchen')).json();
  expect(kitchen.pinOnly).toBe('off');
  expect(CHEF.email).toBeTruthy();
});
