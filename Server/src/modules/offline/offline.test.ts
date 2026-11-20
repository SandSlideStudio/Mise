import { gunzipSync } from 'node:zlib';
import type * as BookModule from '../recipes/book.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bookRecipeFrom,
  unpackOfflineBundle,
  type DishCard,
  type OfflineBundle,
  type Recipe,
} from '@mise/contracts';
import { cookieFrom, setUpKitchen, useTestContext } from '../../test/harness.js';

// Counts how often the whole recipe book is read, the cost this exists to cut.
const bookLoads = vi.hoisted(() => ({ count: 0 }));
vi.mock('../recipes/book.js', async (importOriginal) => {
  const original = await importOriginal<typeof BookModule>();
  return {
    ...original,
    loadRecipeBook: (...args: Parameters<typeof original.loadRecipeBook>) => {
      bookLoads.count += 1;
      return original.loadRecipeBook(...args);
    },
  };
});

const ctx = useTestContext();
let admin: Record<string, string>;
let cook: Record<string, string>;

async function send(
  method: 'POST' | 'PATCH' | 'PUT',
  url: string,
  payload: Record<string, unknown>,
  cookies = admin,
) {
  const response = await ctx.app.inject({ method, url, payload, cookies });
  if (response.statusCode !== 200) {
    throw new Error(`${url} failed: ${response.statusCode} ${response.body}`);
  }
  return response.json();
}
const post = (url: string, payload: Record<string, unknown>) => send('POST', url, payload);

async function kitchenWith(dishes: number) {
  const station = await post('/api/stations', { name: 'Pass', sortOrder: 1 });
  const flour = await post('/api/ingredients', {
    name: 'Flour',
    baseUnit: 'g',
    allergens: ['gluten'],
    // Traces on the label: carried into every part of the bundle like the rest.
    mayContain: ['sesame'],
    vegan: true,
    allergenDetails: { gluten: ['wheat'], nuts: [] },
  });
  const base = await post('/api/recipes', {
    name: 'Base',
    type: 'prep',
    stationId: station.id,
    yield: { value: 1, unit: 'kg' },
    components: [
      {
        sortOrder: 0,
        quantity: { value: 500, unit: 'g' },
        ref: { kind: 'ingredient', ingredientId: flour.id },
      },
    ],
  });
  const ids: string[] = [];
  for (let i = 0; i < dishes; i += 1) {
    const dish = await post('/api/recipes', {
      name: `Dish ${String(i).padStart(2, '0')}`,
      type: 'dish',
      yield: { value: 4, unit: 'each' },
      portions: 4,
      course: 'middle',
      components: [
        {
          sortOrder: 0,
          quantity: { value: 100, unit: 'g' },
          ref: { kind: 'recipe', recipeId: base.id },
        },
        {
          sortOrder: 1,
          quantity: { value: 10, unit: 'g' },
          ref: { kind: 'ingredient', ingredientId: flour.id },
        },
      ],
    });
    ids.push(dish.id);
  }
  await post('/api/menus', { name: 'Autumn', status: 'active', dishes: ids.slice(0, 3) });
  await send('PUT', '/api/checklist', { items: [{ stationId: station.id, name: 'Stock' }] });
  return { base, ids };
}

async function signInCook() {
  await post('/api/users', {
    displayName: 'Marco',
    role: 'cook',
    email: 'marco@example.com',
    password: 'a-long-enough-password',
  });
  const signIn = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'marco@example.com', password: 'a-long-enough-password' },
  });
  return { mise_session: cookieFrom(signIn, 'mise_session')! };
}

beforeEach(async () => {
  admin = { mise_session: await setUpKitchen(ctx.app) };
});

