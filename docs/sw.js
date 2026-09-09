self.addEventListener('push', (event) => {
  let data = { title: 'TalkMe', body: 'Tienes un mensaje nuevo' };
  try {
    if (event.data) data = event.data.json();
  } catch (err) {
    // deja el valor por defecto
  }

  event.waitUntil(
    self.registration.showNotification(data.title, { body: data.body })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
