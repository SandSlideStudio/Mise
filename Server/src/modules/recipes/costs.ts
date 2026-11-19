import { CURRENCIES, type Currency, type RecipeCost, type Role } from '@mise/contracts';
import { costRecipe, foodCostPercent, summariseCost, type RecipeBook } from '@mise/domain';
import type { Executor } from '../../db/client.js';
import { kitchens } from '../../db/schema.js';
import { MANAGERS } from '../../plugins/auth.js';

/**
 * Food cost over the API.
 *
 * Costs are management information: chefs and administrators see them, cooks
 * never do. Every answer leaves the cost fields out for a cook rather than
 * sending them for the app to hide, and the bundle for offline use is built
 * the same way, so a price can't be read off a tablet's storage either.
 */

export function seesCosts(user: { role: Role } | null | undefined): boolean {
  return user ? MANAGERS.includes(user.role) : false;
}

export interface CostSettings {
  currency: Currency;
  foodVatPercent: number;
}

export function currencyOf(value: string): Currency {
  return (CURRENCIES as readonly string[]).includes(value) ? (value as Currency) : 'EUR';
}

export async function loadCostSettings(db: Executor): Promise<CostSettings> {
  const [row] = await db
    .select({ currency: kitchens.currency, foodVatPercent: kitchens.foodVatPercent })
    .from(kitchens)
    .limit(1);
  return { currency: currencyOf(row?.currency ?? 'EUR'), foodVatPercent: row?.foodVatPercent ?? 9 };
}

/**
 * What a recipe costs at a multiplier of its batch, ready to send. Null when
 * its tree can't be followed (a loop), which the expansion answers already.
 */
export function costAgainst(
  recipeId: string,
  factor: number,
  book: RecipeBook,
  settings: CostSettings,
  sellPrice: number | null,
): RecipeCost | null {
  const recipe = book.recipe(recipeId);
  if (!recipe) return null;
  const cost = costRecipe(recipeId, factor, book);
  if (!cost.ok) return null;
  const summary = summariseCost(recipe, factor, cost.value);
  return {
    currency: settings.currency,
    total: summary.total,
    perBase: summary.perBase,
    perPortion: summary.perPortion,
    // A selling price only means something for a dish.
    foodCostPercent:
      recipe.type === 'dish' && summary.perPortion !== null
        ? foodCostPercent(summary.perPortion, sellPrice, settings.foodVatPercent)
        : null,
    gaps: summary.gaps,
  };
}
