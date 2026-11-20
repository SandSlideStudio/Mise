import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddFromChecklist,
  AddFromChecklistResponse,
  Checklist,
  ChecklistItem,
  Station,
  UpdateChecklist,
} from '@mise/contracts';
import { api, isQueued, sendOrQueue } from './client.js';
import { useCurrentUser } from './session.js';
import { useOutbox } from '../lib/outbox.js';
import { RUNNING_LIST } from './running.js';

/**
 * The chef's checklist for the prep list, under the cache key `['checklist']`.
 *
 * Reading it, ticking items onto the list and saving a new version all go
 * through the same outbox as the rest of the list, so none of them is lost
 * to a dropped connection.
 */

/** A new item's id, made here so a save sent twice still means the same item. */
export function newItemId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  // Version 4, variant 1: the shape the server's ids have.
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (n) => n.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The checklist, as this person will see it once their waiting save is sent.
 * Only the newest waiting save counts: each one is the whole list.
 */
export function useChecklist(enabled = true) {
  const { data: user } = useCurrentUser();
  const entries = useOutbox(user?.id);
  const waiting = entries.filter((e) => e.method === 'PUT' && e.path === '/checklist').at(-1);
  const waitingKey = waiting?.id ?? '';
  return useQuery({
    queryKey: ['checklist'],
    queryFn: () => api.get<Checklist>('/checklist'),
    enabled,
    select: useCallback(
      (checklist: Checklist): Checklist => {
        if (!waiting) return checklist;
        const body = waiting.body as UpdateChecklist;
        return {
          ...checklist,
          items: body.items.map((item) => ({
            id: item.id ?? newItemId(),
            stationId: item.stationId,
            name: item.name,
            // Left out by a save from before recipe links or pars: the item
            // keeps the link and the par it had.
            recipeId:
              item.recipeId !== undefined
                ? item.recipeId
                : (checklist.items.find((other) => other.id === item.id)?.recipeId ?? null),
            par:
              item.par !== undefined
                ? item.par
                : (checklist.items.find((other) => other.id === item.id)?.par ?? null),
          })),
        };
      },
      [waitingKey],
    ),
  });
}

export function useAddFromChecklist() {
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: (input: AddFromChecklist) =>
      sendOrQueue<AddFromChecklistResponse>('POST', '/checklist/add', input, {
        label: { key: 'offline.label.checklistAdd' },
      }),
    onSuccess: (result) => {
      if (isQueued(result)) return;
      void queryClient.invalidateQueries({ queryKey: ['tasks', RUNNING_LIST] });
    },
  });
}

/**
 * Save the whole list. `base` is the version the chef started editing from,
 * so a save over someone else's newer one is shown side by side instead.
 */
export function useSaveChecklist() {
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ items, base }: UpdateChecklist & { base: string | null }) =>
      sendOrQueue<Checklist>(
        'PUT',
        '/checklist',
        { items },
        { label: { key: 'offline.label.checklist' }, base },
      ),
    onSuccess: (result) => {
      if (!isQueued(result)) queryClient.setQueryData(['checklist'], result);
    },
  });
}

/** Items by station, in the kitchen's station order; the ones with no station last. */
export function groupChecklist(
  items: ChecklistItem[],
  stations: Station[],
): { station: Station | null; items: ChecklistItem[] }[] {
  const groups: { station: Station | null; items: ChecklistItem[] }[] = [];
  for (const station of stations) {
    const own = items.filter((item) => item.stationId === station.id);
    if (own.length > 0) groups.push({ station, items: own });
  }
  const loose = items.filter((item) => !stations.some((s) => s.id === item.stationId));
  if (loose.length > 0) groups.push({ station: null, items: loose });
  return groups;
}
