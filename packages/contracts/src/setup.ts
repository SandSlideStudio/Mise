import { z } from 'zod';
import { languageSchema, passwordSchema, pinSchema, roleSchema } from './auth.js';
import { quantitySchema } from './common.js';
import { recipeTypeSchema } from './recipes.js';
import { tickedRetentionSchema } from './prep.js';

/**
 * First run only. Reachable while the server has no users at all.
 *
 * The setup screens collect everything first and send it here in one go, so a
 * kitchen is either fully created or not created at all. Nobody is left with
 * an administrator account and half a brigade because the browser closed on
 * step three.
 *
 * Nothing has an id yet, so people and recipes point at their station by name.
 */

/** Used when a request names no stations, which only older clients do. */
export const DEFAULT_STATIONS = ['Larder', 'Sauce', 'Sauté', 'Grill', 'Pastry'] as const;

const sameName = (name: string) => name.trim().toLowerCase();

export const setupStaffSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  // Staff added here only get a PIN, and an administrator needs a password.
  role: roleSchema.exclude(['admin']),
  /** The name of one of the stations in the same request, or none. */
  station: z.string().max(80).nullable().optional(),
  /** Staff added here sign in on a tablet; a manager's password comes later. */
  pin: pinSchema,
});

export const setupRecipeSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: recipeTypeSchema,
  station: z.string().max(80).nullable().optional(),
  yield: quantitySchema.refine((q) => q.value > 0, 'A batch has to make something'),
  portions: z.number().positive().nullable().optional(),
});

export const setupRequestSchema = z
  .object({
    /** The one-time code from the install, when the server asks for one. */
    setupToken: z.string().trim().max(200).optional(),
    kitchenName: z.string().trim().min(1).max(120),
    displayName: z.string().trim().min(1).max(120),
    email: z.email(),
    password: passwordSchema,
    /** Optional, so the person setting up can tap in on the kitchen tablet straight away. */
    pin: pinSchema.optional(),
    /** Becomes the kitchen's default language. */
    language: languageSchema.optional(),
    unitSystem: z.enum(['metric', 'imperial']).optional(),
    tickedRetention: tickedRetentionSchema.optional(),
    /** The browser's time zone, so the nightly backup runs at night where the kitchen is. */
    timeZone: z.string().max(64).optional(),
    stations: z.array(z.string().trim().min(1).max(80)).min(1).max(50).optional(),
    staff: z.array(setupStaffSchema).max(200).optional(),
    recipes: z.array(setupRecipeSchema).max(500).optional(),
  })
  .superRefine((setup, ctx) => {
    const stations = (setup.stations ?? DEFAULT_STATIONS).map(sameName);
    if (new Set(stations).size !== stations.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['stations'],
        message: 'Two stations have the same name',
      });
    }

    const known = new Set(stations);
    const checkStation = (station: string | null | undefined, path: (string | number)[]) => {
      if (station && !known.has(sameName(station))) {
        ctx.addIssue({ code: 'custom', path, message: `There is no station called ${station}` });
      }
    };
    setup.staff?.forEach((person, i) => checkStation(person.station, ['staff', i, 'station']));
    setup.recipes?.forEach((recipe, i) => checkStation(recipe.station, ['recipes', i, 'station']));

    const recipes = (setup.recipes ?? []).map((recipe) => sameName(recipe.name));
    if (new Set(recipes).size !== recipes.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['recipes'],
        message: 'Two recipes have the same name',
      });
    }
  });

export type SetupRequest = z.infer<typeof setupRequestSchema>;
export type SetupStaff = z.infer<typeof setupStaffSchema>;
export type SetupRecipe = z.infer<typeof setupRecipeSchema>;
