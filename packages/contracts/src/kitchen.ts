import { z } from 'zod';
import { idSchema } from './common.js';
import { languageSchema, passwordSchema, pinSchema, roleSchema } from './auth.js';
import { tickedRetentionSchema } from './prep.js';

/** Stations are how every prep list is grouped, so they exist from day one. */
export const stationSchema = z.object({
  id: idSchema,
  name: z.string(),
  sortOrder: z.number().int(),
});

export const createStationSchema = z.object({
  name: z.string().min(1).max(80),
  sortOrder: z.number().int().min(0).default(0),
});

// Without the default, renaming a station doesn't move it to the top.
export const updateStationSchema = z
  .object({
    name: z.string().min(1).max(80),
    sortOrder: z.number().int().min(0),
  })
  .partial();

/** Whole new order in one call, so dragging a list does not fire a request per row. */
export const reorderStationsSchema = z.object({
  ids: z.array(idSchema).min(1),
});

export const userSchema = z.object({
  id: idSchema,
  displayName: z.string(),
  email: z.string().nullable(),
  role: roleSchema,
  defaultStationId: idSchema.nullable(),
  active: z.boolean(),
  hasPassword: z.boolean(),
  hasPin: z.boolean(),
  lockedUntil: z.string().nullable(),
});

export const createUserSchema = z
  .object({
    displayName: z.string().min(1).max(120),
    email: z.email().nullable().optional(),
    role: roleSchema,
    defaultStationId: idSchema.nullable().optional(),
    password: passwordSchema.optional(),
    pin: pinSchema.optional(),
  })
  .refine((v) => v.password || v.pin, {
    message: 'A staff member needs either a password or a PIN to sign in',
  })
  .refine((v) => !v.password || v.email, {
    message: 'Password sign-in needs an email address',
    path: ['email'],
  });

/**
 * Every field optional, because this is also how a PIN gets reset and how
 * somebody gets deactivated. A null pin clears it, removing tablet sign-in.
 */
export const updateUserSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  email: z.email().nullable().optional(),
  role: roleSchema.optional(),
  defaultStationId: idSchema.nullable().optional(),
  active: z.boolean().optional(),
  password: passwordSchema.optional(),
  pin: pinSchema.nullable().optional(),
});

export const pinOnlyStateSchema = z.enum(['off', 'waiting', 'on']);

export const kitchenSchema = z.object({
  id: idSchema,
  name: z.string(),
  /** What the interface speaks for anyone who has not chosen for themselves. */
  language: languageSchema,
  tickedRetention: tickedRetentionSchema,
  /** The chef's checklist on the prep list. */
  prepChecklist: z.boolean(),
  /**
   * Sign-in by PIN alone. "waiting": chosen, but not everyone with a PIN has
   * been given a new one yet, so tablets still show the names.
   */
  pinOnly: pinOnlyStateSchema,
  /** Sign out of a shared tablet after this many minutes untouched. Null: never. */
  idleSignOutMinutes: z.number().int().nullable(),
  /** Kept ticked lines are deleted once this many days old. Null: kept for good. */
  tickedKeepDays: z.number().int().nullable(),
});

export const updateKitchenSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  language: languageSchema.optional(),
  tickedRetention: tickedRetentionSchema.optional(),
  prepChecklist: z.boolean().optional(),
  pinOnly: z.boolean().optional(),
  idleSignOutMinutes: z.number().int().min(1).max(240).nullable().optional(),
  tickedKeepDays: z.number().int().min(1).max(3650).nullable().optional(),
});

/**
 * Where PIN-only sign-in stands, for Settings: who still needs a new PIN
 * before tablets stop showing the names. Names only, never anything about a PIN.
 */
export const pinOnlyStatusSchema = z.object({
  state: pinOnlyStateSchema,
  waiting: z.array(z.object({ id: idSchema, displayName: z.string() })),
});

export type PinOnlyState = z.infer<typeof pinOnlyStateSchema>;
export type PinOnlyStatus = z.infer<typeof pinOnlyStatusSchema>;
export type Station = z.infer<typeof stationSchema>;
export type CreateStation = z.infer<typeof createStationSchema>;
export type UpdateStation = z.infer<typeof updateStationSchema>;
export type User = z.infer<typeof userSchema>;
export type CreateUser = z.infer<typeof createUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
export type Kitchen = z.infer<typeof kitchenSchema>;
export type UpdateKitchen = z.infer<typeof updateKitchenSchema>;
