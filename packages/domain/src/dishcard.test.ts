import { describe, expect, it } from 'vitest';
import {
  combineVegan,
  DISH_CARD_ALLERGEN_ORDER,
  dishCardMatrix,
  isCompleteAllergenOrder,
  mergeAllergenDetails,
  rollUpAllergenDetails,
  rollUpVegan,
} from './dishcard.js';
import { createRecipeBook, type Ingredient, type Recipe, type RecipeComponent } from './recipe.js';
import { unwrap } from './result.js';
import { qty } from './units.js';

/**
 * A dish shaped like a real one: corn cream, a black garlic purée with
 * sulphites, a mustard crumble, and whatever the chef drops on at the pass.
 */

function ingredient(id: string, overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id,
    name: id,
    baseUnit: 'g',
    allergens: [],
    yieldPercent: 100,
    vegan: true,
    ...overrides,
  };
}

let counter = 0;
const ing = (ingredientId: string): RecipeComponent => ({
  id: `c-${++counter}`,
  sortOrder: counter,
  quantity: qty(10, 'g'),
  ref: { kind: 'ingredient', ingredientId },
});
const sub = (recipeId: string): RecipeComponent => ({
  id: `c-${++counter}`,
  sortOrder: counter,
  quantity: qty(10, 'g'),
  ref: { kind: 'recipe', recipeId },
});

function recipe(id: string, components: RecipeComponent[], overrides: Partial<Recipe> = {}) {
  return {
    id,
    name: id,
    type: 'prep',
    yield: qty(100, 'g'),
    components,
    ...overrides,
  } satisfies Recipe;
}

const INGREDIENTS = [
  ingredient('corn'),
  ingredient('oat-cream'),
  ingredient('black-garlic', { allergens: ['sulphites'] }),
  ingredient('mustard-seed', { allergens: ['mustard'] }),
  ingredient('flour', { allergens: ['gluten'], allergenDetails: { gluten: ['Tarwe'] } }),
  ingredient('spelt', { allergens: ['gluten'], allergenDetails: { gluten: ['spelt', 'tarwe'] } }),
  ingredient('hazelnut', { allergens: ['nuts'], allergenDetails: { nuts: ['Hazelnoot'] } }),
  ingredient('butter', { allergens: ['milk'], vegan: false }),
  ingredient('salt', { vegan: null }),
  ingredient('gelatine', { vegan: false }),
];

const cream = recipe('Mais Crème', [ing('corn'), ing('oat-cream')]);
const garlic = recipe('Zwarte Knoflook Puree', [ing('black-garlic'), ing('corn')]);
const crumble = recipe('Uitgebakken Mosterd', [ing('mustard-seed'), ing('flour')]);
const bread = recipe('Brood', [ing('spelt'), ing('salt')]);

function bookWith(dish: Recipe, extra: Recipe[] = []) {
  return createRecipeBook([cream, garlic, crumble, bread, dish, ...extra], INGREDIENTS);
}

describe('vegan', () => {
  it('takes the weakest answer', () => {
    expect(combineVegan(['yes', 'yes'])).toBe('yes');
    expect(combineVegan(['yes', 'unknown'])).toBe('unknown');
    expect(combineVegan(['unknown', 'no', 'yes'])).toBe('no');
  });

  it('is vegan only when everything all the way down is', () => {
    const dish = recipe('dish', [sub('Mais Crème'), sub('Zwarte Knoflook Puree')]);
    expect(unwrap(rollUpVegan('dish', bookWith(dish)))).toBe('yes');
  });

  it('never calls something vegan because nobody filled the field in', () => {
    expect(unwrap(rollUpVegan('Brood', bookWith(recipe('dish', []))))).toBe('unknown');
  });

  it('lets one non-vegan ingredient deep down decide', () => {
    const glazed = recipe('glazed', [sub('Mais Crème'), ing('gelatine')]);
    const dish = recipe('dish', [sub('glazed')]);
    expect(unwrap(rollUpVegan('dish', bookWith(dish, [glazed])))).toBe('no');
  });

  it('says nothing about an empty recipe', () => {
    expect(unwrap(rollUpVegan('dish', bookWith(recipe('dish', []))))).toBe('unknown');
  });

  it('reports a cycle instead of looping', () => {
    const a = recipe('a', [sub('b')]);
    const b = recipe('b', [sub('a')]);
    const result = rollUpVegan('a', createRecipeBook([a, b], INGREDIENTS));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('cycle');
  });
});

