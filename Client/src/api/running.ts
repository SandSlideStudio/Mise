import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddRunningTaskResponse,
  CreatePrepTask,
  HandoverNote,
  PrepTask,
  SessionUser,
  UpdatePrepTask,
} from '@mise/contracts';
import { api } from './client.js';
import { isRefusal, sendTick, usePendingOverlay } from './ticks.js';
import { enqueue } from '../lib/retryQueue.js';

/**
 * The prep list: one list for the whole kitchen, added to by hand, under the
 * cache key `['tasks', 'running']`. Ticks go through the retry queue under the
 * same key, so a tick saved on the tablet refreshes it when it lands.
 */

/** The key a tick is queued and refreshed under. */
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

/** The note above the list for the next shift. */
export function useHandoverNote() {
  return useQuery({
    queryKey: ['handover'],
    queryFn: () => api.get<HandoverNote>('/running/note'),
  });
}

export function useUpdateHandoverNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => api.put<HandoverNote>('/running/note', { text }),
    onSuccess: (note) => queryClient.setQueryData(['handover'], note),
  });
}

export function useAddRunningTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePrepTask) =>
      api.post<AddRunningTaskResponse>('/running/tasks', input),
    onSuccess: () => invalidateTasks(queryClient),
  });
}

type TaskUpdate = UpdatePrepTask & { id: string };

/** A tick: a change of status, maybe with your name on it, and nothing else. */
function isTick(input: TaskUpdate): boolean {
  return (
    input.status !== undefined &&
    Object.keys(input).every((key) => key === 'id' || key === 'status' || key === 'assignedUserId')
  );
}

/**
 * Changing a line. A tick shows on screen at once and is saved on the tablet
 * before it's sent, so it survives a dropped connection or a reload and is
 * retried until the server answers. Only a refusal from the server undoes it.
 * Other edits go straight to the server and are undone if they fail.
 */
export function useUpdatePrepTask() {
  const listKey = RUNNING_LIST;
  const queryClient = useQueryClient();
  return useMutation({
    // Run even when the browser says it's offline: the tick is saved first.
    networkMode: 'always',
    mutationFn: async (input: TaskUpdate): Promise<PrepTask | null> => {
      const { id, ...change } = input;
      const user = queryClient.getQueryData<SessionUser | null>(['me']);
      if (!isTick(input) || !user) return api.patch<PrepTask>(`/tasks/${id}`, change);
      const entry = enqueue({
        userId: user.id,
        taskId: id,
        listKey,
        patch: {
          status: change.status!,
          ...(change.assignedUserId !== undefined ? { assignedUserId: change.assignedUserId } : {}),
        },
      });
      return sendTick(entry);
    },

    onMutate: async ({ id, ...input }) => {
      await queryClient.cancelQueries({ queryKey: ['tasks', listKey] });
      const snapshots = queryClient.getQueriesData<PrepTask[]>({
        queryKey: ['tasks', listKey],
      });
      for (const [key, tasks] of snapshots) {
        if (!tasks) continue;
        queryClient.setQueryData(
          key,
          tasks.map((task) => (task.id === id ? { ...task, ...input } : task)),
        );
      }
      return { snapshots };
    },

    onError: (error, variables, context) => {
      // Saved on the tablet and still being retried: leave it ticked.
      if (isTick(variables) && !isRefusal(error)) return;
      for (const [key, tasks] of context?.snapshots ?? []) {
        queryClient.setQueryData(key, tasks);
      }
      invalidateTasks(queryClient);
    },

    onSuccess: () => invalidateTasks(queryClient),
  });
}

export function useDeletePrepTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/tasks/${id}`),
    onSuccess: () => invalidateTasks(queryClient),
  });
}

function invalidateTasks(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: ['tasks', RUNNING_LIST] });
}
