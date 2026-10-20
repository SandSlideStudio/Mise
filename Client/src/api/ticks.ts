import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PrepTask } from '@mise/contracts';
import { api, RequestFailed } from './client.js';
import { useCurrentUser } from './session.js';
import {
  claim,
  pendingFor,
  queueVersion,
  release,
  remove,
  subscribe,
  type PendingTick,
} from '../lib/retryQueue.js';

/**
 * Sending saved ticks to the server.
 *
 * A tick is sent the moment it's tapped. If that fails for any reason other
 * than the server refusing it, it stays saved and the background sender tries
 * again every few seconds, when the connection comes back, and when the screen
 * is looked at again. Only the person who tapped it ever sends it.
 */

const RETRY_INTERVAL_MS = 5_000;

/**
 * The server said no for a reason that won't change by asking again: the line
 * is gone, or this person isn't allowed. A lost connection, a server error, an
 * expired sign-in (401), a timeout (408) or "slow down" (429) all mean try later.
 */
export function isRefusal(error: unknown): boolean {
  return (
    error instanceof RequestFailed &&
    error.status >= 400 &&
    error.status < 500 &&
    ![401, 408, 429].includes(error.status)
  );
}

// --- refusals, shown once so nobody walks away from a job they think is marked

const refusalListeners = new Set<() => void>();
let lastRefusal: RequestFailed | null = null;

function reportRefusal(error: unknown): void {
  lastRefusal = error instanceof RequestFailed ? error : null;
  for (const listener of refusalListeners) listener();
}

export function dismissRefusal(): void {
  lastRefusal = null;
  for (const listener of refusalListeners) listener();
}

export function useLastRefusal(): RequestFailed | null {
  return useSyncExternalStore(
    (listener) => {
      refusalListeners.add(listener);
      return () => refusalListeners.delete(listener);
    },
    () => lastRefusal,
    () => null,
  );
}

// --- sending ------------------------------------------------------------

/** Ticks on the same line go out one at a time, oldest first. */
const chains = new Map<string, Promise<unknown>>();

/**
 * Send one saved tick. Resolves with the updated line, or null when a newer
 * tick on the same line replaced this one before its turn came.
 */
export function sendTick(entry: PendingTick): Promise<PrepTask | null> {
  const previous = chains.get(entry.taskId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const stillQueued = pendingFor(entry.userId).some((other) => other.id === entry.id);
      if (!stillQueued || !claim(entry.id)) return null;
      try {
        const task = await api.patch<PrepTask>(`/tasks/${entry.taskId}`, entry.patch);
        remove(entry.id);
        return task;
      } catch (error) {
        if (isRefusal(error)) {
          remove(entry.id);
          reportRefusal(error);
        }
        throw error;
      } finally {
        release(entry.id);
      }
    });
  chains.set(entry.taskId, next);
  void next
    .finally(() => {
      if (chains.get(entry.taskId) === next) chains.delete(entry.taskId);
    })
    .catch(() => undefined);
  return next;
}

/** Try to send everything this person has waiting. Stops at the first connection failure. */
export async function sendPending(
  userId: string,
  onSent: (entry: PendingTick) => void = () => undefined,
): Promise<void> {
  for (const entry of pendingFor(userId)) {
    try {
      await sendTick(entry);
      onSent(entry);
    } catch (error) {
      if (!isRefusal(error)) return;
      onSent(entry);
    }
  }
}

/** Keeps sending the signed-in person's saved ticks, on every screen. */
export function useTickSender(): void {
  const queryClient = useQueryClient();
  const userId = useCurrentUser().data?.id;

  useEffect(() => {
    if (!userId) return;
    let running = false;

    async function drain() {
      if (running || pendingFor(userId).length === 0) return;
      running = true;
      try {
        await sendPending(userId!, (entry) => {
          void queryClient.invalidateQueries({ queryKey: ['tasks', entry.listKey] });
        });
      } finally {
        running = false;
      }
    }

    void drain();
    const timer = window.setInterval(() => void drain(), RETRY_INTERVAL_MS);
    const onWake = () => void drain();
    window.addEventListener('online', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [queryClient, userId]);
}

// --- what the screen shows ------------------------------------------------

/** How many of the signed-in person's ticks haven't reached the server. */
export function usePendingTickCount(): number {
  const userId = useCurrentUser().data?.id;
  useSyncExternalStore(subscribe, queueVersion, queueVersion);
  return pendingFor(userId).length;
}

/**
 * Draws waiting ticks over a list from the server, so a refresh never shows a
 * line the cook has ticked as not done.
 */
export function usePendingOverlay(): (tasks: PrepTask[]) => PrepTask[] {
  const version = useSyncExternalStore(subscribe, queueVersion, queueVersion);
  const user = useCurrentUser().data;

  return useCallback(
    (tasks: PrepTask[]) => {
      const mine = pendingFor(user?.id);
      if (mine.length === 0) return tasks;
      // Oldest first, so the newest tick on a line wins.
      const latest = new Map(mine.map((entry) => [entry.taskId, entry.patch]));
      return tasks.map((task) => {
        const patch = latest.get(task.id);
        if (!patch) return task;
        const mineNow = patch.assignedUserId != null && patch.assignedUserId === user?.id;
        return {
          ...task,
          ...patch,
          assignedUserName: mineNow ? (user?.displayName ?? null) : task.assignedUserName,
        };
      });
    },
    // The queue lives outside React; its version says when to redraw.
    [version, user],
  );
}
