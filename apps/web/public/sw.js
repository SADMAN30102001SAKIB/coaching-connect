self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(
          '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>You are offline</title><body style="font:18px system-ui;padding:32px;max-width:480px;margin:auto"><h1>You are offline</h1><p>Reconnect to view records or save changes. No SMS will be sent from this device while offline.</p><button onclick="location.reload()">Try again</button></body></html>',
          { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' } },
        ),
    ),
  );
});
