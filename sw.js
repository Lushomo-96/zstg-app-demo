/**
 * ZSTG — Service Worker
 * Offline-first caching for the Zambia Standard Treatment Guidelines app.
 * Precaches the app shell and content on install, serves cache-first
 * afterwards, and falls back to the cached shell instead of a browser error
 * page on any navigation while offline.
 */

const CACHE_PREFIX = 'zstg-cache-';
const CACHE_NAME = `${CACHE_PREFIX}v25-formulary-audit`;

// Every asset the app actually requests over the network, so a first-time
// install finishes 100% offline-ready — not just whatever happens to get
// requested (and reactively cached) during that first session.
//
// Note: assets/data.json is intentionally NOT listed here. The app loads its
// STG and formulary content from embedded plain-script bundles, which work
// reliably in every install context including file:// and TWA wrappers.
// data.json is the build pipeline's canonical output (import-audited-source.js
// writes it, data-embed.js just wraps the same content for runtime use) and will start
// being fetched here once the Phase 2 remote-update pipeline lands — until
// then, precaching it would duplicate the embedded audited dataset.
const PRECACHE_URLS = [
  './',
  'index.html',
  'manifest.json',
  'assets/data-embed.js',
  'assets/formulary-embed.js',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-512-maskable.png',
  'assets/coat-of-arms-zambia.png',
  'assets/moh-emblem.png'
];

// Install atomically. If any critical file is unavailable, installation fails
// and the last complete worker/cache remains active for reliable offline use.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch: network-first for data.json (keeps it fresh), cache-first for everything else
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;
  
  // Full-page navigations (opening the installed app, a deep link, a reload)
  // get their own path: try the network, but on any failure — no signal at
  // all, not just a 404 — serve the cached shell instead of letting the
  // browser paint its own "no internet" error page. This is what makes a
  // freshly-installed, fully offline launch look like a native app rather
  // than a broken web page.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match('index.html').then(cached => cached || caches.match('./'))
      )
    );
    return;
  }
  
  // (A network-first branch for assets/data.json lived here before — removed
  // because nothing in the app actually requests that URL today; see the
  // PRECACHE_URLS comment above. It'll come back once Phase 2's update
  // pipeline has the app fetch data.json directly instead of using the
  // embedded script.)
  
  // For everything else, use cache-first. Do not substitute index.html for a
  // failed script/image request: returning HTML for those assets hides the
  // real failure and can make the app fail with misleading syntax/MIME errors.
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      return cachedResponse || fetch(event.request).then(networkResponse => {
        if (event.request.method === 'GET' && networkResponse.ok) {
          const responseClone = networkResponse.clone();
          event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone)));
        }
        return networkResponse;
      });
    })
  );
});
