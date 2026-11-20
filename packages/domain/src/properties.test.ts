import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ALLERGENS, ANIMAL_ALLERGENS, type Allergen, type AllergenProfile } from './allergens.js';
import { costRecipe, ingredientCost, type CostGap } from './cost.js';
import {
  dishCardMatrix,
  rollUpAllergenDetails,
  rollUpVegan,
  type AllergenDetails,
  type VeganStatus,
} from './dishcard.js';
import { expandRecipe } from './expand.js';
import { labelShift, type LabelReading } from './labelCheck.js';
import { toMakeForPar } from './par.js';
import {
  createRecipeBook,
  factorForYield,
  findCycle,
  rollUpAllergens,
  scaleRecipe,
  wouldCreateCycle,
  type Ingredient,
  type Recipe,
  type RecipeBook,
  type RecipeComponent,
} from './recipe.js';
import { ALL_UNITS, dimensionOf, toBase, type Quantity, type UnitCode } from './units.js';
import { computeUseBy, KEPT } from './useby.js';

/**
 * Randomised checks of the allergen roll-ups, the dish card, the label check,
 * scaling, costing, pars and use-by dates.
 *
 * Each case builds a random kitchen from a fixed seed, so a failure names the
 * seed it came from and runs the same way again. The allergen answers are
 * checked against a reference written to be obviously right rather than fast:
 * a plain walk of the recipe tree, with no caching and no shortcuts, that
 * reads every ingredient every time it is reached.
 */

// --- a small seeded random generator ------------------------------------------

/** mulberry32: tiny, fast and good enough to explore a kitchen with. */
function generator(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    chance: (p: number) => next() < p,
    pick<T>(list: readonly T[]): T {
      return list[Math.floor(next() * list.length)] as T;
    },
    subset<T>(list: readonly T[], p: number): T[] {
      return list.filter(() => next() < p);
    },
    shuffle<T>(list: readonly T[]): T[] {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j] as T, out[i] as T];
      }
      return out;
    },
  };
}
type Random = ReturnType<typeof generator>;

/**
 * Run `cases` seeds of a property. On a failure, say which seed and what the
 * case looked like, so it can be turned into a fixed test.
 */
function forAll(cases: number, base: number, property: (rng: Random, seed: number) => void) {
  for (let i = 0; i < cases; i++) {
    const seed = base + i;
    try {
      property(generator(seed), seed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`seed ${seed}: ${message}`, { cause: error });
    }
  }
}

// --- random kitchens ----------------------------------------------------------

const MASS: UnitCode[] = ['mg', 'g', 'kg', 'oz', 'lb'];
const VOLUME: UnitCode[] = ['ml', 'cl', 'dl', 'l', 'tsp', 'tbsp', 'floz', 'cup', 'pt', 'qt'];
const COUNT: UnitCode[] = ['each', 'dozen'];
const UNITS_BY_BASE = { g: MASS, ml: VOLUME, each: COUNT } as const;
/** Names written the way people type them: different case, stray spaces. */
const CEREALS = ['wheat', 'Wheat', ' spelt', 'rye', 'barley ', 'OATS', 'kamut'];
const NUTS = ['hazelnut', 'Hazelnut ', 'almond', 'walnut', 'cashew', 'PECAN', 'pistachio'];

interface Kitchen {
  ingredients: Ingredient[];
  recipes: Recipe[];
  dishIds: string[];
  book: RecipeBook;
}

function randomQuantity(rng: Random, units: readonly UnitCode[]): Quantity {
  const value = rng.pick([0.25, 0.5, 1, 2, 3, 7.5, 12, 40, 125, 1000, rng.next() * 500]);
  return { value, unit: rng.pick(units) };
}

function randomIngredient(rng: Random, i: number): Ingredient {
  const baseUnit = rng.pick(['g', 'ml', 'each'] as const);
  const allergens = rng.subset(ALLERGENS, 0.12);
  const details: Partial<AllergenDetails> | null = rng.chance(0.3)
    ? null
    : {
        ...(rng.chance(0.5) ? { gluten: rng.subset(CEREALS, 0.2) } : {}),
        ...(rng.chance(0.5) ? { nuts: rng.subset(NUTS, 0.2) } : {}),
      };
  return {
    id: `i${i}`,
    name: `ingredient ${i}`,
    baseUnit,
    allergens: rng.shuffle(allergens),
    // Sometimes overlapping what it contains, as a careless label reads.
    mayContain: rng.chance(0.2) ? undefined : rng.subset(ALLERGENS, 0.08),
    vegan: rng.pick([true, true, true, false, null, undefined]),
    allergenDetails: details,
    densityGPerMl: rng.chance(0.5) ? 0.5 + rng.next() : null,
    itemWeightG: rng.chance(0.5) ? 5 + rng.next() * 200 : null,
    yieldPercent: rng.chance(0.5) ? rng.int(40, 100) : null,
    price: rng.chance(0.8)
      ? {
          amount: Math.round(rng.next() * 5000) / 100,
          quantity: randomQuantity(
            rng,
            ALL_UNITS.map((u) => u.code),
          ),
        }
      : null,
  };
}

