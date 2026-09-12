/**
 * 화면을 먼저 그리는 캐시 — 판단 규칙 테스트.
 *
 *   node scripts/page-cache.test.mjs
 *
 * src/lib/pageCache.ts 를 임시로 컴파일해서 **실제 코드 그대로** 돌린다
 * (sales.test.mjs 와 같은 방식).
 *
 * 여기서 막고 싶은 것:
 *   · **남이 받아둔 목록이 내 화면에 뜨는 것** — 기기를 같이 쓰면 바로 사고다
 *   · 몇 달 전 목록을 사실인 양 보여주는 것
 *   · 기기 시계가 미래로 틀어졌을 때 낡은 것이 '싱싱함' 으로 읽히는 것
 *   · 깨진 캐시에 화면이 죽는 것 (JSON 이 아니거나 모양이 다를 때)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const out = mkdtempSync(join(tmpdir(), 'moalab-cache-'));
let C;
try {
  execFileSync(
    'npx',
    ['tsc', 'src/lib/pageCache.ts', '--outDir', out,
     '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { stdio: 'pipe' },
  );
  C = createRequire(import.meta.url)(join(out, 'pageCache.js'));
} catch (e) {
  console.error('컴파일 실패:', e.stdout?.toString() || e.message);
  process.exit(1);
}

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) console.log(`  ok  ${label}`);
  else {
    fail++;
    console.log(`FAIL  ${label}\n      기대 ${w}\n      실제 ${g}`);
  }
};

const NOW = Date.parse('2026-09-03T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const env = (memberId, cachedAt, payload) => JSON.stringify({ memberId, cachedAt, payload });
const LIST = { projects: [{ id: 'g1', title: '모두의 창업' }], collaborators: [] };

/* ── 정상 ─────────────────────────────────────────────────────────── */
eq('방금 받은 내 목록은 그대로 쓴다',
  C.usableEnvelope(env('me', NOW - 1000, LIST), 'me', NOW), LIST);
eq('6일 지난 것도 아직 쓴다 (일단 보여주고 새로 받는다)',
  C.usableEnvelope(env('me', NOW - 6 * DAY, LIST), 'me', NOW), LIST);
eq('빈 목록도 유효한 답이다 (없음과 구분해야 한다)',
  C.usableEnvelope(env('me', NOW - 1000, { projects: [], collaborators: [] }), 'me', NOW),
  { projects: [], collaborators: [] });

/* ── 남의 것은 절대 안 보여준다 ────────────────────────────────────── */
eq('다른 사람이 받아둔 것은 안 쓴다',
  C.usableEnvelope(env('other', NOW - 1000, LIST), 'me', NOW), null);
eq('누가 받은 건지 안 적혀 있으면 안 쓴다',
  C.usableEnvelope(JSON.stringify({ cachedAt: NOW, payload: LIST }), 'me', NOW), null);

/* ── 낡은 것 ──────────────────────────────────────────────────────── */
eq('8일 지난 것은 안 쓴다',
  C.usableEnvelope(env('me', NOW - 8 * DAY, LIST), 'me', NOW), null);
eq('딱 7일은 경계 안쪽이라 쓴다',
  C.usableEnvelope(env('me', NOW - 7 * DAY, LIST), 'me', NOW), LIST);

/* ── 시계가 틀어진 기기 ────────────────────────────────────────────── */
eq('미래로 찍힌 것은 안 쓴다 (음수 나이를 싱싱함으로 읽으면 안 된다)',
  C.usableEnvelope(env('me', NOW + DAY, LIST), 'me', NOW), null);
eq('저장 시각이 숫자가 아니면 안 쓴다',
  C.usableEnvelope(env('me', '어제', LIST), 'me', NOW), null);

/* ── 깨진 캐시에도 안 죽는다 ───────────────────────────────────────── */
eq('아무것도 없으면 null', C.usableEnvelope(null, 'me', NOW), null);
eq('JSON 이 아니면 null', C.usableEnvelope('{깨짐', 'me', NOW), null);
eq('JSON 이지만 객체가 아니면 null', C.usableEnvelope('12', 'me', NOW), null);
eq('null 이 저장돼 있으면 null', C.usableEnvelope('null', 'me', NOW), null);
eq('내용 칸이 없으면 null',
  C.usableEnvelope(JSON.stringify({ memberId: 'me', cachedAt: NOW }), 'me', NOW), null);

/* ── 브라우저가 없는 곳(서버)에서도 안 죽는다 ──────────────────────── */
eq('window 가 없으면 읽기는 조용히 null', C.readCache('k', 'me'), null);
let threw = false;
try { C.writeCache('k', 'me', LIST); C.clearCaches(); } catch { threw = true; }
eq('window 가 없어도 쓰기·지우기가 안 터진다', threw, false);

rmSync(out, { recursive: true, force: true });
console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
