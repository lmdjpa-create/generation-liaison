self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() || '' };
  }
  event.waitUntil(self.registration.showNotification(payload.title || 'Génération Liaison', {
    body: payload.body || 'Vous avez une nouvelle notification.',
    data: payload.data || { url: '/app-mobile.html' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL('/app-mobile.html', self.location.origin);
  const notificationId = event.notification.data?.notificationId;
  if (notificationId) target.searchParams.set('notification', notificationId);
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => {
      const url = new URL(client.url);
      return url.origin === target.origin && url.pathname === target.pathname;
    });
    if (existing) {
      existing.postMessage({ type: 'notification-opened', notificationId });
      return existing.focus();
    }
    return self.clients.openWindow(target.href);
  }));
});