/**
 * A kitchen of a dozen or so ingredients and recipes in layers up to seven
 * deep. A recipe only uses recipes from lower layers, so the graph has no
 * loops, but the same sub-recipe can be used by many recipes, and twice by
 * one. Most sub-recipe lines are measured in a unit their yield converts to;
 * some are not, the way old data can be.
 */
function randomKitchen(rng: Random, opts: { mismatchedUnits?: boolean } = {}): Kitchen {
  const mismatched = opts.mismatchedUnits ?? true;
  const ingredients = Array.from({ length: rng.int(1, 14) }, (_, i) => randomIngredient(rng, i));
  const layers = rng.int(1, 7);
  const recipes: Recipe[] = [];
  const byLayer: Recipe[][] = [];
  for (let layer = 0; layer < layers; layer++) {
    const here: Recipe[] = [];
    const count = rng.int(1, 4);
    const below = byLayer.flat();
    for (let k = 0; k < count; k++) {
      const id = `r${layer}_${k}`;
      const yieldUnit = rng.pick([...MASS, ...VOLUME, ...COUNT]);
      const components: RecipeComponent[] = [];
      // Fewer lines higher up, so a spec stays a size a kitchen writes.
      const lines = rng.chance(0.08) ? 0 : rng.int(1, layer > 2 ? 3 : 4);
      for (let c = 0; c < lines; c++) {
        const useRecipe = below.length > 0 && rng.chance(0.45);
        if (useRecipe) {
          const child = rng.pick(below);
          const units =
            mismatched && rng.chance(0.1)
              ? [...MASS, ...VOLUME, ...COUNT]
              : UNITS_BY_BASE[toBaseUnit(child.yield.unit)];
          components.push(
            component(`${id}c${c}`, randomQuantity(rng, units), {
              kind: 'recipe',
              recipeId: child.id,
            }),
          );
        } else {
          const ingredient = rng.pick(ingredients);
          components.push(
            component(`${id}c${c}`, randomQuantity(rng, [...MASS, ...VOLUME, ...COUNT]), {
              kind: 'ingredient',
              ingredientId: ingredient.id,
            }),
          );
        }
      }
      const recipe: Recipe = {
        id,
        name: `recipe ${id}`,
        type: rng.pick(['prep', 'component'] as const),
        yield: { value: rng.pick([0.5, 1, 2, 5, 12, 250, 1000]), unit: yieldUnit },
        portions: rng.chance(0.3) ? rng.int(1, 20) : null,
        components: shuffleOrder(rng, components),
        declaredAllergens: rng.chance(0.3) ? undefined : rng.subset(ALLERGENS, 0.05),
        mayContain: rng.chance(0.3) ? undefined : rng.subset(ALLERGENS, 0.05),
      };
      here.push(recipe);
      recipes.push(recipe);
    }
    byLayer.push(here);
  }

  const all = byLayer.flat();
  const dishIds: string[] = [];
  for (let d = 0; d < rng.int(1, 4); d++) {
    const id = `dish${d}`;
    const components: RecipeComponent[] = [];
    for (let c = 0; c < rng.int(0, 5); c++) {
      if (rng.chance(0.7)) {
        const child = rng.pick(all);
        components.push(
          component(
            `${id}c${c}`,
            randomQuantity(rng, UNITS_BY_BASE[toBaseUnit(child.yield.unit)]),
            {
              kind: 'recipe',
              recipeId: child.id,
            },
          ),
        );
      } else {
        components.push(
          component(`${id}c${c}`, randomQuantity(rng, MASS), {
            kind: 'ingredient',
            ingredientId: rng.pick(ingredients).id,
          }),
        );
      }
    }
    recipes.push({
      id,
      name: `dish ${d}`,
      type: 'dish',
      yield: { value: 1, unit: 'each' },
      portions: 1,
      components: shuffleOrder(rng, components),
      declaredAllergens: rng.subset(ALLERGENS, 0.04),
      mayContain: rng.subset(ALLERGENS, 0.04),
    });
    dishIds.push(id);
  }
  return { ingredients, recipes, dishIds, book: createRecipeBook(recipes, ingredients) };
}

