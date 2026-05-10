/**
 * Base Sniper — Service Worker
 * Menangani Web Push Notification dari server.
 * File ini harus berada di root domain (/sw.js) agar bisa mengontrol semua halaman.
 */

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

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
        body:              payload.body  || '',
        icon:              '/favicon.ico',
        badge:             '/favicon.ico',
        tag:               payload.tag   || 'base-sniper',
        renotify:          true,
        requireInteraction: false,
        vibrate:           [200, 100, 200],
        data:              payload.data  || {},
        silent:            false,
        actions: payload.data?.txHash ? [
            { action: 'view-tx', title: '🔗 Lihat TX' }
        ] : [],
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

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
            // Coba fokus tab yang sudah terbuka
            for (const client of clientList) {
                if (client.url.includes(self.registration.scope) && 'focus' in client) {
                    client.focus();
                    if (url !== '/') client.navigate(url);
                    return;
                }
            }
            // Buka tab baru jika tidak ada yang terbuka
            if (clients.openWindow) {
                return clients.openWindow(url);
            }
        })
    );
});
