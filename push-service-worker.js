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
  const targetUrl = new URL(event.notification.data?.url || '/app-mobile.html', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => client.url === targetUrl);
    return existing ? existing.focus() : self.clients.openWindow(targetUrl);
  }));
});
