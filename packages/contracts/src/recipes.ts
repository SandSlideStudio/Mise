import { z } from 'zod';
import { allergenSchema, idSchema, quantitySchema, unitCodeSchema } from './common.js';

/**
 * A recipe is a list of components, and a component points at either an
 * ingredient or another recipe. That one rule is what separates a restaurant
 * spec from a home recipe.
 */

export const recipeTypeSchema = z.enum(['dish', 'prep', 'component']);
export const recipeStatusSchema = z.enum(['draft', 'published', 'archived']);

export const componentRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ingredient'), ingredientId: idSchema }),
  z.object({ kind: z.literal('recipe'), recipeId: idSchema }),
]);

export const recipeComponentSchema = z.object({
  id: idSchema,
  sortOrder: z.number().int(),
  section: z.string().nullable(),
  note: z.string().nullable(),
  quantity: quantitySchema,
  ref: componentRefSchema,
  /** Filled in on read so the client can render a line without a second call. */
  displayName: z.string().optional(),
});

export const recipeStepSchema = z.object({
  text: z.string().min(1).max(4000),
  /** Optional timer in minutes, so a step can drive a countdown on the line. */
  minutes: z.number().int().positive().nullable().optional(),
});

export const recipePhotoSchema = z.object({
  id: idSchema,
  url: z.string(),
  caption: z.string().nullable(),
  isPrimary: z.boolean(),
});

export const recipeSchema = z.object({
  id: idSchema,
  name: z.string(),
  type: recipeTypeSchema,
  status: recipeStatusSchema,
  stationId: idSchema.nullable(),
  yield: quantitySchema,
  portions: z.number().positive().nullable(),
  prepMinutes: z.number().int().nonnegative().nullable(),
  cookMinutes: z.number().int().nonnegative().nullable(),
  shelfLifeHours: z.number().int().positive().nullable(),
  storage: z.string().nullable(),
  method: z.array(recipeStepSchema),
  tags: z.array(z.string()),
  declaredAllergens: z.array(allergenSchema),
  mayContain: z.array(allergenSchema),
  components: z.array(recipeComponentSchema),
  photos: z.array(recipePhotoSchema),
  version: z.number().int(),
  updatedAt: z.string(),
});

/** The trimmed shape used in lists and pickers. */
export const recipeSummarySchema = recipeSchema.pick({
  id: true,
  name: true,
  type: true,
  status: true,
  stationId: true,
  yield: true,
  portions: true,
  tags: true,
  updatedAt: true,
});

export const createRecipeComponentSchema = z.object({
  sortOrder: z.number().int().min(0),
  section: z.string().max(120).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  quantity: quantitySchema,
  ref: componentRefSchema,
});

const recipeFields = z.object({
  name: z.string().min(1).max(200),
  type: recipeTypeSchema,
  status: recipeStatusSchema,
  stationId: idSchema.nullable().optional(),
  yield: quantitySchema,
  portions: z.number().positive().nullable().optional(),
  prepMinutes: z.number().int().nonnegative().nullable().optional(),
  cookMinutes: z.number().int().nonnegative().nullable().optional(),
  shelfLifeHours: z.number().int().positive().nullable().optional(),
  storage: z.string().max(1000).nullable().optional(),
  method: z.array(recipeStepSchema),
  tags: z.array(z.string().max(60)),
  declaredAllergens: z.array(allergenSchema),
  mayContain: z.array(allergenSchema),
  components: z.array(createRecipeComponentSchema),
});

export const createRecipeSchema = recipeFields.extend({
  status: recipeStatusSchema.default('draft'),
  method: z.array(recipeStepSchema).default([]),
  tags: z.array(z.string().max(60)).default([]),
  declaredAllergens: z.array(allergenSchema).default([]),
  mayContain: z.array(allergenSchema).default([]),
  components: z.array(createRecipeComponentSchema).default([]),
});

// Built from the fields without defaults: a field left out of an update stays as it is.
export const updateRecipeSchema = recipeFields.partial();

export const listRecipesQuerySchema = z.object({
  search: z.string().max(200).optional(),
  type: recipeTypeSchema.optional(),
  status: recipeStatusSchema.optional(),
  stationId: idSchema.optional(),
  tag: z.string().max(60).optional(),
  allergen: allergenSchema.optional(),
  /** Exclude recipes containing this allergen, for allergy-safe menu building. */
  excludeAllergen: allergenSchema.optional(),
});

/**
 * Ask the server to work out the tree at a given size. Giving neither reads
 * the recipe at the size it was written, which is the common case.
 */
export const scaleQuerySchema = z.object({
  portions: z.coerce.number().positive().optional(),
  factor: z.coerce.number().positive().optional(),
  yieldValue: z.coerce.number().positive().optional(),
  yieldUnit: unitCodeSchema.optional(),
});

export const allergenProfileSchema = z.object({
  contains: z.array(allergenSchema),
  mayContain: z.array(allergenSchema),
});

/** One line of a fully expanded recipe, ready to print. */
export const expandedLineSchema = z.object({
  depth: z.number().int(),
  kind: z.enum(['ingredient', 'recipe']),
  sourceId: idSchema,
  name: z.string(),
  section: z.string().nullable(),
  note: z.string().nullable(),
  quantity: quantitySchema,
});

export const expandedRecipeSchema = z.object({
  recipe: recipeSchema,
  factor: z.number(),
  lines: z.array(expandedLineSchema),
  allergens: allergenProfileSchema,
});

export type Recipe = z.infer<typeof recipeSchema>;
export type RecipeSummary = z.infer<typeof recipeSummarySchema>;
export type RecipeComponent = z.infer<typeof recipeComponentSchema>;
export type CreateRecipe = z.infer<typeof createRecipeSchema>;
export type ExpandedRecipe = z.infer<typeof expandedRecipeSchema>;
export type AllergenProfile = z.infer<typeof allergenProfileSchema>;

export type RecipeType = z.infer<typeof recipeTypeSchema>;
export type RecipeStatus = z.infer<typeof recipeStatusSchema>;
export type RecipeStep = z.infer<typeof recipeStepSchema>;
export type RecipePhoto = z.infer<typeof recipePhotoSchema>;
export type ComponentRef = z.infer<typeof componentRefSchema>;
export type CreateRecipeComponent = z.infer<typeof createRecipeComponentSchema>;
export type UpdateRecipe = z.infer<typeof updateRecipeSchema>;
export type ExpandedLine = z.infer<typeof expandedLineSchema>;

/** Copying a spec is how most new dishes start life. */
export const duplicateRecipeSchema = z.object({
  name: z.string().min(1).max(200),
});

export type ScaleQuery = z.infer<typeof scaleQuerySchema>;
