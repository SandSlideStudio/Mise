import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  AddFromChecklist,
  AddRunningTaskResponse,
  Checklist,
  ChecklistItem,
  CreatePrepTask,
  HandoverNote,
  PrepTask,
  SessionUser,
  UpdatePrepTask,
} from '@mise/contracts';
import { useCallback } from 'react';
import { api, isQueued, sendOrQueue } from './client.js';
import { isRefusal, sendTick, usePendingOverlay } from './ticks.js';
import { useCurrentUser } from './session.js';
import { enqueue } from '../lib/retryQueue.js';
import {
  entriesFor,
  isWaiting,
  remove as removeFromOutbox,
  update as updateOutbox,
  useOutbox,
  WAITING,
  type OutboxEntry,
} from '../lib/outbox.js';

/**
 * The prep list: one list for the whole kitchen, added to by hand, under the
 * cache key `['tasks', 'running']`. Ticks go through the retry queue under the
 * same key, so a tick saved on the tablet refreshes it when it lands.
 */

/** The key a tick is queued and refreshed under. */
export const RUNNING_LIST = 'running';

/** A ticked line is gone this long after it was ticked. */
export const GONE_AFTER_MS = 2 * 60 * 60 * 1000;

export { WAITING, isWaiting } from '../lib/outbox.js';

/**
 * The list as this person will see it once their waiting changes are sent:
 * new lines at the bottom, edits made, removed lines gone. Drawn over what
 * the server last said, never written into it, so each change simply stops
 * showing as waiting once it's in.
 */
function useWaitingOverlay(): (tasks: PrepTask[]) => PrepTask[] {
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const entries = useOutbox(user?.id);
  const key = entries.map((entry) => entry.id).join(',');
  const me = user?.displayName ?? null;
  return useCallback(
    (tasks: PrepTask[]) => {
      if (entries.length === 0) return tasks;
      // What the checklist said when it was last loaded: the names behind the ids ticked offline.
      const items = queryClient.getQueryData<Checklist>(['checklist'])?.items ?? [];
      let list = tasks;
      for (const entry of entries) list = applyWaiting(list, entry, { me, items });
      return list;
    },
    // The entries live outside React; their ids say when to redraw.
    [key, me, queryClient],
  );
}

/** What a waiting change needs to know that isn't in the change itself. */
export interface WaitingContext {
  /** The signed-in person's name, for "added by". */
  me: string | null;
  /** The checklist as last loaded, to turn ticked ids into lines. */
  items: ChecklistItem[];
}

/** The same job when the name matches, trimmed and ignoring capitals. */
const sameJob = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * A line from the checklist, while it waits, carries the change's id and the
 * item's: the item is how it is told apart from the others ticked in the same tap.
 */
const waitingChecklistLine = (entryId: string, itemId: string) => `${WAITING}${entryId}:${itemId}`;

/** Whether a waiting line came from the checklist: it has no id of its own to tick or edit yet. */
export const isWaitingChecklistLine = (id: string) =>
  isWaiting(id) && id.includes(':', WAITING.length);

export function applyWaiting(
  tasks: PrepTask[],
  entry: OutboxEntry,
  context: WaitingContext = { me: null, items: [] },
): PrepTask[] {
  if (entry.method === 'POST' && entry.path === '/running/tasks') {
    const body = entry.body as CreatePrepTask;
    return [
      ...tasks,
      {
        id: `${WAITING}${entry.id}`,
        stationId: body.stationId ?? null,
        recipeId: body.recipeId ?? null,
        description: body.description,
        quantity: body.quantity ?? null,
        status: 'open',
        assignedUserId: body.assignedUserId ?? null,
        assignedUserName: null,
        completedByName: null,
        completedAt: null,
        sortOrder: Number.MAX_SAFE_INTEGER,
        createdByName: context.me,
        fromChecklist: false,
      },
    ];
  }
  if (entry.method === 'POST' && entry.path === '/checklist/add') {
    // The server's rule: what is already open on that station isn't added again.
    const wanted = new Set((entry.body as AddFromChecklist).ids);
    let list = tasks;
    for (const item of context.items) {
      if (!wanted.has(item.id)) continue;
      const there = list.some(
        (line) =>
          (line.status === 'open' || line.status === 'in_progress') &&
          line.stationId === item.stationId &&
          sameJob(line.description, item.name),
      );
      if (there) continue;
      list = [
        ...list,
        {
          id: waitingChecklistLine(entry.id, item.id),
          stationId: item.stationId,
          recipeId: item.recipeId,
          description: item.name,
          quantity: null,
          status: 'open',
          assignedUserId: null,
          assignedUserName: null,
          completedByName: null,
          completedAt: null,
          sortOrder: Number.MAX_SAFE_INTEGER,
          createdByName: context.me,
          fromChecklist: true,
        },
      ];
    }
    return list;
  }
  const task = /^\/tasks\/([^/]+)$/.exec(entry.path)?.[1];
  if (!task) return tasks;
  if (entry.method === 'DELETE') return tasks.filter((line) => line.id !== task);
  if (entry.method === 'PATCH') {
    const body = entry.body as UpdatePrepTask;
    return tasks.map((line) => (line.id === task ? ({ ...line, ...body } as PrepTask) : line));
  }
  return tasks;
}

