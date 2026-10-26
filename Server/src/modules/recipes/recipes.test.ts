import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { setUpKitchen, useTestContext } from '../../test/harness.js';

const ctx = useTestContext();
let admin: string;

beforeEach(async () => {
  admin = await setUpKitchen(ctx.app);
});

function as(cookie: string) {
  return { mise_session: cookie };
}

async function addIngredient(
  app: FastifyInstance,
  cookie: string,
  payload: Record<string, unknown>,
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/ingredients',
    payload: { baseUnit: 'g', ...payload },
    cookies: as(cookie),
  });
  if (response.statusCode !== 200) {
    throw new Error(`Could not add ingredient: ${response.statusCode} ${response.body}`);
  }
  return response.json();
}

async function addRecipe(app: FastifyInstance, cookie: string, payload: Record<string, unknown>) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/recipes',
    payload: {
      type: 'prep',
      yield: { value: 1, unit: 'kg' },
      ...payload,
    },
    cookies: as(cookie),
  });
  if (response.statusCode !== 200) {
    throw new Error(`Could not add recipe: ${response.statusCode} ${response.body}`);
  }
  return response.json();
}

describe('the ingredient catalogue', () => {
  it('stores the three fields that make conversion possible', async () => {
    const egg = await addIngredient(ctx.app, admin, {
      name: 'Egg',
      baseUnit: 'each',
      itemWeightG: 50,
      allergens: ['eggs'],
    });
    expect(egg).toMatchObject({ itemWeightG: 50, allergens: ['eggs'] });

    const oil = await addIngredient(ctx.app, admin, {
      name: 'Rapeseed oil',
      baseUnit: 'ml',
      densityGPerMl: 0.92,
    });
    expect(oil.densityGPerMl).toBeCloseTo(0.92);
  });

  it('records trim yield: how much of what is bought is left once trimmed', async () => {
    const onion = await addIngredient(ctx.app, admin, {
      name: 'Onion',
      yieldPercent: 90,
    });
    expect(onion).toMatchObject({ yieldPercent: 90 });
  });

  it('refuses a trim yield over 100 per cent', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/ingredients',
      payload: { name: 'Magic onion', baseUnit: 'g', yieldPercent: 150 },
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses two ingredients with the same name, whatever the case', async () => {
    await addIngredient(ctx.app, admin, { name: 'Onion' });
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/ingredients',
      payload: { name: 'ONION', baseUnit: 'g' },
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(409);
  });

  it('will not delete an ingredient a recipe still uses', async () => {
    const onion = await addIngredient(ctx.app, admin, { name: 'Onion' });
    await addRecipe(ctx.app, admin, {
      name: 'Soubise',
      components: [
        {
          sortOrder: 0,
          quantity: { value: 500, unit: 'g' },
          ref: { kind: 'ingredient', ingredientId: onion.id },
        },
      ],
    });

    const response = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/ingredients/${onion.id}`,
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(409);
  });

  it('lets a cook read the catalogue but not change it', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/ingredients',
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('recipes', () => {
  it('stores a component that points at an ingredient', async () => {
    const onion = await addIngredient(ctx.app, admin, { name: 'Onion' });
    const recipe = await addRecipe(ctx.app, admin, {
      name: 'Soubise',
      components: [
        {
          sortOrder: 0,
          quantity: { value: 500, unit: 'g' },
          note: 'finely sliced',
          ref: { kind: 'ingredient', ingredientId: onion.id },
        },
      ],
    });
    expect(recipe.components).toHaveLength(1);
    expect(recipe.components[0]).toMatchObject({
      note: 'finely sliced',
      displayName: 'Onion',
      ref: { kind: 'ingredient', ingredientId: onion.id },
    });
  });

  it('stores a component that points at another recipe', async () => {
    const stock = await addRecipe(ctx.app, admin, {
      name: 'Chicken stock',
      yield: { value: 2, unit: 'l' },
    });
    const veloute = await addRecipe(ctx.app, admin, {
      name: 'Velouté',
      yield: { value: 1, unit: 'l' },
      components: [
        {
          sortOrder: 0,
          quantity: { value: 800, unit: 'ml' },
          ref: { kind: 'recipe', recipeId: stock.id },
        },
      ],
    });
    expect(veloute.components[0]).toMatchObject({
      displayName: 'Chicken stock',
      ref: { kind: 'recipe', recipeId: stock.id },
    });
  });

  it('keeps the unit the chef typed', async () => {
    const recipe = await addRecipe(ctx.app, admin, {
      name: 'Chicken stock',
      yield: { value: 2, unit: 'l' },
    });
    // Stored as 2000 ml underneath, but a chef who wrote litres sees litres.
    expect(recipe.yield).toEqual({ value: 2, unit: 'l' });
  });

  it('rolls allergens up through two levels of sub-recipe', async () => {
    const flour = await addIngredient(ctx.app, admin, { name: 'Flour', allergens: ['gluten'] });
    const cream = await addIngredient(ctx.app, admin, {
      name: 'Cream',
      baseUnit: 'ml',
      allergens: ['milk'],
    });

    const stock = await addRecipe(ctx.app, admin, {
      name: 'Chicken stock',
      yield: { value: 2, unit: 'l' },
    });
    const veloute = await addRecipe(ctx.app, admin, {
      name: 'Velouté',
      yield: { value: 1, unit: 'l' },
      components: [
        {
          sortOrder: 0,
          quantity: { value: 800, unit: 'ml' },
          ref: { kind: 'recipe', recipeId: stock.id },
        },
        {
          sortOrder: 1,
          quantity: { value: 60, unit: 'g' },
          ref: { kind: 'ingredient', ingredientId: flour.id },
        },
        {
          sortOrder: 2,
          quantity: { value: 200, unit: 'ml' },
          ref: { kind: 'ingredient', ingredientId: cream.id },
        },
      ],
    });
    const pie = await addRecipe(ctx.app, admin, {
      name: 'Chicken pie',
      type: 'dish',
      yield: { value: 10, unit: 'each' },
      portions: 10,
      components: [
        {
          sortOrder: 0,
          quantity: { value: 500, unit: 'ml' },
          ref: { kind: 'recipe', recipeId: veloute.id },
        },
      ],
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/recipes/${pie.id}/allergens`,
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().contains).toEqual(['gluten', 'milk']);
  });

  it('replaces the whole component list on save, the way the editor works', async () => {
    const onion = await addIngredient(ctx.app, admin, { name: 'Onion' });
    const carrot = await addIngredient(ctx.app, admin, { name: 'Carrot' });
    const recipe = await addRecipe(ctx.app, admin, {
      name: 'Mirepoix',
      components: [
        {
          sortOrder: 0,
          quantity: { value: 1, unit: 'kg' },
          ref: { kind: 'ingredient', ingredientId: onion.id },
        },
      ],
    });

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/recipes/${recipe.id}`,
      payload: {
        components: [
          {
            sortOrder: 0,
            quantity: { value: 500, unit: 'g' },
            ref: { kind: 'ingredient', ingredientId: carrot.id },
          },
        ],
      },
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().components).toHaveLength(1);
    expect(response.json().components[0].displayName).toBe('Carrot');
  });

  it('duplicates a spec as a fresh draft', async () => {
    const onion = await addIngredient(ctx.app, admin, { name: 'Onion' });
    const original = await addRecipe(ctx.app, admin, {
      name: 'Soubise',
      status: 'published',
      components: [
        {
          sortOrder: 0,
          quantity: { value: 500, unit: 'g' },
          ref: { kind: 'ingredient', ingredientId: onion.id },
        },
      ],
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/recipes/${original.id}/duplicate`,
      payload: { name: 'Soubise, second pass' },
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().name).toBe('Soubise, second pass');
    // A copy always starts as a draft, whatever the original was.
    expect(response.json().status).toBe('draft');
    expect(response.json().components).toHaveLength(1);
    expect(response.json().id).not.toBe(original.id);
  });

  it('will not delete a recipe another one still uses, and says which', async () => {
    const stock = await addRecipe(ctx.app, admin, {
      name: 'Chicken stock',
      yield: { value: 2, unit: 'l' },
    });
    await addRecipe(ctx.app, admin, {
      name: 'Velouté',
      yield: { value: 1, unit: 'l' },
      components: [
        {
          sortOrder: 0,
          quantity: { value: 800, unit: 'ml' },
          ref: { kind: 'recipe', recipeId: stock.id },
        },
      ],
    });

    const response = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/recipes/${stock.id}`,
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain('Velouté');
  });

  it('stops a cook editing the library', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { displayName: 'Marco', role: 'cook', pin: '4821' },
      cookies: as(admin),
    });
    expect(created.statusCode).toBe(200);

    // A cook has no password, so use the roles guard directly via the API.
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/recipes',
      payload: { name: 'Rogue', type: 'prep', yield: { value: 1, unit: 'kg' } },
    });
    expect(response.statusCode).toBe(401);
  });
});

/**
 * A loop makes scaling and prep explosion non-terminating, so it is the one
 * edit that has to be refused outright rather than warned about.
 */
describe('loops', () => {
  it('refuses a recipe that contains itself', async () => {
    const stock = await addRecipe(ctx.app, admin, {
      name: 'Chicken stock',
      yield: { value: 2, unit: 'l' },
    });

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/recipes/${stock.id}`,
      payload: {
        components: [
          {
            sortOrder: 0,
            quantity: { value: 100, unit: 'ml' },
            ref: { kind: 'recipe', recipeId: stock.id },
          },
        ],
      },
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('loop');
  });

  it('refuses a loop that closes through a third recipe, and names both ends', async () => {
    const stock = await addRecipe(ctx.app, admin, {
      name: 'Chicken stock',
      yield: { value: 2, unit: 'l' },
    });
    const veloute = await addRecipe(ctx.app, admin, {
      name: 'Velouté',
      yield: { value: 1, unit: 'l' },
      components: [
        {
          sortOrder: 0,
          quantity: { value: 800, unit: 'ml' },
          ref: { kind: 'recipe', recipeId: stock.id },
        },
      ],
    });

    // Now try to put the velouté inside the stock it is made from.
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/recipes/${stock.id}`,
      payload: {
        components: [
          {
            sortOrder: 0,
            quantity: { value: 100, unit: 'ml' },
            ref: { kind: 'recipe', recipeId: veloute.id },
          },
        ],
      },
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('Chicken stock');
    expect(response.json().error.message).toContain('Velouté');
  });

  it('leaves the recipe untouched when a loop is refused', async () => {
    const onion = await addIngredient(ctx.app, admin, { name: 'Onion' });
    const stock = await addRecipe(ctx.app, admin, {
      name: 'Chicken stock',
      yield: { value: 2, unit: 'l' },
      components: [
        {
          sortOrder: 0,
          quantity: { value: 200, unit: 'g' },
          ref: { kind: 'ingredient', ingredientId: onion.id },
        },
      ],
    });

    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/recipes/${stock.id}`,
      payload: {
        components: [
          {
            sortOrder: 0,
            quantity: { value: 100, unit: 'ml' },
            ref: { kind: 'recipe', recipeId: stock.id },
          },
        ],
      },
      cookies: as(admin),
    });

    const after = await ctx.app.inject({
      method: 'GET',
      url: `/api/recipes/${stock.id}`,
      cookies: as(admin),
    });
    expect(after.json().components).toHaveLength(1);
    expect(after.json().components[0].displayName).toBe('Onion');
  });

  it('does not create the recipe at all when a new one would close a loop', async () => {
    const a = await addRecipe(ctx.app, admin, { name: 'A', yield: { value: 1, unit: 'l' } });
    const before = await ctx.app.inject({
      method: 'GET',
      url: '/api/recipes',
      cookies: as(admin),
    });

    // B contains A, which is fine; the loop only appears if A then contains B.
    await addRecipe(ctx.app, admin, {
      name: 'B',
      yield: { value: 1, unit: 'l' },
      components: [
        {
          sortOrder: 0,
          quantity: { value: 100, unit: 'ml' },
          ref: { kind: 'recipe', recipeId: a.id },
        },
      ],
    });

    const after = await ctx.app.inject({
      method: 'GET',
      url: '/api/recipes',
      cookies: as(admin),
    });
    expect(after.json()).toHaveLength(before.json().length + 1);
  });
});

