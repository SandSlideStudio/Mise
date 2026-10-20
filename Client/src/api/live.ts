import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BASE_URL } from './client.js';

/**
 * Keeping every open screen current without anyone pressing reload.
 *
 * The server sends a short signal whenever something in the kitchen changes,
 * naming only which part moved. This refetches whatever on screen depends on
 * it, so a chef putting their name on a line shows up on the other tablets
 * within a second.
 */

type Topic = 'prep' | 'kitchen' | 'staff';

const KEYS_BY_TOPIC: Record<Topic, string[][]> = {
  prep: [['tasks'], ['services'], ['service']],
  kitchen: [['kitchen'], ['stations'], ['me']],
  staff: [['users'], ['roster'], ['me']],
};

const TOPICS = Object.keys(KEYS_BY_TOPIC) as Topic[];

/** Several ticks in quick succession become one refetch, not several. */
const SETTLE_MS = 300;

/** How long to wait before trying again after the server turned the stream away. */
const RECONNECT_MS = 5_000;

export function useLiveUpdates(enabled: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;

    const waiting = new Set<Topic>();
    let flushTimer: number | undefined;
    let reconnectTimer: number | undefined;
    let source: EventSource | null = null;
    let connectedBefore = false;
    let stopped = false;

    function flush() {
      flushTimer = undefined;
      // Refetching while a tap is on its way would show the old state for a
      // moment. Ticks still waiting are drawn over the list anyway.
      if (queryClient.isMutating() > 0) {
        flushTimer = window.setTimeout(flush, SETTLE_MS);
        return;
      }
      for (const topic of waiting) {
        for (const queryKey of KEYS_BY_TOPIC[topic]) {
          void queryClient.invalidateQueries({ queryKey });
        }
      }
      waiting.clear();
    }

    function queue(topics: Topic[]) {
      for (const topic of topics) waiting.add(topic);
      flushTimer ??= window.setTimeout(flush, SETTLE_MS);
    }

    function connect() {
      source = new EventSource(`${BASE_URL}/events`, { withCredentials: true });

      source.addEventListener('open', () => {
        // Anything could have changed while the connection was down.
        if (connectedBefore) queue(TOPICS);
        connectedBefore = true;
      });

      source.addEventListener('change', (event) => {
        try {
          const { topic } = JSON.parse((event as MessageEvent<string>).data) as { topic: Topic };
          if (topic in KEYS_BY_TOPIC) queue([topic]);
        } catch {
          // A signal we cannot read is not worth breaking the screen over.
        }
      });

      source.addEventListener('error', () => {
        // The browser retries a dropped connection by itself. It gives up for
        // good on an error answer, such as a proxy's 502 while the server
        // restarts, so that case is retried here.
        if (source?.readyState !== EventSource.CLOSED || stopped) return;
        source.close();
        reconnectTimer = window.setTimeout(connect, RECONNECT_MS);
      });
    }

    connect();

    return () => {
      stopped = true;
      source?.close();
      window.clearTimeout(flushTimer);
      window.clearTimeout(reconnectTimer);
    };
  }, [enabled, queryClient]);
}
