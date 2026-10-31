import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Connection, UpdateConnection } from '@mise/contracts';
import { api } from './client.js';

/** Settings → Connection: how this server is reached. Administrators only. */

export function useConnection() {
  return useQuery({
    queryKey: ['connection'],
    queryFn: () => api.get<Connection>('/connection'),
  });
}

export function useUpdateConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateConnection) => api.put<Connection>('/connection', input),
    onSuccess: (connection) => queryClient.setQueryData(['connection'], connection),
  });
}

/** What people paste: "https://mise.example.com/login" → "mise.example.com". */
export function bareDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

/** Whether a host is a name someone could have bought, not an address or a local name. */
export function looksLikeDomain(host: string): boolean {
  return (
    /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) && !/^[\d.]+$/.test(host) && !host.endsWith('.local')
  );
}
