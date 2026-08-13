self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Mova', body: event.data?.text() || 'Новое событие' };
  }
  if (payload.closeTag) {
    event.waitUntil(self.registration.getNotifications({ tag: payload.closeTag }).then((notifications) => notifications.forEach((notification) => notification.close())));
    return;
  }
  const title = payload.title || 'Mova';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: payload.icon || '/icon-192.png',
      badge: payload.badge || '/icon-192.png',
      tag: payload.tag,
      renotify: payload.kind === 'call',
      requireInteraction: Boolean(payload.requireInteraction),
      data: {
        kind: payload.kind || 'message',
        conversationId: payload.conversationId || '',
        url: payload.url || '/app',
      },
      actions: [{ action: 'open', title: 'Открыть' }],
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = new URL(data.url || '/app', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      const client = windows.find((candidate) => candidate.url.startsWith(self.location.origin));
      if (client) {
        client.postMessage({ type: 'mova:notification-click', kind: data.kind, conversationId: data.conversationId });
        await client.focus();
        return;
      }
      await self.clients.openWindow(url);
    }),
  );
});
