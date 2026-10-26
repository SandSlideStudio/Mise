import {
  ALLERGENS,
  emptyAllergenProfile,
  mergeProfiles,
  type Allergen,
  type AllergenProfile,
} from './allergens.js';
import { rollUpAllergens, type RecipeBook, type RecipeError } from './recipe.js';
import { err, ok, type Result } from './result.js';

/**
 * The dish card: what front of house is handed for every dish on the menu.
 *
 * A server presenting a plate needs to know what it is, what goes with it, and
 * above all what is in it. The card answers the last question per component,
 * so "without the mustard crumble it's mustard-free" is something a server can
 * say with confidence rather than guess at.
 */

// --- front-of-house vocabulary ---------------------------------------------

/** Fixed lists, so the card can say them in whichever language it is printed in. */
export const SERVING_TEMPERATURES = ['cold', 'room', 'warm', 'hot', 'hot_and_cold'] as const;
export const COURSES = [
  'amuse',
  'starter',
  'middle',
  'main',
  'pre_dessert',
  'dessert',
  'mignardise',
  'side',
] as const;

export type ServingTemperature = (typeof SERVING_TEMPERATURES)[number];
export type Course = (typeof COURSES)[number];

/**
 * The order allergens run across a card. Not the order of the law: the order
 * kitchens already print, with the common ones first.
 */
export const DISH_CARD_ALLERGEN_ORDER: readonly Allergen[] = [
  'eggs',
  'gluten',
  'lupin',
  'milk',
  'mustard',
  'sulphites',
  'molluscs',
  'fish',
  'soybeans',
  'sesame',
  'celery',
  'crustaceans',
  'peanuts',
  'nuts',
];

// --- vegan ------------------------------------------------------------------

/**
 * Whether something is vegan. "Unknown" is a real answer: an ingredient nobody
 * has said anything about is not vegan by default, because a card handed to a
 * guest must never claim it on the strength of an empty field.
 */
export type VeganStatus = 'yes' | 'no' | 'unknown';

/** The weakest of several answers: one "no" makes the whole thing not vegan. */
export function combineVegan(statuses: readonly VeganStatus[]): VeganStatus {
  if (statuses.includes('no')) return 'no';
  if (statuses.includes('unknown')) return 'unknown';
  return 'yes';
}

function veganOf(value: boolean | null | undefined): VeganStatus {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'unknown';
}

/**
 * Vegan all the way down: every ingredient in every sub-recipe has to be.
 * A recipe with nothing in it says nothing about itself, so it is unknown.
 */
