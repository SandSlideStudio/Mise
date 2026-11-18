import { useEffect } from 'react';
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { unpackOfflineBundle, type OfflineBundle } from '@mise/contracts';
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
  rememberVersion(null);
  // The photos the service worker keeps (sw/service-worker.js).
  if (typeof caches !== 'undefined') await caches.delete('mise-photos').catch(() => false);
}

// --- loading ahead -------------------------------------------------------------

const EVERY_MS = 30 * 60 * 1000;
/** How long the prep list and the handover note stay fresh before they are asked for again. */
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

/**
 * The data version the last complete load saw. A plain string on the device,
 * forgotten with everything else on signing out.
 */
const LOADED_KEY = 'mise.loaded-version';

function loadedVersion(): string | null {
  try {
    return localStorage.getItem(LOADED_KEY);
  } catch {
    return null;
  }
}

function rememberVersion(version: string | null): void {
  try {
    if (version) localStorage.setItem(LOADED_KEY, version);
    else localStorage.removeItem(LOADED_KEY);
  } catch {
    // Not remembered: the next load simply goes ahead.
  }
}

/**
 * Loads what may be needed offline, but only if the kitchen's data changed
 * since the last complete load, and then in one request: the server reads its
 * recipe book once for all of it, not once for every recipe and screen.
 */
export async function loadAhead(queryClient: QueryClient): Promise<void> {
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
  if (current === loadedVersion() && haveAnswers) return;

  let bundle: OfflineBundle;
  try {
    bundle = await api.get<OfflineBundle>('/offline/bundle');
  } catch {
    return;
  }
  // A change being sent right now is shown as made; answers read before it
  // must not paint over it. The next round loads them.
  if (queryClient.isMutating() > 0) return;

  for (const [queryKey, data] of unpackOfflineBundle(bundle)) {
    queryClient.setQueryData(queryKey, data);
  }
  // Light, and changing all day, so asked for directly.
  await inTurn([
    () => load(queryClient, ['tasks', 'running'], '/running/tasks'),
    () => load(queryClient, ['handover'], '/running/note'),
  ]);
  rememberVersion(bundle.version);
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
