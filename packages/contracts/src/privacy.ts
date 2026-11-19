import { z } from 'zod';
import { idSchema } from './common.js';
import { languageSchema, roleSchema } from './auth.js';
import { labelCheckStatusSchema } from './labelChecks.js';
import { prepTaskStatusSchema, tickedRetentionSchema } from './prep.js';

/**
 * What Mise keeps about people and where it sends anything, as this kitchen
 * has it set up. The kitchen answers to its staff for their data; this is what
 * it needs to answer them, with the numbers that are true for this server.
 */
export const privacySummarySchema = z.object({
  tickedRetention: tickedRetentionSchema,
  /** Kept ticked lines go after this many days. Null: kept for good. */
  tickedKeepDays: z.number().int().nullable(),
  /** Hours a ticked line stays on the running list. */
  runningListHours: z.number(),
  passwordSessionDays: z.number().int(),
  pinSessionHours: z.number().int(),
  /** An outside device unused this long is forgotten, its address and browser with it. */
  outsideDeviceIdleDays: z.number().int(),
  /** A request for outside access nobody answers is dropped after this long. */
  outsideRequestHours: z.number().int(),
  /** Answers kept for changes sent from offline, so they're never made twice. */
  offlineAnswersDays: z.number().int(),
  updateCheck: z.boolean(),
  domainHttps: z.boolean(),
  backups: z.object({
    /** Backups kept on this server. */
    keepLocal: z.number().int(),
    /** Backups kept on the NAS and on OneDrive, each. */
    keepRemote: z.number().int(),
    webdav: z.boolean(),
    onedrive: z.boolean(),
  }),
});

/** A prep line someone had a hand in, and which hand. */
const personLineSchema = z.object({
  id: idSchema,
  description: z.string(),
  station: z.string().nullable(),
  status: prepTaskStatusSchema,
  addedAt: z.string(),
  completedAt: z.string().nullable(),
  fromChecklist: z.boolean(),
  /** They put it on the list. */
  added: z.boolean(),
  /** Their name is against it: they started it, or it is theirs to do. */
  onIt: z.boolean(),
  /** They ticked it off. */
  ticked: z.boolean(),
});

/**
 * Everything Mise holds about one person, for them to read. Never a hash, a
 * token or anything else made from their PIN or password.
 */
export const personDataSchema = z.object({
  exportedAt: z.string(),
  kitchen: z.string(),
  person: z.object({
    id: idSchema,
    displayName: z.string(),
    email: z.string().nullable(),
    role: roleSchema,
    station: z.string().nullable(),
    active: z.boolean(),
    language: languageSchema.nullable(),
    hasPassword: z.boolean(),
    hasPin: z.boolean(),
    pinSetAt: z.string().nullable(),
    tourSeenAt: z.string().nullable(),
    lockedUntil: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  prepLines: z.array(personLineSchema),
  recipes: z.array(z.object({ id: idSchema, name: z.string(), createdAt: z.string() })),
  /** Changes to a dish's allergens their edit made, from its allergen record. */
  allergenChanges: z.array(
    z.object({ dish: z.string(), changedAt: z.string(), cause: z.string().nullable() }),
  ),
  /** Labels they read at delivery. Left out by older servers. */
  labelChecks: z
    .array(
      z.object({
        ingredient: z.string(),
        checkedAt: z.string(),
        changed: z.boolean(),
        status: labelCheckStatusSchema,
        note: z.string().nullable(),
      }),
    )
    .optional(),
  /** The note for the next shift, when it is signed with their name. */
  handoverNote: z.object({ text: z.string().nullable(), at: z.string().nullable() }).nullable(),
  sessions: z.array(
    z.object({
      startedAt: z.string(),
      lastSeenAt: z.string(),
      endsAt: z.string(),
      browser: z.string().nullable(),
      tablet: z.string().nullable(),
    }),
  ),
  approvedDevices: z.array(
    z.object({
      name: z.string(),
      approvedAt: z.string().nullable(),
      lastSeenAt: z.string().nullable(),
    }),
  ),
});

export type PrivacySummary = z.infer<typeof privacySummarySchema>;
export type PersonData = z.infer<typeof personDataSchema>;
