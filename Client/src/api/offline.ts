import { useEffect } from 'react';
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import type { MenuSummary, RecipeSummary } from '@mise/contracts';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { del, get, set } from 'idb-keyval';
import { isReachable } from '../lib/connectivity.js';
import { api } from './client.js';

/**
 * What a tablet keeps for when Mise can't be reached.
 *
 * Everything loaded is saved on the device (IndexedDB), so a screen opened
 * yesterday still opens without a connection. And the kitchen's day-to-day
 * (the prep list, every recipe and dish, the menus) is loaded in the
 * background now and then, so pages nobody opened yet are there too.
 */

/** Saved for a week; anything older is asked for again. */
export const KEPT_FOR_MS = 7 * 24 * 60 * 60 * 1000;

/** Not kept on the device: settings an administrator reads with the connection anyway. */
const NOT_KEPT = new Set([
  'users',
  'devices',
  'remote-devices',
  'connection',
  'backups',
  'backup-key',
  'setup-onedrive',
  'access-status',
  'trust',
  'version',
]);

const STORE_KEY = 'mise.cache';

export const persister = createAsyncStoragePersister({
  storage: {
    getItem: async (key: string) => (await get<string>(key)) ?? null,
    setItem: (key: string, value: string) => set(key, value),
    removeItem: (key: string) => del(key),
  },
  key: STORE_KEY,
  // Writing the whole cache on every change would be a lot on a slow tablet.
  throttleTime: 2_000,
});

export function keepOnDevice(queryKey: QueryKey, succeeded: boolean): boolean {
  return succeeded && !NOT_KEPT.has(String(queryKey[0]));
}

/** Forget everything kept, as signing out on a shared tablet does. */
export async function forgetKept(): Promise<void> {
  await del(STORE_KEY).catch(() => undefined);
}

// --- loading ahead -------------------------------------------------------------

const EVERY_MS = 30 * 60 * 1000;
/** Fresh enough not to ask again. */
const FRESH_MS = 25 * 60 * 1000;
/** A few at a time, so a Raspberry Pi serving the kitchen doesn't notice. */
const AT_ONCE = 3;

async function load(queryClient: QueryClient, queryKey: QueryKey, path: string, query?: object) {
  await queryClient
    .prefetchQuery({
      queryKey,
      queryFn: () => api.get(path, query as Record<string, string>),
      staleTime: FRESH_MS,
    })
    .catch(() => undefined);
}

async function inTurn(jobs: (() => Promise<void>)[]): Promise<void> {
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: AT_ONCE }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        if (!isReachable()) return;
        await job();
      }
    }),
  );
}

async function loadAhead(queryClient: QueryClient): Promise<void> {
  if (!isReachable()) return;
  await inTurn([
    () => load(queryClient, ['tasks', 'running'], '/running/tasks'),
    () => load(queryClient, ['handover'], '/running/note'),
    () => load(queryClient, ['stations'], '/stations'),
    () => load(queryClient, ['recipes', {}], '/recipes'),
    () => load(queryClient, ['dishes'], '/dishes'),
    () => load(queryClient, ['menus'], '/menus'),
    () => load(queryClient, ['dish-card-settings'], '/dish-cards/settings'),
  ]);

  const recipes = queryClient.getQueryData<RecipeSummary[]>(['recipes', {}]) ?? [];
  const menus = queryClient.getQueryData<MenuSummary[]>(['menus']) ?? [];
  await inTurn([
    ...recipes.flatMap(({ id, type }) => [
      () => load(queryClient, ['recipe', id], `/recipes/${id}`),
      () => load(queryClient, ['recipe-expanded', id, {}], `/recipes/${id}/expanded`),
      () => load(queryClient, ['recipe-allergens', id], `/recipes/${id}/allergens`),
      () => load(queryClient, ['recipe-used-by', id], `/recipes/${id}/used-by`),
      ...(type === 'dish'
        ? [() => load(queryClient, ['dish-card', id], `/recipes/${id}/card`)]
        : []),
    ]),
    ...menus.flatMap(({ id }) => [
      () => load(queryClient, ['menu', id], `/menus/${id}`),
      () => load(queryClient, ['menu-overview', id], `/menus/${id}/overview`),
    ]),
  ]);
}

/** Load the kitchen ahead now and then while someone is signed in. Mounted once, in the shell. */
export function useLoadAhead(signedIn: boolean): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!signedIn) return;
    // A moment after start, so the screen someone opened loads first.
    const first = window.setTimeout(() => void loadAhead(queryClient), 5_000);
    const timer = window.setInterval(() => void loadAhead(queryClient), EVERY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [signedIn, queryClient]);
}
