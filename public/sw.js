// 크롬에서 "앱 설치"(PWA)가 가능하도록 등록만 하는 최소 서비스 워커.
// 일부러 아무것도 캐시하지 않는다: 자주 배포되는 앱이라 오래된 번들이 캐시에 남으면
// "고쳤는데 폰에서는 안 고쳐짐" 문제가 생기기 때문. 요청은 전부 네트워크로 그대로 통과시킨다.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request))
})
