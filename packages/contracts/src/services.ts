import { z } from 'zod';
import { idSchema, quantitySchema } from './common.js';

/**
 * A service is one meal period on one date. Adding dishes and covers to it and
 * pressing generate is the whole reason this application exists.
 */

export const servicePeriodSchema = z.enum(['breakfast', 'lunch', 'dinner', 'prep_day', 'event']);
export const serviceStatusSchema = z.enum(['planning', 'active', 'closed']);
export const prepTaskStatusSchema = z.enum(['open', 'in_progress', 'done', 'skipped']);
export const prepTaskSourceSchema = z.enum(['generated', 'manual']);

/**
 * How a kitchen keeps its prep. Either a list per service, generated from the
 * dishes on it, or one running list that lines are added to by hand and that
 * forgets a ticked line two hours after it was ticked.
 */
export const prepModeSchema = z.enum(['per_service', 'running']);

/**
 * Whether a line that has dropped off the running list is kept in the
 * database, out of sight, or deleted to save the space.
 */
export const tickedRetentionSchema = z.enum(['keep', 'delete']);

export const serviceDishSchema = z.object({
  id: idSchema,
  recipeId: idSchema,
  recipeName: z.string(),
  plannedPortions: z.number().positive(),
});

export const prepTaskSchema = z.object({
  id: idSchema,
  /** Null for a line on the running list, which belongs to no service. */
  serviceId: idSchema.nullable(),
  stationId: idSchema.nullable(),
  kind: z.enum(['recipe', 'ingredient', 'other']),
  sourceRecipeId: idSchema.nullable(),
  sourceIngredientId: idSchema.nullable(),
  description: z.string(),
  quantity: quantitySchema.nullable(),
  source: prepTaskSourceSchema,
  status: prepTaskStatusSchema,
  assignedUserId: idSchema.nullable(),
  assignedUserName: z.string().nullable(),
  completedByName: z.string().nullable(),
  completedAt: z.string().nullable(),
  notes: z.array(z.string()),
  /** Which dishes drove the total, so a chef can check the arithmetic. */
  usedBy: z.array(
    z.object({ recipeId: idSchema, recipeName: z.string(), quantity: quantitySchema }),
  ),
  sortOrder: z.number().int(),
});

export const serviceSchema = z.object({
  id: idSchema,
  date: z.string(),
  period: servicePeriodSchema,
  covers: z.number().int().nonnegative().nullable(),
  notes: z.string().nullable(),
  status: serviceStatusSchema,
  dishes: z.array(serviceDishSchema),
  generatedAt: z.string().nullable(),
});

export const serviceSummarySchema = serviceSchema
  .pick({ id: true, date: true, period: true, covers: true, status: true, generatedAt: true })
  .extend({
    dishCount: z.number().int(),
    taskCount: z.number().int(),
    doneCount: z.number().int(),
  });

export const createServiceSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  period: servicePeriodSchema,
  covers: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const updateServiceSchema = createServiceSchema.partial().extend({
  status: serviceStatusSchema.optional(),
});

export const addServiceDishSchema = z.object({
  recipeId: idSchema,
  plannedPortions: z.number().positive(),
});

export const updateServiceDishSchema = z.object({
  plannedPortions: z.number().positive(),
});

export const createPrepTaskSchema = z.object({
  description: z.string().min(1).max(500),
  stationId: idSchema.nullable().optional(),
  quantity: quantitySchema.nullable().optional(),
  assignedUserId: idSchema.nullable().optional(),
});

/**
 * Adding to the running list. When the same thing is already open on the same
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

/**
 * Regenerating merges rather than replaces. Anything a cook has finished or
 * added by hand survives; untouched generated tasks get their new quantities.
 */
export const generatePrepListResponseSchema = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  removed: z.number().int(),
  kept: z.number().int(),
  tasks: z.array(prepTaskSchema),
});

/** Copy unfinished work from an earlier service onto this one. */
export const carryOverRequestSchema = z.object({
  fromServiceId: idSchema,
});

/**
 * Carrying over twice should not double the list, so anything already on the
 * target service by the same description is skipped rather than duplicated.
 */
export const carryOverResponseSchema = z.object({
  created: z.number().int(),
  skipped: z.number().int(),
  tasks: z.array(prepTaskSchema),
});

export const listServicesQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  status: serviceStatusSchema.optional(),
});

export const listPrepTasksQuerySchema = z.object({
  stationId: idSchema.optional(),
  assignedUserId: idSchema.optional(),
  status: prepTaskStatusSchema.optional(),
});

export type Service = z.infer<typeof serviceSchema>;
export type ServiceSummary = z.infer<typeof serviceSummarySchema>;
export type ServiceDish = z.infer<typeof serviceDishSchema>;
export type ServicePeriod = z.infer<typeof servicePeriodSchema>;
export type ServiceStatus = z.infer<typeof serviceStatusSchema>;
export type CreateService = z.infer<typeof createServiceSchema>;
export type UpdateService = z.infer<typeof updateServiceSchema>;
export type PrepTask = z.infer<typeof prepTaskSchema>;
export type PrepTaskStatus = z.infer<typeof prepTaskStatusSchema>;
export type CreatePrepTask = z.infer<typeof createPrepTaskSchema>;
export type UpdatePrepTask = z.infer<typeof updatePrepTaskSchema>;
export type CarryOverResponse = z.infer<typeof carryOverResponseSchema>;
export type GeneratePrepListResponse = z.infer<typeof generatePrepListResponseSchema>;
export type AddRunningTaskResponse = z.infer<typeof addRunningTaskResponseSchema>;
export type PrepMode = z.infer<typeof prepModeSchema>;
export type TickedRetention = z.infer<typeof tickedRetentionSchema>;
