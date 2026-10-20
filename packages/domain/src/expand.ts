import { err, ok, type Result } from './result.js';
import { factorForPortions, factorForYield, type RecipeBook, type RecipeError } from './recipe.js';
import { BASE_UNIT_FOR, dimensionOf, fromBase, toBase, type Quantity } from './units.js';

/**
 * Reading a recipe at a size other than the one it was written at.
 *
 * This is the other half of the tree walk. Where the prep explosion asks "what
 * has to be made tonight" and aggregates across dishes, expansion asks "show
 * me this one spec at twenty-five covers" and keeps everything in the order it
 * was written, nested, including the things that need no preparation at all.
 */

export interface ExpandedLine {
  /** How deep in the tree: 0 is the recipe's own lines. */
  depth: number;
  kind: 'ingredient' | 'recipe';
  sourceId: string;
  name: string;
  section: string | null;
  note: string | null;
  /** Scaled, in the canonical base unit for its dimension. */
  quantity: Quantity;
}

const MAX_DEPTH = 32;

export type ExpandError = RecipeError | { kind: 'max_depth_exceeded'; recipeId: string };

/**
 * Flatten a recipe's tree at a given multiplier.
 *
 * Sub-recipes appear as a line of their own *and* have their contents listed
 * beneath, because a cook reading a spec at the pass wants both: how much
 * velouté goes in, and what the velouté is if they have to make more.
 */
export function expandRecipe(
  recipeId: string,
  factor: number,
  book: RecipeBook,
): Result<ExpandedLine[], ExpandError> {
  const lines: ExpandedLine[] = [];

  function visit(
    id: string,
    multiplier: number,
    depth: number,
    onPath: Set<string>,
  ): Result<void, ExpandError> {
    if (depth > MAX_DEPTH) return err({ kind: 'max_depth_exceeded', recipeId: id });
    if (onPath.has(id)) return err({ kind: 'cycle', path: [...onPath, id] });

    const recipe = book.recipe(id);
    if (!recipe) return err({ kind: 'missing_recipe', recipeId: id });

    const nextPath = new Set(onPath).add(id);

    for (const component of recipe.components) {
      const scaled: Quantity = {
        value: component.quantity.value * multiplier,
        unit: component.quantity.unit,
      };
      const baseUnit = BASE_UNIT_FOR[dimensionOf(scaled.unit)];
      const quantity = fromBase(toBase(scaled), baseUnit);

      if (component.ref.kind === 'ingredient') {
        const ingredient = book.ingredient(component.ref.ingredientId);
        if (!ingredient) {
          return err({ kind: 'missing_ingredient', ingredientId: component.ref.ingredientId });
        }
        lines.push({
          depth,
          kind: 'ingredient',
          sourceId: ingredient.id,
          name: ingredient.name,
          section: component.section ?? null,
          note: component.note ?? null,
          quantity,
        });
        continue;
      }

      const child = book.recipe(component.ref.recipeId);
      if (!child) return err({ kind: 'missing_recipe', recipeId: component.ref.recipeId });

      lines.push({
        depth,
        kind: 'recipe',
        sourceId: child.id,
        name: child.name,
        section: component.section ?? null,
        note: component.note ?? null,
        quantity,
      });

      // How many batches of the child does that quantity represent?
      const childFactor = factorForYield(child, scaled);
      if (!childFactor.ok) return childFactor;

      const nested = visit(child.id, childFactor.value, depth + 1, nextPath);
      if (!nested.ok) return nested;
    }

    return ok(undefined);
  }

  const result = visit(recipeId, factor, 0, new Set());
  return result.ok ? ok(lines) : result;
}

/**
 * Work out the multiplier for a requested size, from either a portion count or
 * a target yield. Callers give one or the other; a chef thinks in both.
 */
export function factorFor(
  recipeId: string,
  target: { portions?: number; factor?: number; yield?: Quantity },
  book: RecipeBook,
): Result<number, ExpandError> {
  const recipe = book.recipe(recipeId);
  if (!recipe) return err({ kind: 'missing_recipe', recipeId });

  if (target.factor !== undefined) return ok(target.factor);
  if (target.portions !== undefined) return factorForPortions(recipe, target.portions);
  if (target.yield !== undefined) return factorForYield(recipe, target.yield);
  return ok(1);
}
