import { describe, expect, it } from 'vitest';
import {
  costPerBaseUnit,
  costRecipe,
  foodCostPercent,
  ingredientCost,
  summariseCost,
} from './cost.js';
import { createRecipeBook, type Ingredient, type Recipe, type RecipeComponent } from './recipe.js';
import { unwrap } from './result.js';
import { qty, type UnitCode } from './units.js';

/**
 * A small kitchen with prices: a stock goes into a sauce, the sauce into a
 * dish. Round numbers, so each expectation can be checked by hand.
 */
function priced(id: string, name: string, overrides: Partial<Ingredient> = {}): Ingredient {
  return { id, name, baseUnit: 'g', allergens: [], ...overrides };
}

const BONES = priced('i-bones', 'Bones', { price: { amount: 4, quantity: qty(2, 'kg') } });
const WATER = priced('i-water', 'Water', { baseUnit: 'ml' });
const ONION = priced('i-onion', 'Onion', {
  // €2 a kilo, 80 % usable: €2.50 per usable kilo.
  price: { amount: 2, quantity: qty(1, 'kg') },
  yieldPercent: 80,
});
const CREAM = priced('i-cream', 'Cream', {
  baseUnit: 'ml',
  price: { amount: 3.2, quantity: qty(1, 'l') },
});
const EGG = priced('i-egg', 'Egg', {
  baseUnit: 'each',
  // 30 eggs for €9: €0.30 each. One is 50 g.
  price: { amount: 9, quantity: qty(30, 'each') },
  itemWeightG: 50,
});
const OIL = priced('i-oil', 'Oil', {
  // Bought by the litre, used by weight: needs the density.
  price: { amount: 4.6, quantity: qty(1, 'l') },
  densityGPerMl: 0.92,
});

let counter = 0;
function line(id: string, value: number, unit: UnitCode, recipe = false): RecipeComponent {
  counter += 1;
  return {
    id: `c-${counter}`,
    sortOrder: counter,
    quantity: qty(value, unit),
    ref: recipe ? { kind: 'recipe', recipeId: id } : { kind: 'ingredient', ingredientId: id },
  };
}

// €4 of bones and unpriced water: €4 for 2 l.
const STOCK: Recipe = {
  id: 'r-stock',
  name: 'Stock',
  type: 'prep',
  yield: qty(2000, 'ml'),
  components: [line('i-bones', 2000, 'g'), line('i-water', 3000, 'ml')],
};
const SAUCE: Recipe = {
  id: 'r-sauce',
  name: 'Sauce',
  type: 'prep',
  yield: qty(1000, 'ml'),
  components: [
    line('r-stock', 500, 'ml', true), // €1
    line('i-cream', 250, 'ml'), // €0.80
    line('i-onion', 200, 'g'), // €0.50
  ],
};
const DISH: Recipe = {
  id: 'r-dish',
  name: 'Dish',
  type: 'dish',
  yield: qty(4, 'each'),
  portions: 4,
  components: [line('r-sauce', 400, 'ml', true), line('i-egg', 4, 'each')],
};

const INGREDIENTS = [BONES, WATER, ONION, CREAM, EGG, OIL];
const kitchen = createRecipeBook([STOCK, SAUCE, DISH], INGREDIENTS);

describe('costPerBaseUnit', () => {
  it('turns a price per purchase into a price per gram', () => {
    expect(unwrap(costPerBaseUnit(BONES))).toBeCloseTo(0.002);
  });

  it('pays for the trim: 80 % yield makes each usable gram dearer', () => {
    expect(unwrap(costPerBaseUnit(ONION))).toBeCloseTo(0.0025);
  });

  it('converts a purchase in another unit of the same kind', () => {
    expect(unwrap(costPerBaseUnit(CREAM))).toBeCloseTo(0.0032);
  });

  it('crosses from volume to weight with the density', () => {
    // A litre of oil is 920 g: €4.60 / 920 g = €0.005 per g.
    expect(unwrap(costPerBaseUnit(OIL))).toBeCloseTo(0.005);
  });

  it('crosses from weight to count with the weight of one', () => {
    const eggsByWeight = { ...EGG, price: { amount: 3, quantity: qty(500, 'g') } };
    // 500 g is ten eggs, so €0.30 each.
    expect(unwrap(costPerBaseUnit(eggsByWeight))).toBeCloseTo(0.3);
  });

  it('says so when nobody has entered a price', () => {
    expect(costPerBaseUnit(WATER)).toEqual({ ok: false, error: 'no_price' });
  });

  it('says so when the purchase unit cannot be turned into the base unit', () => {
    const noDensity = { ...OIL, densityGPerMl: null };
    expect(costPerBaseUnit(noDensity)).toEqual({ ok: false, error: 'units' });
  });

  it('refuses a purchase of nothing instead of dividing by zero', () => {
    const nothing = { ...BONES, price: { amount: 4, quantity: qty(0, 'kg') } };
    expect(costPerBaseUnit(nothing)).toEqual({ ok: false, error: 'units' });
  });
});

describe('ingredientCost', () => {
  it('costs an amount used in a different unit of the same kind', () => {
    // Two tablespoons of cream: 29.57 ml at €0.0032.
    expect(unwrap(ingredientCost(CREAM, qty(2, 'tbsp')))).toBeCloseTo(0.0946, 3);
  });

  it('costs eggs used by weight through the weight of one', () => {
    expect(unwrap(ingredientCost(EGG, qty(100, 'g')))).toBeCloseTo(0.6);
  });

  it('costs oil used by volume though it is weighed', () => {
    // 100 ml is 92 g at €0.005.
    expect(unwrap(ingredientCost(OIL, qty(100, 'ml')))).toBeCloseTo(0.46);
  });

  it('cannot cost a count of something weighed without the weight of one', () => {
    expect(ingredientCost(BONES, qty(2, 'each'))).toEqual({ ok: false, error: 'units' });
  });
});

