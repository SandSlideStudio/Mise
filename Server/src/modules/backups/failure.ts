/**
 * Why a backup or a restore didn't work, as a code the app can say in the
 * kitchen's own language. The detail is for the server log only.
 */
export type BackupFailureCode =
  | 'bad_key'
  | 'wrong_key'
  | 'not_a_backup'
  | 'too_new'
  | 'local'
  | 'unreachable'
  | 'auth'
  | 'folder'
  | 'remote'
  | 'onedrive_auth'
  | 'onedrive_full'
  | 'onedrive_unreachable'
  | 'onedrive_failed'
  | 'unknown';

export class BackupFailure extends Error {
  readonly code: BackupFailureCode;

  constructor(code: BackupFailureCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'BackupFailure';
    this.code = code;
  }
}

export function failureCode(error: unknown): BackupFailureCode {
  return error instanceof BackupFailure ? error.code : 'unknown';
}
