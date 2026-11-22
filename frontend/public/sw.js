// Life Is's reminders in this browser. It only shows what Life Is sent (locked so only this browser could read
// it) and opens Life Is when tapped. It keeps nothing and fetches nothing.
self.addEventListener('push', (event) => {
  let message = { title: 'Life Is', body: '', url: '/' };
  try { message = { ...message, ...event.data.json() }; } catch { /* a message that can't be read still says Life Is */ }
  event.waitUntil(self.registration.showNotification(message.title, {
    body: message.body, icon: '/icon-192.png', badge: '/icon-192.png', tag: 'lifeis-morning', data: { url: message.url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
      if (client.url.startsWith(self.location.origin)) { await client.focus(); return client.navigate(url); }
    }
    return self.clients.openWindow(url);
  })());
});
