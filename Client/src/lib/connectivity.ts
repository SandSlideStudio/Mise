import { useSyncExternalStore } from 'react';

/**
 * Whether Mise itself can be reached, as last seen by an actual request.
 *
 * Not navigator.onLine: a tablet on the kitchen wifi is "online" while the
 * server in the back office is switched off, and a tablet on a network with
 * no internet still reaches a server on that network. Any answer from Mise
 * means reachable; a request that got no answer at all means not.
 */

let reachable = true;
let since = Date.now();
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (next === reachable) return;
  reachable = next;
  since = Date.now();
  for (const listener of listeners) listener();
}

export const markReachable = () => set(true);
export const markUnreachable = () => set(false);
export const isReachable = () => reachable;

export function onReachable(listener: () => void): () => void {
  const wrapped = () => {
    if (reachable) listener();
  };
  listeners.add(wrapped);
  return () => void listeners.delete(wrapped);
}

/** Whether Mise answers, and since when that has been so. */
export function useConnectivity(): { reachable: boolean; since: number } {
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => (reachable ? 1 : -1) * since,
  );
  return { reachable: value > 0, since: Math.abs(value) };
}
