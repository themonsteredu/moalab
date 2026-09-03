'use client';

/**
 * 서버를 거쳐야만 읽히는 화면이 **기다리지 않고 곧바로 그려지게** 하는 캐시.
 *
 * 대부분의 화면은 브라우저가 Supabase 로 곧바로 붙지만, 정부지원사업처럼
 * 잠가둔 표는 반드시 `/api/*` 를 거친다. 그 왕복을 매번 빈 화면으로 기다리면
 * "메뉴가 안 열린다" 로 느껴진다 — 지난번에 받은 것을 **먼저 그려놓고**
 * 뒤에서 새로 받아 조용히 갈아끼운다
 * (대화창이 '보내면 화면에 먼저 띄우고' 하는 것과 같은 판단).
 *
 * - **`localStorage` 다.** `sessionStorage` 는 앱을 닫으면 사라져서, 정작
 *   제일 답답한 '앱을 새로 열었을 때' 에 아무 도움이 안 된다.
 * - **누가 받은 것인지 같이 적어둔다.** 다른 사람이 로그인하면 안 보여준다.
 * - **로그아웃하면 지운다** (`clearCaches`) — 남의 자료가 기기에 남으면 안 된다.
 * - 낡아도 **일단 보여주고 곧바로 새로 받는다.** 서버가 죽어 있을 때
 *   빈 화면 대신 지난 목록이라도 보이는 편이 낫다 (화면이 에러 띠를 같이 띄운다).
 */

const PREFIX = 'moalab.cache.';
/** 이보다 낡으면 안 쓴다 — 몇 달 전 목록을 사실인 양 보여주지 않는다 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface Envelope<T> {
  memberId: string;
  cachedAt: number;
  payload: T;
}

/**
 * 저장해둔 것을 지금 화면에 써도 되나 — 순수 함수라 테스트가 그대로 검사한다.
 * 같은 사람 것이어야 하고, 너무 낡지 않아야 하고, 모양이 성해야 한다.
 */
export function usableEnvelope<T>(
  raw: string | null,
  memberId: string,
  now = Date.now(),
  maxAgeMs = MAX_AGE_MS,
): T | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // 깨진 캐시는 없는 것으로 친다
  }
  const env = parsed as Partial<Envelope<T>> | null;
  if (!env || typeof env !== 'object') return null;
  if (env.memberId !== memberId) return null;
  if (typeof env.cachedAt !== 'number' || !Number.isFinite(env.cachedAt)) return null;
  // 기기 시계가 틀어져 미래로 찍힌 것도 버린다 (음수 나이를 '싱싱함' 으로 읽으면 안 된다)
  const age = now - env.cachedAt;
  if (age < 0 || age > maxAgeMs) return null;
  if (env.payload === undefined) return null;
  return env.payload as T;
}

function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null; // 사파리 비공개 모드 등에서 접근 자체가 막힐 수 있다
  }
}

/** 지난번에 받은 것 — 없으면 null */
export function readCache<T>(key: string, memberId: string, now = Date.now()): T | null {
  const s = store();
  if (!s) return null;
  try {
    return usableEnvelope<T>(s.getItem(PREFIX + key), memberId, now);
  } catch {
    return null;
  }
}

/** 이번에 받은 것을 저장 — 실패해도 화면 사용에는 영향이 없다 */
export function writeCache<T>(key: string, memberId: string, payload: T, now = Date.now()): void {
  const s = store();
  if (!s) return;
  const env: Envelope<T> = { memberId, cachedAt: now, payload };
  try {
    s.setItem(PREFIX + key, JSON.stringify(env));
  } catch {
    // 저장 공간이 꽉 찼으면 그냥 캐시 없이 돈다
  }
}

/** 로그아웃할 때 전부 지운다. 화면 설정(`moalab.open.*` 등)은 건드리지 않는다 */
export function clearCaches(): void {
  const s = store();
  if (!s) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < s.length; i += 1) {
      const k = s.key(i);
      if (k?.startsWith(PREFIX)) doomed.push(k);
    }
    for (const k of doomed) s.removeItem(k);
  } catch {
    // 지우지 못해도 로그아웃 자체는 막지 않는다
  }
}
