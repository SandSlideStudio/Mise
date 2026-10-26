import { z } from 'zod';

/** Where nightly backups go. They are always kept on the server too. */
export const backupDestinationSchema = z.enum(['local', 'webdav', 'onedrive']);

/**
 * What an administrator should be told about, most urgent first: the last
 * backup failed, there hasn't been one for two days, or nobody has written the
 * recovery key down yet.
 */
export const backupProblemSchema = z.enum(['failed', 'stale', 'key_unconfirmed']);

/** Why a backup or a restore didn't work. The app words each one itself. */
export const backupFailureSchema = z.enum([
  'bad_key',
  'wrong_key',
  'not_a_backup',
  'too_new',
  'local',
  'unreachable',
  'auth',
  'folder',
  'remote',
  'onedrive_auth',
  'onedrive_full',
  'onedrive_unreachable',
  'onedrive_failed',
  'unknown',
]);

export const backupFileSchema = z.object({
  name: z.string(),
  size: z.number().int(),
  createdAt: z.string(),
});

/**
 * OneDrive's side: whose OneDrive is connected, or the code to type in at
 * Microsoft while someone is connecting it.
 */
export const onedriveStatusSchema = z.object({
  account: z.string().nullable(),
  connecting: z
    .object({ userCode: z.string(), verificationUri: z.string(), expiresAt: z.string() })
    .nullable(),
  connectError: z.enum(['declined', 'expired', 'failed']).nullable(),
});

export const backupStatusSchema = z.object({
  destination: backupDestinationSchema,
  webdavUrl: z.string().nullable(),
  webdavUsername: z.string().nullable(),
  hasWebdavPassword: z.boolean(),
  onedrive: onedriveStatusSchema,
  hour: z.number().int(),
  timeZone: z.string(),
  keepLocal: z.number().int(),
  keepRemote: z.number().int(),
  keyConfirmed: z.boolean(),
  lastAttemptAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  lastError: backupFailureSchema.nullable(),
  running: z.boolean(),
  problem: backupProblemSchema.nullable(),
  /** Backups kept on the server, newest first. */
  files: z.array(backupFileSchema),
});

export const webdavUrlSchema = z
  .string()
  .trim()
  .max(500)
  .regex(/^https?:\/\/[^\s/?#]+[^\s]*$/i, 'Use an address that starts with http:// or https://');

export const updateBackupSettingsSchema = z
  .object({
    destination: backupDestinationSchema,
    webdavUrl: webdavUrlSchema.nullable(),
    webdavUsername: z.string().trim().max(200).nullable(),
    /** Left out to keep the saved password. */
    webdavPassword: z.string().max(500),
    hour: z.number().int().min(0).max(23),
    timeZone: z.string().min(1).max(64),
    keepLocal: z.number().int().min(1).max(60),
    keepRemote: z.number().int().min(1).max(365),
  })
  .partial();

export const testBackupDestinationSchema = z.object({
  webdavUrl: webdavUrlSchema,
  webdavUsername: z.string().trim().max(200).nullable().optional(),
  /** Left out to test with the saved password. */
  webdavPassword: z.string().max(500).optional(),
});

export const recoveryKeySchema = z.object({ recoveryKey: z.string() });

export const restoreResultSchema = z.object({
  kitchenName: z.string(),
  staff: z.number().int(),
  recipes: z.number().int(),
  photos: z.number().int(),
});

export type BackupDestination = z.infer<typeof backupDestinationSchema>;
export type BackupProblem = z.infer<typeof backupProblemSchema>;
export type BackupFailureCode = z.infer<typeof backupFailureSchema>;
export type BackupFile = z.infer<typeof backupFileSchema>;
export type OnedriveStatus = z.infer<typeof onedriveStatusSchema>;
export type BackupStatus = z.infer<typeof backupStatusSchema>;
export type UpdateBackupSettings = z.infer<typeof updateBackupSettingsSchema>;
export type TestBackupDestination = z.infer<typeof testBackupDestinationSchema>;
export type RestoreResult = z.infer<typeof restoreResultSchema>;
