import { unpackOfflineBundle, type OfflineBundle } from '@mise/contracts';

/**
 * Works out the offline bundle away from the screen (see unpack.ts). Every
 * recipe's tree, allergens, cost and card take a while on a slow tablet, and
 * on the page's own thread that is a screen that stops answering a cook's tap.
 */
addEventListener('message', (event: MessageEvent<OfflineBundle>) => {
  try {
    postMessage({ entries: unpackOfflineBundle(event.data) });
  } catch {
    // The page works it out itself then; the reason is the same code's to give there.
    postMessage({ failed: true });
  }
});
