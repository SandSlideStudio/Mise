import {
  expandRecipe,
  factorFor,
  isAllergen,
  isUnitCode,
  type ExpandError,
  type Quantity,
  type RecipeBook,
} from '@mise/domain';
import type { createRecipesService } from './service.js';

/**
 * How a stored recipe is shown over the API.
 *
 * Kept apart from the routes because the loading-ahead bundle
 * (modules/offline) must hand out exactly what the individual endpoints do.
 */

export type StoredRecipe = NonNullable<
  Awaited<ReturnType<ReturnType<typeof createRecipesService>['getRecipe']>>
>;

/**
 * withCosts: whether the reader may see what a dish sells for. Off unless
 * said, so an answer never carries a price by forgetting to ask.
 */
export function serialise(row: StoredRecipe, names: Map<string, string>, withCosts = false) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    stationId: row.stationId,
    yield: {
      value: row.yieldEntered,
      unit: isUnitCode(row.yieldUnit) ? row.yieldUnit : ('g' as const),
    },
    portions: row.portions,
    prepMinutes: row.prepMinutes,
    cookMinutes: row.cookMinutes,
    shelfLifeHours: row.shelfLifeHours,
    storage: row.storage,
    method: row.method,
    tags: row.tags,
    declaredAllergens: row.declaredAllergens.filter(isAllergen),
    mayContain: row.mayContain.filter(isAllergen),
    flavourProfile: row.flavourProfile,
    servingTemperature: row.servingTemperature,
    course: row.course,
    drinkPairings: row.drinkPairings,
    cutlery: row.cutlery,
    components: row.components.map((component) => ({
      id: component.id,
      sortOrder: component.sortOrder,
      section: component.section,
      note: component.note,
      quantity: {
        value: component.quantityEntered,
        unit: isUnitCode(component.unitEntered) ? component.unitEntered : ('g' as const),
      },
      ref: component.childRecipeId
        ? ({ kind: 'recipe', recipeId: component.childRecipeId } as const)
        : ({ kind: 'ingredient', ingredientId: component.ingredientId! } as const),
      displayName: names.get(component.id) ?? '',
    })),
    photos: row.photos.map((photo) => ({
      id: photo.id,
      url: `/api/uploads/${photo.path}`,
      caption: photo.caption,
      isPrimary: photo.isPrimary,
    })),
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    ...(withCosts ? { sellPrice: row.sellPrice } : {}),
  };
}

/** One line of the recipe list. */
export function summarise(row: {
  id: string;
  name: string;
  type: StoredRecipe['type'];
  status: StoredRecipe['status'];
  stationId: string | null;
  yieldEntered: number;
  yieldUnit: string;
  portions: number | null;
  tags: string[];
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    stationId: row.stationId,
    yield: {
      value: row.yieldEntered,
      unit: isUnitCode(row.yieldUnit) ? row.yieldUnit : ('g' as const),
    },
    portions: row.portions,
    tags: row.tags,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface ScaleRequest {
  factor?: number | undefined;
  portions?: number | undefined;
  yieldValue?: number | undefined;
  yieldUnit?: Quantity['unit'] | undefined;
}

/**
 * The tree at a requested size, worked out against a book that is already
 * loaded. Returns the failure instead of throwing, so the route can word it
 * and the bundle can simply leave that recipe out.
 */
export function expandAgainst(recipeId: string, query: ScaleRequest, book: RecipeBook) {
  const target: { portions?: number; factor?: number; yield?: Quantity } = {};
  if (query.factor !== undefined) target.factor = query.factor;
  else if (query.portions !== undefined) target.portions = query.portions;
  else if (query.yieldValue !== undefined && query.yieldUnit !== undefined) {
    target.yield = { value: query.yieldValue, unit: query.yieldUnit };
  }

  const factor = factorFor(recipeId, target, book);
  if (!factor.ok) return { ok: false as const, error: factor.error };

  const lines = expandRecipe(recipeId, factor.value, book);
  if (!lines.ok) return { ok: false as const, error: lines.error };

  return { ok: true as const, value: { factor: factor.value, lines: lines.value } };
}

export type { ExpandError };
