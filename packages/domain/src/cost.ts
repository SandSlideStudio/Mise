import { expandRecipe, type ExpandError } from './expand.js';
import type { Ingredient, Recipe, RecipeBook } from './recipe.js';
import { err, ok, type Result } from './result.js';
import { convert, toBase, type ConversionContext, type Quantity } from './units.js';

/**
 * Food cost: what a batch, a portion or a plate costs in ingredients.
 *
 * Prices are entered the way a chef reads them off an invoice, "€12.50 per
 * 5 kg bag", and turned into a cost per usable gram, millilitre or piece: trim
 * yield counts, because the peel of an onion is paid for too. A recipe's cost
 * is then the sum of its lines, following every sub-recipe down through the
 * same expansion that scales a spec, so a scaled spec and its cost can never
 * disagree.
 *
 * An unknown price is never counted as zero. A cost always comes with the
 * list of what it leaves out, so a chef reads "cost so far, two ingredients
 * without a price" rather than a reassuringly low number that is wrong.
 */

/** Why a line could not be costed. */
export type CostProblem =
  /** Nobody has entered what it costs. */
  | 'no_price'
  /** Its amount, or what it is bought in, can't be turned into the other. */
  | 'units';

/** Something a cost leaves out, named so the chef can go and fix it. */
export interface CostGap {
  kind: 'ingredient' | 'recipe';
  id: string;
  name: string;
  reason: CostProblem;
}

export interface RecipeCost {
  /** What everything that could be costed comes to. Only complete when gaps is empty. */
  total: number;
  /** What it leaves out, each once, in the order first met. */
  gaps: CostGap[];
}

function contextOf(ingredient: Ingredient): ConversionContext {
  return { densityGPerMl: ingredient.densityGPerMl, itemWeightG: ingredient.itemWeightG };
}

/**
 * What one usable gram, millilitre or piece costs, in the ingredient's own
 * base unit. Buying 5 kg of onions at 90 % yield gets 4.5 kg you can use.
 */
export function costPerBaseUnit(ingredient: Ingredient): Result<number, CostProblem> {
  const price = ingredient.price;
  if (!price) return err('no_price');
  const bought = convert(price.quantity, ingredient.baseUnit, contextOf(ingredient));
  if (!bought.ok) return err('units');
  const usable = toBase(bought.value) * ((ingredient.yieldPercent ?? 100) / 100);
  // A purchase of nothing is a typing mistake, not an infinitely dear ingredient.
  if (!(usable > 0) || !Number.isFinite(price.amount)) return err('units');
  return ok(price.amount / usable);
}

/** What an amount of an ingredient costs, in whatever unit the recipe uses it. */
export function ingredientCost(
  ingredient: Ingredient,
  quantity: Quantity,
): Result<number, CostProblem> {
  const perBase = costPerBaseUnit(ingredient);
  if (!perBase.ok) return perBase;
  const used = convert(quantity, ingredient.baseUnit, contextOf(ingredient));
  if (!used.ok) return err('units');
  return ok(toBase(used.value) * perBase.value);
}

/**
 * What a recipe costs at a multiplier of its batch: 1 for the recipe as
 * written, 2.5 for what the scaler asked.
 *
 * A sub-recipe costs what its own lines cost for the share of its batch that
 * is used, which the expansion has already worked out. One the expansion
 * could not open (measured in a unit its yield can't be turned into) is left
 * out and said so, rather than costing nothing.
 */
export function costRecipe(
  recipeId: string,
  factor: number,
  book: RecipeBook,
): Result<RecipeCost, ExpandError> {
  const lines = expandRecipe(recipeId, factor, book);
  if (!lines.ok) return lines;

  let total = 0;
  const gaps: CostGap[] = [];
  const seen = new Set<string>();
  function gap(entry: CostGap) {
    const key = `${entry.kind}:${entry.id}:${entry.reason}`;
    if (seen.has(key)) return;
    seen.add(key);
    gaps.push(entry);
  }

  lines.value.forEach((line, index) => {
    if (line.kind === 'recipe') {
      // Its contents follow it one level deeper whenever it could be opened.
      const child = book.recipe(line.sourceId);
      const next = lines.value[index + 1];
      const opened = next !== undefined && next.depth === line.depth + 1;
      if (child && child.components.length > 0 && !opened) {
        gap({ kind: 'recipe', id: child.id, name: child.name, reason: 'units' });
      }
      return;
    }
    const ingredient = book.ingredient(line.sourceId);
    if (!ingredient) return; // The expansion refuses a missing ingredient already.
    const cost = ingredientCost(ingredient, line.quantity);
    if (cost.ok) total += cost.value;
    else gap({ kind: 'ingredient', id: ingredient.id, name: ingredient.name, reason: cost.error });
  });

  return ok({ total, gaps });
}

/** A recipe's cost, also per unit of what it makes and per portion. */
export interface CostSummary extends RecipeCost {
  /** Per gram, millilitre or piece of what the batch makes. Null for a batch of nothing. */
  perBase: number | null;
  /** Per portion, for a recipe written in portions. */
  perPortion: number | null;
}

export function summariseCost(recipe: Recipe, factor: number, cost: RecipeCost): CostSummary {
  const made = toBase(recipe.yield) * factor;
  const portions = recipe.portions ? recipe.portions * factor : 0;
  return {
    ...cost,
    perBase: made > 0 ? cost.total / made : null,
    perPortion: portions > 0 ? cost.total / portions : null,
  };
}

/**
 * Food cost as a percentage of what the guest pays before VAT, the figure a
 * kitchen is judged on. Menu prices include VAT, so it is taken off first:
 * €24 at 9 % is €22.02 to the house. Null without a selling price.
 */
export function foodCostPercent(
  costPerPortion: number,
  sellPriceInclVat: number | null | undefined,
  vatPercent: number,
): number | null {
  if (!sellPriceInclVat || sellPriceInclVat <= 0) return null;
  const toHouse = sellPriceInclVat / (1 + vatPercent / 100);
  return (costPerPortion / toHouse) * 100;
}
