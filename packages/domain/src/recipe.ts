import {
  type Allergen,
  type AllergenProfile,
  emptyAllergenProfile,
  mergeProfiles,
} from './allergens.js';
import type { AllergenDetails } from './dishcard.js';
import { err, ok, type Result } from './result.js';
import { convert, dimensionOf, toBase, type ConversionContext, type Quantity } from './units.js';
import type { BaseUnit, UnitCode } from './units.js';

/**
 * The recipe graph, expressed without any reference to the database.
 *
 * A recipe is a list of components. Each component is either a raw ingredient
 * or another recipe. That single rule is what makes a restaurant recipe
 * different from a home one: a dish contains a sauce, which contains a stock,
 * and scaling the dish has to scale all the way down.
 */

export type RecipeType = 'dish' | 'prep' | 'component';

/**
 * A dish is plated to order, so a new one is written for a single plate: its
 * components are what goes on one plate, and scaling to 40 covers multiplies
 * by 40. Batch sizes only mean something for preps and components.
 */
export const ONE_PLATE = { yield: { value: 1, unit: 'each' }, portions: 1 } as const satisfies {
  yield: Quantity;
  portions: number;
};

export interface Ingredient {
  id: string;
  name: string;
  /** The unit this ingredient is normally counted in. */
  baseUnit: BaseUnit;
  allergens: Allergen[];
  densityGPerMl?: number | null;
  itemWeightG?: number | null;
  /**
   * Edible portion as a percentage of what you buy. Onions come in around 90:
   * a kilo bought is 900 g once peeled and trimmed.
   */
  yieldPercent: number;
  /** True or false when someone has said; null or absent when nobody has. */
  vegan?: boolean | null;
  /** Which gluten cereals and which nuts, for the ones that contain them. */
  allergenDetails?: Partial<AllergenDetails> | null;
}

export type ComponentRef =
  { kind: 'ingredient'; ingredientId: string } | { kind: 'recipe'; recipeId: string };

export interface RecipeComponent {
  id: string;
  sortOrder: number;
  /** Optional heading, so a recipe can read "For the marinade". */
  section?: string | null;
  /** Free text such as "finely diced" or "picked and washed". */
  note?: string | null;
  quantity: Quantity;
  ref: ComponentRef;
}

export interface Recipe {
  id: string;
  name: string;
  type: RecipeType;
  stationId?: string | null;
  /** What one batch of this recipe produces. */
  yield: Quantity;
  /** How many plates a batch covers, when the recipe is a dish. */
  portions?: number | null;
  components: RecipeComponent[];
  /** Allergens the chef asserts directly, beyond what the ingredients imply. */
  declaredAllergens?: Allergen[];
  mayContain?: Allergen[];
}

/** Read-only lookup over everything the maths needs. */
export interface RecipeBook {
  recipe(id: string): Recipe | undefined;
  ingredient(id: string): Ingredient | undefined;
}

export function createRecipeBook(
  recipes: readonly Recipe[],
  ingredients: readonly Ingredient[],
): RecipeBook {
  const recipeMap = new Map(recipes.map((r) => [r.id, r]));
  const ingredientMap = new Map(ingredients.map((i) => [i.id, i]));
  return {
    recipe: (id) => recipeMap.get(id),
    ingredient: (id) => ingredientMap.get(id),
  };
}

export function conversionContextFor(i: Ingredient): ConversionContext {
  return { densityGPerMl: i.densityGPerMl ?? null, itemWeightG: i.itemWeightG ?? null };
}

// --- errors ---------------------------------------------------------------

export type RecipeError =
  | { kind: 'missing_recipe'; recipeId: string }
  | { kind: 'missing_ingredient'; ingredientId: string }
  | { kind: 'cycle'; path: string[] }
  | { kind: 'zero_yield'; recipeId: string }
  | { kind: 'no_portions'; recipeId: string }
  | { kind: 'incompatible_units'; recipeId: string; from: UnitCode; to: UnitCode };

// --- cycles ---------------------------------------------------------------

/**
 * Depth-first search for a recipe that contains itself. Returns the path of
 * recipe ids that closes the loop, or null when the graph is sound.
 *
 * This is checked on every write, not just in the UI, because a cycle makes
 * scaling and explosion non-terminating.
 */
