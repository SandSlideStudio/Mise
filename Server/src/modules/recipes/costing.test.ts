import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import { cookieFrom, setUpKitchen, useTestContext } from '../../test/harness.js';

/**
 * Food cost over the API: worked out right, and never shown to a cook,
 * whichever way they ask, the offline bundle included.
 */

const ctx = useTestContext();
let admin: Record<string, string>;

async function call(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: object,
  cookies = admin,
) {
  return ctx.app.inject({ method, url, payload, cookies });
}

async function ok(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: object,
  cookies = admin,
) {
  const response = await call(method, url, payload, cookies);
  if (response.statusCode !== 200) {
    throw new Error(`${method} ${url}: ${response.statusCode} ${response.body}`);
  }
  return response.json();
}

const ingredientLine = (id: string, value: number, unit: string) => ({
  sortOrder: 0,
  quantity: { value, unit },
  ref: { kind: 'ingredient', ingredientId: id },
});
const recipeLine = (id: string, value: number, unit: string) => ({
  sortOrder: 1,
  quantity: { value, unit },
  ref: { kind: 'recipe', recipeId: id },
});

/**
 * A stock of bones (€4 for 2 kg) and unpriced water goes into a sauce with
 * cream (€3.20 a litre); 100 ml of the sauce and two eggs (€0.30 each) make
 * one plate, sold at €10.90 including 9 % VAT.
 */
async function pricedKitchen() {
  const bones = await ok('POST', '/api/ingredients', {
    name: 'Bones',
    baseUnit: 'g',
    price: { amount: 4, quantity: { value: 2, unit: 'kg' } },
  });
  const water = await ok('POST', '/api/ingredients', { name: 'Water', baseUnit: 'ml' });
  const cream = await ok('POST', '/api/ingredients', {
    name: 'Cream',
    baseUnit: 'ml',
    allergens: ['milk'],
    price: { amount: 3.2, quantity: { value: 1, unit: 'l' } },
  });
  const eggs = await ok('POST', '/api/ingredients', {
    name: 'Eggs',
    baseUnit: 'each',
    price: { amount: 9, quantity: { value: 30, unit: 'each' } },
  });
  const stock = await ok('POST', '/api/recipes', {
    name: 'Stock',
    type: 'prep',
    yield: { value: 2, unit: 'l' },
    components: [ingredientLine(bones.id, 2, 'kg'), ingredientLine(water.id, 3, 'l')],
  });
  // 500 ml stock (€1) and 500 ml cream (€1.60): €2.60 a litre.
  const sauce = await ok('POST', '/api/recipes', {
    name: 'Sauce',
    type: 'prep',
    yield: { value: 1, unit: 'l' },
    components: [recipeLine(stock.id, 500, 'ml'), ingredientLine(cream.id, 500, 'ml')],
  });
  // 100 ml sauce (€0.26) and two eggs (€0.60): €0.86 a plate.
  const dish = await ok('POST', '/api/recipes', {
    name: 'Eggs in sauce',
    type: 'dish',
    yield: { value: 1, unit: 'each' },
    portions: 1,
    sellPrice: 10.9,
    components: [recipeLine(sauce.id, 100, 'ml'), ingredientLine(eggs.id, 2, 'each')],
  });
  const menu = await ok('POST', '/api/menus', { name: 'Lunch', dishes: [dish.id] });
  return { bones, water, cream, eggs, stock, sauce, dish, menu };
}

