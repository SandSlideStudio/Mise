import { describe, expect, it } from 'vitest';
import { DISHES, INGREDIENTS, PESTO, recipe, RECIPES } from '../test/labelKitchen.js';
import { labelConsequences, labelDiffers } from './labelChecks.js';

/** What a label changes, worked out on the device from what it holds. */

describe('the consequences of a label', () => {
  it('names each dish that changes, however deep the ingredient sits, with its menus', () => {
    const result = labelConsequences(RECIPES, INGREDIENTS, DISHES, PESTO.id, {
      allergens: ['milk', 'nuts'],
      mayContain: ['peanuts'],
    });
    expect(result).toEqual({
      dishes: [
        {
          id: 'r-pasta',
          name: 'Pasta pesto',
          menus: ['Lunch'],
          added: ['nuts'],
          removed: [],
          mayAdded: ['peanuts'],
          mayRemoved: [],
        },
      ],
      unknown: 0,
    });
  });

  it('puts dishes on a menu first, and counts what it cannot work out', () => {
    const recipes = [
      ...RECIPES,
      recipe('r-toast', 'A toast', 'dish', [['ingredient', PESTO.id]]),
      recipe('r-gone', 'Missing part', 'dish', [['recipe', 'not-on-this-device']]),
    ];
    const result = labelConsequences(recipes, INGREDIENTS, DISHES, PESTO.id, {
      allergens: [],
      mayContain: [],
    });
    expect(result.dishes.map((dish) => dish.name)).toEqual(['Pasta pesto', 'A toast']);
    expect(result.dishes[0]!.removed).toEqual(['milk']);
    expect(result.unknown).toBe(1);
  });

  it('leaves archived dishes out: they are on no menu', () => {
    const archived = { ...RECIPES[1]!, status: 'archived' as const };
    const result = labelConsequences([RECIPES[0]!, archived], INGREDIENTS, DISHES, PESTO.id, {
      allergens: ['milk', 'eggs'],
      mayContain: [],
    });
    expect(result.dishes).toEqual([]);
  });
});

describe('whether a label differs', () => {
  it('goes by what is in the lists, not their order, and ignores a trace of what it contains', () => {
    const ingredient = { ...PESTO, allergens: ['milk' as const, 'eggs' as const] };
    expect(labelDiffers(ingredient, { allergens: ['eggs', 'milk'], mayContain: ['milk'] })).toBe(
      false,
    );
    expect(labelDiffers(PESTO, { allergens: ['milk'], mayContain: ['nuts'] })).toBe(true);
    expect(labelDiffers(PESTO, { allergens: [], mayContain: [] })).toBe(true);
  });
});
