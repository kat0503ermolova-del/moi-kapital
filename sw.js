// App-shell cache: the interface opens offline; data requests always go to the network.
const CACHE = 'kapital-v11';
const SHELL = ['./', 'index.html', 'styles.css', 'js/app.js', 'js/core.js', 'js/invest.js', 'js/quick.js', 'js/watch.js', 'js/connect.js', 'js/glossary.js', 'js/plan.js', 'js/chart.js', 'js/incomeplan.js', 'js/strategy.js', 'js/review.js', 'js/util.js', 'js/calcs.js', 'js/config.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // network first, so updates arrive immediately; cache as the offline fallback
  e.respondWith(
    fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