export function findCycle(rootId: string, book: RecipeBook): string[] | null {
  const path: string[] = [];
  const onPath = new Set<string>();
  const settled = new Set<string>();

  function visit(id: string): string[] | null {
    if (onPath.has(id)) {
      return [...path.slice(path.indexOf(id)), id];
    }
    if (settled.has(id)) return null;

    const recipe = book.recipe(id);
    if (!recipe) return null; // A missing recipe is a different error.

    onPath.add(id);
    path.push(id);
    for (const component of recipe.components) {
      if (component.ref.kind !== 'recipe') continue;
      const found = visit(component.ref.recipeId);
      if (found) return found;
    }
    path.pop();
    onPath.delete(id);
    settled.add(id);
    return null;
  }

  return visit(rootId);
}

/**
 * Whether adding `childId` as a component of `parentId` would close a loop.
 * Call this before persisting a component.
 */
export function wouldCreateCycle(parentId: string, childId: string, book: RecipeBook): boolean {
  if (parentId === childId) return true;
  const seen = new Set<string>();
  const stack = [childId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (id === parentId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const recipe = book.recipe(id);
    if (!recipe) continue;
    for (const component of recipe.components) {
      if (component.ref.kind === 'recipe') stack.push(component.ref.recipeId);
    }
  }
  return false;
}

// --- scaling --------------------------------------------------------------

/** Multiplier that takes one batch of a recipe to the requested portion count. */
export function factorForPortions(
  recipe: Recipe,
  targetPortions: number,
): Result<number, RecipeError> {
  if (!recipe.portions || recipe.portions <= 0) {
    return err({ kind: 'no_portions', recipeId: recipe.id });
  }
  return ok(targetPortions / recipe.portions);
}

/** Multiplier that takes one batch of a recipe to the requested output quantity. */
export function factorForYield(
  recipe: Recipe,
  target: Quantity,
  context: ConversionContext = {},
): Result<number, RecipeError> {
  const batch = toBase(recipe.yield);
  if (batch === 0) return err({ kind: 'zero_yield', recipeId: recipe.id });

  if (dimensionOf(target.unit) !== dimensionOf(recipe.yield.unit)) {
    const converted = convert(target, recipe.yield.unit, context);
    if (!converted.ok) {
      return err({
        kind: 'incompatible_units',
        recipeId: recipe.id,
        from: target.unit,
        to: recipe.yield.unit,
      });
    }
    return ok(toBase(converted.value) / batch);
  }
  return ok(toBase(target) / batch);
}

/** A recipe with every component quantity multiplied. Sub-recipes are untouched. */
export function scaleRecipe(recipe: Recipe, factor: number): Recipe {
  return {
    ...recipe,
    yield: { value: recipe.yield.value * factor, unit: recipe.yield.unit },
    portions: recipe.portions == null ? recipe.portions : recipe.portions * factor,
    components: recipe.components.map((c) => ({
      ...c,
      quantity: { value: c.quantity.value * factor, unit: c.quantity.unit },
    })),
  };
}

// --- allergen roll-up -----------------------------------------------------

/**
 * Union of every allergen reachable from a recipe, following sub-recipes all
 * the way down. A missing ingredient or recipe is an error rather than a
 * silent omission, because under-declaring an allergen is the one bug in this
 * system that can put someone in hospital.
 */
export function rollUpAllergens(
  recipeId: string,
  book: RecipeBook,
): Result<AllergenProfile, RecipeError> {
  const memo = new Map<string, AllergenProfile>();
  const onPath = new Set<string>();

  function visit(id: string): Result<AllergenProfile, RecipeError> {
    const cached = memo.get(id);
    if (cached) return ok(cached);
    if (onPath.has(id)) return err({ kind: 'cycle', path: [...onPath, id] });

    const recipe = book.recipe(id);
    if (!recipe) return err({ kind: 'missing_recipe', recipeId: id });

    onPath.add(id);
    const parts: AllergenProfile[] = [
      { contains: recipe.declaredAllergens ?? [], mayContain: recipe.mayContain ?? [] },
    ];

    for (const component of recipe.components) {
      if (component.ref.kind === 'ingredient') {
        const ingredient = book.ingredient(component.ref.ingredientId);
        if (!ingredient) {
          onPath.delete(id);
          return err({ kind: 'missing_ingredient', ingredientId: component.ref.ingredientId });
        }
        parts.push({ contains: ingredient.allergens, mayContain: [] });
      } else {
        const child = visit(component.ref.recipeId);
        if (!child.ok) {
          onPath.delete(id);
          return child;
        }
        parts.push(child.value);
      }
    }

    onPath.delete(id);
    const profile = parts.length > 0 ? mergeProfiles(...parts) : emptyAllergenProfile();
    memo.set(id, profile);
    return ok(profile);
  }

  return visit(recipeId);
}
