// GoPMaS POS — service worker: cache app shell ให้เปิดได้แม้ไม่มีสัญญาณ
const CACHE = 'gopmas-pos-v8'; // ⚠ เปลี่ยนเลขเวอร์ชันทุกครั้งที่แก้ index.html/app.js
const SHELL = ['./', './index.html', './app.js', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return; // POST ไป Apps Script ปล่อยผ่าน
  if (new URL(e.request.url).origin !== location.origin) return; // API call ปล่อยผ่าน
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
