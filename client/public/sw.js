const CACHE_NAME = 'guichet-__BUILD_HASH__';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
];

// Install: cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for static
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip Socket.io and WebSocket requests
  if (url.pathname.startsWith('/socket.io')) return;

  // Skip browser extensions
  if (url.protocol === 'chrome-extension:') return;

  // API calls: never cache authenticated endpoints
  if (url.pathname.startsWith('/api/')) {
    // Only cache explicitly public, non-authenticated endpoints
    const PUBLIC_API_PATHS = ['/api/v1/health'];
    const isPublic = PUBLIC_API_PATHS.some((p) => url.pathname === p);

    if (!isPublic) {
      return; // Let the browser handle normally — no SW caching for authenticated APIs
    }

    // Cache public endpoints with network-first
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then((r) => r || new Response(
          JSON.stringify({ error: 'offline' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )))
    );
    return;
  }

  // Static assets: stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});

// ─── Push Notifications ─────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;

  const payload = event.data.json();

  const promiseChain = self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((clients) => {
      const focused = clients.some((client) => client.focused);
      if (focused) return;

      return self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        tag: payload.tag || 'guichet',
        data: {
          ticketId: payload.ticketId,
          type: payload.type,
        },
        renotify: true,
      });
    });

  event.waitUntil(promiseChain);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const { ticketId } = event.notification.data || {};
  const targetUrl = ticketId ? `/?ticket=${ticketId}` : '/';

  const promiseChain = self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.postMessage({ type: 'NAVIGATE_TICKET', ticketId });
          return;
        }
      }
      return self.clients.openWindow(targetUrl);
    });

  event.waitUntil(promiseChain);
});
