import { useEffect } from 'react';
import {
  notifyManager,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { OFFLINE_BUNDLE_FORMAT, type OfflineBundle } from '@mise/contracts';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { del, get, set } from 'idb-keyval';
import { isReachable } from '../lib/connectivity.js';
import { VERSION } from '../version.js';
import { entriesFor } from '../lib/outbox.js';
import { api } from './client.js';
import { breather, unpack } from './unpack.js';

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
  // The fonts dish cards are drawn with: objects that can't be stored as
  // text. Saved, they came back without their workings and every card failed
  // to open until the browser's data was cleared. They load in a moment.
  'card-fonts',
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

/**
 * Whether a query is saved on the device. Anything with an answer is, even
 * when asking again just failed: that failure is Mise being out of reach, and
 * the last answer is exactly what to open with next time.
 */
export function keepOnDevice(queryKey: QueryKey, hasAnswer: boolean): boolean {
  return hasAnswer && !NOT_KEPT.has(String(queryKey[0]));
}

/** Forget everything kept, as signing out on a shared tablet does: data and photos. */
export async function forgetKept(): Promise<void> {
  await del(STORE_KEY).catch(() => undefined);
  // The photos the service worker keeps (sw/service-worker.js).
  if (typeof caches !== 'undefined') await caches.delete('mise-photos').catch(() => false);
}

// --- loading ahead -------------------------------------------------------------

const EVERY_MS = 30 * 60 * 1000;
/** How long the prep list and the handover note stay fresh before they are asked for again. */
const FRESH_MS = 25 * 60 * 1000;
/** A few at a time, so a Raspberry Pi serving the kitchen doesn't notice. */
const AT_ONCE = 3;
/**
 * How long the bundle's answers are put in the cache before the page gets a
 * breather: each one wakes the screens that show it, and all of a kitchen's
 * at once is a stutter a cook would feel.
 */
const SLICE_MS = 8;

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

/**
 * The data version the last complete load saw. Kept in the cache itself, so
 * it is saved on the device with the answers it describes, and never says
 * "up to date" about answers that didn't make it there.
 */
const LOADED_KEY = ['loaded-version'] as const;

/** Kinds of answer the bundle holds one of per recipe or menu. */
const PER_ITEM = new Set([
  'recipe',
  'recipe-used-by',
  'recipe-allergens',
  'recipe-expanded',
  'dish-card',
  'menu',
  'menu-overview',
]);

/**
 * Loads what may be needed offline, but only if the kitchen's data changed
 * since the last complete load, and then in one request: the server reads its
 * recipe book once for all of it, not once for every recipe and screen.
 */
export async function loadAhead(queryClient: QueryClient, userId?: string): Promise<void> {
  if (!isReachable()) return;

  let current: string;
  try {
    current = (await api.get<{ version: string }>('/offline/version')).version;
  } catch {
    return;
  }
  // The version alone is not trusted when the saved answers are gone (cleared
  // by the browser, or older than a week): then they are loaded again.
  const haveAnswers = queryClient.getQueryData(['recipes', {}]) !== undefined;
  if (current === queryClient.getQueryData(LOADED_KEY) && haveAnswers) return;

  const started = Date.now();
  let bundle: OfflineBundle;
  try {
    // Which app asks, so a server that has been updated meanwhile can tell it
    // to reload rather than let it work out allergens with older code.
    bundle = await api.get<OfflineBundle>('/offline/bundle', {
      format: OFFLINE_BUNDLE_FORMAT,
      app: VERSION,
    });
  } catch {
    return;
  }
  // A server from before the format this app reads answers in its own; what
  // is in it would be misread, so it is left alone until both are updated.
  if (bundle.format !== OFFLINE_BUNDLE_FORMAT) return;
  // Changes not sent yet are shown as made; the server's copy must not paint
  // over them. The next round, once they are sent, loads it.
  const editing = () => queryClient.isMutating() > 0 || (!!userId && entriesFor(userId).length > 0);
  if (editing()) return;

  const entries = await unpack(bundle);

  let complete = true;
  const fresher = (queryKey: QueryKey) => {
    const state = queryClient.getQueryState(queryKey);
    return state !== undefined && state.dataUpdatedAt > started;
  };
  const inBundle = new Map<string, Set<string>>();
  for (let next = 0; next < entries.length;) {
    // Asked again before every slice: someone may have started an edit while
    // the bundle was being worked out, or during the last breather. Then the
    // rest waits for the next round, and nothing is let go of on what is
    // only part of the bundle.
    if (editing()) return;
    const until = Date.now() + SLICE_MS;
    notifyManager.batch(() => {
      do {
        const [queryKey, data] = entries[next++]!;
        const kind = String(queryKey[0]);
        if (PER_ITEM.has(kind)) {
          if (!inBundle.has(kind)) inBundle.set(kind, new Set());
          inBundle.get(kind)!.add(String(queryKey[1]));
        }
        // Saved while the bundle was on its way: newer than what it holds.
        if (fresher(queryKey)) {
          complete = false;
          continue;
        }
        queryClient.setQueryData(queryKey, data);
      } while (next < entries.length && Date.now() < until);
    });
    if (next < entries.length) await breather();
  }
  // What the bundle no longer holds is gone, or no longer theirs to open
  // (cards made chefs-only): not kept for offline use either.
  queryClient.removeQueries({
    predicate: (query) => {
      const kind = String(query.queryKey[0]);
      if (!PER_ITEM.has(kind)) return false;
      if (inBundle.get(kind)?.has(String(query.queryKey[1]))) return false;
      return query.state.dataUpdatedAt <= started && query.getObserversCount() === 0;
    },
  });
  // Light, and changing all day, so asked for directly.
  await inTurn([
    () => load(queryClient, ['tasks', 'running'], '/running/tasks'),
    () => load(queryClient, ['handover'], '/running/note'),
  ]);
  if (complete) queryClient.setQueryData(LOADED_KEY, bundle.version);
}

/** Load the kitchen ahead now and then while someone is signed in. Mounted once, in the shell. */
export function useLoadAhead(userId: string | null | undefined): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    // A moment after start, so the screen someone opened loads first.
    const first = window.setTimeout(() => void loadAhead(queryClient, userId), 5_000);
    const timer = window.setInterval(() => void loadAhead(queryClient, userId), EVERY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [userId, queryClient]);
}
