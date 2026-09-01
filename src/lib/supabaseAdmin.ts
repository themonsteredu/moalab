import { createClient } from '@supabase/supabase-js';

/**
 * 서버 전용. service_role 키를 쓰므로 절대 클라이언트에서 import 하지 말 것.
 *
 * ## ⚠️ `cache: 'no-store'` 를 빼면 **방금 쓴 값을 못 읽는다**
 *
 * Next.js 14 는 서버에서 `fetch` 를 바꿔치기해 **GET 응답을 캐시한다.**
 * supabase-js 도 안에서 `fetch` 를 쓰기 때문에, 같은 조회를 두 번 하면
 * 두 번째는 **DB 를 안 보고 캐시가 답한다.** 라우트에 `dynamic = 'force-dynamic'`
 * 을 붙여도 다른 라우트가 만든 캐시까지는 못 막는다.
 *
 * 실제로 구글 드라이브 연결이 이것 때문에 하루종일 안 됐다 —
 * `/api/settings/drive/start` 가 확인값을 새로 저장했는데,
 * 14초 뒤 `/api/settings/drive/callback` 이 읽은 값은 **두 시간 전 것**이었다.
 * 그래서 확인값이 늘 안 맞아 `E2` 로 튕겼다 (서버 로그로 잡았다).
 *
 * 조회 주소가 똑같은 곳(로그인 PIN 확인·설정 읽기)일수록 더 잘 걸린다.
 */
export function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    db: { schema: 'moalab' },
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      // 늘 DB 를 보게 한다 (위 설명 참고)
      fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: 'no-store' }),
    },
  });
}
