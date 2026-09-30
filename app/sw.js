// King Pad service worker: opens the app with no internet and plays the saved stems from the device.
const SHELL = 'kingpad-shell-v1';
const STEMS = 'pads-stems-v1';   // filled by the page (index.html, cacheStems)
const SUPA_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
const ASSETS = ['./', 'manifest.json', 'favicon.png', 'apple-touch-icon.png', 'icon-512.png', 'mark.png', SUPA_JS];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('kingpad-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

const TYPES = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg' };

// Stems are stored under a permanent id; audio elements ask for ranges, so answer 206 like a real server.
async function serveStem(req, id) {
  const res = await (await caches.open(STEMS)).match(id);
  if (!res) return new Response('', { status: 404 });
  const blob = await res.blob();
  const ext = decodeURIComponent(id.split('?')[0]).split('.').pop().toLowerCase();
  const type = TYPES[ext] || res.headers.get('content-type') || 'audio/mpeg';
  const size = blob.size;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  if (!m) return new Response(blob, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } });
  let start, end;
  if (m[1] === '') { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start >= size || start > end) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(blob.slice(start, end + 1, type), {
    status: 206,
    headers: { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' },
  });
}

async function networkFirst(req, key) {
  const cache = await caches.open(SHELL);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);   // stage Wi-Fi that connects but never answers
    const res = await fetch(req, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) await cache.put(key, res.clone());
    return res;
  } catch {
    return (await cache.match(key)) || Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.endsWith('/stem/')) {
    e.respondWith(serveStem(req, url.searchParams.get('id') || ''));
    return;
  }
  if (req.mode === 'navigate' && url.origin === location.origin) {
    e.respondWith(networkFirst(req, new URL('./', location.href).href));
    return;
  }
  if (req.url === SUPA_JS) {
    e.respondWith(caches.match(SUPA_JS).then((hit) => hit || fetch(req)));
    return;
  }
  const scope = new URL('./', location.href).href;
  if (url.origin === location.origin && req.url.startsWith(scope) && !url.pathname.endsWith('version.txt')) {
    e.respondWith(networkFirst(req, url.origin + url.pathname));
  }
});
