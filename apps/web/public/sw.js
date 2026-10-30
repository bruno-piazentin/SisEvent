/* Service worker do SisEvent
 * - guarda as páginas e arquivos estáticos já visitados (abre sem sinal)
 * - chamadas à API nunca vêm do cache: a fila offline do check-in é feita no app (lib/fila-offline.ts)
 */
const CACHE = 'sisevent-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/manifest.webmanifest', '/icone.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api') || url.origin !== self.location.origin) return;

  // navegação: rede primeiro, cache como reserva
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); return res; })
        .catch(() => caches.match(req).then((r) => r || caches.match('/'))),
    );
    return;
  }
  // estáticos do Next (_next/static) são imutáveis: cache primeiro
  if (url.pathname.startsWith('/_next/static') || url.pathname.endsWith('.svg')) {
    e.respondWith(
      caches.match(req).then((r) => r || fetch(req).then((res) => {
        const copia = res.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); return res;
      })),
    );
  }
});