function toBaseUnit(u: UnitCode): 'g' | 'ml' | 'each' {
  const dimension = dimensionOf(u);
  return dimension === 'mass' ? 'g' : dimension === 'volume' ? 'ml' : 'each';
}

function component(id: string, quantity: Quantity, ref: RecipeComponent['ref']): RecipeComponent {
  return { id, sortOrder: 0, quantity, ref };
}

/** Stored in any order, with sort orders that say the real one. */
function shuffleOrder(rng: Random, components: RecipeComponent[]): RecipeComponent[] {
  return rng.shuffle(components.map((c, i) => ({ ...c, sortOrder: i * 10 })));
}

/** Just the part of the kitchen under one recipe, for a failure message. */
function describeFrom(kitchen: Kitchen, rootId: string): string {
  const lines: string[] = [];
  const shown = new Set<string>();
  const ingredients = new Set<string>();
  const walk = (id: string) => {
    if (shown.has(id)) return;
    shown.add(id);
    const recipe = kitchen.book.recipe(id);
    if (!recipe) return void lines.push(`${id}: (missing)`);
    const parts = recipe.components.map((c) => {
      const ref = c.ref.kind === 'ingredient' ? c.ref.ingredientId : c.ref.recipeId;
      return `${c.quantity.value}${c.quantity.unit} ${ref}`;
    });
    lines.push(
      `${id} [yield ${recipe.yield.value}${recipe.yield.unit}; declares ${(recipe.declaredAllergens ?? []).join(',')}; may ${(recipe.mayContain ?? []).join(',')}]: ${parts.join(' | ')}`,
    );
    for (const c of recipe.components) {
      if (c.ref.kind === 'recipe') walk(c.ref.recipeId);
      else ingredients.add(c.ref.ingredientId);
    }
  };
  walk(rootId);
  for (const id of ingredients) {
    const i = kitchen.book.ingredient(id);
    lines.push(
      i
        ? `${id}: contains ${i.allergens.join(',')}; may ${(i.mayContain ?? []).join(',')}; vegan ${String(i.vegan)}; details ${JSON.stringify(i.allergenDetails)}`
        : `${id}: (missing)`,
    );
  }
  return lines.join('\n');
}

