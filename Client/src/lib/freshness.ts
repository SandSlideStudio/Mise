import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../api/client.js';
import { VERSION } from '../version.js';
import { onReachable } from './connectivity.js';

/**
 * Noticing that Mise was updated while this screen stayed open.
 *
 * A tablet can sit on the prep list for days. After an update, the app it
 * holds is the old one: its pages ask for files the server no longer has.
 * So it asks the server which version it runs, now and then, and when that
 * differs (or a page's file turns out to be gone) it offers a reload. Nothing
 * is lost by reloading: changes not yet sent are kept on the device.
 */

let newer: string | null = null;
const listeners = new Set<() => void>();

export function markUpdated(version: string | null = null): void {
  const next = version ?? newer ?? 'new';
  if (newer === next) return;
  newer = next;
  for (const listener of listeners) listener();
}

/** The version the server runs, when it differs from this screen's; else null. */
export function useUpdatedVersion(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => newer,
  );
}

/** A page's code that couldn't be loaded: its file is gone after an update. */
export function isStaleAppError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(
    message,
  );
}

async function check(): Promise<void> {
  try {
    const { version } = await api.get<{ version: string }>('/health');
    if (version && version !== VERSION) markUpdated(version);
  } catch {
    // Not reachable: nothing to compare against, try again later.
  }
}

const EVERY_MS = 10 * 60 * 1000;

/** Keep an eye on the server's version. Mounted once, in the shell. */
export function useVersionWatch(): void {
  useEffect(() => {
    // Vite says so when a page's files can't be loaded ahead.
    const onPreloadError = (event: Event) => {
      event.preventDefault();
      markUpdated();
    };
    window.addEventListener('vite:preloadError', onPreloadError);
    const first = window.setTimeout(() => void check(), 10_000);
    const timer = window.setInterval(() => void check(), EVERY_MS);
    const offReachable = onReachable(() => void check());
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('vite:preloadError', onPreloadError);
      window.clearTimeout(first);
      window.clearInterval(timer);
      offReachable();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
