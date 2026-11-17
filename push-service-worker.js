self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = payload.title === 'Alerte d’urgence' ||
      /^Alerte d’urgence : appel au (15|18|112) demandé$/.test(payload.title || '')
    ? 'Alerte d’urgence'
    : payload.title === 'Vérification de sécurité sans réponse'
      ? 'Vérification de sécurité sans réponse' : 'Génération Liaison';
  event.waitUntil(self.registration.showNotification(title, {
    body: 'Connectez-vous à l’application pour consulter cette notification.',
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
