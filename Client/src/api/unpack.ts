import { unpackOfflineBundle, type OfflineBundle, type UnpackedEntry } from '@mise/contracts';

/**
 * Unpacking the offline bundle, off the page's thread where the browser can.
 *
 * Working out every recipe's tree, allergens, cost and dish card is the same
 * kitchen maths the server does, and for a whole kitchen it takes a while: a
 * tenth of a second on a fast computer, a second or more on a cheap kitchen
 * tablet. Done on the page's thread, the screen a cook is using stops
 * answering for that long, every time the kitchen's data changes. In a
 * worker it runs beside the page, and only the answers come back.
 *
 * Where there is no worker (an old browser, the tests) or it doesn't answer,
 * the page works it out itself, as before: slower to touch, but never left
 * without the kitchen for offline use.
 */

/** Long past what even a slow tablet needs; a worker this late is stuck. */
const PATIENCE_MS = 30_000;

type Answer = { entries: UnpackedEntry[] } | { failed: true };

function inWorker(bundle: OfflineBundle, patienceMs: number): Promise<UnpackedEntry[] | null> {
  if (typeof Worker === 'undefined') return Promise.resolve(null);
  let worker: Worker;
  try {
    worker = new Worker(new URL('./unpack.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const done = (entries: UnpackedEntry[] | null) => {
      clearTimeout(timer);
      // One bundle per worker: it holds the whole kitchen while it lives.
      worker.terminate();
      resolve(entries);
    };
    const timer = setTimeout(() => done(null), patienceMs);
    worker.addEventListener('message', (event: MessageEvent<Answer>) =>
      done('entries' in event.data ? event.data.entries : null),
    );
    // A file that didn't load (a server or cache from another build), or an
    // answer that couldn't be read back.
    worker.addEventListener('error', () => done(null));
    worker.addEventListener('messageerror', () => done(null));
    try {
      worker.postMessage(bundle);
    } catch {
      done(null);
    }
  });
}

/** The bundle as the query cache keys the screens read; see unpackOfflineBundle. */
export async function unpack(
  bundle: OfflineBundle,
  patienceMs = PATIENCE_MS,
): Promise<UnpackedEntry[]> {
  return (await inWorker(bundle, patienceMs)) ?? unpackOfflineBundle(bundle);
}

/** Time given to the page between slices of work, so taps and drawing come first. */
export function breather(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      // Idle time where the browser has it, but never waiting long for it on a busy screen.
      requestIdleCallback(() => resolve(), { timeout: 100 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}
