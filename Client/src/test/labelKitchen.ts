import type { DishSummary, Ingredient, Recipe } from '@mise/contracts';

/**
 * A small kitchen for the label check tests: pesto in a sauce, the sauce in a
 * pasta on the lunch menu; a salad of leaves on no menu.
 */

export function ingredient(id: string, name: string, allergens: string[] = []): Ingredient {
  return {
    id,
    name,
    category: null,
    baseUnit: 'g',
    allergens: allergens as Ingredient['allergens'],
    mayContain: [],
    vegan: null,
    allergenDetails: { gluten: [], nuts: [] },
    notes: null,
    densityGPerMl: null,
    itemWeightG: null,
    yieldPercent: 100,
    labelCheck: null,
    updatedAt: '2026-11-01T10:00:00.000Z',
  };
}

const ref = (kind: 'ingredient' | 'recipe', id: string) =>
  kind === 'ingredient' ? ({ kind, ingredientId: id } as const) : ({ kind, recipeId: id } as const);

export function recipe(
  id: string,
  name: string,
  type: Recipe['type'],
  parts: ['ingredient' | 'recipe', string][],
): Recipe {
  return {
    id,
    name,
    type,
    status: 'published',
    stationId: null,
    yield: { value: 1, unit: type === 'dish' ? 'each' : 'kg' },
    portions: type === 'dish' ? 1 : null,
    prepMinutes: null,
    cookMinutes: null,
    shelfLifeHours: null,
    kept: null,
    storage: null,
    method: [],
    tags: [],
    declaredAllergens: [],
    mayContain: [],
    flavourProfile: [],
    servingTemperature: null,
    course: null,
    drinkPairings: [],
    cutlery: [],
    components: parts.map(([kind, partId], index) => ({
      id: `c-${id}-${index}`,
      sortOrder: index,
      section: null,
      note: null,
      quantity: { value: 100, unit: 'g' },
      ref: ref(kind, partId),
    })),
    photos: [],
    version: 1,
    updatedAt: '2026-11-01T10:00:00.000Z',
  };
}

export function dish(id: string, name: string, menus: string[]): DishSummary {
  return {
    id,
    name,
    status: 'published',
    course: null,
    servingTemperature: null,
    flavourProfile: [],
    menus,
    photoUrl: null,
    facts: null,
  };
}

export const PESTO = ingredient('i-pesto', 'Pesto', ['milk']);
export const LEAVES = ingredient('i-leaves', 'Leaves');
export const INGREDIENTS = [LEAVES, PESTO];
export const RECIPES = [
  recipe('r-sauce', 'Pesto sauce', 'prep', [['ingredient', PESTO.id]]),
  recipe('r-pasta', 'Pasta pesto', 'dish', [['recipe', 'r-sauce']]),
  recipe('r-salad', 'Salad', 'dish', [['ingredient', LEAVES.id]]),
];
export const DISHES = [dish('r-pasta', 'Pasta pesto', ['Lunch']), dish('r-salad', 'Salad', [])];
