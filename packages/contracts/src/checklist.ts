import { z } from 'zod';
import { idSchema, quantitySchema } from './common.js';

/**
 * The chef's checklist for the prep list: names, organised by station, that
 * anyone can tick to put on the list. Names, with an optional recipe from the
 * book and an optional par: how much the chef wants ready.
 */

/** A par is an amount to have ready, so it is more than nothing. */
export const parSchema = quantitySchema.refine((q) => q.value > 0, {
  message: 'A par is more than nothing.',
});

export const checklistItemSchema = z.object({
  id: idSchema,
  /** Null: no station, shown in a group of its own at the end. */
  stationId: idSchema.nullable(),
  name: z.string(),
  /** The recipe the line is made from: the prep line it adds links to it. Null: none. */
  recipeId: idSchema.nullable(),
  /**
   * How much the chef wants ready, in the unit the chef chose. Null: no par,
   * the line goes on the list without an amount. Optional so a checklist
   * kept on a tablet from before pars still reads.
   */
  par: quantitySchema.nullable().optional(),
});

export const checklistSchema = z.object({
  /** Whether the kitchen has the checklist switched on. */
  enabled: z.boolean(),
  /** In the kitchen's station order, then the chef's own order within a station. */
  items: z.array(checklistItemSchema),
  /** When it last changed: sent back as the version an edit started from. */
  updatedAt: z.string(),
});

/**
 * The whole list, replacing what is there. The order sent is the order kept
 * within each station. An item sent with an id it already has keeps that id;
 * a new one may bring its own, so a change sent twice makes it once.
 */
export const updateChecklistSchema = z.object({
  items: z
    .array(
      z.object({
        id: idSchema.optional(),
        stationId: idSchema.nullable(),
        name: z.string().trim().min(1).max(120),
        recipeId: idSchema.nullable().optional(),
        /**
         * Null takes the par away. Left out keeps the one the item has, so a
         * save from a tablet that predates pars doesn't wipe them.
         */
        par: parSchema.nullable().optional(),
      }),
    )
    .max(500),
});

export const addFromChecklistSchema = z.object({
  ids: z.array(idSchema).min(1).max(500),
  /**
   * How much is already there, by item id, for items with a par. An item
   * with a par and nothing said here has nothing there, so the whole par is
   * made. Left out altogether by tablets from before pars.
   */
  onHand: z
    .record(idSchema, quantitySchema)
    .refine((onHand) => Object.keys(onHand).length <= 500, {
      message: 'Too many amounts.',
    })
    .optional(),
});

export const addFromChecklistResponseSchema = z.object({
  /** Lines that went on the prep list. */
  added: z.number().int(),
  /** Ticked items that were skipped because the same line is already open on that station. */
  alreadyThere: z.number().int(),
  /** Names of ticked items left off because what is there already reaches the par. */
  enough: z.array(z.string()).default([]),
});

export type ChecklistItem = z.infer<typeof checklistItemSchema>;
export type Checklist = z.infer<typeof checklistSchema>;
export type UpdateChecklist = z.infer<typeof updateChecklistSchema>;
export type AddFromChecklist = z.infer<typeof addFromChecklistSchema>;
export type AddFromChecklistResponse = z.infer<typeof addFromChecklistResponseSchema>;
