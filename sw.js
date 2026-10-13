// Service worker: gör att appen fungerar utan internet.
// Höj VERSION när du laddar upp nya filer, så hämtar telefonen den nya versionen.
const VERSION = 'budget-v1.4.0';
const FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './fonts/Geist-Variable.woff2',
  './fonts/GeistMono-Variable.woff2',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  // cache: 'reload' = hämta alltid färska filer från servern, aldrig webbläsarens gamla kopior
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // Kalenderfiler hämtas alltid direkt från nätet
  if (url.pathname.endsWith('.ics')) return;
  // Sidan: nätet först (så uppdateringar syns), sparad kopia om du är offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
        .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put('./index.html', copy)); } return res; })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }
  // Allt annat: sparad kopia först
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
