import { z } from 'zod';
import { allergenSchema, idSchema } from './common.js';
import { ingredientPriceInputSchema, ingredientPriceSchema } from './costing.js';
import { lastLabelCheckSchema } from './labelChecks.js';

/**
 * The raw material catalogue. Density and item weight are what make
 * volume-to-weight and count-to-weight conversion possible, and yield percent
 * says how much of what is bought ends up usable once trimmed.
 */

export const baseUnitSchema = z.enum(['g', 'ml', 'each']);

/** Which gluten cereals and which nuts, named the way the law wants them. */
const names = z.array(z.string().trim().min(1).max(60)).max(12);
export const allergenDetailsSchema = z.object({ gluten: names, nuts: names });

export const ingredientSchema = z.object({
  id: idSchema,
  name: z.string(),
  category: z.string().nullable(),
  baseUnit: baseUnitSchema,
  allergens: z.array(allergenSchema),
  /** Traces the supplier's label warns about: "may contain", never "contains". */
  mayContain: z.array(allergenSchema),
  /** Null until somebody says, and null is never shown as vegan. */
  vegan: z.boolean().nullable(),
  allergenDetails: allergenDetailsSchema,
  notes: z.string().nullable(),
  /** Grams per millilitre, and grams for one: what lets amounts cross from one kind of unit to another. */
  densityGPerMl: z.number().nullable(),
  itemWeightG: z.number().nullable(),
  /** Edible portion as a percentage of what is bought. */
  yieldPercent: z.number(),
  /** What it costs. Null: nobody has said. Left out altogether for a cook. */
  price: ingredientPriceSchema.nullable().optional(),
  /** When its label was last read at delivery; null: never. Left out by older servers. */
  labelCheck: lastLabelCheckSchema.nullable().optional(),
  /** When it last changed: the version an edit starts from. */
  updatedAt: z.string(),
});

const ingredientFields = z.object({
  name: z.string().min(1).max(160),
  category: z.string().max(80).nullable().optional(),
  baseUnit: baseUnitSchema,
  allergens: z.array(allergenSchema),
  mayContain: z.array(allergenSchema),
  vegan: z.boolean().nullable().optional(),
  allergenDetails: allergenDetailsSchema.optional(),
  notes: z.string().max(2000).nullable().optional(),
  densityGPerMl: z.number().positive().max(30).nullable().optional(),
  itemWeightG: z.number().positive().max(100_000).nullable().optional(),
  yieldPercent: z.number().gt(0).max(100).optional(),
  price: ingredientPriceInputSchema.nullable().optional(),
});

export const createIngredientSchema = ingredientFields.extend({
  allergens: z.array(allergenSchema).default([]),
  mayContain: z.array(allergenSchema).default([]),
});

// Built from the fields without defaults: a field left out of an update stays as it is.
export const updateIngredientSchema = ingredientFields.partial().extend({
  /**
   * With a price: when the price the editor showed was last changed (its
   * price.updatedAt; null: there was none). A new price alone keeps the
   * ingredient's version, so this is how an edit sees that someone changed
   * the price since, and doesn't undo it unseen.
   */
  priceBase: z.string().nullable().optional(),
});

export const listIngredientsQuerySchema = z.object({
  search: z.string().max(160).optional(),
  category: z.string().max(80).optional(),
});

export type Ingredient = z.infer<typeof ingredientSchema>;
export type CreateIngredient = z.infer<typeof createIngredientSchema>;

export type UpdateIngredient = z.infer<typeof updateIngredientSchema>;
export type BaseUnit = z.infer<typeof baseUnitSchema>;
export type AllergenDetails = z.infer<typeof allergenDetailsSchema>;
