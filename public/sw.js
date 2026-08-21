/*
 * 푸시 알림용 서비스 워커.
 * 캐싱은 하지 않는다 — 오프라인 대응까지 하면 "고쳐서 배포했는데 옛 화면이 뜬다" 는
 * 더 큰 문제가 생긴다. 여기서는 알림만 받는다.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: '모아랩', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || '모아랩 업무';
  const options = {
    body: data.body || '',
    // /icon.svg 는 존재하지 않는 파일이었다 — 안드로이드 알림에 크롬 기본 아이콘이 떴다
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // 같은 tag 는 덮어쓴다 — 공지 하나에 알림이 여러 개 쌓이지 않게
    tag: data.tag || 'moalab',
    renotify: true,
    data: { url: data.url || '/home' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/home';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      /* 이미 열려 있는 창이 있으면 그 창을 쓴다 (탭이 계속 늘어나지 않게).
         단 navigate() 는 이 서비스워커가 제어하지 않는 창에서는 실패한다 —
         그 경우 조용히 죽지 말고 새 창을 열어야 한다. 예전엔 실패하면
         포커스만 되고 정작 알림이 가리키는 화면으로 안 갔다. */
      for (const client of list) {
        if ('focus' in client) {
          try {
            const p = client.navigate(target);
            if (p && typeof p.catch === 'function') {
              return p.then(() => client.focus()).catch(() => self.clients.openWindow(target));
            }
          } catch {
            return self.clients.openWindow(target);
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
