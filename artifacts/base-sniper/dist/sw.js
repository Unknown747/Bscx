/**
 * Base Sniper — Service Worker
 * - Web Push Notifications
 * - PWA app-shell caching untuk offline support
 */

const CACHE_NAME  = 'base-sniper-v2';
const SHELL_PATHS = ['/', '/index.html'];

// ── Install: pre-cache app shell ─────────────────────────────────────────────
self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(SHELL_PATHS))
            .catch(() => {})
    );
});

// ── Activate: clean old caches ───────────────────────────────────────────────
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            ))
            .then(() => clients.claim())
    );
});

// ── Fetch: stale-while-revalidate for assets, network-only for /api ──────────
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip non-GET and API requests — always go to network
    if (event.request.method !== 'GET') return;
    if (url.pathname.startsWith('/api/')) return;

    // Navigation: network first, cache fallback
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then((res) => {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
                    return res;
                })
                .catch(() => caches.match('/index.html'))
        );
        return;
    }

    // Static assets (/assets/): cache-first with network update
    if (url.pathname.startsWith('/assets/') || url.pathname.endsWith('.svg') || url.pathname.endsWith('.png')) {
        event.respondWith(
            caches.match(event.request).then(cached => {
                const fetchPromise = fetch(event.request).then(res => {
                    caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone()));
                    return res;
                });
                return cached || fetchPromise;
            })
        );
    }
});

// ── Push Notifications ───────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
    if (!event.data) return;

    let payload;
    try {
        payload = event.data.json();
    } catch {
        payload = { title: 'Base Sniper', body: event.data.text() };
    }

    const title   = payload.title || 'Base Sniper';
    const options = {
        body:               payload.body  || '',
        icon:               '/icon-192.png',
        badge:              '/icon-192.png',
        tag:                payload.tag   || 'base-sniper',
        renotify:           true,
        requireInteraction: false,
        vibrate:            [200, 100, 200],
        data:               payload.data  || {},
        silent:             false,
        actions: payload.data?.txHash ? [
            { action: 'view-tx', title: '🔗 Lihat TX' }
        ] : [],
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click ───────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const data   = event.notification.data || {};
    const txHash = data.txHash;

    let url = '/';
    if (event.action === 'view-tx' && txHash) {
        url = `https://basescan.org/tx/${txHash}`;
    }

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.includes(self.registration.scope) && 'focus' in client) {
                    client.focus();
                    if (url !== '/') client.navigate(url);
                    return;
                }
            }
            if (clients.openWindow) return clients.openWindow(url);
        })
    );
});
