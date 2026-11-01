import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Connection, KitchenHttps, TrustInfo, UpdateConnection } from '@mise/contracts';
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

/** Every HTTPS change answers with the whole connection, which replaces what was shown. */
function useConnectionChange<T>(send: (input: T) => Promise<Connection>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSuccess: (connection) => queryClient.setQueryData(['connection'], connection),
  });
}

export const useEnableKitchenHttps = () =>
  useConnectionChange((input: KitchenHttps) =>
    api.put<Connection>('/connection/kitchen-https', input),
  );
export const useDisableKitchenHttps = () =>
  useConnectionChange(() => api.delete<Connection>('/connection/kitchen-https'));
export const useEnableDomainHttps = () =>
  useConnectionChange(() => api.post<Connection>('/connection/domain-https'));
export const useDisableDomainHttps = () =>
  useConnectionChange(() => api.delete<Connection>('/connection/domain-https'));

/** For the trust page, before anyone signs in. */
export function useTrustInfo() {
  return useQuery({
    queryKey: ['trust'],
    queryFn: () => api.get<TrustInfo>('/connection/trust'),
  });
}

/** The kitchen certificate's own address for this device: https://192.168.1.50:3443 */
export function httpsAddress(names: string[], port: number): string {
  const here = window.location.hostname.toLowerCase();
  const name = names.includes(here) ? here : (names[0] ?? here);
  const host = name.includes(':') ? `[${name}]` : name;
  return `https://${host}${port === 443 ? '' : `:${port}`}`;
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
