import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { recipes } from '../../db/schema.js';
import { cookieFrom, setUpKitchen, useTestContext } from '../../test/harness.js';

const ctx = useTestContext();
let admin: Record<string, string>;

beforeEach(async () => {
  admin = { mise_session: await setUpKitchen(ctx.app) };
});

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
  cookies = admin,
) {
  return ctx.app.inject({ method, url, payload, cookies });
}

async function ok(method: 'POST' | 'PATCH' | 'GET', url: string, payload?: object) {
  const response = await call(method, url, payload);
  if (response.statusCode !== 200) {
    throw new Error(`${method} ${url}: ${response.statusCode} ${response.body}`);
  }
  return response.json();
}

async function dish(name: string, course: string | null, allergens: string[] = []) {
  const ingredient = await ok('POST', '/api/ingredients', {
    name: `${name} base`,
    baseUnit: 'g',
    allergens,
    vegan: true,
  });
  const sauce = await ok('POST', '/api/recipes', {
    name: `${name} saus`,
    type: 'prep',
    yield: { value: 1, unit: 'kg' },
    components: [
      {
        sortOrder: 0,
        quantity: { value: 100, unit: 'g' },
        ref: { kind: 'ingredient', ingredientId: ingredient.id },
      },
    ],
  });
  return ok('POST', '/api/recipes', {
    name,
    type: 'dish',
    yield: { value: 10, unit: 'each' },
    portions: 10,
    course,
    components: [
      {
        sortOrder: 0,
        quantity: { value: 50, unit: 'g' },
        ref: { kind: 'recipe', recipeId: sauce.id },
      },
    ],
  });
}

