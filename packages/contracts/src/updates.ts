import { z } from 'zod';

/**
 * Which Mise is running, and whether a newer one is out. Everyone may see the
 * version; only an administrator is told about updates, because only they can
 * install one.
 */
export const versionInfoSchema = z.object({
  current: z.string(),
  /** Whether this kitchen asks GitHub once a day. */
  checkEnabled: z.boolean(),
  /** The newest release, once a check has worked. Null for anyone but an administrator. */
  latest: z.string().nullable(),
  newer: z.boolean(),
  releaseUrl: z.string().nullable(),
  checkedAt: z.string().nullable(),
  /** The last check didn't reach GitHub. */
  checkFailed: z.boolean(),
});

export const updateVersionCheckSchema = z.object({ enabled: z.boolean() });

export type VersionInfo = z.infer<typeof versionInfoSchema>;
export type UpdateVersionCheck = z.infer<typeof updateVersionCheckSchema>;
