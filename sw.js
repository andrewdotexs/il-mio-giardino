// ══════════════════════════════════════════════════════════════════════
// Il Mio Giardino — Service Worker (PWA)
// ══════════════════════════════════════════════════════════════════════
const CACHE_NAME = 'giardino-v1';

// File da precaricare nella cache
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

// ── Install: precache risorse essenziali ─────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: pulisci vecchie cache ──────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: Network-first per API, Cache-first per risorse statiche ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API: sempre network, non cachare
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({error: 'Offline — server non raggiungibile'}), {
          headers: {'Content-Type': 'application/json'}
        })
      )
    );
    return;
  }

  // Font Google: cache-first (raramente cambiano)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Tutto il resto: network-first con fallback cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Aggiorna la cache con la versione nuova
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
