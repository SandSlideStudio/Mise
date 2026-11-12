/* global self, caches, fetch, URL, Response, setTimeout, clearTimeout */
/**
 * Mise opens without a server.
 *
 * Over HTTPS, the browser keeps this worker, and with it every file of the
 * app, so a tablet can open Mise with the server off or the wifi gone. The
 * data itself is the app's business (saved on the device, and changes sent
 * later); this worker only makes sure there is an app to show it in.
 *
 * Each build lists its own files below and gets its own cache, so an update
 * replaces the old app whole and never mixes two versions.
 */

const VERSION = '__VERSION__';
const APP = `mise-app-${VERSION}`;
const PHOTOS = 'mise-photos';
/**
 * Photos kept on the device at most. Every recipe's photos fit for most
 * kitchens; past this, the ones fetched longest ago go first, so a tablet
 * never fills up with photos of dishes long gone.
 */
const MAX_PHOTOS = 300;
const FILES = JSON.parse('__FILES__');
/** How long to wait for the server before opening the app from the cache. */
const PATIENCE_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP)
      .then((cache) => cache.addAll(['/', ...FILES.map((file) => `/${file}`)]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('mise-app-') && name !== APP)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** The server if it answers soon, otherwise what was kept. */
function serverFirst(request, fallback) {
  return new Promise((resolve) => {
    let settled = false;
    const useKept = () =>
      caches.match(fallback).then((kept) => {
        if (!settled) {
          settled = true;
          resolve(kept || Response.error());
        }
      });
    const timer = setTimeout(useKept, PATIENCE_MS);
    fetch(request)
      .then((response) => {
        clearTimeout(timer);
        if (settled) return;
        // A web server in front answering for a Mise that is down (502, 503,
        // 504) is no answer from Mise: open the kept app instead of its error.
        if (response.status >= 500) {
          void caches.match(fallback).then((kept) => {
            if (settled) return;
            settled = true;
            resolve(kept || response);
          });
          return;
        }
        settled = true;
        resolve(response);
      })
      .catch(() => {
        clearTimeout(timer);
        void useKept();
      });
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Photos: shown from the device once seen. A new photo gets a new name.
  if (url.pathname.startsWith('/api/uploads/')) {
    event.respondWith(
      caches.open(PHOTOS).then((cache) =>
        cache.match(request).then(
          (kept) =>
            kept ||
            fetch(request).then((response) => {
              if (response.ok) {
                void cache.put(request, response.clone()).then(() => trimPhotos(cache));
              }
              return response;
            }),
        ),
      ),
    );
    return;
  }

  // The data and Let's Encrypt's check are never answered from here.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.well-known/')) return;

  // Opening a page: the app as the server has it now, or as kept.
  if (request.mode === 'navigate') {
    event.respondWith(serverFirst(request, '/'));
    return;
  }

  // The app's own files never change under one name: kept first.
  event.respondWith(caches.match(request).then((kept) => kept || fetch(request)));
});

/** Keep the photo cache to MAX_PHOTOS, dropping the ones stored first. */
function trimPhotos(cache) {
  return cache
    .keys()
    .then((kept) =>
      Promise.all(
        kept.slice(0, Math.max(0, kept.length - MAX_PHOTOS)).map((old) => cache.delete(old)),
      ),
    );
}
