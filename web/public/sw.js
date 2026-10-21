// Service worker mínimo: existe só para permitir instalar o PWA.
// Rede primeiro, sem cache; não intercepta /api nem /ws.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) return;
  e.respondWith(fetch(e.request));
});