describe('menus', () => {
  it('keep their dishes in course order, then in the order the chef gave', async () => {
    const dessert = await dish('Tarte tatin', 'dessert');
    const middle = await dish('Luchtige Mais', 'middle', ['mustard']);
    const starter = await dish('Oester', 'starter', ['molluscs']);
    const loose = await dish('Brood', null, ['gluten']);

    const menu = await ok('POST', '/api/menus', {
      name: 'Herfstmenu',
      dishes: [dessert.id, loose.id, middle.id, starter.id],
    });
    expect(menu.dishes.map((d: { name: string }) => d.name)).toEqual([
      'Oester',
      'Luchtige Mais',
      'Tarte tatin',
      'Brood',
    ]);
    expect(menu).toMatchObject({ status: 'draft', dishCount: 4, cardsPrintedAt: null });

    const list = await ok('GET', '/api/menus');
    expect(list).toEqual([expect.objectContaining({ name: 'Herfstmenu', dishCount: 4 })]);
  });

  it('only take dishes, and refuse a second menu with the same name', async () => {
    const tatin = await dish('Tarte tatin', 'dessert');
    const [sauce] = await ctx.db
      .select({ id: recipes.id })
      .from(recipes)
      .where(eq(recipes.name, 'Tarte tatin saus'));

    const wrong = await call('POST', '/api/menus', { name: 'Fout', dishes: [sauce!.id] });
    expect(wrong.statusCode).toBe(400);

    await ok('POST', '/api/menus', { name: 'Lunch', dishes: [tatin.id] });
    expect((await call('POST', '/api/menus', { name: 'lunch' })).statusCode).toBe(409);
  });

  it('change, copy and go', async () => {
    const tatin = await dish('Tarte tatin', 'dessert');
    const menu = await ok('POST', '/api/menus', { name: 'Herfst', dishes: [tatin.id] });

    const changed = await ok('PATCH', `/api/menus/${menu.id}`, { status: 'active', dishes: [] });
    expect(changed).toMatchObject({ status: 'active', dishCount: 0 });

    await ok('PATCH', `/api/menus/${menu.id}`, { dishes: [tatin.id] });
    const copy = await ok('POST', `/api/menus/${menu.id}/duplicate`, { name: 'Winter' });
    expect(copy).toMatchObject({ name: 'Winter', status: 'draft', dishCount: 1 });

    expect((await call('DELETE', `/api/menus/${menu.id}`)).statusCode).toBe(204);
    expect((await call('GET', `/api/menus/${menu.id}`)).statusCode).toBe(404);
  });

  it('lose a dish that is deleted from the book', async () => {
    const tatin = await dish('Tarte tatin', 'dessert');
    const menu = await ok('POST', '/api/menus', { name: 'Herfst', dishes: [tatin.id] });
    await call('DELETE', `/api/recipes/${tatin.id}`);
    expect((await ok('GET', `/api/menus/${menu.id}`)).dishCount).toBe(0);
  });

  it('say which dishes changed after the cards were last printed', async () => {
    const tatin = await dish('Tarte tatin', 'dessert');
    const oester = await dish('Oester', 'starter');
    const menu = await ok('POST', '/api/menus', { name: 'Herfst', dishes: [tatin.id, oester.id] });
    expect(menu.dishes.every((d: { changedSinceCards: boolean }) => d.changedSinceCards)).toBe(
      true,
    );

    const printed = await ok('POST', `/api/menus/${menu.id}/cards-printed`);
    expect(printed.dishes.some((d: { changedSinceCards: boolean }) => d.changedSinceCards)).toBe(
      false,
    );

    // Changing a sub-recipe counts as changing the dish.
    const [sauce] = await ctx.db
      .select({ id: recipes.id })
      .from(recipes)
      .where(eq(recipes.name, 'Oester saus'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await ok('PATCH', `/api/recipes/${sauce!.id}`, { storage: 'Op ijs' });

    const after = await ok('GET', `/api/menus/${menu.id}`);
    const changed = Object.fromEntries(
      after.dishes.map((d: { name: string; changedSinceCards: boolean }) => [
        d.name,
        d.changedSinceCards,
      ]),
    );
    expect(changed).toEqual({ Oester: true, 'Tarte tatin': false });
  });
});

describe('the allergen overview', () => {
  it('lists every dish with everything in it, in menu order', async () => {
    const tatin = await dish('Tarte tatin', 'dessert', ['milk', 'gluten']);
    const oester = await dish('Oester', 'starter', ['molluscs']);
    const menu = await ok('POST', '/api/menus', { name: 'Herfst', dishes: [tatin.id, oester.id] });

    const overview = await ok('GET', `/api/menus/${menu.id}/overview`);
    expect(overview.menu.name).toBe('Herfst');
    expect(overview.dishes).toEqual([
      expect.objectContaining({ name: 'Oester', contains: ['molluscs'], vegan: 'yes' }),
      expect.objectContaining({ name: 'Tarte tatin', contains: ['gluten', 'milk'] }),
    ]);
    expect(overview.settings).toMatchObject({ theme: 'day' });
  });

  it('follows who may open dish cards', async () => {
    const menu = await ok('POST', '/api/menus', { name: 'Herfst' });
    await ok('POST', '/api/users', {
      displayName: 'Marco',
      role: 'cook',
      email: 'marco@example.com',
      password: 'a-long-enough-password',
    });
    const signIn = await call('POST', '/api/auth/login', {
      email: 'marco@example.com',
      password: 'a-long-enough-password',
    });
    const cook = { mise_session: cookieFrom(signIn, 'mise_session')! };

    expect((await call('GET', `/api/menus/${menu.id}`, undefined, cook)).statusCode).toBe(200);
    expect((await call('GET', `/api/menus/${menu.id}/overview`, undefined, cook)).statusCode).toBe(
      200,
    );
    expect((await call('POST', '/api/menus', { name: 'Nee' }, cook)).statusCode).toBe(403);

    await call('PATCH', '/api/dish-cards/settings', { access: 'managers' });
    expect((await call('GET', `/api/menus/${menu.id}/overview`, undefined, cook)).statusCode).toBe(
      403,
    );
  });
});
