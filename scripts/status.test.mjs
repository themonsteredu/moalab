/**
 * 앱 상태 계산 테스트 — computeStatus.
 *
 *   node scripts/status.test.mjs
 *
 * 이 함수가 목록·홈·상세의 배지를 전부 결정한다. 여기가 틀리면
 * "누가 다음에 움직여야 하는지" 가 화면에서 사라진다.
 *
 * 특히 막고 싶은 것:
 *   · `open`(답 안 한 지적)이 하나라도 있으면 무조건 **수정 필요** —
 *     `recheck` 가 섞여 있어도 다시확인으로 내려가면 안 된다 (제작자 차례를 놓친다)
 *   · 지적 0건인데 검증자가 아무도 안 눌렀으면 done 이 아니다
 *     ("아무도 안 봤다" 와 "다 봤는데 문제없다" 는 다르다)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const out = mkdtempSync(join(tmpdir(), 'moalab-status-'));
let S, T;
try {
  execFileSync(
    'npx',
    ['tsc', 'src/lib/status.ts', 'src/lib/types.ts', '--outDir', out,
     '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { stdio: 'pipe' },
  );
  const req = createRequire(import.meta.url);
  S = req(join(out, 'status.js'));
  T = req(join(out, 'types.js'));
} catch (e) {
  console.error('컴파일 실패:', e.stdout?.toString() || e.message);
  process.exit(1);
}

let fail = 0;
const f = (...states) => states.map((status) => ({ status }));

/** [설명, 지적상태들, 검증자수, 완료누른수, 기대상태] */
const cases = [
  ['지적 없음 · 검증자 없음                → 진행 중', [], 0, 0, 'pending'],
  ['지적 없음 · 검증자 2명 중 0명 완료     → 진행 중', [], 2, 0, 'pending'],
  ['지적 없음 · 검증자 2명 중 1명 완료     → 진행 중', [], 2, 1, 'pending'],
  ['지적 없음 · 검증자 전원 완료           → 검증 완료', [], 2, 2, 'done'],
  ['지적 없음 · 완료가 정족수보다 많음     → 검증 완료', [], 1, 3, 'done'],

  ['open 1건                               → 수정 필요', f('open'), 2, 2, 'fixing'],
  ['open + recheck (섞임)                  → 수정 필요', f('open', 'recheck'), 2, 2, 'fixing'],
  ['open + fixed (섞임)                    → 수정 필요', f('open', 'fixed'), 2, 2, 'fixing'],
  ['open + closed                          → 수정 필요', f('open', 'closed'), 1, 1, 'fixing'],

  ['recheck 1건                            → 다시확인', f('recheck'), 2, 2, 'recheck'],
  ['fixed 1건 (고쳤다고만 한 상태)         → 다시확인', f('fixed'), 2, 2, 'recheck'],
  ['fixed + recheck                        → 다시확인', f('fixed', 'recheck'), 2, 2, 'recheck'],
  ['recheck + closed                       → 다시확인', f('recheck', 'closed'), 2, 2, 'recheck'],
  ['recheck 인데 검증자 0명                → 다시확인', f('recheck'), 0, 0, 'recheck'],

  ['closed 만                              → 검증 완료', f('closed'), 1, 1, 'done'],
  ['wontfix 만                             → 검증 완료', f('wontfix'), 1, 1, 'done'],
  ['closed + wontfix · 전원 완료           → 검증 완료', f('closed', 'wontfix'), 2, 2, 'done'],
  ['closed 만 · 아무도 안 눌렀음           → 진행 중', f('closed'), 2, 0, 'pending'],
];

console.log('--- computeStatus ---');
for (const [label, findings, rc, sc, want] of cases) {
  const got = S.computeStatus(findings, rc, sc);
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}  → ${got}${ok ? '' : `   (기대: ${want})`}`);
}

console.log('\n--- 상태 4개에 모두 이름표·색이 있나 ---');
for (const st of ['pending', 'fixing', 'recheck', 'done']) {
  const m = S.STATUS_META[st];
  const ok = Boolean(m && m.label && m.chip && m.dot);
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${st.padEnd(8)} → ${m ? m.label : '없음'}`);
}

console.log('\n--- 살아있는 지적 판정 (isOpenFinding) ---');
for (const [st, want] of [['open', true], ['fixed', true], ['recheck', true], ['wontfix', false], ['closed', false]]) {
  const got = T.isOpenFinding(st);
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${st.padEnd(8)} → ${got ? '살아있음' : '닫힘'}`);
}

console.log('\n--- 진행률 ---');
for (const [rc, sc, want] of [[0, 0, 0], [2, 0, 0], [2, 1, 50], [3, 1, 33], [2, 2, 100], [2, 5, 100]]) {
  const got = S.roundProgress(rc, sc);
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} 검증자 ${rc}명 중 ${sc}명 완료 → ${got}%`);
}

rmSync(out, { recursive: true, force: true });
console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
