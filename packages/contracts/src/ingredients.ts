import { z } from 'zod';
import { allergenSchema, idSchema } from './common.js';

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
  densityGPerMl: z.number().positive().nullable(),
  itemWeightG: z.number().positive().nullable(),
  yieldPercent: z.number().positive().max(100),
  /** Null until somebody says, and null is never shown as vegan. */
  vegan: z.boolean().nullable(),
  allergenDetails: allergenDetailsSchema,
  notes: z.string().nullable(),
});

const ingredientFields = z.object({
  name: z.string().min(1).max(160),
  category: z.string().max(80).nullable().optional(),
  baseUnit: baseUnitSchema,
  allergens: z.array(allergenSchema),
  densityGPerMl: z.number().positive().nullable().optional(),
  itemWeightG: z.number().positive().nullable().optional(),
  yieldPercent: z.number().positive().max(100),
  vegan: z.boolean().nullable().optional(),
  allergenDetails: allergenDetailsSchema.optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const createIngredientSchema = ingredientFields.extend({
  allergens: z.array(allergenSchema).default([]),
  yieldPercent: z.number().positive().max(100).default(100),
});

// Built from the fields without defaults: a field left out of an update stays as it is.
export const updateIngredientSchema = ingredientFields.partial();

export const listIngredientsQuerySchema = z.object({
  search: z.string().max(160).optional(),
  category: z.string().max(80).optional(),
});

export type Ingredient = z.infer<typeof ingredientSchema>;
export type CreateIngredient = z.infer<typeof createIngredientSchema>;

export type UpdateIngredient = z.infer<typeof updateIngredientSchema>;
export type BaseUnit = z.infer<typeof baseUnitSchema>;
export type AllergenDetails = z.infer<typeof allergenDetailsSchema>;
