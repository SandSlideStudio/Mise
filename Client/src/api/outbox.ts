import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { onReachable } from '../lib/connectivity.js';
import { entriesFor, remove, subscribe, update, type OutboxEntry } from '../lib/outbox.js';
import { request, RequestFailed } from './client.js';
import { useCurrentUser } from './session.js';

/**
 * Sending the changes that waited on the device.
 *
 * Oldest first, one at a time, whenever Mise answers again: at once when a
 * request gets through, and every ten seconds while anything waits. Each
 * outcome is settled for good:
 *
 * - done: gone from the list, and the screens ask the server again;
 * - someone changed the same thing meanwhile: kept, with what is there now,
 *   until the person chooses between the two;
 * - refused for a reason asking again won't change (it was deleted, they may
 *   no longer do that): dropped, and said once on screen;
 * - no answer, or signed out: left as is, to try again later.
 */

const RETRY_MS = 10_000;

/** A refusal that came back for a change made earlier, shown once. */
export interface DroppedChange {
  entry: OutboxEntry;
  error: RequestFailed;
}

let dropped: DroppedChange[] = [];
const droppedListeners = new Set<() => void>();

function report(change: DroppedChange): void {
  dropped = [...dropped, change];
  for (const listener of droppedListeners) listener();
}

export function dismissDropped(): void {
  dropped = [];
  for (const listener of droppedListeners) listener();
}

export function useDroppedChanges(): DroppedChange[] {
  return useSyncExternalStore(
    (listener) => {
      droppedListeners.add(listener);
      return () => void droppedListeners.delete(listener);
    },
    () => dropped,
  );
}

let sending = false;
/** Asked to send while already sending: go round once more when done. */
let again = false;

/** Send what this person has waiting. Returns whether anything went through. */
export async function flush(userId: string): Promise<boolean> {
  if (sending) {
    again = true;
    return false;
  }
  sending = true;
  let sent = false;
  try {
    // A path with an unsettled conflict holds back later changes to the same thing.
    const held = new Set<string>();
    for (const entry of entriesFor(userId)) {
      if (entry.conflict) {
        held.add(entry.path);
        continue;
      }
      if (held.has(entry.path)) continue;
      try {
        await request(entry.path, {
          method: entry.method,
          body: entry.body,
          headers: {
            'x-mise-write': entry.id,
            ...(entry.base ? { 'x-mise-base': entry.base } : {}),
          },
        });
        remove(entry.id);
        sent = true;
      } catch (error) {
        if (error instanceof RequestFailed && error.code === 'changed_meanwhile') {
          const current = (error.details as { current?: unknown } | undefined)?.current ?? null;
          update(entry.id, { conflict: { current } });
          held.add(entry.path);
          continue;
        }
        if (
          error instanceof RequestFailed &&
          error.status >= 400 &&
          error.status < 500 &&
          ![401, 408, 429].includes(error.status)
        ) {
          remove(entry.id);
          report({ entry, error });
          continue;
        }
        // No answer, signed out, or "slow down": everything waits for next time.
        break;
      }
    }
  } finally {
    sending = false;
  }
  // Something changed while sending, such as a conflict settled with "keep
  // mine": send that now rather than at the next round.
  if (again) {
    again = false;
    if (await flush(userId)) sent = true;
  }
  return sent;
}

/** Keep this person's waiting changes going out. Mounted once, in the shell. */
export function useOutboxSender(): void {
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    let stopped = false;
    const run = async () => {
      if (stopped || entriesFor(userId).length === 0) return;
      if (await flush(userId)) void queryClient.invalidateQueries();
    };
    void run();
    const timer = window.setInterval(() => void run(), RETRY_MS);
    const offReachable = onReachable(() => void run());
    const offChanged = subscribe(() => {
      // A conflict settled with "keep mine": send it now.
      if (entriesFor(userId).some((entry) => !entry.conflict)) void run();
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') void run();
    };
    window.addEventListener('online', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      offReachable();
      offChanged();
      window.removeEventListener('online', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId, queryClient]);
}

/** Settle a conflict: send mine over what is there now. */
export function keepMine(entry: OutboxEntry): void {
  update(entry.id, { conflict: undefined, base: undefined });
}

/** Settle a conflict: keep what is there now, and forget mine. */
export function keepTheirs(
  entry: OutboxEntry,
  queryClient: ReturnType<typeof useQueryClient>,
): void {
  remove(entry.id);
  void queryClient.invalidateQueries();
}
