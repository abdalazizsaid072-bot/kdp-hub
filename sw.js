// KDP Hub Service Worker — تشغيل بدون نت + إشعارات في الخلفية
const CACHE = 'kdphub-v2';
const SHELL = ['./', 'index.html', 'styles.css', 'js/app.js', 'js/data.js', 'js/insights.js', 'js/templates.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/badge-96.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // بيانات الشيت دايماً من النت (الأبلكيشن نفسه بيحتفظ بآخر نسخة)
  if (/script\.google(usercontent)?\.com$/.test(url.hostname)) return;

  // ملفات الأبلكيشن: من النت الأول عشان التحديثات توصل، ولو مفيش نت من الكاش
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
    return;
  }

  // مكتبات وخطوط من CDN: من الكاش الأول
  if (/cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    })));
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const href = e.notification.data?.href || '#/home';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const client = list.find(c => new URL(c.url).origin === self.location.origin);
    if (client) { client.postMessage({ href }); return client.focus(); }
    return self.clients.openWindow('./' + href);
  }));
});

/* ─── فحص دوري في الخلفية (Chrome/Edge بعد التثبيت) ─── */
self.addEventListener('periodicsync', e => {
  if (e.tag === 'kdphub-check') e.waitUntil(backgroundCheck());
});

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('kdphub', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function get(db, k) { return new Promise(r => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => r(q.result); q.onerror = () => r(null); }); }
async function put(db, k, v) { return new Promise(r => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = r; t.onerror = r; }); }

async function backgroundCheck() {
  const db = await idb();
  const list = (await get(db, 'reminders')) || [];
  const notified = (await get(db, 'notified')) || {};
  const d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const due = list.filter(r => r.fireOn <= today && !notified[r.id] && (r.kind !== 'idea' || d.getHours() >= 9));
  // التذكيرات المتأخرة القديمة بتتحسب تاني لما الأبلكيشن يتفتح؛ هنا بنبعت اللي ميعاده جه بس
  for (const r of due.filter(r => r.kind !== 'idea').slice(0, 4).concat(due.filter(r => r.kind === 'idea').slice(0, 1))) {
    await self.registration.showNotification(r.title, { body: r.body, tag: r.id, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', lang: 'ar', dir: 'rtl', data: { href: r.href } });
    notified[r.id] = Date.now();
  }
  await put(db, 'notified', notified);
}
