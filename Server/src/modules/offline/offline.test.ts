import { gunzipSync } from 'node:zlib';
import type * as BookModule from '../recipes/book.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unpackOfflineBundle, type OfflineBundle } from '@mise/contracts';
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
    url: '/api/offline/bundle',
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

  it('is refused without signing in', async () => {
    for (const url of ['/api/offline/bundle', '/api/offline/version']) {
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
    expect((await bundleFor(admin)).recipes.map((r) => r.name)).toContain('Renamed');
  });

  it('ignores prep ticks, which are kept current by live updates', async () => {
    await kitchenWith(1);
    const before = await version();
    await send('PUT', '/api/running/note', { text: 'Fish at ten' });
    expect(await version()).toBe(before);
  });

  it('differs between roles', async () => {
    cook = await signInCook();
    expect(await version(cook)).not.toBe(await version());
  });
});
