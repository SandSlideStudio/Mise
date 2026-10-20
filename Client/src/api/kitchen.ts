import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateStation,
  CreateUser,
  Kitchen,
  Station,
  UpdateKitchen,
  UpdateStation,
  UpdateUser,
  User,
} from '@mise/contracts';
import { api } from './client.js';

/** Stations, staff and the kitchen's own settings. */

export function useStations() {
  return useQuery({
    queryKey: ['stations'],
    queryFn: () => api.get<Station[]>('/stations'),
    // Stations change about once a year; no need to keep asking.
    staleTime: 5 * 60_000,
  });
}

export function useCreateStation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStation) => api.post<Station>('/stations', input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['stations'] }),
  });
}

export function useUpdateStation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateStation & { id: string }) =>
      api.patch<Station>(`/stations/${id}`, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['stations'] }),
  });
}

export function useDeleteStation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/stations/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['stations'] }),
  });
}

export function useReorderStations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.post<Station[]>('/stations/reorder', { ids }),
    // The whole order goes up at once, so the answer is the new list.
    onSuccess: (stations) => queryClient.setQueryData(['stations'], stations),
  });
}

export function useStaff() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<User[]>('/users'),
  });
}

export function useCreateStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUser) => api.post<User>('/users', input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateUser & { id: string }) =>
      api.patch<User>(`/users/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      // Editing yourself can change your own role or name in the header.
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

/** Removes someone for good. */
export function useRemoveStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/users/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['roster'] });
    },
  });
}

export function useKitchen() {
  return useQuery({
    queryKey: ['kitchen'],
    queryFn: () => api.get<Kitchen>('/kitchen'),
  });
}

export function useUpdateKitchen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateKitchen) => api.patch<Kitchen>('/kitchen', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kitchen'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export interface Device {
  id: string;
  name: string;
  enrolledAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

export function useDevices() {
  return useQuery({
    queryKey: ['devices'],
    queryFn: () => api.get<Device[]>('/auth/devices'),
  });
}

/**
 * Enrolling sets a long-lived cookie on *this* device, so an administrator has
 * to do it from the tablet they are enrolling.
 */
export function useEnrollDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.post<{ id: string; name: string; token: string }>('/auth/devices', { name }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['devices'] }),
  });
}

export function useRevokeDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/auth/devices/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['devices'] }),
  });
}
