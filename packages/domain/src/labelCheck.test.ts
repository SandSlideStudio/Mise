import { describe, expect, it } from 'vitest';
import { labelShift } from './labelCheck.js';
import { createRecipeBook, type Recipe } from './recipe.js';

const line = (ref: Recipe['components'][number]['ref']) => ({
  id: `c-${JSON.stringify(ref)}`,
  sortOrder: 0,
  quantity: { value: 100, unit: 'g' as const },
  ref,
});
const recipe = (id: string, type: Recipe['type'], components: Recipe['components']): Recipe => ({
  id,
  name: id,
  type,
  yield: { value: 1, unit: 'kg' },
  components,
});

/** Mayonnaise in a sauce, the sauce in fries; a salad without it; a dish with a part not here. */
const book = createRecipeBook(
  [
    recipe('sauce', 'prep', [line({ kind: 'ingredient', ingredientId: 'mayo' })]),
    recipe('fries', 'dish', [
      line({ kind: 'recipe', recipeId: 'sauce' }),
      line({ kind: 'ingredient', ingredientId: 'potato' }),
    ]),
    recipe('salad', 'dish', [line({ kind: 'ingredient', ingredientId: 'potato' })]),
    recipe('special', 'dish', [line({ kind: 'recipe', recipeId: 'not-loaded' })]),
  ],
  [
    { id: 'mayo', name: 'Mayonnaise', baseUnit: 'g', allergens: ['eggs'], mayContain: [] },
    { id: 'potato', name: 'Potato', baseUnit: 'g', allergens: [], mayContain: ['celery'] },
  ],
);

describe('what a new label changes', () => {
  it('finds each dish that gains or loses an allergen through the ingredient, however deep', () => {
    const shift = labelShift(book, ['fries', 'salad', 'special'], 'mayo', {
      allergens: ['eggs', 'mustard'],
      mayContain: ['eggs', 'sesame'],
    });
    expect(shift.dishes).toEqual([
      expect.objectContaining({
        dishId: 'fries',
        added: ['mustard'],
        removed: [],
        // Eggs are contained, so not a trace as well.
        mayAdded: ['sesame'],
        mayRemoved: [],
        after: { contains: ['eggs', 'mustard'], mayContain: ['celery', 'sesame'] },
      }),
    ]);
    // A dish this device can't work out is said, not left out silently.
    expect(shift.unknown).toEqual(['special']);
  });

  it('says what goes, and an allergen that becomes only a trace', () => {
    const shift = labelShift(book, ['fries'], 'potato', { allergens: [], mayContain: [] });
    expect(shift.dishes[0]).toMatchObject({ removed: [], mayRemoved: ['celery'] });
    const eggsGone = labelShift(book, ['fries'], 'mayo', { allergens: [], mayContain: ['eggs'] });
    expect(eggsGone.dishes[0]).toMatchObject({ removed: ['eggs'], mayAdded: ['eggs'] });
  });

  it('finds nothing when the label says what Mise has', () => {
    expect(
      labelShift(book, ['fries', 'salad'], 'mayo', { allergens: ['eggs'], mayContain: [] }),
    ).toEqual({
      dishes: [],
      unknown: [],
    });
  });
});
