import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CarryOverResponse,
  CreatePrepTask,
  CreateService,
  GeneratePrepListResponse,
  PrepTask,
  SessionUser,
  Service,
  ServiceDish,
  ServiceSummary,
  UpdatePrepTask,
  UpdateService,
} from '@mise/contracts';
import { api } from './client.js';
import { isRefusal, sendTick, usePendingOverlay } from './ticks.js';
import { enqueue } from '../lib/retryQueue.js';

/** Services and their prep lists. */

/** Today in the kitchen's own timezone, which is the one the cook is standing in. */
export function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function useServices(filters: { from?: string; to?: string } = {}) {
  return useQuery({
    queryKey: ['services', filters],
    queryFn: () => api.get<ServiceSummary[]>('/services', filters),
  });
}

export function useService(id: string | undefined) {
  return useQuery({
    queryKey: ['service', id],
    enabled: Boolean(id),
    queryFn: () => api.get<Service>(`/services/${id}`),
  });
}

export function useCreateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateService) => api.post<Service>('/services', input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['services'] }),
  });
}

export function useUpdateService(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateService) => api.patch<Service>(`/services/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['service', id] });
      void queryClient.invalidateQueries({ queryKey: ['services'] });
    },
  });
}

export function useDeleteService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/services/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['services'] }),
  });
}

export function usePrepTasks(serviceId: string | undefined, filters: Record<string, string> = {}) {
  const overlay = usePendingOverlay();
  return useQuery({
    queryKey: ['tasks', serviceId, filters],
    enabled: Boolean(serviceId),
    queryFn: () => api.get<PrepTask[]>(`/services/${serviceId}/tasks`, filters),
    select: overlay,
  });
}

export function useCreatePrepTask(serviceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePrepTask) =>
      api.post<PrepTask>(`/services/${serviceId}/tasks`, input),
    onSuccess: () => invalidateTasks(queryClient, serviceId),
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
export function useUpdatePrepTask(listKey: string) {
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
      invalidateTasks(queryClient, listKey);
    },

    onSuccess: () => invalidateTasks(queryClient, listKey),
  });
}

export function useDeletePrepTask(serviceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/tasks/${id}`),
    onSuccess: () => invalidateTasks(queryClient, serviceId),
  });
}

export function useCarryOver(serviceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fromServiceId: string) =>
      api.post<CarryOverResponse>(`/services/${serviceId}/carry-over`, { fromServiceId }),
    onSuccess: () => invalidateTasks(queryClient, serviceId),
  });
}

function invalidateTasks(queryClient: ReturnType<typeof useQueryClient>, serviceId: string): void {
  void queryClient.invalidateQueries({ queryKey: ['tasks', serviceId] });
  void queryClient.invalidateQueries({ queryKey: ['services'] });
}

export function useAddServiceDish(serviceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { recipeId: string; plannedPortions: number }) =>
      api.post<ServiceDish[]>(`/services/${serviceId}/dishes`, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['service', serviceId] }),
  });
}

export function useRemoveServiceDish(serviceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dishId: string) =>
      api.delete<ServiceDish[]>(`/services/${serviceId}/dishes/${dishId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['service', serviceId] }),
  });
}

/**
 * The button the whole application exists for. Merges into the list people
 * have been editing rather than replacing it.
 */
export function useGeneratePrepList(serviceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<GeneratePrepListResponse>(`/services/${serviceId}/generate`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks', serviceId] });
      void queryClient.invalidateQueries({ queryKey: ['service', serviceId] });
      void queryClient.invalidateQueries({ queryKey: ['services'] });
    },
  });
}