describe('costRecipe', () => {
  it('adds up a recipe’s own lines', () => {
    expect(unwrap(costRecipe('r-stock', 1, kitchen)).total).toBeCloseTo(4);
  });

  it('never counts an unknown price as zero: it is named instead', () => {
    expect(unwrap(costRecipe('r-stock', 1, kitchen)).gaps).toEqual([
      { kind: 'ingredient', id: 'i-water', name: 'Water', reason: 'no_price' },
    ]);
  });

  it('costs a sub-recipe for the share of its batch that is used', () => {
    // Stock €1 + cream €0.80 + onion €0.50.
    expect(unwrap(costRecipe('r-sauce', 1, kitchen)).total).toBeCloseTo(2.3);
  });

  it('follows every level down, and names a gap however deep', () => {
    // 400 ml of sauce (€0.92) and four eggs (€1.20).
    const cost = unwrap(costRecipe('r-dish', 1, kitchen));
    expect(cost.total).toBeCloseTo(2.12);
    expect(cost.gaps.map((gap) => gap.name)).toEqual(['Water']);
  });

  it('scales with the factor, at every level', () => {
    expect(unwrap(costRecipe('r-dish', 2.5, kitchen)).total).toBeCloseTo(5.3);
  });

  it('names each gap once, however often it is used', () => {
    const twice: Recipe = {
      ...SAUCE,
      id: 'r-twice',
      name: 'Twice',
      components: [line('r-stock', 100, 'ml', true), line('r-stock', 200, 'ml', true)],
    };
    const book = createRecipeBook([STOCK, twice], INGREDIENTS);
    expect(unwrap(costRecipe('r-twice', 1, book)).gaps).toHaveLength(1);
  });

  it('names a line in a unit it cannot be costed in, and costs the rest', () => {
    const odd: Recipe = {
      ...STOCK,
      id: 'r-odd',
      name: 'Odd',
      components: [line('i-bones', 3, 'each'), line('i-onion', 100, 'g')],
    };
    const cost = unwrap(costRecipe('r-odd', 1, createRecipeBook([odd], INGREDIENTS)));
    expect(cost.total).toBeCloseTo(0.25);
    expect(cost.gaps).toEqual([
      { kind: 'ingredient', id: 'i-bones', name: 'Bones', reason: 'units' },
    ]);
  });

  it('names a sub-recipe measured in a unit its yield cannot be turned into', () => {
    const byWeight: Recipe = {
      ...DISH,
      id: 'r-by-weight',
      components: [line('r-sauce', 100, 'g', true), line('i-egg', 1, 'each')],
    };
    const book = createRecipeBook([STOCK, SAUCE, byWeight], INGREDIENTS);
    const cost = unwrap(costRecipe('r-by-weight', 1, book));
    expect(cost.total).toBeCloseTo(0.3);
    expect(cost.gaps).toEqual([{ kind: 'recipe', id: 'r-sauce', name: 'Sauce', reason: 'units' }]);
  });

  it('does not mistake an empty sub-recipe for one it could not open', () => {
    const empty: Recipe = { ...STOCK, id: 'r-empty', name: 'Empty', components: [] };
    const uses: Recipe = { ...DISH, id: 'r-uses', components: [line('r-empty', 100, 'ml', true)] };
    const cost = unwrap(costRecipe('r-uses', 1, createRecipeBook([empty, uses], INGREDIENTS)));
    expect(cost).toEqual({ total: 0, gaps: [] });
  });

  it('refuses a loop, as the expansion does', () => {
    const loop: Recipe = {
      ...STOCK,
      components: [...STOCK.components, line('r-sauce', 100, 'ml', true)],
    };
    const result = costRecipe('r-sauce', 1, createRecipeBook([loop, SAUCE], INGREDIENTS));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('cycle');
  });
});

describe('summariseCost', () => {
  it('gives the cost per unit of yield and per portion', () => {
    const sauce = summariseCost(SAUCE, 1, unwrap(costRecipe('r-sauce', 1, kitchen)));
    expect(sauce.perBase).toBeCloseTo(0.0023);
    expect(sauce.perPortion).toBeNull();

    const dish = summariseCost(DISH, 1, unwrap(costRecipe('r-dish', 1, kitchen)));
    expect(dish.perPortion).toBeCloseTo(0.53);
  });

  it('keeps the cost per portion the same at any size', () => {
    const dish = summariseCost(DISH, 3, unwrap(costRecipe('r-dish', 3, kitchen)));
    expect(dish.total).toBeCloseTo(6.36);
    expect(dish.perPortion).toBeCloseTo(0.53);
  });
});

describe('foodCostPercent', () => {
  it('takes VAT off the menu price first', () => {
    // €21.80 including 9 % is €20 to the house; €6 of food is 30 %.
    expect(foodCostPercent(6, 21.8, 9)).toBeCloseTo(30);
  });

  it('is unknown without a selling price', () => {
    expect(foodCostPercent(6, null, 9)).toBeNull();
    expect(foodCostPercent(6, 0, 9)).toBeNull();
  });
});
