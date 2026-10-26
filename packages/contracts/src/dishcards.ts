import { z } from 'zod';
import { languageSchema } from './auth.js';
import { allergenSchema, idSchema } from './common.js';
import { courseSchema, recipeStatusSchema, servingTemperatureSchema } from './recipes.js';

/**
 * Dish cards: one page per dish for front of house, plus its allergens per
 * component on the back. The kitchen sets up how they look once; anyone it
 * allows can then print one in any of the interface's languages.
 */

/** Parts of the card a kitchen can switch off. */
export const DISH_CARD_PARTS = [
  'menu',
  'flavour',
  'temperature',
  'course',
  'drinks',
  'cutlery',
  'photo',
  'logo',
  'location',
  'summary',
  'mayContain',
  'vegan',
] as const;

export const dishCardPartSchema = z.enum(DISH_CARD_PARTS);
export const dishCardThemeSchema = z.enum(['day', 'night']);
export const dishCardAccessSchema = z.enum(['everyone', 'managers']);

/** The kitchen's own warning, written once per language it wants. */
export const dishCardWarningsSchema = z.partialRecord(languageSchema, z.string().max(2000));

export const dishCardSettingsSchema = z.object({
  title: z.string().nullable(),
  locationName: z.string().nullable(),
  address: z.string().nullable(),
  logoUrl: z.string().nullable(),
  warnings: dishCardWarningsSchema,
  hidden: z.array(dishCardPartSchema),
  theme: dishCardThemeSchema,
  access: dishCardAccessSchema,
});

export const updateDishCardSettingsSchema = z
  .object({
    title: z.string().trim().max(120).nullable(),
    locationName: z.string().trim().max(120).nullable(),
    address: z.string().trim().max(240).nullable(),
    warnings: dishCardWarningsSchema,
    hidden: z.array(dishCardPartSchema),
    theme: dishCardThemeSchema,
    access: dishCardAccessSchema,
  })
  .partial();

export const veganStatusSchema = z.enum(['yes', 'no', 'unknown']);

/** What one row of the allergen table says. */
export const dishCardFactsSchema = z.object({
  contains: z.array(allergenSchema),
  mayContain: z.array(allergenSchema),
  vegan: veganStatusSchema,
  gluten: z.array(z.string()),
  nuts: z.array(z.string()),
});

export const dishCardRowSchema = dishCardFactsSchema.extend({
  recipeId: idSchema,
  name: z.string(),
});

/**
 * Everything a card needs, in no particular language. Labels and the fixed
 * lists are translated where the card is drawn, so switching language is
 * instant and needs no second request.
 */
export const dishCardSchema = z.object({
  kitchenName: z.string(),
  dish: z.object({
    id: idSchema,
    name: z.string(),
    status: recipeStatusSchema,
    /** The menus a card says the dish is on: active ones, or the one being printed. */
    menus: z.array(z.string()),
    flavourProfile: z.array(z.string()),
    servingTemperature: servingTemperatureSchema.nullable(),
    course: courseSchema.nullable(),
    drinkPairings: z.array(z.string()),
    cutlery: z.array(z.string()),
    photoUrl: z.string().nullable(),
  }),
  rows: z.array(dishCardRowSchema),
  /** Allergens from things sitting directly on the dish, when they add anything. */
  other: dishCardFactsSchema.nullable(),
  whole: dishCardFactsSchema,
  /** What someone should fix before trusting the card. Never stops it printing. */
  attention: z.object({
    veganUnknown: z.array(z.string()),
    missingDetails: z.array(z.string()),
  }),
  settings: dishCardSettingsSchema,
});

export type DishCardPart = z.infer<typeof dishCardPartSchema>;
export type DishCardTheme = z.infer<typeof dishCardThemeSchema>;
export type DishCardAccess = z.infer<typeof dishCardAccessSchema>;
export type DishCardSettings = z.infer<typeof dishCardSettingsSchema>;
export type UpdateDishCardSettings = z.infer<typeof updateDishCardSettingsSchema>;
export type DishCardFacts = z.infer<typeof dishCardFactsSchema>;
export type DishCardRow = z.infer<typeof dishCardRowSchema>;
export type DishCard = z.infer<typeof dishCardSchema>;
export type VeganStatus = z.infer<typeof veganStatusSchema>;
