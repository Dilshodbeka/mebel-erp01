// Service Worker для Mebel Aliya ERP
// Нужен для двух вещей: показ уведомлений в фоне и установка приложения на телефон.

const SW_VERSION = 'v1';

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Passthrough — обязателен, чтобы приложение можно было установить как PWA
self.addEventListener('fetch', e => {});

// Показ уведомления по команде со страницы
self.addEventListener('message', event => {
    const data = event.data || {};
    if (data.type !== 'SHOW_NOTIFICATION') return;

    self.registration.showNotification(data.title || 'Новая задача', {
        body: data.body || '',
        icon: data.icon || '/icon-192.png',
        badge: data.badge || '/icon-192.png',
        tag: data.tag || 'erp-task',
        renotify: true,
        vibrate: [200, 100, 200],
        requireInteraction: false,
        data: { url: data.url || '/' }
    });
});

// Полноценный Web Push — работает, когда приложение полностью закрыто.
// Требует серверной отправки (см. инструкцию в проекте).
self.addEventListener('push', event => {
    let payload = { title: 'Новая задача', body: '' };
    try {
        if (event.data) payload = event.data.json();
    } catch (e) {
        if (event.data) payload.body = event.data.text();
    }

    event.waitUntil(
        self.registration.showNotification(payload.title || 'Новая задача', {
            body: payload.body || '',
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: payload.tag || 'erp-task',
            renotify: true,
            vibrate: [200, 100, 200],
            data: { url: payload.url || '/' }
        })
    );
});

// Клик по уведомлению — открываем приложение или переключаемся на открытую вкладку
self.addEventListener('notificationclick', event => {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
            for (const client of list) {
                if ('focus' in client) return client.focus();
            }
            if (clients.openWindow) return clients.openWindow(targetUrl);
        })
    );
});
