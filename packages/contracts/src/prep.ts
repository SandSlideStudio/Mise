import { z } from 'zod';
import { idSchema, quantitySchema } from './common.js';

/**
 * The prep list: one running list the kitchen adds to by hand and ticks off,
 * which forgets a ticked line two hours after it was ticked.
 */

export const prepTaskStatusSchema = z.enum(['open', 'in_progress', 'done', 'skipped']);

/**
 * Whether a line that has dropped off the list is kept in the database, out
 * of sight, or deleted to save the space.
 */
export const tickedRetentionSchema = z.enum(['keep', 'delete']);

export const prepTaskSchema = z.object({
  id: idSchema,
  stationId: idSchema.nullable(),
  /** The spec this line is for, when it was added from a recipe. */
  recipeId: idSchema.nullable(),
  description: z.string(),
  quantity: quantitySchema.nullable(),
  status: prepTaskStatusSchema,
  assignedUserId: idSchema.nullable(),
  assignedUserName: z.string().nullable(),
  completedByName: z.string().nullable(),
  completedAt: z.string().nullable(),
  sortOrder: z.number().int(),
});

export const createPrepTaskSchema = z.object({
  description: z.string().min(1).max(500),
  stationId: idSchema.nullable().optional(),
  recipeId: idSchema.nullable().optional(),
  quantity: quantitySchema.nullable().optional(),
  assignedUserId: idSchema.nullable().optional(),
});

/**
 * Adding to the list. When the same thing is already open on the same
 * station, the amount goes onto that line instead of starting a second one,
 * and `merged` says so.
 */
export const addRunningTaskResponseSchema = z.object({
  task: prepTaskSchema,
  merged: z.boolean(),
});

export const updatePrepTaskSchema = z.object({
  description: z.string().min(1).max(500).optional(),
  stationId: idSchema.nullable().optional(),
  quantity: quantitySchema.nullable().optional(),
  assignedUserId: idSchema.nullable().optional(),
  status: prepTaskStatusSchema.optional(),
  sortOrder: z.number().int().optional(),
});

export type PrepTask = z.infer<typeof prepTaskSchema>;
export type PrepTaskStatus = z.infer<typeof prepTaskStatusSchema>;
export type CreatePrepTask = z.infer<typeof createPrepTaskSchema>;
export type UpdatePrepTask = z.infer<typeof updatePrepTaskSchema>;
export type AddRunningTaskResponse = z.infer<typeof addRunningTaskResponseSchema>;
export type TickedRetention = z.infer<typeof tickedRetentionSchema>;
