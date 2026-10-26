import { z } from 'zod';
import { idSchema } from './common.js';
import { dishCardFactsSchema, dishCardSettingsSchema } from './dishcards.js';
import { courseSchema, recipeStatusSchema } from './recipes.js';

/**
 * Menus: the dishes front of house sells together, such as this autumn's
 * menu or the lunch card. A menu prints as one allergen overview, and all its
 * dish cards come out as one PDF.
 */

export const menuStatusSchema = z.enum(['draft', 'active', 'archived']);

export const menuSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  status: menuStatusSchema,
  dishCount: z.number().int(),
  updatedAt: z.string(),
});

export const menuDishSchema = z.object({
  recipeId: idSchema,
  name: z.string(),
  course: courseSchema.nullable(),
  status: recipeStatusSchema,
  /** The dish, or anything in it, changed after the menu's cards were last downloaded. */
  changedSinceCards: z.boolean(),
});

export const menuSchema = menuSummarySchema.extend({
  /** In menu order: by course, then as the chef arranged them. */
  dishes: z.array(menuDishSchema),
  cardsPrintedAt: z.string().nullable(),
});

const menuFields = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable(),
  status: menuStatusSchema,
  /** The dishes, in the order the chef wants them within each course. */
  dishes: z.array(idSchema).max(200),
});

export const createMenuSchema = menuFields.extend({
  description: z.string().trim().max(1000).nullable().default(null),
  status: menuStatusSchema.default('draft'),
  dishes: z.array(idSchema).max(200).default([]),
});

export const updateMenuSchema = menuFields.partial();

export const duplicateMenuSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

/** Everything the allergen overview needs, in no particular language. */
export const menuOverviewSchema = z.object({
  kitchenName: z.string(),
  menu: z.object({ id: idSchema, name: z.string(), description: z.string().nullable() }),
  dishes: z.array(
    dishCardFactsSchema.extend({
      recipeId: idSchema,
      name: z.string(),
      course: courseSchema.nullable(),
    }),
  ),
  settings: dishCardSettingsSchema,
});

export type MenuStatus = z.infer<typeof menuStatusSchema>;
export type MenuSummary = z.infer<typeof menuSummarySchema>;
export type MenuDish = z.infer<typeof menuDishSchema>;
export type Menu = z.infer<typeof menuSchema>;
export type CreateMenu = z.infer<typeof createMenuSchema>;
export type UpdateMenu = z.infer<typeof updateMenuSchema>;
export type MenuOverview = z.infer<typeof menuOverviewSchema>;
