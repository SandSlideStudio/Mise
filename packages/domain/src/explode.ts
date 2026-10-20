import { err, ok, type Result } from './result.js';
import {
  factorForPortions,
  factorForYield,
  type Recipe,
  type RecipeBook,
  type RecipeError,
} from './recipe.js';
import { BASE_UNIT_FOR, dimensionOf, fromBase, toBase, type Quantity } from './units.js';

/**
 * Turning a service into a prep list.
 *
 * This is the job a chef does by hand every afternoon: take tonight's dishes
 * and covers, walk every recipe tree, and work out what has to be made. The
 * part people get wrong is aggregation. If three dishes each take 200 ml of
 * the same sauce, the prep list must say 600 ml once, not 200 ml three times,
 * and the stock underneath that sauce has to scale to the combined figure.
 */

export interface ServiceDish {
  recipeId: string;
  /** Plates expected for this dish tonight. */
  portions: number;
}

export interface PrepUsage {
  recipeId: string;
  recipeName: string;
  quantity: Quantity;
}

export interface PrepTaskDraft {
  /**
   * Stable identity for this task within a service. Regenerating a prep list
   * matches on this so completed and hand-edited tasks survive.
   */
  key: string;
  kind: 'recipe' | 'ingredient';
  sourceId: string;
  name: string;
  stationId: string | null;
  /** Total needed, in the canonical base unit for its dimension. */
  quantity: Quantity;
  /**
   * Deepest point in any tree where this appears. A stock at depth 2 must be
   * made before the sauce at depth 1 that uses it.
   */
  depth: number;
  /** Component notes gathered from every place this is used, deduplicated. */
  notes: string[];
  /** Which dishes and recipes drove the total, for a chef checking the maths. */
  usedBy: PrepUsage[];
}

/** Guards against a pathological tree even when cycle detection is bypassed. */
const MAX_DEPTH = 32;

export type ExplodeError = RecipeError | { kind: 'max_depth_exceeded'; recipeId: string };

/**
 * Gross a quantity up for trim loss. Needing 900 g of peeled onion means
 * pulling a kilo when the yield is 90 percent.
 */
export function applyYieldLoss(baseValue: number, yieldPercent: number): number {
  if (!yieldPercent || yieldPercent <= 0 || yieldPercent >= 100) return baseValue;
  return baseValue / (yieldPercent / 100);
}

export function explodeService(
  dishes: readonly ServiceDish[],
  book: RecipeBook,
): Result<PrepTaskDraft[], ExplodeError> {
  const tasks = new Map<string, PrepTaskDraft>();

  function record(
    kind: 'recipe' | 'ingredient',
    sourceId: string,
    name: string,
    stationId: string | null,
    baseValue: number,
    baseUnitCode: Quantity['unit'],
    depth: number,
    note: string | null | undefined,
    parent: Recipe,
  ): void {
    const key = `${kind}:${sourceId}:${baseUnitCode}`;
    const existing = tasks.get(key);
    const usage: PrepUsage = {
      recipeId: parent.id,
      recipeName: parent.name,
      quantity: fromBase(baseValue, baseUnitCode),
    };

    if (!existing) {
      tasks.set(key, {
        key,
        kind,
        sourceId,
        name,
        stationId,
        quantity: fromBase(baseValue, baseUnitCode),
        depth,
        notes: note ? [note] : [],
        usedBy: [usage],
      });
      return;
    }

    existing.quantity = { value: existing.quantity.value + baseValue, unit: baseUnitCode };
    existing.depth = Math.max(existing.depth, depth);
    if (note && !existing.notes.includes(note)) existing.notes.push(note);
    existing.usedBy.push(usage);
  }

  function visit(
    recipe: Recipe,
    factor: number,
    depth: number,
    onPath: Set<string>,
  ): Result<void, ExplodeError> {
    if (depth > MAX_DEPTH) return err({ kind: 'max_depth_exceeded', recipeId: recipe.id });
    if (onPath.has(recipe.id)) return err({ kind: 'cycle', path: [...onPath, recipe.id] });

    const nextPath = new Set(onPath).add(recipe.id);

    for (const component of recipe.components) {
      const scaled: Quantity = {
        value: component.quantity.value * factor,
        unit: component.quantity.unit,
      };

      if (component.ref.kind === 'ingredient') {
        const ingredient = book.ingredient(component.ref.ingredientId);
        if (!ingredient) {
          return err({ kind: 'missing_ingredient', ingredientId: component.ref.ingredientId });
        }
        // Only things that actually need doing become tasks. Salt in a sauce
        // is not prep; two kilos of onion to brunoise is.
        if (!ingredient.requiresPrep && !component.note) continue;

        const baseUnitCode = BASE_UNIT_FOR[dimensionOf(scaled.unit)];
        record(
          'ingredient',
          ingredient.id,
          ingredient.name,
          null,
          applyYieldLoss(toBase(scaled), ingredient.yieldPercent),
          baseUnitCode,
          depth,
          component.note,
          recipe,
        );
        continue;
      }

      const child = book.recipe(component.ref.recipeId);
      if (!child) return err({ kind: 'missing_recipe', recipeId: component.ref.recipeId });

      record(
        'recipe',
        child.id,
        child.name,
        child.stationId ?? null,
        toBase(scaled),
        BASE_UNIT_FOR[dimensionOf(scaled.unit)],
        depth,
        component.note,
        recipe,
      );

      // How many batches of the child does that quantity represent? A recipe
      // has no density of its own, so no conversion context is passed: if a
      // sauce yields litres and a dish measures it in grams, that is a data
      // problem to surface, not one to guess at.
      const childFactor = factorForYield(child, scaled);
      if (!childFactor.ok) return childFactor;

      const nested = visit(child, childFactor.value, depth + 1, nextPath);
      if (!nested.ok) return nested;
    }

    return ok(undefined);
  }

  for (const dish of dishes) {
    const recipe = book.recipe(dish.recipeId);
    if (!recipe) return err({ kind: 'missing_recipe', recipeId: dish.recipeId });

    const factor = factorForPortions(recipe, dish.portions);
    if (!factor.ok) return factor;

    const result = visit(recipe, factor.value, 0, new Set());
    if (!result.ok) return result;
  }

  return ok(sortForService([...tasks.values()]));
}

/**
 * Deepest first, so the stock is made before the sauce that needs it, then
 * grouped by station and named alphabetically within that.
 */
export function sortForService(tasks: PrepTaskDraft[]): PrepTaskDraft[] {
  return [...tasks].sort((a, b) => {
    if (a.depth !== b.depth) return b.depth - a.depth;
    const stationA = a.stationId ?? '';
    const stationB = b.stationId ?? '';
    if (stationA !== stationB) return stationA.localeCompare(stationB);
    return a.name.localeCompare(b.name);
  });
}

/** Group a prep list by station for the tablet view. */
export function groupByStation(
  tasks: readonly PrepTaskDraft[],
): Map<string | null, PrepTaskDraft[]> {
  const groups = new Map<string | null, PrepTaskDraft[]>();
  for (const task of tasks) {
    const key = task.stationId;
    const bucket = groups.get(key);
    if (bucket) bucket.push(task);
    else groups.set(key, [task]);
  }
  return groups;
}
