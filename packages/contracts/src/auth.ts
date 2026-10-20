import { z } from 'zod';
import { idSchema } from './common.js';

/**
 * Two ways in. Managers use email and password from anywhere. Line cooks tap a
 * name and a PIN, but only on a tablet an admin has enrolled, because four
 * digits on their own are far too weak to expose to a network.
 */

export const ROLES = ['admin', 'head_chef', 'sous_chef', 'cook'] as const;
export type Role = (typeof ROLES)[number];
export const roleSchema = z.enum(ROLES);

/** Roles that may edit the recipe library and manage staff. */
export const MANAGER_ROLES: readonly Role[] = ['admin', 'head_chef', 'sous_chef'];

const RANK: Record<Role, number> = { cook: 0, sous_chef: 1, head_chef: 2, admin: 3 };

/**
 * Whether someone with role `actor` may add, change or remove a person with
 * `role`, or give someone that role. Administrators can manage anyone;
 * everyone else only people ranked below them.
 */
export function mayManage(actor: Role, role: Role): boolean {
  return actor === 'admin' || RANK[role] < RANK[actor];
}

/**
 * The languages the interface speaks. A kitchen has a default; a person may
 * override it for themselves. Recipes stay exactly as the chef typed them.
 */
export const LANGUAGES = ['en', 'nl', 'fr', 'es', 'de'] as const;
export type Language = (typeof LANGUAGES)[number];
export const languageSchema = z.enum(LANGUAGES);

export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(200, 'That is longer than we can hash');

export const pinSchema = z.string().regex(/^\d{4,8}$/, 'A PIN is 4 to 8 digits');

export const setupStatusSchema = z.object({
  needsSetup: z.boolean(),
  /** The kitchen's language, so the screens before sign-in already speak it. */
  language: languageSchema,
  /** So the sign-in screens can say which kitchen this is. Null before setup. */
  kitchenName: z.string().nullable(),
  /** Whether setting up needs the one-time code from the install. */
  setupTokenRequired: z.boolean(),
});

export const loginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const pinLoginRequestSchema = z.object({
  userId: idSchema,
  pin: z.string().min(1),
});

export const sessionUserSchema = z.object({
  id: idSchema,
  displayName: z.string(),
  email: z.string().nullable(),
  role: roleSchema,
  defaultStationId: idSchema.nullable(),
  kitchenName: z.string(),
  /** Their own choice, or null to follow the kitchen. */
  language: languageSchema.nullable(),
  kitchenLanguage: languageSchema,
  /** Whether they have been offered the tour, so each person is asked exactly once. */
  tourSeen: z.boolean(),
  /** Signed in by PIN on an enrolled tablet, so signing out goes back to the names. */
  onTablet: z.boolean(),
});

/** What anyone signed in may change about themselves. */
export const updateMeSchema = z.object({
  language: languageSchema.nullable().optional(),
  /** Taken or declined, the tour is not offered again. */
  tourSeen: z.literal(true).optional(),
});

/** The roster a shared tablet shows before anyone has signed in. */
export const rosterEntrySchema = z.object({
  id: idSchema,
  displayName: z.string(),
  role: roleSchema,
  defaultStationId: idSchema.nullable(),
  /**
   * Nobody is signed in yet, so the tablet cannot look stations up itself.
   * The name under a cook's name is how two Marcos tell themselves apart.
   */
  stationName: z.string().nullable(),
  /**
   * How many digits their PIN has, so the pad signs in the moment the last one
   * is typed. Null for a PIN set before this was recorded; the pad then waits
   * for OK. Knowing the length barely helps a guesser: five misses lock the
   * account.
   */
  pinLength: z.number().int().nullable(),
});

export const enrollDeviceRequestSchema = z.object({
  name: z.string().min(1).max(120),
});

export const enrollDeviceResponseSchema = z.object({
  id: idSchema,
  name: z.string(),
  /** Shown once, at enrollment time, and never again. */
  token: z.string(),
});

export const deviceSchema = z.object({
  id: idSchema,
  name: z.string(),
  enrolledAt: z.string(),
  lastSeenAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type PinLoginRequest = z.infer<typeof pinLoginRequestSchema>;
export type SessionUser = z.infer<typeof sessionUserSchema>;
export type UpdateMe = z.infer<typeof updateMeSchema>;
export type RosterEntry = z.infer<typeof rosterEntrySchema>;
export type Device = z.infer<typeof deviceSchema>;

export type SetupStatus = z.infer<typeof setupStatusSchema>;
