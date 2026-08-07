'use client';

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * 모아랩 테이블은 전부 'moalab' 스키마 안에 있다.
 * (이 Supabase 프로젝트를 다른 앱과 같이 쓰기 때문에 public 을 쓰지 않는다)
 * 앱 코드에서는 그냥 supabase.from('apps') 라고 쓰면 moalab.apps 로 간다.
 * Supabase 대시보드 Settings → API → Exposed schemas 에 moalab 이 있어야 한다.
 */
export const DB_SCHEMA = 'moalab';

function makeClient() {
  return createClient(url!, anonKey!, {
    db: { schema: DB_SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type MoalabClient = ReturnType<typeof makeClient>;

/**
 * 환경변수가 없으면 빌드/렌더 도중 죽지 않고, 실제 호출 시점에
 * 한글 안내 에러를 던지도록 프록시로 감싼다.
 */
function makeStub(): MoalabClient {
  const msg =
    '서버 설정이 아직 안 됐어요. .env.local 에 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 를 넣어주세요.';
  const handler: ProxyHandler<object> = {
    get() {
      throw new Error(msg);
    },
    apply() {
      throw new Error(msg);
    },
  };
  return new Proxy({}, handler) as MoalabClient;
}

export const supabase: MoalabClient = url && anonKey ? makeClient() : makeStub();

export const isSupabaseConfigured = Boolean(url && anonKey);

/** Supabase 에러를 강사들이 읽을 수 있는 한글 문장으로 */
export function friendlyError(e: unknown, fallback = '저장이 안 됐어요. 다시 눌러주세요.'): string {
  if (!e) return fallback;
  const raw = typeof e === 'string' ? e : (e as { message?: string })?.message ?? '';
  if (!raw) return fallback;
  if (/duplicate key|already exists|unique/i.test(raw)) return '이미 같은 값이 등록돼 있어요.';
  if (/violates foreign key/i.test(raw)) return '연결된 항목이 없어졌어요. 새로고침 후 다시 해주세요.';
  if (/Failed to fetch|NetworkError|fetch failed|Load failed/i.test(raw))
    return '인터넷 연결이 불안정해요. 잠시 후 다시 눌러주세요.';
  if (/schema must be one of|PGRST106|does not exist.*schema|Could not find the table/i.test(raw))
    return 'DB 설정이 덜 끝났어요. Supabase 설정 > API > Exposed schemas 에 moalab 을 추가해주세요.';
  // 저장소(Storage) 쪽은 테이블과 원인이 달라서 따로 알려준다
  if (/Bucket not found|bucket does not exist/i.test(raw))
    return '첨부를 넣을 저장소가 아직 안 만들어졌어요. 관리자에게 "Storage 버킷 SQL 실행"이라고 알려주세요.';
  if (/mime type|not supported/i.test(raw))
    return '이 형식의 파일은 아직 올릴 수 없어요. 관리자에게 알려주세요.';
  if (/row-level security|permission denied|JWT|Unauthorized/i.test(raw))
    return '권한이 없어요. 관리자에게 알려주세요.';
  if (/Payload too large|exceeded the maximum|entity too large/i.test(raw))
    return '파일이 너무 커요. 더 작은 파일로 올려주세요.';
  if (raw.includes('.env.local')) return raw;

  // 여기까지 못 걸러낸 건 원인을 짐작할 수 없다.
  // 폰에서는 콘솔을 못 보니, 캡처해서 물어볼 수 있게 원문을 짧게 덧붙인다.
  if (typeof console !== 'undefined') console.error('[moalab]', e);
  return `${fallback} (${raw.slice(0, 120)})`;
}
