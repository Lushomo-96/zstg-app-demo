/**
 * ZSTG — Service Worker
 * Offline-first caching for the Zambia Standard Treatment Guidelines app.
 * Precaches the app shell and content on install, serves cache-first
 * afterwards, and falls back to the cached shell instead of a browser error
 * page on any navigation while offline.
 */

const CACHE_NAME = 'zstg-cache-v18-demo-disclaimer';

// Every asset the app actually requests over the network, so a first-time
// install finishes 100% offline-ready — not just whatever happens to get
// requested (and reactively cached) during that first session.
//
// Note: assets/data.json is intentionally NOT listed here. The app loads its
// content from assets/data-embed.js (a plain <script> include, which works
// reliably in every install context including file:// and TWA wrappers).
// data.json is the build pipeline's canonical output (seed.js writes it,
// data-embed.js just wraps the same content for runtime use) and will start
// being fetched here once the Phase 2 remote-update pipeline lands — until
// then, precaching it would duplicate the embedded audited dataset.
const PRECACHE_URLS = [
  './',
  'index.html',
  'manifest.json',
  'assets/data-embed.js',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-512-maskable.png',
  'assets/coat-of-arms-zambia.png',
  'assets/moh-emblem.png'
];

// Install: cache all critical assets. addAll() fails atomically if any single
// URL 404s, which would silently leave the whole precache empty — so cache
// each file individually and warn (not fail) on a miss instead.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.all(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(err => console.warn('[SW] precache miss:', url, err))
        )
      );
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
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
  
  // For everything else, use cache-first strategy — and never let a failed
  // network fetch reject uncaught; fall back to whatever's cached (or a
  // clean failure the app's own JS can handle) instead of a browser error.
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      return cachedResponse || fetch(event.request).then(networkResponse => {
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        return networkResponse;
      }).catch(() => caches.match('index.html'));
    })
  );
});
