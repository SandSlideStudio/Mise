import { z } from 'zod';
import { COURSES, KEPT, SERVING_TEMPERATURES } from '@mise/domain';
import { allergenSchema, idSchema, quantitySchema, unitCodeSchema } from './common.js';
import { recipeCostSchema } from './costing.js';

/**
 * A recipe is a list of components, and a component points at either an
 * ingredient or another recipe. That one rule is what separates a restaurant
 * spec from a home recipe.
 */

/** What a dish card says about a dish. Fixed lists, so the card can translate them. */
export const servingTemperatureSchema = z.enum(SERVING_TEMPERATURES);
export const courseSchema = z.enum(COURSES);
/** How a batch is kept, for the use-by on its label. */
export const keptSchema = z.enum(KEPT);

/** Short things a chef types: a flavour, a wine, a spoon. */
const shortList = z.array(z.string().trim().min(1).max(80)).max(12);

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
  /** Null: not chosen yet; the label then goes by what the storage note says. */
  kept: keptSchema.nullable(),
  /** Where and how, in the chef's own words. */
  storage: z.string().nullable(),
  method: z.array(recipeStepSchema),
  tags: z.array(z.string()),
  declaredAllergens: z.array(allergenSchema),
  mayContain: z.array(allergenSchema),
  flavourProfile: z.array(z.string()),
  servingTemperature: servingTemperatureSchema.nullable(),
  course: courseSchema.nullable(),
  drinkPairings: z.array(z.string()),
  cutlery: z.array(z.string()),
  components: z.array(recipeComponentSchema),
  photos: z.array(recipePhotoSchema),
  /** What a guest pays for a dish, VAT included. Left out altogether for a cook. */
  sellPrice: z.number().nonnegative().nullable().optional(),
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
  kept: keptSchema.nullable().optional(),
  storage: z.string().max(1000).nullable().optional(),
  method: z.array(recipeStepSchema),
  tags: z.array(z.string().max(60)),
  declaredAllergens: z.array(allergenSchema),
  mayContain: z.array(allergenSchema),
  flavourProfile: shortList,
  servingTemperature: servingTemperatureSchema.nullable(),
  course: courseSchema.nullable(),
  drinkPairings: shortList,
  cutlery: shortList,
  components: z.array(createRecipeComponentSchema),
  sellPrice: z.number().finite().nonnegative().max(100_000).nullable().optional(),
});

export const createRecipeSchema = recipeFields.extend({
  status: recipeStatusSchema.default('draft'),
  method: z.array(recipeStepSchema).default([]),
  tags: z.array(z.string().max(60)).default([]),
  declaredAllergens: z.array(allergenSchema).default([]),
  mayContain: z.array(allergenSchema).default([]),
  flavourProfile: shortList.default([]),
  servingTemperature: servingTemperatureSchema.nullable().default(null),
  course: courseSchema.nullable().default(null),
  drinkPairings: shortList.default([]),
  cutlery: shortList.default([]),
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

/**
 * One entry in a dish's allergen record: what its allergens became, and when.
 * What was added or taken away is the difference with the entry before it.
 */
export const allergenChangeSchema = allergenProfileSchema.extend({
  id: idSchema,
  changedAt: z.string(),
  /** The ingredient or recipe whose edit made the change. Null for the dish itself, and for the first entry. */
  cause: z.string().nullable(),
  /** Who made it. Null when nobody did (the first entry) or they are no longer on the staff. */
  changedBy: z.string().nullable(),
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
  /** What the size asked for costs. Left out altogether for a cook. */
  cost: recipeCostSchema.optional(),
});

export type Recipe = z.infer<typeof recipeSchema>;
export type RecipeSummary = z.infer<typeof recipeSummarySchema>;
export type RecipeComponent = z.infer<typeof recipeComponentSchema>;
export type CreateRecipe = z.infer<typeof createRecipeSchema>;
export type ExpandedRecipe = z.infer<typeof expandedRecipeSchema>;
export type AllergenProfile = z.infer<typeof allergenProfileSchema>;
export type AllergenChange = z.infer<typeof allergenChangeSchema>;

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
export type ServingTemperature = z.infer<typeof servingTemperatureSchema>;
export type Course = z.infer<typeof courseSchema>;
export type Kept = z.infer<typeof keptSchema>;
