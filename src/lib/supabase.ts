'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * 환경변수가 없으면 빌드/렌더 도중 죽지 않고, 실제 호출 시점에
 * 한글 안내 에러를 던지도록 프록시로 감싼다.
 */
function makeStub(): SupabaseClient {
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
  return new Proxy({}, handler) as SupabaseClient;
}

export const supabase: SupabaseClient =
  url && anonKey
    ? createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : makeStub();

export const isSupabaseConfigured = Boolean(url && anonKey);

/** Supabase 에러를 강사들이 읽을 수 있는 한글 문장으로 */
export function friendlyError(e: unknown, fallback = '저장이 안 됐어요. 다시 눌러주세요.'): string {
  if (!e) return fallback;
  const raw = typeof e === 'string' ? e : (e as { message?: string })?.message ?? '';
  if (!raw) return fallback;
  if (/duplicate key|already exists|unique/i.test(raw)) return '이미 같은 값이 등록돼 있어요.';
  if (/violates foreign key/i.test(raw)) return '연결된 항목이 없어졌어요. 새로고침 후 다시 해주세요.';
  if (/Failed to fetch|NetworkError|fetch failed/i.test(raw))
    return '인터넷 연결이 불안정해요. 잠시 후 다시 눌러주세요.';
  if (/row-level security|permission denied|JWT/i.test(raw))
    return '권한이 없어요. 원장님께 문의해주세요.';
  if (/Payload too large|exceeded the maximum/i.test(raw)) return '파일이 너무 커요. 사진 장수를 줄여주세요.';
  if (raw.includes('.env.local')) return raw;
  return fallback;
}
