import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BackupStatus,
  OnedriveStatus,
  RestoreResult,
  TestBackupDestination,
  UpdateBackupSettings,
} from '@mise/contracts';
import { api, BASE_URL, request, RequestFailed, withPassword } from './client.js';

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
    mutationFn: (currentPassword?: string) =>
      api.post<BackupStatus>('/backups/onedrive', withPassword(currentPassword)),
    onSuccess: (status) => queryClient.setQueryData(['backups'], status),
  });
}

/** Also cancels a sign-in that is still waiting for its code. */
export function useDisconnectOnedrive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (currentPassword?: string) =>
      api.delete<BackupStatus>('/backups/onedrive', withPassword(currentPassword)),
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

/**
 * Only asked for when someone wants to see it, and from outside the kitchen
 * with their password again. Kept by the screen, never in the query cache.
 */
export function useRecoveryKey() {
  return useMutation({
    mutationFn: (currentPassword?: string) =>
      api.post<{ recoveryKey: string }>('/backups/key', withPassword(currentPassword)),
  });
}

export function useConfirmRecoveryKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>('/backups/key/confirm'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['backups'] }),
  });
}

export function backupDownloadUrl(name: string, ticket?: string): string {
  const url = `${BASE_URL}/backups/files/${encodeURIComponent(name)}`;
  return ticket ? `${url}?ticket=${encodeURIComponent(ticket)}` : url;
}

/**
 * From outside the kitchen: a ticket for the password, then the download
 * itself, which the browser saves as it would from a link.
 */
export function useDownloadBackup() {
  return useMutation({
    mutationFn: async ({ name, currentPassword }: { name: string; currentPassword?: string }) => {
      const { ticket } = await api.post<{ ticket: string }>(
        `/backups/files/${encodeURIComponent(name)}/ticket`,
        withPassword(currentPassword),
      );
      const link = document.createElement('a');
      link.href = backupDownloadUrl(name, ticket);
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
    },
  });
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

// --- during first-run setup ----------------------------------------------
// The same steps as Settings → Backups, before anyone is signed in. They carry
// the setup code for the requests that need it.

const setupHeaders = (code: string): Record<string, string> =>
  code ? { 'x-setup-token': code } : {};

export function useSetupTestBackup(code: string) {
  return useMutation({
    mutationFn: (input: TestBackupDestination) =>
      request<void>('/setup/backups/test', {
        method: 'POST',
        body: input,
        headers: setupHeaders(code),
      }),
  });
}

/** OneDrive's side during setup; asked every few seconds while a sign-in is waiting. */
export function useSetupOnedrive(code: string, enabled: boolean) {
  return useQuery({
    queryKey: ['setup-onedrive'],
    queryFn: () => request<OnedriveStatus>('/setup/onedrive', { headers: setupHeaders(code) }),
    enabled,
    refetchInterval: (query) => (query.state.data?.connecting ? 3000 : false),
  });
}

export function useSetupConnectOnedrive(code: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request<OnedriveStatus>('/setup/onedrive', { method: 'POST', headers: setupHeaders(code) }),
    onSuccess: (status) => queryClient.setQueryData(['setup-onedrive'], status),
  });
}

export function useSetupDisconnectOnedrive(code: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request<OnedriveStatus>('/setup/onedrive', { method: 'DELETE', headers: setupHeaders(code) }),
    onSuccess: (status) => queryClient.setQueryData(['setup-onedrive'], status),
  });
}