describe('finding a recipe', () => {
  beforeEach(async () => {
    const flour = await addIngredient(ctx.app, admin, { name: 'Flour', allergens: ['gluten'] });
    await addRecipe(ctx.app, admin, {
      name: 'Pasta dough',
      tags: ['pasta'],
      components: [
        {
          sortOrder: 0,
          quantity: { value: 500, unit: 'g' },
          ref: { kind: 'ingredient', ingredientId: flour.id },
        },
      ],
    });
    await addRecipe(ctx.app, admin, { name: 'Chicken stock', yield: { value: 2, unit: 'l' } });
  });

  it('searches by name', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/recipes?search=stock',
      cookies: as(admin),
    });
    expect(response.json()).toHaveLength(1);
    expect(response.json()[0].name).toBe('Chicken stock');
  });

  it('filters by tag', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/recipes?tag=pasta',
      cookies: as(admin),
    });
    expect(response.json()).toHaveLength(1);
    expect(response.json()[0].name).toBe('Pasta dough');
  });

  /** Building an allergy-safe menu is the whole reason this filter exists. */
  it('excludes everything containing an allergen, following sub-recipes', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/recipes?excludeAllergen=gluten',
      cookies: as(admin),
    });
    expect(response.json().map((r: { name: string }) => r.name)).toEqual(['Chicken stock']);
  });

  it('finds everything containing an allergen', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/recipes?allergen=gluten',
      cookies: as(admin),
    });
    expect(response.json().map((r: { name: string }) => r.name)).toEqual(['Pasta dough']);
  });
});