const bundleFor = async (cookies: Record<string, string>) => {
  const response = await ctx.app.inject({
    method: 'GET',
    url: '/api/offline/bundle?format=2',
    cookies,
    headers: { 'accept-encoding': 'gzip' },
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-encoding']).toBe('gzip');
  // inject hands the body over as sent.
  return JSON.parse(gunzipSync(response.rawPayload).toString()) as OfflineBundle;
};

/** The endpoint each query key is filled from, as useLoadAhead used to ask for it. */
function pathFor(key: readonly unknown[]): string {
  const [name, id] = key as [string, string | undefined];
  const paths: Record<string, string> = {
    stations: '/api/stations',
    checklist: '/api/checklist',
    dishes: '/api/dishes',
    menus: '/api/menus',
    'dish-card-settings': '/api/dish-cards/settings',
    recipes: '/api/recipes',
    recipe: `/api/recipes/${id}`,
    'recipe-expanded': `/api/recipes/${id}/expanded`,
    'recipe-allergens': `/api/recipes/${id}/allergens`,
    'recipe-used-by': `/api/recipes/${id}/used-by`,
    'recipe-allergen-history': `/api/recipes/${id}/allergen-history`,
    'dish-card': `/api/recipes/${id}/card`,
    menu: `/api/menus/${id}`,
    'menu-overview': `/api/menus/${id}/overview`,
  };
  return paths[name]!;
}

async function expectSameAsOneByOne(cookies: Record<string, string>) {
  const entries = unpackOfflineBundle(await bundleFor(cookies));
  for (const [key, data] of entries) {
    const single = await ctx.app.inject({ method: 'GET', url: pathFor(key), cookies });
    expect(single.statusCode, JSON.stringify(key)).toBe(200);
    // The used-by list has no order of its own.
    const sort = (value: unknown) =>
      key[0] === 'recipe-used-by'
        ? [...(value as { id: string }[])].sort((a, b) => a.id.localeCompare(b.id))
        : value;
    expect(sort(data), JSON.stringify(key)).toEqual(sort(single.json()));
  }
  return entries;
}

describe('the bundle for offline use', () => {
  it('holds exactly what each endpoint gives a chef', async () => {
    await kitchenWith(4);
    const entries = await expectSameAsOneByOne(admin);
    const names = new Set(entries.map(([key]) => key[0]));
    expect([...names].sort()).toEqual(
      [
        'checklist',
        'dish-card',
        'dish-card-settings',
        'dishes',
        'menu',
        'menu-overview',
        'menus',
        'recipe',
        'recipe-allergen-history',
        'recipe-allergens',
        'recipe-expanded',
        'recipe-used-by',
        'recipes',
        'stations',
      ].sort(),
    );
    // 5 recipes, 4 of them dishes.
    expect(entries.filter(([key]) => key[0] === 'recipe-expanded')).toHaveLength(5);
    expect(entries.filter(([key]) => key[0] === 'dish-card')).toHaveLength(4);
    expect(entries.filter(([key]) => key[0] === 'recipe-allergen-history')).toHaveLength(4);
    const overview = entries.find(([key]) => key[0] === 'menu-overview')![1] as {
      dishes: { mayContain: string[] }[];
      allergensAsOf: string | null;
    };
    expect(overview.dishes[0]!.mayContain).toEqual(['sesame']);
    expect(overview.allergensAsOf).not.toBeNull();
  });

  it('holds exactly what each endpoint gives a cook, and nothing they would be refused', async () => {
    const { ids } = await kitchenWith(2);
    cook = await signInCook();
    await expectSameAsOneByOne(cook);

    await send('PATCH', '/api/dish-cards/settings', { access: 'managers' });
    const entries = await expectSameAsOneByOne(cook);
    const names = new Set(entries.map(([key]) => key[0]));
    expect(names.has('dish-card')).toBe(false);
    expect(names.has('menu-overview')).toBe(false);
    // They still read the recipes and the menus, as one by one.
    expect(names.has('recipe-expanded')).toBe(true);
    expect(names.has('menu')).toBe(true);

    const refused = await ctx.app.inject({
      method: 'GET',
      url: `/api/recipes/${ids[0]}/card`,
      cookies: cook,
    });
    expect(refused.statusCode).toBe(403);
    // A chef is still given them.
    expect(
      unpackOfflineBundle(await bundleFor(admin)).some(([key]) => key[0] === 'dish-card'),
    ).toBe(true);
  });

  it('holds exactly what each endpoint gives for cups, ounces and lines in the same place', async () => {
    const station = await post('/api/stations', { name: 'Pass', sortOrder: 1 });
    const milk = await post('/api/ingredients', {
      name: 'Milk',
      baseUnit: 'ml',
      allergens: ['milk'],
      vegan: false,
    });
    const butter = await post('/api/ingredients', {
      name: 'Butter',
      baseUnit: 'g',
      allergens: ['milk'],
      vegan: false,
    });
    const salt = await post('/api/ingredients', { name: 'Salt', baseUnit: 'g', vegan: true });
    const sauce = await post('/api/recipes', {
      name: 'Sauce',
      type: 'prep',
      stationId: station.id,
      // Kept in grams to four decimals: not what converting a pound gives.
      yield: { value: 1.3, unit: 'lb' },
      components: [
        {
          sortOrder: 0,
          quantity: { value: 1.5, unit: 'cup' },
          ref: { kind: 'ingredient', ingredientId: milk.id },
        },
        {
          sortOrder: 1,
          quantity: { value: 3, unit: 'oz' },
          ref: { kind: 'ingredient', ingredientId: butter.id },
        },
        // Two lines in the same place.
        {
          sortOrder: 1,
          quantity: { value: 1, unit: 'tsp' },
          ref: { kind: 'ingredient', ingredientId: salt.id },
        },
      ],
    });
    await post('/api/recipes', {
      name: 'Dish',
      type: 'dish',
      yield: { value: 1, unit: 'each' },
      portions: 1,
      components: [
        {
          sortOrder: 0,
          quantity: { value: 2, unit: 'oz' },
          ref: { kind: 'recipe', recipeId: sauce.id },
        },
      ],
    });

    const bundle = await bundleFor(admin);
    const entry = bundle.recipeEntries.find((e) => e.recipe.id === sauce.id)!;
    expect(entry.base?.length).toBeGreaterThan(0);
    await expectSameAsOneByOne(admin);
    cook = await signInCook();
    await expectSameAsOneByOne(cook);
  });

  it('sends each recipe and ingredient once, however many dishes use them', async () => {
    const { base } = await kitchenWith(12);
    const sent = JSON.stringify(await bundleFor(admin));
    const flour = (
      await ctx.app.inject({ method: 'GET', url: '/api/ingredients', cookies: admin })
    ).json<{ id: string }[]>()[0]!;
    // The ingredient is in thirteen recipes, and its id in the bundle once.
    expect(sent.split(flour.id)).toHaveLength(2);
    // The base is in twelve dishes, and sent once, not inside each of them.
    expect(sent.split('"Base"')).toHaveLength(2);
    expect(sent).not.toContain('"lines"');
    expect(base.id).toBeTruthy();
  });

  it('takes what the server sent as it is over what it would work out', async () => {
    const { base, ids } = await kitchenWith(1);
    const bundle = await bundleFor(admin);
    const dish = bundle.recipeEntries.find((e) => e.recipe.id === ids[0])!;
    const sauce = bundle.recipeEntries.find((e) => e.recipe.id === base.id)!;
    const dataOf = (key: unknown[]) =>
      unpackOfflineBundle(bundle).find(([k]) => JSON.stringify(k) === JSON.stringify(key))?.[1];

    const { settings: _settings, ...card } = dataOf(['dish-card', dish.recipe.id]) as DishCard;
    delete dish.cardAttention;
    dish.card = { ...card, kitchenName: 'As sent' };
    sauce.book = { ...bookRecipeFrom(sauce.recipe as Recipe), components: [] };
    dish.recipe.components[0]!.displayName = 'Named as sent';

    expect(dataOf(['dish-card', dish.recipe.id])).toMatchObject({ kitchenName: 'As sent' });
    expect(dataOf(['recipe-expanded', base.id, {}])).toMatchObject({ lines: [] });
    expect((dataOf(['recipe', dish.recipe.id]) as Recipe).components[0]!.displayName).toBe(
      'Named as sent',
    );
  });

  it('is refused to an app that reads another format', async () => {
    for (const url of ['/api/offline/bundle', '/api/offline/bundle?format=1']) {
      const response = await ctx.app.inject({ method: 'GET', url, cookies: admin });
      expect(response.statusCode).toBe(410);
      expect(response.json().error.code).toBe('bundle_format');
    }
  });

  it('is refused without signing in', async () => {
    for (const url of ['/api/offline/bundle?format=2', '/api/offline/version']) {
      expect((await ctx.app.inject({ method: 'GET', url })).statusCode).toBe(401);
    }
  });

  it('reads the recipe book once, however many recipes there are', async () => {
    await kitchenWith(12);
    bookLoads.count = 0;
    await bundleFor(admin);
    expect(bookLoads.count).toBe(1);
    // The same again, with nothing changed: built once for every tablet.
    await bundleFor(admin);
    expect(bookLoads.count).toBe(1);
  });

  it('asks the database no more often for twelve dishes than for three', async () => {
    const { base } = await kitchenWith(3);
    const small = await ctx.countStatements(() => bundleFor(admin));
    for (let i = 3; i < 12; i += 1) {
      await post('/api/recipes', {
        name: `Extra ${i}`,
        type: 'dish',
        yield: { value: 4, unit: 'each' },
        portions: 4,
        components: [
          {
            sortOrder: 0,
            quantity: { value: 100, unit: 'g' },
            ref: { kind: 'recipe', recipeId: base.id },
          },
        ],
      });
    }
    const large = await ctx.countStatements(() => bundleFor(admin));
    expect(large.result.dishes).toHaveLength(12);
    expect(large.statements).toBeLessThanOrEqual(small.statements);
  });

  it('is built once for a chef and a cook taking turns', async () => {
    await kitchenWith(3);
    cook = await signInCook();
    bookLoads.count = 0;
    const versions = [];
    for (const who of [admin, cook, admin, cook]) versions.push((await bundleFor(who)).version);
    expect(bookLoads.count).toBe(1);
    // Each still says whose it is.
    expect(versions[0]).not.toBe(versions[1]);
    expect(versions[0]).toBe(versions[2]);
  });
});

describe('the data version', () => {
  const version = async (cookies = admin) =>
    (await ctx.app.inject({ method: 'GET', url: '/api/offline/version', cookies })).json<{
      version: string;
    }>().version;

  it('changes on a recipe edit and not on reading', async () => {
    const { ids } = await kitchenWith(2);
    const before = await version();

    await bundleFor(admin);
    await ctx.app.inject({ method: 'GET', url: `/api/recipes/${ids[0]}`, cookies: admin });
    await ctx.app.inject({ method: 'GET', url: '/api/recipes', cookies: admin });
    expect(await version()).toBe(before);

    await send('PATCH', `/api/recipes/${ids[0]}`, { name: 'Renamed' });
    const after = await version();
    expect(after).not.toBe(before);
    expect((await bundleFor(admin)).version).toBe(after);
    expect((await bundleFor(admin)).recipeEntries.map((e) => e.recipe.name)).toContain('Renamed');
  });

  it('ignores prep ticks, which are kept current by live updates', async () => {
    await kitchenWith(1);
    const before = await version();
    await send('PUT', '/api/running/note', { text: 'Fish at ten' });
    expect(await version()).toBe(before);
  });

  it('ignores adding from the checklist, and moves when the checklist is saved', async () => {
    await kitchenWith(1);
    await send('PATCH', '/api/kitchen', { prepChecklist: true });
    const saved = await send('PUT', '/api/checklist', {
      items: [{ stationId: null, name: 'Jus' }],
    });
    const before = await version();
    const [item] = (saved as { items: { id: string }[] }).items;
    await send('POST', '/api/checklist/add', { ids: [item!.id] });
    expect(await version()).toBe(before);
    await send('PUT', '/api/checklist', { items: [] });
    expect(await version()).not.toBe(before);
  });

  it('moves when someone is renamed or removed, so their old name leaves the bundle', async () => {
    await kitchenWith(1);
    const chef = await post('/api/users', {
      displayName: 'Gusteau',
      role: 'sous_chef',
      email: 'gusteau@example.com',
      password: 'a-long-enough-password',
    });
    const signIn = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'gusteau@example.com', password: 'a-long-enough-password' },
    });
    const flour = (
      await ctx.app.inject({ method: 'GET', url: '/api/ingredients', cookies: admin })
    ).json<{ id: string; name: string }[]>()[0]!;
    // Their name goes on every dish's allergen record.
    await send(
      'PATCH',
      `/api/ingredients/${flour.id}`,
      { allergens: ['gluten', 'milk'] },
      {
        mise_session: cookieFrom(signIn, 'mise_session')!,
      },
    );
    expect(JSON.stringify(await bundleFor(admin))).toContain('Gusteau');

    await send('PATCH', `/api/users/${chef.id}`, { displayName: 'Auguste' });
    const renamed = JSON.stringify(await bundleFor(admin));
    expect(renamed).not.toContain('Gusteau');
    expect(renamed).toContain('Auguste');

    const removed = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/users/${chef.id}`,
      cookies: admin,
    });
    expect(removed.statusCode).toBe(204);
    expect(JSON.stringify(await bundleFor(admin))).not.toContain('Auguste');
  });

  it('differs between roles', async () => {
    cook = await signInCook();
    expect(await version(cook)).not.toBe(await version());
  });
});
