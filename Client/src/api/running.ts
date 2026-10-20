import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AddRunningTaskResponse, CreatePrepTask, PrepTask } from '@mise/contracts';
import { api } from './client.js';
import { usePendingOverlay } from './ticks.js';

/**
 * The running list: one list for the whole kitchen, added to by hand.
 *
 * It shares the tick path with service lists — the same PATCH, the same retry
 * queue — under the cache key `['tasks', 'running']`, so a queued tick
 * refreshes it exactly as it would a service's list.
 */

/** The key a running-list tick is queued and refreshed under. */
export const RUNNING_LIST = 'running';

/** A ticked line is gone this long after it was ticked. */
export const GONE_AFTER_MS = 2 * 60 * 60 * 1000;

export function useRunningTasks() {
  const overlay = usePendingOverlay();
  return useQuery({
    queryKey: ['tasks', RUNNING_LIST],
    queryFn: () => api.get<PrepTask[]>('/running/tasks'),
    // Lines drop off on the clock as well as on a tap, so keep asking.
    refetchInterval: 60_000,
    select: overlay,
  });
}

export function useAddRunningTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePrepTask) =>
      api.post<AddRunningTaskResponse>('/running/tasks', input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['tasks', RUNNING_LIST] }),
  });
}
