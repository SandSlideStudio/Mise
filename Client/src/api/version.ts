import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { VersionInfo } from '@mise/contracts';
import { api } from './client.js';

/** Which Mise is running, and for an administrator whether a newer one is out. */
export function useVersion() {
  return useQuery({
    queryKey: ['version'],
    queryFn: () => api.get<VersionInfo>('/version'),
    // The server checks once a day; asking it more than hourly tells nobody anything new.
    staleTime: 60 * 60_000,
  });
}

export function useSetVersionCheck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => api.put<VersionInfo>('/version/check', { enabled }),
    onSuccess: (info) => queryClient.setQueryData(['version'], info),
  });
}
