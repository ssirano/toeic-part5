// 오프라인 지원: 항상 네트워크 우선(업데이트 즉시 반영, JS 파일 버전이 섞이지 않게), 오프라인일 때만 캐시 사용.
const CACHE = "part5-trainer-v2";
const SHELL = ["./", "index.html", "style.css", "js/app.js", "js/engine.js", "js/storage.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "questions.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
