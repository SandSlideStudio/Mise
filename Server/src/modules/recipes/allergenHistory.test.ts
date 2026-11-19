import { beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { dishAllergenChanges, users } from '../../db/schema.js';
import { buildApp } from '../../app.js';
import { TEST_CONFIG, cookieFrom, setUpKitchen, useTestContext } from '../../test/harness.js';
import { recordAllergenChanges } from './allergenHistory.js';

const ctx = useTestContext();
let admin: Record<string, string>;

beforeEach(async () => {
  admin = { mise_session: await setUpKitchen(ctx.app) };
});

async function send(
  method: 'POST' | 'PATCH',
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
const patch = (url: string, payload: Record<string, unknown>) => send('PATCH', url, payload);

const line = (ref: Record<string, string>, value = 100) => ({
  sortOrder: 0,
  quantity: { value, unit: 'g' },
  ref,
});
const ingredient = (id: string) => line({ kind: 'ingredient', ingredientId: id });
const sub = (id: string) => line({ kind: 'recipe', recipeId: id });

/**
 * Celeriac in a stock, the stock in a velouté, the velouté in two dishes. A
 * third dish has none of it.
 */
async function kitchen() {
  const celeriac = await post('/api/ingredients', { name: 'Celeriac', baseUnit: 'g' });
  const butter = await post('/api/ingredients', {
    name: 'Butter',
    baseUnit: 'g',
    allergens: ['milk'],
  });
  const stock = await post('/api/recipes', {
    name: 'Stock',
    type: 'prep',
    yield: { value: 1, unit: 'kg' },
    components: [ingredient(celeriac.id)],
  });
  const veloute = await post('/api/recipes', {
    name: 'Velouté',
    type: 'prep',
    yield: { value: 1, unit: 'kg' },
    components: [sub(stock.id), ingredient(butter.id)],
  });
  const dish = (name: string, components: unknown[]) =>
    post('/api/recipes', {
      name,
      type: 'dish',
      yield: { value: 1, unit: 'each' },
      portions: 1,
      components,
    });
  const chicken = await dish('Chicken, velouté', [sub(veloute.id)]);
  const fish = await dish('Fish, velouté', [sub(veloute.id)]);
  const salad = await dish('Salad', [ingredient(butter.id)]);
  return { celeriac, butter, stock, veloute, chicken, fish, salad };
}

async function historyOf(id: string, cookies = admin) {
  const response = await ctx.app.inject({
    method: 'GET',
    url: `/api/recipes/${id}/allergen-history`,
    cookies,
  });
  expect(response.statusCode).toBe(200);
  return response.json<
    {
      changedAt: string;
      contains: string[];
      mayContain: string[];
      cause: string | null;
      changedBy: string | null;
    }[]
  >();
}

async function rowCount() {
  const [row] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(dishAllergenChanges);
  return row!.n;
}

describe('the allergen record of a dish', () => {
  it('starts with what a new dish contains', async () => {
    const { chicken } = await kitchen();
    const history = await historyOf(chicken.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      contains: ['milk'],
      mayContain: [],
      cause: null,
      changedBy: 'Escoffier',
    });
  });

  it('adds one line to each dish a change deep in a sub-recipe reaches, and none to the rest', async () => {
    const { celeriac, chicken, fish, salad } = await kitchen();
    await patch(`/api/ingredients/${celeriac.id}`, { mayContain: ['celery', 'mustard'] });

    for (const dish of [chicken, fish]) {
      const history = await historyOf(dish.id);
      expect(history).toHaveLength(2);
      // Newest first.
      expect(history[0]).toMatchObject({
        contains: ['milk'],
        mayContain: ['celery', 'mustard'],
        cause: 'Celeriac',
        changedBy: 'Escoffier',
      });
      expect(history[1]!.mayContain).toEqual([]);
    }
    expect(await historyOf(salad.id)).toHaveLength(1);

    // Contains now: the trace it was is no longer listed as a trace.
    await patch(`/api/ingredients/${celeriac.id}`, { allergens: ['celery'] });
    const [latest] = await historyOf(chicken.id);
    expect(latest).toMatchObject({ contains: ['milk', 'celery'], mayContain: ['mustard'] });
  });

  it('adds nothing when the allergens stay the same', async () => {
    const { celeriac, stock, chicken } = await kitchen();
    const before = await rowCount();
    await patch(`/api/ingredients/${celeriac.id}`, { notes: 'Peeled' });
    await patch(`/api/recipes/${stock.id}`, { name: 'Brown stock' });
    await patch(`/api/recipes/${chicken.id}`, { name: 'Chicken' });
    // Already in it through the butter: the dish says the same as before.
    await patch(`/api/recipes/${chicken.id}`, { declaredAllergens: ['milk'] });
    expect(await rowCount()).toBe(before);
  });

  it('names the sub-recipe that changed, and nothing for the dish itself', async () => {
    const { veloute, chicken } = await kitchen();
    await patch(`/api/recipes/${veloute.id}`, { mayContain: ['eggs'] });
    expect((await historyOf(chicken.id))[0]).toMatchObject({
      mayContain: ['eggs'],
      cause: 'Velouté',
    });

    await patch(`/api/recipes/${chicken.id}`, { declaredAllergens: ['sesame'] });
    expect((await historyOf(chicken.id))[0]).toMatchObject({
      contains: ['milk', 'sesame'],
      cause: null,
    });
  });

  it('records a sub-recipe taken out of a dish', async () => {
    const { celeriac, chicken } = await kitchen();
    await patch(`/api/recipes/${chicken.id}`, { components: [ingredient(celeriac.id)] });
    const history = await historyOf(chicken.id);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ contains: [], mayContain: [], cause: null });
  });

  it('gives a dish without a record its first line, once', async () => {
    const { chicken } = await kitchen();
    // A kitchen from before 2.4: dishes, and no record of them.
    await ctx.db.delete(dishAllergenChanges);
    expect(await rowCount()).toBe(0);

    // What the server does when it starts.
    expect(await ctx.db.transaction((tx) => recordAllergenChanges(tx))).toBe(3);
    const history = await historyOf(chicken.id);
    expect(history).toEqual([
      expect.objectContaining({ contains: ['milk'], cause: null, changedBy: null }),
    ]);
    expect(await ctx.db.transaction((tx) => recordAllergenChanges(tx))).toBe(0);
  });

  it('is written when the server starts', async () => {
    await kitchen();
    await ctx.db.delete(dishAllergenChanges);
    const again = await buildApp(TEST_CONFIG, { db: ctx.db, serveClient: false });
    await again.ready();
    await again.close();
    expect(await rowCount()).toBe(3);
  });

  it('starts for a dish made a dish later, and for a copy', async () => {
    const { butter } = await kitchen();
    const soup = await post('/api/recipes', {
      name: 'Soup',
      type: 'prep',
      yield: { value: 1, unit: 'kg' },
      components: [ingredient(butter.id)],
    });
    expect(await historyOf(soup.id)).toEqual([]);
    await patch(`/api/recipes/${soup.id}`, { type: 'dish', portions: 4 });
    expect(await historyOf(soup.id)).toHaveLength(1);
    const copy = await post(`/api/recipes/${soup.id}/duplicate`, { name: 'Soup two' });
    expect(await historyOf(copy.id)).toHaveLength(1);
  });

  it('forgets who made a change when they are removed, and keeps the change', async () => {
    const { celeriac, chicken } = await kitchen();
    await post('/api/users', {
      displayName: 'Ana',
      role: 'head_chef',
      email: 'ana@example.com',
      password: 'a-long-enough-password',
    });
    const signIn = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ana@example.com', password: 'a-long-enough-password' },
    });
    const ana = { mise_session: cookieFrom(signIn, 'mise_session')! };
    await send('PATCH', `/api/ingredients/${celeriac.id}`, { mayContain: ['celery'] }, ana);
    expect((await historyOf(chicken.id))[0]!.changedBy).toBe('Ana');

    await ctx.db.delete(users).where(eq(users.email, 'ana@example.com'));
    const [latest] = await historyOf(chicken.id);
    expect(latest).toMatchObject({ mayContain: ['celery'], changedBy: null, cause: 'Celeriac' });
  });

  it('goes with the dish', async () => {
    const { salad } = await kitchen();
    const response = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/recipes/${salad.id}`,
      cookies: admin,
    });
    expect(response.statusCode).toBe(204);
    const left = await ctx.db
      .select()
      .from(dishAllergenChanges)
      .where(eq(dishAllergenChanges.recipeId, salad.id));
    expect(left).toEqual([]);
  });

  it('can be read by a cook, and not without signing in', async () => {
    const { chicken } = await kitchen();
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
    const cook = { mise_session: cookieFrom(signIn, 'mise_session')! };
    expect(await historyOf(chicken.id, cook)).toHaveLength(1);

    const anonymous = await ctx.app.inject({
      method: 'GET',
      url: `/api/recipes/${chicken.id}/allergen-history`,
    });
    expect(anonymous.statusCode).toBe(401);
    const missing = await ctx.app.inject({
      method: 'GET',
      url: '/api/recipes/00000000-0000-4000-8000-000000000000/allergen-history',
      cookies: admin,
    });
    expect(missing.statusCode).toBe(404);
  });

  it('dates a menu overview by the latest change among its dishes', async () => {
    const { celeriac, chicken, salad } = await kitchen();
    const menu = await post('/api/menus', {
      name: 'Lunch',
      status: 'active',
      dishes: [chicken.id, salad.id],
    });
    await patch(`/api/ingredients/${celeriac.id}`, { mayContain: ['celery'] });
    const [latest] = await historyOf(chicken.id);

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/menus/${menu.id}/overview`,
      cookies: admin,
    });
    expect(response.statusCode).toBe(200);
    const overview = response.json();
    expect(overview.allergensAsOf).toBe(latest!.changedAt);
    expect(
      overview.dishes.find((d: { name: string }) => d.name === 'Chicken, velouté'),
    ).toMatchObject({ contains: ['milk'], mayContain: ['celery'] });
  });

  it('leaves out a dish whose allergens cannot be worked out', async () => {
    const { stock, chicken, fish } = await kitchen();
    await ctx.db.delete(dishAllergenChanges);
    // A loop the app would never save: the stock made with the dish it is in.
    await ctx.db.execute(
      sql`insert into recipe_component (recipe_id, quantity_base, quantity_entered, unit_entered, child_recipe_id)
          values (${stock.id}, 1, 1, 'g', ${chicken.id})`,
    );
    // Only the salad: no guess is written down for the other two.
    expect(await ctx.db.transaction((tx) => recordAllergenChanges(tx))).toBe(1);
    expect(await historyOf(chicken.id)).toEqual([]);
    expect(await historyOf(fish.id)).toEqual([]);
  });
});