/** Check an expectation, and on a failure print the recipe tree it was about. */
function about(kitchen: Kitchen, rootId: string, check: () => void) {
  try {
    check();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\nunder ${rootId}:\n${describeFrom(kitchen, rootId)}`, {
      cause: error,
    });
  }
}

// --- the reference: a naive walk ------------------------------------------------

/** Everything reachable from a recipe, every time it is reached, in any order. */
function reachable(book: RecipeBook, rootId: string) {
  const ingredients: Ingredient[] = [];
  const recipes: Recipe[] = [];
  const walk = (id: string) => {
    const recipe = book.recipe(id);
    if (!recipe) throw new Error(`reference: missing recipe ${id}`);
    recipes.push(recipe);
    for (const c of recipe.components) {
      if (c.ref.kind === 'recipe') walk(c.ref.recipeId);
      else {
        const ingredient = book.ingredient(c.ref.ingredientId);
        if (!ingredient) throw new Error(`reference: missing ingredient ${c.ref.ingredientId}`);
        ingredients.push(ingredient);
      }
    }
  };
  walk(rootId);
  return { ingredients, recipes };
}

function referenceProfile(book: RecipeBook, rootId: string): AllergenProfile {
  const { ingredients, recipes } = reachable(book, rootId);
  const contains = new Set<Allergen>();
  const may = new Set<Allergen>();
  for (const i of ingredients) {
    i.allergens.forEach((a) => contains.add(a));
    (i.mayContain ?? []).forEach((a) => may.add(a));
  }
  for (const r of recipes) {
    (r.declaredAllergens ?? []).forEach((a) => contains.add(a));
    (r.mayContain ?? []).forEach((a) => may.add(a));
  }
  return {
    contains: ALLERGENS.filter((a) => contains.has(a)),
    mayContain: ALLERGENS.filter((a) => may.has(a) && !contains.has(a)),
  };
}

/**
 * Vegan: "no" when anything reachable is known not to be (an ingredient
 * marked so, or anything containing milk, eggs, fish or shellfish); "yes"
 * only when every ingredient reached says so and no recipe on the way is
 * empty; otherwise unknown.
 */
function referenceVegan(book: RecipeBook, rootId: string): VeganStatus {
  const { ingredients, recipes } = reachable(book, rootId);
  const animal = (list: readonly Allergen[] | undefined) =>
    (list ?? []).some((a) => ANIMAL_ALLERGENS.includes(a));
  if (ingredients.some((i) => i.vegan === false || animal(i.allergens))) return 'no';
  if (recipes.some((r) => animal(r.declaredAllergens))) return 'no';
  if (recipes.some((r) => r.components.length === 0)) return 'unknown';
  return ingredients.every((i) => i.vegan === true) ? 'yes' : 'unknown';
}

/** Names compared the way a guest reads them: case and spaces don't matter. */
function nameSet(names: readonly string[]): string[] {
  return [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))].sort();
}

function referenceDetails(book: RecipeBook, rootId: string) {
  const { ingredients } = reachable(book, rootId);
  return {
    gluten: nameSet(ingredients.flatMap((i) => i.allergenDetails?.gluten ?? [])),
    nuts: nameSet(ingredients.flatMap((i) => i.allergenDetails?.nuts ?? [])),
  };
}

function detailSets(details: AllergenDetails) {
  return { gluten: nameSet(details.gluten), nuts: nameSet(details.nuts) };
}

function unionProfile(profiles: readonly AllergenProfile[]): AllergenProfile {
  const contains = new Set(profiles.flatMap((p) => p.contains));
  const may = new Set(profiles.flatMap((p) => p.mayContain));
  return {
    contains: ALLERGENS.filter((a) => contains.has(a)),
    mayContain: ALLERGENS.filter((a) => may.has(a) && !contains.has(a)),
  };
}

function unwrapOk<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(`expected a result, got ${JSON.stringify(result.error)}`);
  return result.value;
}

const KITCHENS = 1500;

// --- allergens ----------------------------------------------------------------

describe('allergen roll-up against a naive walk', () => {
  it('declares everything reachable, through shared sub-recipes, in any order', () => {
    let recipesChecked = 0;
    forAll(KITCHENS, 1_000, (rng) => {
      const kitchen = randomKitchen(rng);
      // Every recipe, not just the dishes: a sub-recipe's own card matters too.
      for (const recipe of rng.shuffle(kitchen.recipes)) {
        recipesChecked++;
        about(kitchen, recipe.id, () => {
          expect(unwrapOk(rollUpAllergens(recipe.id, kitchen.book))).toEqual(
            referenceProfile(kitchen.book, recipe.id),
          );
          expect(unwrapOk(rollUpVegan(recipe.id, kitchen.book))).toBe(
            referenceVegan(kitchen.book, recipe.id),
          );
          expect(detailSets(unwrapOk(rollUpAllergenDetails(recipe.id, kitchen.book)))).toEqual(
            referenceDetails(kitchen.book, recipe.id),
          );
        });
      }
    });
    expect(recipesChecked).toBeGreaterThan(KITCHENS * 5);
  });

  it('gives the same answer whichever recipe is asked about first', () => {
    // The roll-up keeps what it worked out on the way; asking in a different
    // order, or the same recipe twice, must not change a thing.
    forAll(500, 20_000, (rng) => {
      const kitchen = randomKitchen(rng);
      const first = new Map(
        kitchen.recipes.map((r) => [r.id, unwrapOk(rollUpAllergens(r.id, kitchen.book))]),
      );
      const reordered = createRecipeBook(
        rng.shuffle(kitchen.recipes),
        rng.shuffle(kitchen.ingredients),
      );
      for (const recipe of rng.shuffle(kitchen.recipes)) {
        expect(unwrapOk(rollUpAllergens(recipe.id, reordered))).toEqual(first.get(recipe.id));
      }
    });
  });

  it('is the same when every line is listed twice', () => {
    forAll(500, 30_000, (rng) => {
      const kitchen = randomKitchen(rng);
      const doubled = kitchen.recipes.map((r) => ({
        ...r,
        components: [...r.components, ...r.components.map((c) => ({ ...c, id: `${c.id}b` }))],
      }));
      const book = createRecipeBook(doubled, kitchen.ingredients);
      for (const id of kitchen.dishIds) {
        expect(unwrapOk(rollUpAllergens(id, book))).toEqual(
          unwrapOk(rollUpAllergens(id, kitchen.book)),
        );
        expect(unwrapOk(rollUpVegan(id, book))).toBe(unwrapOk(rollUpVegan(id, kitchen.book)));
      }
    });
  });

  it('refuses a missing ingredient anywhere below, rather than leaving it out', () => {
    forAll(500, 40_000, (rng) => {
      const kitchen = randomKitchen(rng);
      const missing = rng.pick(kitchen.ingredients);
      const book = createRecipeBook(
        kitchen.recipes,
        kitchen.ingredients.filter((i) => i !== missing),
      );
      for (const id of kitchen.dishIds) {
        const uses = reachable(kitchen.book, id).ingredients.includes(missing);
        expect(rollUpAllergens(id, book).ok).toBe(!uses);
        expect(rollUpVegan(id, book).ok).toBe(!uses);
        expect(dishCardMatrix(id, book).ok).toBe(!uses);
      }
    });
  });
});

describe('the dish card matrix', () => {
  it('rows and the whole dish agree with the naive walk, and leave nothing out', () => {
    let dishes = 0;
    forAll(KITCHENS, 50_000, (rng) => {
      const kitchen = randomKitchen(rng);
      for (const dishId of kitchen.dishIds) {
        dishes++;
        about(kitchen, dishId, () => {
          const dish = kitchen.book.recipe(dishId)!;
          const matrix = unwrapOk(dishCardMatrix(dishId, kitchen.book));

          // One row per sub-recipe, the first time the dish lists it.
          const expectedRows = [
            ...new Set(
              [...dish.components]
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .flatMap((c) => (c.ref.kind === 'recipe' ? [c.ref.recipeId] : [])),
            ),
          ];
          expect(matrix.rows.map((r) => r.recipeId)).toEqual(expectedRows);
          for (const row of matrix.rows) {
            expect(row.allergens).toEqual(referenceProfile(kitchen.book, row.recipeId!));
            expect(row.vegan).toBe(referenceVegan(kitchen.book, row.recipeId!));
            expect(detailSets(row.details)).toEqual(referenceDetails(kitchen.book, row.recipeId!));
          }

          // The whole dish.
          const whole = referenceProfile(kitchen.book, dishId);
          expect(matrix.dish.allergens).toEqual(whole);
          expect(matrix.dish.vegan).toBe(referenceVegan(kitchen.book, dishId));
          expect(detailSets(matrix.dish.details)).toEqual(referenceDetails(kitchen.book, dishId));

          // Reading the rows and the "other" row together says all of it.
          const shown = [...matrix.rows, ...(matrix.other ? [matrix.other] : [])];
          expect(unionProfile(shown.map((r) => r.allergens))).toEqual(whole);
          expect({
            gluten: nameSet(shown.flatMap((r) => r.details.gluten)),
            nuts: nameSet(shown.flatMap((r) => r.details.nuts)),
          }).toEqual(referenceDetails(kitchen.book, dishId));
          // What sits directly on the dish is a row of its own whenever it
          // carries an allergen, all of them, whatever the sub-recipes have
          // already: "no jus" must never be read as "no milk" with butter on
          // the plate as well.
          const ownContains = new Set<Allergen>(dish.declaredAllergens ?? []);
          const ownMay = new Set<Allergen>(dish.mayContain ?? []);
          for (const component of dish.components) {
            if (component.ref.kind !== 'ingredient') continue;
            const ingredient = kitchen.book.ingredient(component.ref.ingredientId)!;
            ingredient.allergens.forEach((a) => ownContains.add(a));
            (ingredient.mayContain ?? []).forEach((a) => ownMay.add(a));
          }
          const own = {
            contains: ALLERGENS.filter((a) => ownContains.has(a)),
            mayContain: ALLERGENS.filter((a) => ownMay.has(a) && !ownContains.has(a)),
          };
          if (own.contains.length + own.mayContain.length > 0) {
            expect(matrix.other?.allergens).toEqual(own);
          } else if (matrix.other) {
            expect(matrix.other.allergens).toEqual(own);
          }

          // Never every row vegan on a dish that isn't. (The "other" row only
          // speaks for what sits directly in the dish, so it is left aside.)
          if (
            matrix.rows.length > 0 &&
            !matrix.other &&
            matrix.rows.every((r) => r.vegan === 'yes')
          ) {
            expect(matrix.dish.vegan).toBe('yes');
          }
          if (matrix.dish.vegan !== 'yes' && dish.components.length > 0) {
            expect(shown.some((r) => r.vegan !== 'yes')).toBe(true);
          }
          // A row never says vegan next to milk, eggs, fish or shellfish.
          for (const row of shown) {
            if (row.allergens.contains.some((a) => ANIMAL_ALLERGENS.includes(a))) {
              expect(row.vegan).toBe('no');
            }
          }
        });
      }
    });
    expect(dishes).toBeGreaterThan(KITCHENS);
  });
});

// --- the label check ------------------------------------------------------------

function randomLabel(rng: Random): LabelReading {
  return { allergens: rng.subset(ALLERGENS, 0.15), mayContain: rng.subset(ALLERGENS, 0.1) };
}

describe('the label check', () => {
  it('predicts exactly what saving the label and working the dishes out again gives', () => {
    let shifts = 0;
    forAll(KITCHENS, 60_000, (rng) => {
      const kitchen = randomKitchen(rng);
      const target = rng.pick(kitchen.ingredients);
      const label = randomLabel(rng);
      // Some dishes using an ingredient this book doesn't have: unknown, not "no change".
      const broken = rng.chance(0.2) ? 'dishBroken' : null;
      const recipes = broken
        ? [
            ...kitchen.recipes,
            {
              id: broken,
              name: 'broken',
              type: 'dish' as const,
              yield: { value: 1, unit: 'each' as const },
              components: [
                component(
                  'bc',
                  { value: 1, unit: 'g' },
                  { kind: 'ingredient', ingredientId: 'nowhere' },
                ),
              ],
            },
          ]
        : kitchen.recipes;
      const book = createRecipeBook(recipes, kitchen.ingredients);
      const dishIds = rng.shuffle(broken ? [...kitchen.dishIds, broken] : kitchen.dishIds);

      const shift = labelShift(book, dishIds, target.id, label);

      // Apply the label as it reads, and work it all out the slow way.
      const saved = createRecipeBook(
        recipes,
        kitchen.ingredients.map((i) =>
          i.id === target.id
            ? { ...i, allergens: [...label.allergens], mayContain: [...label.mayContain] }
            : i,
        ),
      );
      const expected = dishIds.flatMap((dishId) => {
        if (dishId === broken) return [];
        const before = referenceProfile(book, dishId);
        const after = referenceProfile(saved, dishId);
        const minus = (a: Allergen[], b: Allergen[]) => a.filter((x) => !b.includes(x));
        const change = {
          dishId,
          before,
          after,
          added: minus(after.contains, before.contains),
          removed: minus(before.contains, after.contains),
          mayAdded: minus(after.mayContain, before.mayContain),
          mayRemoved: minus(before.mayContain, after.mayContain),
        };
        const changed =
          change.added.length +
          change.removed.length +
          change.mayAdded.length +
          change.mayRemoved.length;
        return changed ? [change] : [];
      });
      shifts += expected.length;
      about(kitchen, dishIds[0]!, () => {
        expect(shift.dishes).toEqual(expected);
        expect(shift.unknown).toEqual(broken ? [broken] : []);
        // And it is what the dish card will say once saved.
        for (const change of shift.dishes) {
          expect(unwrapOk(dishCardMatrix(change.dishId, saved)).dish.allergens).toEqual(
            change.after,
          );
        }
      });
    });
    // Enough of the cases change something to mean something.
    expect(shifts).toBeGreaterThan(KITCHENS / 4);
  });
});

// --- scaling --------------------------------------------------------------------

const FACTORS = [0.1, 0.25, 0.5, 1, 1.5, 2, 3.7, 10, 25, 40, 120];

describe('scaling', () => {
  it('never changes what a recipe contains', () => {
    forAll(KITCHENS, 70_000, (rng) => {
      const kitchen = randomKitchen(rng);
      const recipe = rng.pick(kitchen.recipes);
      const factor = rng.pick(FACTORS);
      const scaled = createRecipeBook(
        kitchen.recipes.map((r) => (r.id === recipe.id ? scaleRecipe(r, factor) : r)),
        kitchen.ingredients,
      );
      for (const r of kitchen.recipes) {
        expect(unwrapOk(rollUpAllergens(r.id, scaled))).toEqual(
          unwrapOk(rollUpAllergens(r.id, kitchen.book)),
        );
      }
    });
  });

  it('lists the same ingredients at any size, all of them when every unit fits', () => {
    let expanded = 0;
    forAll(KITCHENS, 80_000, (rng) => {
      const fits = rng.chance(0.6);
      const kitchen = randomKitchen(rng, { mismatchedUnits: !fits });
      const recipe = rng.pick(kitchen.recipes);
      const atOne = expandRecipe(recipe.id, 1, kitchen.book);
      if (!atOne.ok) {
        // Only an exponentially large spec is refused.
        expect(atOne.error.kind).toBe('too_many_lines');
        return;
      }
      expanded++;
      const factor = rng.pick(FACTORS);
      const lines = unwrapOk(expandRecipe(recipe.id, factor, kitchen.book));
      const key = (l: (typeof lines)[number]) => `${l.depth}:${l.kind}:${l.sourceId}`;
      expect(lines.map(key)).toEqual(atOne.value.map(key));
      lines.forEach((line, i) => {
        const base = atOne.value[i]!;
        expect(line.quantity.unit).toBe(base.quantity.unit);
        const want = base.quantity.value * factor;
        expect(Math.abs(line.quantity.value - want)).toBeLessThanOrEqual(1e-9 * Math.max(1, want));
      });
      if (fits) {
        // Every ingredient reachable is on the spec, so its allergens are too.
        const listed = new Set(lines.filter((l) => l.kind === 'ingredient').map((l) => l.sourceId));
        const all = new Set(reachable(kitchen.book, recipe.id).ingredients.map((i) => i.id));
        about(kitchen, recipe.id, () => expect([...listed].sort()).toEqual([...all].sort()));
      }
    });
    expect(expanded).toBeGreaterThan(KITCHENS * 0.9);
  });

  it('refuses a loop, however deep', () => {
    forAll(KITCHENS, 90_000, (rng) => {
      const kitchen = randomKitchen(rng, { mismatchedUnits: false });
      // A recipe that uses something, and something below it that uses it back.
      const candidates = kitchen.recipes.filter((r) =>
        r.components.some((c) => c.ref.kind === 'recipe'),
      );
      if (candidates.length === 0) return;
      const top = rng.pick(candidates);
      const under = reachable(kitchen.book, top.id).recipes.filter((r) => r.id !== top.id);
      const bottom = rng.pick(under);
      expect(wouldCreateCycle(bottom.id, top.id, kitchen.book)).toBe(true);
      const looped = createRecipeBook(
        kitchen.recipes.map((r) =>
          r.id === bottom.id
            ? {
                ...r,
                components: [
                  ...r.components,
                  component(
                    'loop',
                    { value: 1, unit: top.yield.unit },
                    { kind: 'recipe', recipeId: top.id },
                  ),
                ],
              }
            : r,
        ),
        kitchen.ingredients,
      );
      expect(findCycle(top.id, looped)).not.toBeNull();
      const rolled = rollUpAllergens(top.id, looped);
      expect(rolled.ok ? null : rolled.error.kind).toBe('cycle');
      expect(rollUpVegan(top.id, looped).ok).toBe(false);
      expect(rollUpAllergenDetails(top.id, looped).ok).toBe(false);
      const lines = expandRecipe(top.id, rng.pick(FACTORS), looped);
      expect(lines.ok).toBe(false);
      expect(costRecipe(top.id, 1, looped).ok).toBe(false);
    });
  });
});

// --- costing --------------------------------------------------------------------

/** What a recipe costs, worked out line by line down the tree. */
function referenceCost(book: RecipeBook, rootId: string, factor: number) {
  let total = 0;
  const gaps = new Set<string>();
  const walk = (id: string, multiplier: number) => {
    const recipe = book.recipe(id)!;
    for (const c of recipe.components) {
      const q = { value: c.quantity.value * multiplier, unit: c.quantity.unit };
      if (c.ref.kind === 'ingredient') {
        const ingredient = book.ingredient(c.ref.ingredientId)!;
        const cost = ingredientCost(ingredient, q);
        if (cost.ok) total += cost.value;
        else gaps.add(`ingredient:${ingredient.id}:${cost.error}`);
      } else {
        const child = book.recipe(c.ref.recipeId)!;
        const childFactor = factorForYield(child, q);
        if (childFactor.ok) walk(child.id, childFactor.value);
        else if (child.components.length > 0) gaps.add(`recipe:${child.id}:units`);
      }
    }
  };
  walk(rootId, factor);
  return { total, gaps: [...gaps].sort() };
}

const gapKeys = (gaps: CostGap[]) => gaps.map((g) => `${g.kind}:${g.id}:${g.reason}`).sort();

describe('costing', () => {
  it('scales linearly, matches a line-by-line sum and never counts an unknown price as free', () => {
    let costed = 0;
    forAll(KITCHENS, 100_000, (rng) => {
      const kitchen = randomKitchen(rng);
      const recipe = rng.pick(kitchen.recipes);
      const atOne = costRecipe(recipe.id, 1, kitchen.book);
      if (!atOne.ok) {
        expect(atOne.error.kind).toBe('too_many_lines');
        return;
      }
      costed++;
      const factor = rng.pick(FACTORS);
      const scaled = unwrapOk(costRecipe(recipe.id, factor, kitchen.book));
      about(kitchen, recipe.id, () => {
        expect(Number.isFinite(scaled.total)).toBe(true);
        expect(scaled.total).toBeGreaterThanOrEqual(0);
        expect(Math.abs(scaled.total - factor * atOne.value.total)).toBeLessThanOrEqual(
          1e-9 * Math.max(1, scaled.total),
        );
        // What is left out does not depend on the size.
        expect(gapKeys(scaled.gaps)).toEqual(gapKeys(atOne.value.gaps));

        const reference = referenceCost(kitchen.book, recipe.id, factor);
        expect(gapKeys(scaled.gaps)).toEqual(reference.gaps);
        expect(Math.abs(scaled.total - reference.total)).toBeLessThanOrEqual(
          1e-9 * Math.max(1, reference.total),
        );

        // Any ingredient on the spec without a price is named as a gap.
        const lines = unwrapOk(expandRecipe(recipe.id, factor, kitchen.book));
        for (const line of lines) {
          if (line.kind !== 'ingredient') continue;
          if (kitchen.book.ingredient(line.sourceId)!.price) continue;
          expect(scaled.gaps).toContainEqual(
            expect.objectContaining({ kind: 'ingredient', id: line.sourceId, reason: 'no_price' }),
          );
        }
      });
    });
    expect(costed).toBeGreaterThan(KITCHENS * 0.9);
  });
});

// --- pars -----------------------------------------------------------------------

describe('par levels', () => {
  it('never asks for less than par less what is there, and never a negative amount', () => {
    const units = ALL_UNITS.map((u) => u.code);
    forAll(20_000, 110_000, (rng) => {
      const par: Quantity = {
        value: rng.pick([0, 0.1, 0.25, 1, 2.5, 12, 13, 24, 100, 999.9, rng.next() * 5000]),
        unit: rng.pick(units),
      };
      const onHand: Quantity | null = rng.chance(0.15)
        ? null
        : {
            value: rng.pick([0, 0.01, 0.3, 1, 11, 12, 50, rng.next() * 6000]),
            unit: rng.chance(0.7) ? rng.pick(UNITS_BY_BASE[toBaseUnit(par.unit)]) : rng.pick(units),
          };
      const outcome = toMakeForPar(par, onHand);
      const context = `par ${par.value} ${par.unit}, on hand ${onHand ? `${onHand.value} ${onHand.unit}` : 'none'}: ${JSON.stringify(outcome)}`;
      const there = onHand ? toBase(onHand) : 0;
      const sameKind = !onHand || dimensionOf(onHand.unit) === dimensionOf(par.unit);
      if (!sameKind) {
        expect(outcome.kind, context).toBe('unknown');
        return;
      }
      const short = toBase(par) - there;
      if (outcome.kind === 'enough') {
        expect(short, context).toBeLessThanOrEqual(1e-9 * Math.max(1, toBase(par)));
      } else {
        expect(outcome.kind, context).toBe('make');
        if (outcome.kind !== 'make') return;
        expect(dimensionOf(outcome.make.unit), context).toBe(dimensionOf(par.unit));
        expect(outcome.make.value, context).toBeGreaterThan(0);
        expect(toBase(outcome.make), context).toBeGreaterThanOrEqual(short * (1 - 1e-9));
      }
    });
  });
});

// --- use-by ---------------------------------------------------------------------

describe('use-by dates', () => {
  beforeAll(() => {
    vi.stubEnv('TZ', 'Europe/Amsterdam');
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('is never before it was made, and a longer shelf life never gives an earlier date', () => {
    forAll(20_000, 120_000, (rng) => {
      // Any minute across a few years, summer time changes included.
      const made = new Date(
        Date.UTC(2026, 0, 1) + Math.floor(rng.next() * 4 * 365 * 24 * 60) * 60_000,
      );
      const kept = rng.chance(0.15) ? null : rng.pick(KEPT);
      const a = rng.pick([0, null, undefined, -5, 0.5, 1, 6, 24, 48, 72, 120, rng.next() * 400]);
      const b = rng.pick([0.5, 1, 6, 24, 47, 72, 96, rng.next() * 400]);
      const context = `made ${made.toISOString()}, kept ${kept}, shelf life ${a} and ${b}`;
      for (const hours of [a, b]) {
        const result = computeUseBy({ made, shelfLifeHours: hours, kept });
        if (result.kind === 'blank') continue;
        expect(result.at.getTime(), context).toBeGreaterThanOrEqual(made.getTime());
        if (result.kind === 'default') {
          // The end of a day at least that many calendar days on.
          const days = (result.at.getTime() - made.getTime()) / 86_400_000;
          expect(days, context).toBeGreaterThanOrEqual(result.days - 1 / 24);
          expect(result.at.getHours(), context).toBe(23);
        }
      }
      if (typeof a === 'number' && a > 0) {
        const [shorter, longer] = a <= b ? [a, b] : [b, a];
        const first = computeUseBy({ made, shelfLifeHours: shorter, kept });
        const second = computeUseBy({ made, shelfLifeHours: longer, kept });
        expect(first.kind === 'blank' || second.kind === 'blank', context).toBe(false);
        if (first.kind === 'blank' || second.kind === 'blank') return;
        expect(first.at.getTime(), context).toBeLessThanOrEqual(second.at.getTime());
        // A date holds whole milliseconds.
        expect(
          Math.abs(second.at.getTime() - made.getTime() - longer * 3_600_000),
          context,
        ).toBeLessThan(1);
      }
    });
  });
});