async function signInCook() {
  await ok('POST', '/api/users', {
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

describe('ingredient prices', () => {
  it('are kept as entered, with the cost of a usable gram worked out', async () => {
    const onion = await ok('POST', '/api/ingredients', {
      name: 'Onion',
      baseUnit: 'g',
      yieldPercent: 80,
      price: { amount: 12.5, quantity: { value: 5, unit: 'kg' } },
    });
    expect(onion.price).toMatchObject({ amount: 12.5, quantity: { value: 5, unit: 'kg' } });
    // 5 kg, 4 kg of it usable: €0.003125 a gram.
    expect(onion.price.perBase).toBeCloseTo(0.003125);
    expect(onion.price.updatedAt).not.toBeNull();
    expect(onion.yieldPercent).toBe(80);
  });

  it('say so when the purchase unit needs a density that is missing', async () => {
    const oil = await ok('POST', '/api/ingredients', {
      name: 'Oil',
      baseUnit: 'g',
      price: { amount: 4.6, quantity: { value: 1, unit: 'l' } },
    });
    expect(oil.price.perBase).toBeNull();
    const withDensity = await ok('PATCH', `/api/ingredients/${oil.id}`, { densityGPerMl: 0.92 });
    expect(withDensity.price.perBase).toBeCloseTo(0.005);
  });

  it('are unknown until entered, and can be cleared again', async () => {
    const salt = await ok('POST', '/api/ingredients', { name: 'Salt', baseUnit: 'g' });
    expect(salt.price).toBeNull();
    const priced = await ok('PATCH', `/api/ingredients/${salt.id}`, {
      price: { amount: 1, quantity: { value: 1, unit: 'kg' } },
    });
    expect(priced.price.amount).toBe(1);
    const cleared = await ok('PATCH', `/api/ingredients/${salt.id}`, { price: null });
    expect(cleared.price).toBeNull();
  });

  it('change only the price date when only the price changes, so cards need no reprint', async () => {
    const butter = await ok('POST', '/api/ingredients', {
      name: 'Butter',
      baseUnit: 'g',
      allergens: ['milk'],
      price: { amount: 5, quantity: { value: 1, unit: 'kg' } },
    });
    const same = await ok('PATCH', `/api/ingredients/${butter.id}`, {
      name: 'Butter',
      allergens: ['milk'],
      price: { amount: 5, quantity: { value: 1, unit: 'kg' } },
    });
    expect(same.price.updatedAt).toBe(butter.price.updatedAt);
    expect(same.updatedAt).toBe(butter.updatedAt);

    const dearer = await ok('PATCH', `/api/ingredients/${butter.id}`, {
      name: 'Butter',
      allergens: ['milk'],
      price: { amount: 6, quantity: { value: 1, unit: 'kg' } },
    });
    expect(dearer.price.updatedAt).not.toBe(butter.price.updatedAt);
    expect(dearer.updatedAt).toBe(butter.updatedAt);

    const renamed = await ok('PATCH', `/api/ingredients/${butter.id}`, { name: 'Salted butter' });
    expect(renamed.updatedAt).not.toBe(butter.updatedAt);
  });

  it('refuse a purchase of nothing', async () => {
    const response = await call('POST', '/api/ingredients', {
      name: 'Air',
      baseUnit: 'g',
      price: { amount: 1, quantity: { value: 0, unit: 'kg' } },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('the cost of a recipe', () => {
  it('follows every sub-recipe and names what has no price', async () => {
    const { sauce, water } = await pricedKitchen();
    const expanded = await ok('GET', `/api/recipes/${sauce.id}/expanded`);
    expect(expanded.cost.currency).toBe('EUR');
    expect(expanded.cost.total).toBeCloseTo(2.6);
    expect(expanded.cost.perBase).toBeCloseTo(0.0026);
    expect(expanded.cost.perPortion).toBeNull();
    expect(expanded.cost.gaps).toEqual([
      { kind: 'ingredient', id: water.id, name: 'Water', reason: 'no_price' },
    ]);
  });

  it('is the cost of what the scaler asked for', async () => {
    const { sauce } = await pricedKitchen();
    const fiveLitres = await ok(
      'GET',
      `/api/recipes/${sauce.id}/expanded?yieldValue=5&yieldUnit=l`,
    );
    expect(fiveLitres.cost.total).toBeCloseTo(13);
    expect(fiveLitres.cost.perBase).toBeCloseTo(0.0026);
  });

  it('gives a dish its cost per portion and food cost after VAT', async () => {
    const { dish } = await pricedKitchen();
    const expanded = await ok('GET', `/api/recipes/${dish.id}/expanded`);
    expect(expanded.recipe.sellPrice).toBe(10.9);
    expect(expanded.cost.perPortion).toBeCloseTo(0.86);
    // €10.90 with 9 % VAT is €10 to the house.
    expect(expanded.cost.foodCostPercent).toBeCloseTo(8.6);

    await ok('PATCH', '/api/kitchen', { foodVatPercent: 0, currency: 'CHF' });
    const noVat = await ok('GET', `/api/recipes/${dish.id}/expanded?portions=10`);
    expect(noVat.cost.currency).toBe('CHF');
    expect(noVat.cost.total).toBeCloseTo(8.6);
    expect(noVat.cost.perPortion).toBeCloseTo(0.86);
    expect(noVat.cost.foodCostPercent).toBeCloseTo((0.86 / 10.9) * 100);
  });

  it('keeps a selling price for a dish, changed and cleared like any field', async () => {
    const { dish } = await pricedKitchen();
    const dearer = await ok('PATCH', `/api/recipes/${dish.id}`, { sellPrice: 12 });
    expect(dearer.sellPrice).toBe(12);
    const unsold = await ok('PATCH', `/api/recipes/${dish.id}`, { sellPrice: null });
    expect(unsold.sellPrice).toBeNull();
    const copy = await ok('POST', `/api/recipes/${dish.id}/duplicate`, { name: 'Copy' });
    expect(copy.sellPrice).toBeNull();
  });
});

describe('the cost of a menu', () => {
  it('gives each dish its cost and food cost, and the averages', async () => {
    const { menu, eggs } = await pricedKitchen();
    const cheap = await ok('POST', '/api/recipes', {
      name: 'One egg',
      type: 'dish',
      yield: { value: 1, unit: 'each' },
      portions: 1,
      components: [ingredientLine(eggs.id, 1, 'each')],
    });
    const both = await ok('PATCH', `/api/menus/${menu.id}`, {
      dishes: [...menu.dishes.map((d: { recipeId: string }) => d.recipeId), cheap.id],
    });
    expect(both.dishes[0].cost).toMatchObject({ sellPrice: 10.9, gaps: 1 });
    expect(both.dishes[0].cost.perPortion).toBeCloseTo(0.86);
    expect(both.dishes[1].cost).toMatchObject({ sellPrice: null, foodCostPercent: null, gaps: 0 });

    const read = await ok('GET', `/api/menus/${menu.id}`);
    expect(read.cost.currency).toBe('EUR');
    expect(read.cost.averagePerPortion).toBeCloseTo((0.86 + 0.3) / 2);
    // Only the dish with a selling price counts towards the food cost.
    expect(read.cost.averageFoodCostPercent).toBeCloseTo(8.6);
    expect(read.cost.incomplete).toBe(true);
  });
});

describe('a cook', () => {
  it('gets no cost fields anywhere', async () => {
    const { bones, sauce, dish, menu } = await pricedKitchen();
    const cook = await signInCook();

    const list = await ok('GET', '/api/ingredients', undefined, cook);
    expect(list.length).toBeGreaterThan(0);
    for (const ingredient of list) expect(ingredient).not.toHaveProperty('price');
    expect(await ok('GET', `/api/ingredients/${bones.id}`, undefined, cook)).not.toHaveProperty(
      'price',
    );

    for (const id of [sauce.id, dish.id]) {
      const recipe = await ok('GET', `/api/recipes/${id}`, undefined, cook);
      expect(recipe).not.toHaveProperty('sellPrice');
      const expanded = await ok('GET', `/api/recipes/${id}/expanded?factor=2`, undefined, cook);
      expect(expanded).not.toHaveProperty('cost');
      expect(expanded.recipe).not.toHaveProperty('sellPrice');
    }

    const read = await ok('GET', `/api/menus/${menu.id}`, undefined, cook);
    expect(read).not.toHaveProperty('cost');
    for (const line of read.dishes) expect(line).not.toHaveProperty('cost');
  });

  it('gets no costs in the bundle for offline use, though a chef does', async () => {
    await pricedKitchen();
    const cook = await signInCook();
    const bundle = async (cookies: Record<string, string>) => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/offline/bundle?format=2',
        cookies,
        headers: { 'accept-encoding': 'gzip' },
      });
      expect(response.statusCode).toBe(200);
      return gunzipSync(response.rawPayload).toString();
    };

    const forChef = await bundle(admin);
    expect(forChef).toContain('"sellPrice":10.9');
    expect(forChef).toContain('"foodCostPercent"');
    expect(forChef).toContain('"averagePerPortion"');

    const forCook = await bundle(cook);
    expect(forCook).not.toContain('sellPrice');
    expect(forCook).not.toContain('"cost"');
    expect(forCook).not.toContain('10.9');
    // Nor what the ingredients cost, which a chef's tablet works costs out from.
    expect(forChef).toContain('"price":{"amount":4');
    expect(forCook).not.toContain('"price"');
    expect(forCook).not.toContain('costSettings');
    // And the chef's build is not handed out again for the cook's.
    expect(await bundle(admin)).toContain('"sellPrice":10.9');
  });
});
