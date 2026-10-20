import type { Ingredient, Recipe, RecipeComponent } from './recipe.js';
import { createRecipeBook } from './recipe.js';
import { qty, type Quantity, type UnitCode } from './units.js';

/**
 * A small but realistic kitchen, used by the tests.
 *
 * Two dishes both take the same velouté, the velouté takes chicken stock, and
 * the stock takes vegetables. Three levels deep with a shared component is
 * exactly the shape that makes prep lists worth generating.
 */

export const STATION = {
  larder: 'st-larder',
  sauce: 'st-sauce',
  saute: 'st-saute',
  pass: 'st-pass',
} as const;

function ingredient(id: string, name: string, overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id,
    name,
    baseUnit: 'g',
    allergens: [],
    yieldPercent: 100,
    requiresPrep: false,
    ...overrides,
  };
}

export const INGREDIENTS: Ingredient[] = [
  ingredient('i-bones', 'Chicken bones'),
  ingredient('i-onion', 'Onion', { yieldPercent: 90, requiresPrep: true }),
  ingredient('i-carrot', 'Carrot', { yieldPercent: 80, requiresPrep: true }),
  ingredient('i-butter', 'Butter', { allergens: ['milk'] }),
  ingredient('i-flour', 'Plain flour', { allergens: ['gluten'] }),
  ingredient('i-cream', 'Double cream', {
    baseUnit: 'ml',
    allergens: ['milk'],
    densityGPerMl: 1.0,
  }),
  ingredient('i-water', 'Water', { baseUnit: 'ml', densityGPerMl: 1.0 }),
  ingredient('i-salt', 'Salt'),
  ingredient('i-tarragon', 'Tarragon', { requiresPrep: true }),
  ingredient('i-egg', 'Egg', { baseUnit: 'each', allergens: ['eggs'], itemWeightG: 50 }),
];

let componentCounter = 0;

function ing(ingredientId: string, value: number, unit: UnitCode, note?: string): RecipeComponent {
  return {
    id: `c-${++componentCounter}`,
    sortOrder: componentCounter,
    note: note ?? null,
    quantity: qty(value, unit),
    ref: { kind: 'ingredient', ingredientId },
  };
}

function sub(recipeId: string, value: number, unit: UnitCode, note?: string): RecipeComponent {
  return {
    id: `c-${++componentCounter}`,
    sortOrder: componentCounter,
    note: note ?? null,
    quantity: qty(value, unit),
    ref: { kind: 'recipe', recipeId },
  };
}

const stock: Recipe = {
  id: 'r-stock',
  name: 'Chicken stock',
  type: 'prep',
  stationId: STATION.larder,
  yield: qty(2000, 'ml'),
  components: [
    ing('i-bones', 2000, 'g'),
    ing('i-onion', 200, 'g', 'roughly chopped'),
    ing('i-carrot', 150, 'g'),
    ing('i-water', 3000, 'ml'),
  ],
};

const veloute: Recipe = {
  id: 'r-veloute',
  name: 'Chicken velouté',
  type: 'prep',
  stationId: STATION.sauce,
  yield: qty(1000, 'ml'),
  components: [
    sub('r-stock', 800, 'ml'),
    ing('i-butter', 60, 'g'),
    ing('i-flour', 60, 'g'),
    ing('i-cream', 200, 'ml'),
  ],
};

const pie: Recipe = {
  id: 'r-pie',
  name: 'Chicken pie',
  type: 'dish',
  stationId: STATION.pass,
  yield: qty(10, 'each'),
  portions: 10,
  components: [sub('r-veloute', 500, 'ml'), ing('i-flour', 400, 'g'), ing('i-butter', 200, 'g')],
};

const fricassee: Recipe = {
  id: 'r-fricassee',
  name: 'Chicken fricassée',
  type: 'dish',
  stationId: STATION.saute,
  yield: qty(8, 'each'),
  portions: 8,
  components: [sub('r-veloute', 400, 'ml'), ing('i-tarragon', 20, 'g', 'picked')],
};

export const RECIPES: Recipe[] = [stock, veloute, pie, fricassee];

export const book = createRecipeBook(RECIPES, INGREDIENTS);

/** The same kitchen, but the stock has been made to contain the velouté. */
export function cyclicBook() {
  const brokenStock: Recipe = {
    ...stock,
    components: [...stock.components, sub('r-veloute', 100, 'ml')],
  };
  return createRecipeBook([brokenStock, veloute, pie, fricassee], INGREDIENTS);
}

/** Find a generated task by its source id, for readable assertions. */
export function taskFor<T extends { sourceId: string }>(tasks: readonly T[], id: string): T {
  const found = tasks.find((t) => t.sourceId === id);
  if (!found) throw new Error(`no task generated for ${id}`);
  return found;
}

export function value(q: Quantity): number {
  return q.value;
}
