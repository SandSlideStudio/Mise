import { z } from 'zod';
import { idSchema } from './common.js';

/**
 * The chef's checklist for the prep list: names, organised by station, that
 * anyone can tick to put on the list. Names, with an optional recipe from the book: no amounts.
 */

export const checklistItemSchema = z.object({
  id: idSchema,
  /** Null: no station, shown in a group of its own at the end. */
  stationId: idSchema.nullable(),
  name: z.string(),
  /** The recipe the line is made from: the prep line it adds links to it. Null: none. */
  recipeId: idSchema.nullable(),
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
      }),
    )
    .max(500),
});

export const addFromChecklistSchema = z.object({
  ids: z.array(idSchema).min(1).max(500),
});

export const addFromChecklistResponseSchema = z.object({
  /** Lines that went on the prep list. */
  added: z.number().int(),
  /** Ticked items that were skipped because the same line is already open on that station. */
  alreadyThere: z.number().int(),
});

export type ChecklistItem = z.infer<typeof checklistItemSchema>;
export type Checklist = z.infer<typeof checklistSchema>;
export type UpdateChecklist = z.infer<typeof updateChecklistSchema>;
export type AddFromChecklist = z.infer<typeof addFromChecklistSchema>;
export type AddFromChecklistResponse = z.infer<typeof addFromChecklistResponseSchema>;
