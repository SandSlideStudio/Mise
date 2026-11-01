import { useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccessStatus, RemoteDevices } from '@mise/contracts';
import { api, RequestFailed } from './client.js';

/** Outside access: asking from a device beyond the kitchen, and answering. */

/** True for the answer every API call gets from outside before approval. */
export function isAccessRequired(error: unknown): boolean {
  return error instanceof RequestFailed && error.code === 'access_required';
}

/** Where this device stands. Asked every few seconds while a request waits. */
export function useAccessStatus() {
  return useQuery({
    queryKey: ['access-status'],
    queryFn: () => api.get<AccessStatus>('/access/status'),
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 3_000 : false),
    refetchIntervalInBackground: true,
  });
}

export function useRequestAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.post<AccessStatus>('/access/request', { name }),
    onSuccess: (status) => queryClient.setQueryData(['access-status'], status),
  });
}

export function useRemoteDevices() {
  return useQuery({
    queryKey: ['remote-devices'],
    queryFn: () => api.get<RemoteDevices>('/access/devices'),
  });
}

export function useApproveRemoteDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password?: string }) =>
      api.post<void>(`/access/devices/${id}/approve`, password ? { password } : {}),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['remote-devices'] }),
  });
}

export function useRemoveRemoteDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/access/devices/${id}`),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['remote-devices'] }),
  });
}

// Whether the server has answered "approve this device first". Kept outside
// React Query so any failed call, from any screen, can flip the whole app to
// the request page.
let required = false;
const listeners = new Set<() => void>();

export function markAccessRequired(): void {
  if (required) return;
  required = true;
  for (const listener of listeners) listener();
}

export function useAccessRequired(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => required,
  );
}
