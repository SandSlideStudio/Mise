import { useQuery } from '@tanstack/react-query';
import type { PersonData, PrivacySummary } from '@mise/contracts';
import { api } from './client.js';

/** What this kitchen keeps, for how long, and where it sends anything. Managers. */
export function usePrivacySummary(enabled = true) {
  return useQuery({
    queryKey: ['privacy'],
    queryFn: () => api.get<PrivacySummary>('/privacy'),
    enabled,
  });
}

/** Everything about one person, fetched fresh each time: it's handed to them as it is now. */
export function fetchPersonData(id: string): Promise<PersonData> {
  return api.get<PersonData>(`/users/${id}/data`);
}