describe('cereals and nuts', () => {
  it('merges names without repeating them, whatever their case', () => {
    expect(mergeAllergenDetails({ gluten: ['Tarwe'] }, { gluten: ['tarwe', 'Spelt '] })).toEqual({
      gluten: ['Tarwe', 'Spelt'],
      nuts: [],
    });
  });

  it('rolls up through sub-recipes', () => {
    const dish = recipe('dish', [sub('Uitgebakken Mosterd'), sub('Brood'), ing('hazelnut')]);
    expect(unwrap(rollUpAllergenDetails('dish', bookWith(dish)))).toEqual({
      gluten: ['Tarwe', 'spelt'],
      nuts: ['Hazelnoot'],
    });
  });
});

describe('the dish card matrix', () => {
  it('has one row per sub-recipe, in the order of the dish', () => {
    const dish = recipe('dish', [
      sub('Mais Crème'),
      sub('Zwarte Knoflook Puree'),
      sub('Uitgebakken Mosterd'),
    ]);
    const matrix = unwrap(dishCardMatrix('dish', bookWith(dish)));
    expect(matrix.rows.map((row) => row.name)).toEqual([
      'Mais Crème',
      'Zwarte Knoflook Puree',
      'Uitgebakken Mosterd',
    ]);
    expect(matrix.rows[1]!.allergens.contains).toEqual(['sulphites']);
    expect(matrix.rows[2]!.allergens.contains).toEqual(['gluten', 'mustard']);
    expect(matrix.rows[2]!.details.gluten).toEqual(['Tarwe']);
    expect(matrix.other).toBeNull();
    expect(matrix.dish.allergens.contains).toEqual(['gluten', 'mustard', 'sulphites']);
    expect(matrix.dish.vegan).toBe('yes');
  });

  it('lists a sub-recipe used twice only once', () => {
    const dish = recipe('dish', [sub('Mais Crème'), sub('Mais Crème')]);
    expect(unwrap(dishCardMatrix('dish', bookWith(dish))).rows).toHaveLength(1);
  });

  it('adds a row when an ingredient straight on the dish brings an allergen', () => {
    const dish = recipe('dish', [sub('Mais Crème'), ing('hazelnut')]);
    const matrix = unwrap(dishCardMatrix('dish', bookWith(dish)));
    expect(matrix.other?.allergens.contains).toEqual(['nuts']);
    expect(matrix.other?.details.nuts).toEqual(['Hazelnoot']);
    expect(matrix.dish.allergens.contains).toEqual(['nuts']);
  });

  it('adds a row for allergens declared on the dish itself', () => {
    const dish = recipe('dish', [sub('Mais Crème')], { mayContain: ['sesame'] });
    const matrix = unwrap(dishCardMatrix('dish', bookWith(dish)));
    expect(matrix.other?.allergens.mayContain).toEqual(['sesame']);
  });

  it('adds a row when an ingredient on the dish is not vegan', () => {
    const dish = recipe('dish', [sub('Mais Crème'), ing('gelatine')]);
    const matrix = unwrap(dishCardMatrix('dish', bookWith(dish)));
    expect(matrix.other?.vegan).toBe('no');
    expect(matrix.dish.vegan).toBe('no');
  });

  it('adds no row when the ingredients on the dish say nothing new', () => {
    const dish = recipe('dish', [sub('Zwarte Knoflook Puree'), ing('black-garlic'), ing('corn')]);
    expect(unwrap(dishCardMatrix('dish', bookWith(dish))).other).toBeNull();
  });

  it('does not repeat a may-contain that a row already contains', () => {
    const dish = recipe('dish', [sub('Zwarte Knoflook Puree')], { mayContain: ['sulphites'] });
    expect(unwrap(dishCardMatrix('dish', bookWith(dish))).other).toBeNull();
  });

  it('fails rather than leaving out a recipe it cannot find', () => {
    const dish = recipe('dish', [sub('gone')]);
    const result = dishCardMatrix('dish', bookWith(dish));
    expect(result.ok).toBe(false);
  });
});

describe('the column order', () => {
  it('covers every allergen exactly once', () => {
    expect(isCompleteAllergenOrder(DISH_CARD_ALLERGEN_ORDER)).toBe(true);
  });
});
