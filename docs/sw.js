// 오프라인 지원: 항상 네트워크 우선(업데이트 즉시 반영, JS 파일 버전이 섞이지 않게), 오프라인일 때만 캐시 사용.
const CACHE = "part5-trainer-v3";
const NETWORK_TIMEOUT_MS = 3000; // 신호가 약할 때 오래 기다리지 않고 저장본으로 전환
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
  const network = fetch(e.request, { cache: "no-cache" }).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
    }
    return res;
  });
  const cached = () => caches.match(e.request, { ignoreSearch: true });
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS)).then(cached);
  e.respondWith(
    // 네트워크가 빨리 오면 최신본, 3초가 지나도 안 오면 저장본(없으면 계속 네트워크를 기다림)
    Promise.race([network.catch(cached), timeout.then((hit) => hit || network)]).then((res) => res || network),
  );
});