export function rollUpVegan(recipeId: string, book: RecipeBook): Result<VeganStatus, RecipeError> {
  const memo = new Map<string, VeganStatus>();
  const onPath = new Set<string>();

  function visit(id: string): Result<VeganStatus, RecipeError> {
    const cached = memo.get(id);
    if (cached) return ok(cached);
    if (onPath.has(id)) return err({ kind: 'cycle', path: [...onPath, id] });

    const recipe = book.recipe(id);
    if (!recipe) return err({ kind: 'missing_recipe', recipeId: id });
    if (recipe.components.length === 0) return ok('unknown');

    onPath.add(id);
    const parts: VeganStatus[] = [];
    for (const component of recipe.components) {
      if (component.ref.kind === 'ingredient') {
        const ingredient = book.ingredient(component.ref.ingredientId);
        if (!ingredient) {
          onPath.delete(id);
          return err({ kind: 'missing_ingredient', ingredientId: component.ref.ingredientId });
        }
        parts.push(veganOf(ingredient.vegan));
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

    const status = combineVegan(parts);
    memo.set(id, status);
    return ok(status);
  }

  return visit(recipeId);
}

// --- which cereal, which nut ------------------------------------------------

/**
 * The law asks for the name of the gluten cereal and of the nut, not just a
 * cross in the column: "contains gluten (wheat)", "contains nuts (hazelnut)".
 */
export interface AllergenDetails {
  gluten: string[];
  nuts: string[];
}

export function emptyAllergenDetails(): AllergenDetails {
  return { gluten: [], nuts: [] };
}

/** Union of several lists of names, ignoring case, in the order first seen. */
function mergeNames(...lists: readonly (readonly string[] | undefined)[]): string[] {
  const seen = new Map<string, string>();
  for (const list of lists) {
    for (const raw of list ?? []) {
      const name = raw.trim();
      if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
    }
  }
  return [...seen.values()];
}

export function mergeAllergenDetails(
  ...details: readonly (Partial<AllergenDetails> | null | undefined)[]
): AllergenDetails {
  return {
    gluten: mergeNames(...details.map((d) => d?.gluten)),
    nuts: mergeNames(...details.map((d) => d?.nuts)),
  };
}

/** Every cereal and nut named anywhere beneath a recipe. */
export function rollUpAllergenDetails(
  recipeId: string,
  book: RecipeBook,
): Result<AllergenDetails, RecipeError> {
  const memo = new Map<string, AllergenDetails>();
  const onPath = new Set<string>();

  function visit(id: string): Result<AllergenDetails, RecipeError> {
    const cached = memo.get(id);
    if (cached) return ok(cached);
    if (onPath.has(id)) return err({ kind: 'cycle', path: [...onPath, id] });

    const recipe = book.recipe(id);
    if (!recipe) return err({ kind: 'missing_recipe', recipeId: id });

    onPath.add(id);
    const parts: Partial<AllergenDetails>[] = [];
    for (const component of recipe.components) {
      if (component.ref.kind === 'ingredient') {
        const ingredient = book.ingredient(component.ref.ingredientId);
        if (!ingredient) {
          onPath.delete(id);
          return err({ kind: 'missing_ingredient', ingredientId: component.ref.ingredientId });
        }
        parts.push(ingredient.allergenDetails ?? {});
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

    const details = mergeAllergenDetails(...parts);
    memo.set(id, details);
    return ok(details);
  }

  return visit(recipeId);
}

// --- the matrix ---------------------------------------------------------------

export interface DishCardRow {
  /** The sub-recipe this row is, or null for the row of everything else. */
  recipeId: string | null;
  name: string;
  allergens: AllergenProfile;
  vegan: VeganStatus;
  details: AllergenDetails;
}

export interface DishCardMatrix {
  /** One row per sub-recipe, in the order the dish lists them. */
  rows: DishCardRow[];
  /**
   * Allergens, vegan status or details that come from something sitting
   * directly in the dish rather than in a sub-recipe, when they add anything
   * the rows don't already say. Null when they add nothing.
   */
  other: Omit<DishCardRow, 'recipeId' | 'name'> | null;
  /** The whole dish, everything included. */
  dish: Omit<DishCardRow, 'recipeId' | 'name'>;
}

const VEGAN_RANK: Record<VeganStatus, number> = { yes: 0, unknown: 1, no: 2 };

/**
 * The allergen table on the back of a dish card.
 *
 * The rows are the dish's sub-recipes, because that is how front of house
 * thinks about a plate. But a card that leaves an allergen out can put a
 * guest in hospital, so anything the dish carries outside its sub-recipes, a
 * garnish of raw hazelnut or an allergen declared on the dish itself, gets a
 * row of its own rather than going missing.
 */
export function dishCardMatrix(
  dishId: string,
  book: RecipeBook,
): Result<DishCardMatrix, RecipeError> {
  const dish = book.recipe(dishId);
  if (!dish) return err({ kind: 'missing_recipe', recipeId: dishId });

  const rows: DishCardRow[] = [];
  const seen = new Set<string>();
  const direct: { allergens: AllergenProfile; vegan: VeganStatus[]; details: AllergenDetails[] } = {
    allergens: {
      contains: dish.declaredAllergens ?? [],
      mayContain: dish.mayContain ?? [],
    },
    vegan: [],
    details: [],
  };
  let hasDirect = (dish.declaredAllergens?.length ?? 0) + (dish.mayContain?.length ?? 0) > 0;

  const ordered = [...dish.components].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const component of ordered) {
    if (component.ref.kind === 'ingredient') {
      const ingredient = book.ingredient(component.ref.ingredientId);
      if (!ingredient) {
        return err({ kind: 'missing_ingredient', ingredientId: component.ref.ingredientId });
      }
      hasDirect = true;
      direct.allergens = mergeProfiles(direct.allergens, {
        contains: ingredient.allergens,
        mayContain: [],
      });
      direct.vegan.push(veganOf(ingredient.vegan));
      direct.details.push(mergeAllergenDetails(ingredient.allergenDetails));
      continue;
    }

    const childId = component.ref.recipeId;
    if (seen.has(childId)) continue;
    seen.add(childId);

    const child = book.recipe(childId);
    if (!child) return err({ kind: 'missing_recipe', recipeId: childId });
    const allergens = rollUpAllergens(childId, book);
    if (!allergens.ok) return allergens;
    const vegan = rollUpVegan(childId, book);
    if (!vegan.ok) return vegan;
    const details = rollUpAllergenDetails(childId, book);
    if (!details.ok) return details;

    rows.push({
      recipeId: childId,
      name: child.name,
      allergens: allergens.value,
      vegan: vegan.value,
      details: details.value,
    });
  }

  const dishAllergens = rollUpAllergens(dishId, book);
  if (!dishAllergens.ok) return dishAllergens;
  const dishDetails = rollUpAllergenDetails(dishId, book);
  if (!dishDetails.ok) return dishDetails;
  const everyVegan = [...rows.map((row) => row.vegan), ...direct.vegan];
  const dishVegan = everyVegan.length > 0 ? combineVegan(everyVegan) : 'unknown';

  let other: DishCardMatrix['other'] = null;
  if (hasDirect) {
    const covered = mergeProfiles(...rows.map((row) => row.allergens), emptyAllergenProfile());
    const coveredDetails = mergeAllergenDetails(...rows.map((row) => row.details));
    const otherDetails = mergeAllergenDetails(...direct.details);
    const otherVegan = combineVegan(direct.vegan);
    const rowsVegan = rows.length > 0 ? combineVegan(rows.map((row) => row.vegan)) : 'yes';

    const addsAllergen =
      direct.allergens.contains.some((a) => !covered.contains.includes(a)) ||
      direct.allergens.mayContain.some(
        (a) => !covered.contains.includes(a) && !covered.mayContain.includes(a),
      );
    const addsDetail =
      otherDetails.gluten.some((n) => !includesName(coveredDetails.gluten, n)) ||
      otherDetails.nuts.some((n) => !includesName(coveredDetails.nuts, n));
    const lowersVegan = direct.vegan.length > 0 && VEGAN_RANK[otherVegan] > VEGAN_RANK[rowsVegan];

    if (addsAllergen || addsDetail || lowersVegan) {
      other = {
        allergens: direct.allergens,
        vegan: direct.vegan.length > 0 ? otherVegan : 'yes',
        details: otherDetails,
      };
    }
  }

  return ok({
    rows,
    other,
    dish: { allergens: dishAllergens.value, vegan: dishVegan, details: dishDetails.value },
  });
}

function includesName(list: readonly string[], name: string): boolean {
  return list.some((n) => n.toLowerCase() === name.toLowerCase());
}

/** For the type checker: the order covers every allergen exactly once. */
export function isCompleteAllergenOrder(order: readonly Allergen[]): boolean {
  return order.length === ALLERGENS.length && ALLERGENS.every((a) => order.includes(a));
}
