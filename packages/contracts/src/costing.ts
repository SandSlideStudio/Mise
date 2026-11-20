import { z } from 'zod';
import { costRecipe, foodCostPercent, summariseCost, type RecipeBook } from '@mise/domain';
import { idSchema, quantitySchema } from './common.js';

/**
 * Food cost. Management information: every cost field below is left out of
 * the answer altogether for a cook, not merely hidden by the app, so the
 * schemas mark them optional.
 */

/** A short list on purpose: the currencies of the kitchens Mise is used in. */
export const CURRENCIES = ['EUR', 'GBP', 'CHF', 'DKK', 'SEK', 'PLN', 'CZK', 'USD'] as const;
export const currencySchema = z.enum(CURRENCIES);

/** What an ingredient costs to buy, as read off the invoice: "12.50 for 5 kg". */
export const ingredientPriceInputSchema = z.object({
  amount: z.number().finite().nonnegative().max(1_000_000),
  quantity: quantitySchema.extend({ value: z.number().finite().positive().max(1_000_000) }),
});

export const ingredientPriceSchema = ingredientPriceInputSchema.extend({
  /** When the price was last entered or changed. */
  updatedAt: z.string().nullable(),
  /**
   * What one usable gram, millilitre or piece costs, trim yield counted.
   * Null when what it is bought in can't be turned into how it is measured.
   */
  perBase: z.number().nullable(),
});

/** Something a cost leaves out: no price, or an amount that can't be converted. */
export const costGapSchema = z.object({
  kind: z.enum(['ingredient', 'recipe']),
  id: idSchema,
  name: z.string(),
  reason: z.enum(['no_price', 'units']),
});

/** What a recipe costs at the size asked for. Only complete when gaps is empty. */
export const recipeCostSchema = z.object({
  currency: currencySchema,
  total: z.number(),
  /** Per gram, millilitre or piece of what it makes. */
  perBase: z.number().nullable(),
  perPortion: z.number().nullable(),
  /** Of what the guest pays before VAT, for a dish with a selling price. */
  foodCostPercent: z.number().nullable(),
  gaps: z.array(costGapSchema),
});

/** A dish's line on a menu: its cost per portion and food cost. */
export const menuDishCostSchema = z.object({
  perPortion: z.number().nullable(),
  sellPrice: z.number().nullable(),
  foodCostPercent: z.number().nullable(),
  /** How many things its cost leaves out. */
  gaps: z.number().int(),
});

/** The menu's averages, over the dishes that have a figure. */
export const menuCostSchema = z.object({
  currency: currencySchema,
  averagePerPortion: z.number().nullable(),
  averageFoodCostPercent: z.number().nullable(),
  /** Some dish's cost leaves something out, so the averages are too low. */
  incomplete: z.boolean(),
});

export type Currency = z.infer<typeof currencySchema>;
export type IngredientPrice = z.infer<typeof ingredientPriceSchema>;
export type IngredientPriceInput = z.infer<typeof ingredientPriceInputSchema>;
export type CostGap = z.infer<typeof costGapSchema>;
export type RecipeCost = z.infer<typeof recipeCostSchema>;
export type MenuDishCost = z.infer<typeof menuDishCostSchema>;
export type MenuCost = z.infer<typeof menuCostSchema>;

/** What the kitchen counts costs in, and the VAT its menu prices include. */
export interface CostSettings {
  currency: Currency;
  foodVatPercent: number;
}

/**
 * What a recipe costs at a multiplier of its batch, ready to send. Null when
 * its tree can't be followed (a loop), which the expansion answers already.
 *
 * Here rather than on the server because a chef's tablet works the costs of
 * its offline copy out itself, and must come to the very same figures.
 */
export function recipeCostAt(
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
