import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BackupStatus,
  RestoreResult,
  TestBackupDestination,
  UpdateBackupSettings,
} from '@mise/contracts';
import { api, BASE_URL, RequestFailed } from './client.js';

export function useBackupStatus(enabled = true) {
  return useQuery({
    queryKey: ['backups'],
    queryFn: () => api.get<BackupStatus>('/backups'),
    enabled,
    // While someone is typing the code in at Microsoft, watch for them finishing.
    refetchInterval: (query) => (query.state.data?.onedrive.connecting ? 2000 : false),
  });
}

export function useConnectOnedrive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<BackupStatus>('/backups/onedrive'),
    onSuccess: (status) => queryClient.setQueryData(['backups'], status),
  });
}

/** Also cancels a sign-in that is still waiting for its code. */
export function useDisconnectOnedrive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<BackupStatus>('/backups/onedrive'),
    onSuccess: (status) => queryClient.setQueryData(['backups'], status),
  });
}

export function useUpdateBackups() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateBackupSettings) => api.patch<BackupStatus>('/backups', input),
    onSuccess: (status) => queryClient.setQueryData(['backups'], status),
  });
}

/** Waits for the backup to finish, which on a small machine can take a minute. */
export function useRunBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<BackupStatus>('/backups/run'),
    onSuccess: (status) => queryClient.setQueryData(['backups'], status),
  });
}

export function useTestBackupDestination() {
  return useMutation({
    mutationFn: (input: TestBackupDestination) => api.post<void>('/backups/test', input),
  });
}

/** Only fetched when someone asks to see it. */
export function useRecoveryKey(enabled: boolean) {
  return useQuery({
    queryKey: ['backup-key'],
    queryFn: () => api.get<{ recoveryKey: string }>('/backups/key'),
    enabled,
    staleTime: Infinity,
  });
}

export function useConfirmRecoveryKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>('/backups/key/confirm'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['backups'] }),
  });
}

export function backupDownloadUrl(name: string): string {
  return `${BASE_URL}/backups/files/${encodeURIComponent(name)}`;
}

export interface RestoreInput {
  file: File;
  recoveryKey: string;
  setupToken?: string;
}

export function useRestoreBackup() {
  return useMutation({
    mutationFn: async ({ file, recoveryKey, setupToken }: RestoreInput) => {
      // The fields go first: the server checks the setup code before it
      // accepts any of the file.
      const body = new FormData();
      if (setupToken) body.append('setupToken', setupToken);
      body.append('recoveryKey', recoveryKey);
      body.append('timeZone', Intl.DateTimeFormat().resolvedOptions().timeZone);
      body.append('backup', file);
      const response = await fetch(`${BASE_URL}/setup/restore`, {
        method: 'POST',
        body,
        credentials: 'same-origin',
      });
      const parsed: unknown = await response.json().catch(() => null);
      if (!response.ok)
        throw new RequestFailed(response.status, parsed as never, response.statusText);
      return parsed as RestoreResult;
    },
  });
}
