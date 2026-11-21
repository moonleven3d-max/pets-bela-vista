// Pets Bela Vista — service worker
// Estratégia "rede primeiro": sempre busca a versão mais nova do site e usa o cache só quando estiver offline.
// (A versão anterior usava "cache primeiro", o que fazia o celular continuar mostrando arquivos antigos após cada atualização.)
const CACHE = 'pets-bela-vista-v4';
const ASSETS = ['/', '/index.html', '/admin.html', '/styles.css', '/app.js', '/admin.js', '/firebase-config.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/hero-pets.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
});
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Firebase, fontes etc. passam direto pela rede
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('/index.html') : Response.error())))
  );
});