export function useRunningTasks() {
  const ticks = usePendingOverlay();
  const waiting = useWaitingOverlay();
  return useQuery({
    queryKey: ['tasks', RUNNING_LIST],
    queryFn: () => api.get<PrepTask[]>('/running/tasks'),
    // Lines drop off on the clock as well as on a tap, so keep asking.
    refetchInterval: 60_000,
    // Ticks after the waiting lines, so a line added offline shows ticked too.
    select: useCallback((tasks: PrepTask[]) => ticks(waiting(tasks)), [ticks, waiting]),
  });
}

/** The note above the list for the next shift. */
export function useHandoverNote() {
  const { data: user } = useCurrentUser();
  const entries = useOutbox(user?.id);
  // A note written while Mise couldn't be reached shows as written.
  const waiting = entries.filter((entry) => entry.path === '/running/note').at(-1);
  const waitingKey = waiting?.id ?? '';
  return useQuery({
    queryKey: ['handover'],
    queryFn: () => api.get<HandoverNote>('/running/note'),
    select: useCallback(
      (note: HandoverNote): HandoverNote => {
        if (!waiting) return note;
        const text = (waiting.body as { text: string | null }).text;
        return text
          ? {
              text,
              byName: user?.displayName ?? null,
              at: new Date(waiting.queuedAt).toISOString(),
            }
          : { text: null, byName: null, at: null };
      },
      [waitingKey, user?.displayName],
    ),
  });
}

export function useUpdateHandoverNote() {
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: (text: string) => {
      // The version written over, so someone else's newer note isn't lost unseen.
      const before = queryClient.getQueryData<HandoverNote>(['handover']);
      return sendOrQueue<HandoverNote>(
        'PUT',
        '/running/note',
        { text },
        { label: { key: 'offline.label.note' }, base: before?.at ?? 'none' },
      );
    },
    onSuccess: (note) => {
      if (!isQueued(note)) queryClient.setQueryData(['handover'], note);
    },
  });
}

export function useAddRunningTask() {
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: (input: CreatePrepTask) =>
      sendOrQueue<AddRunningTaskResponse>('POST', '/running/tasks', input, {
        label: { key: 'offline.label.addLine', vars: { name: input.description } },
      }),
    onSuccess: (result) => {
      if (!isQueued(result)) invalidateTasks(queryClient);
    },
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
      // Not on the server yet: only a tick can wait for it, and goes out right after it.
      if (isWaitingChecklistLine(id)) return null;
      if (isWaiting(id) && (!isTick(input) || !user)) return null;
      if (!isTick(input) || !user) {
        const result = await sendOrQueue<PrepTask>('PATCH', `/tasks/${id}`, change, {
          label: { key: 'offline.label.editLine' },
        });
        return isQueued(result) ? null : result;
      }
      const entry = enqueue({
        userId: user.id,
        taskId: id,
        listKey,
        patch: {
          status: change.status!,
          ...(change.assignedUserId !== undefined ? { assignedUserId: change.assignedUserId } : {}),
        },
      });
      return isWaiting(id) ? null : sendTick(entry);
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
    networkMode: 'always',
    mutationFn: async (id: string) => {
      // A line that was itself still waiting to be added is simply never sent.
      if (isWaiting(id)) {
        dropWaitingLine(id, queryClient);
        return;
      }
      await sendOrQueue<void>('DELETE', `/tasks/${id}`, undefined, {
        label: { key: 'offline.label.removeLine' },
      });
    },
    onSuccess: () => invalidateTasks(queryClient),
  });
}

/**
 * Take a line that hasn't been sent off the list. One typed in is a change of
 * its own; one from the checklist is one of the items ticked in a change, so
 * only that item is left out, and the change goes if it was the last.
 */
function dropWaitingLine(id: string, queryClient: QueryClient): void {
  const [entryId = '', itemId] = id.slice(WAITING.length).split(':');
  if (itemId === undefined) {
    removeFromOutbox(entryId);
    return;
  }
  const userId = queryClient.getQueryData<SessionUser | null>(['me'])?.id;
  const entry = userId ? entriesFor(userId).find((other) => other.id === entryId) : undefined;
  if (!entry) return;
  const rest = (entry.body as AddFromChecklist).ids.filter((other) => other !== itemId);
  if (rest.length === 0) removeFromOutbox(entryId);
  else updateOutbox(entryId, { body: { ids: rest } });
}

function invalidateTasks(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: ['tasks', RUNNING_LIST] });
}