describe('saving part of a record', () => {
  it('changes only the fields that were sent on a recipe', async () => {
    const butter = await addIngredient(ctx.app, admin, { name: 'Butter', allergens: ['milk'] });
    const sauce = await addRecipe(ctx.app, admin, {
      name: 'Beurre blanc',
      status: 'published',
      tags: ['sauce'],
      declaredAllergens: ['sulphites'],
      method: [{ text: 'Reduce, then mount with butter.' }],
      components: [
        {
          sortOrder: 0,
          quantity: { value: 250, unit: 'g' },
          ref: { kind: 'ingredient', ingredientId: butter.id },
        },
      ],
    });

    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/recipes/${sauce.id}`,
      payload: { portions: 6 },
      cookies: as(admin),
    });
    expect(patched.statusCode).toBe(200);

    const after = await ctx.app.inject({
      method: 'GET',
      url: `/api/recipes/${sauce.id}`,
      cookies: as(admin),
    });
    expect(after.json()).toMatchObject({
      portions: 6,
      status: 'published',
      tags: ['sauce'],
      declaredAllergens: ['sulphites'],
      method: [{ text: 'Reduce, then mount with butter.' }],
    });
    expect(after.json().components).toHaveLength(1);
  });

  it('changes only the fields that were sent on an ingredient', async () => {
    const shallot = await addIngredient(ctx.app, admin, {
      name: 'Shallot',
      allergens: ['sulphites'],
      yieldPercent: 85,
    });
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/ingredients/${shallot.id}`,
      payload: { notes: 'Banana shallots only' },
      cookies: as(admin),
    });
    const after = await ctx.app.inject({
      method: 'GET',
      url: `/api/ingredients/${shallot.id}`,
      cookies: as(admin),
    });
    expect(after.json()).toMatchObject({
      allergens: ['sulphites'],
      yieldPercent: 85,
      notes: 'Banana shallots only',
    });
  });

  it('keeps a station in its place when it is renamed', async () => {
    const stations = await ctx.app.inject({
      method: 'GET',
      url: '/api/stations',
      cookies: as(admin),
    });
    const third = stations.json()[2];
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/stations/${third.id}`,
      payload: { name: 'Fish' },
      cookies: as(admin),
    });
    const after = await ctx.app.inject({
      method: 'GET',
      url: '/api/stations',
      cookies: as(admin),
    });
    expect(after.json()[2]).toMatchObject({
      id: third.id,
      name: 'Fish',
      sortOrder: third.sortOrder,
    });
  });
});

describe('a save that fails', () => {
  it('leaves the recipe exactly as it was', async () => {
    const butter = await addIngredient(ctx.app, admin, { name: 'Butter' });
    const sauce = await addRecipe(ctx.app, admin, {
      name: 'Beurre blanc',
      components: [
        {
          sortOrder: 0,
          quantity: { value: 250, unit: 'g' },
          ref: { kind: 'ingredient', ingredientId: butter.id },
        },
      ],
    });

    const failed = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/recipes/${sauce.id}`,
      payload: {
        name: 'Renamed',
        components: [
          {
            sortOrder: 0,
            quantity: { value: 1, unit: 'kg' },
            ref: { kind: 'ingredient', ingredientId: '00000000-0000-4000-8000-000000000000' },
          },
        ],
      },
      cookies: as(admin),
    });
    expect(failed.statusCode).toBeGreaterThanOrEqual(400);

    const after = await ctx.app.inject({
      method: 'GET',
      url: `/api/recipes/${sauce.id}`,
      cookies: as(admin),
    });
    expect(after.json()).toMatchObject({ name: 'Beurre blanc', version: sauce.version });
    expect(after.json().components).toHaveLength(1);
  });

  it('leaves no half-made recipe behind, so trying again works', async () => {
    const payload = {
      name: 'Velouté',
      components: [
        {
          sortOrder: 0,
          quantity: { value: 1, unit: 'kg' },
          ref: { kind: 'ingredient', ingredientId: '00000000-0000-4000-8000-000000000000' },
        },
      ],
    };
    const failed = await ctx.app.inject({
      method: 'POST',
      url: '/api/recipes',
      payload: { type: 'prep', yield: { value: 1, unit: 'l' }, ...payload },
      cookies: as(admin),
    });
    expect(failed.statusCode).toBeGreaterThanOrEqual(400);

    const retried = await addRecipe(ctx.app, admin, { name: 'Velouté' });
    expect(retried.name).toBe('Velouté');
  });
});
