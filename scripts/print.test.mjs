/**
 * 인쇄 통합 셀(rowSpan) 계산 테스트.
 *
 *   node scripts/print.test.mjs
 *
 * src/lib/print.ts 를 임시로 컴파일해서 **실제 코드 그대로** 돌린다
 * (org.test.mjs · task.test.mjs 와 같은 방식).
 *
 * 여기서 막고 싶은 것:
 *   · rowSpan 합이 줄 수와 안 맞아 **표가 통째로 어긋나는 것**
 *     (한 칸이라도 틀리면 그 아래 열이 전부 밀린다 — 눈으로는 늦게 발견된다)
 *   · **떨어져 있는 같은 값을 합치는 것.** 같은 부서가 두 군데 떨어져 나오면
 *     그건 그대로 두 덩어리다. 합치면 없던 순서가 생긴다
 *   · 덮인 줄에 `<td>` 를 또 그려서 칸이 하나 더 튀어나오는 것
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const out = mkdtempSync(join(tmpdir(), 'moalab-print-'));
let P;
try {
  execFileSync(
    'npx',
    ['tsc', 'src/lib/print.ts', '--outDir', out,
     '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { stdio: 'pipe' },
  );
  P = createRequire(import.meta.url)(join(out, 'print.js'));
} catch (e) {
  console.error('컴파일 실패:', e.stdout?.toString() || e.message);
  process.exit(1);
}

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    console.log(`OK   ${label} → ${g}`);
  } else {
    console.log(`FAIL ${label}\n     받은 값: ${g}\n     기대값 : ${w}`);
    fail += 1;
  }
};

/** 보기 편하게 'r2' (그림·2줄) / '·' (덮임) 로 줄인다 */
const short = (spans) => spans.map((s) => (s.render ? `r${s.rowSpan}` : '·'));

/* ------------------------------------------------------------- 기본 갈래 */

eq('빈 목록', short(P.mergeRuns([])), []);
eq('한 줄', short(P.mergeRuns(['가'])), ['r1']);
eq('전부 같으면 한 칸으로', short(P.mergeRuns(['가', '가', '가'])), ['r3', '·', '·']);
eq('전부 다르면 안 합친다', short(P.mergeRuns(['가', '나', '다'])), ['r1', 'r1', 'r1']);
eq('앞에서만 이어짐', short(P.mergeRuns(['가', '가', '나'])), ['r2', '·', 'r1']);
eq('뒤에서만 이어짐', short(P.mergeRuns(['가', '나', '나'])), ['r1', 'r2', '·']);

/* --------------------------------------------- 떨어진 같은 값은 안 합친다
   같은 부서가 두 군데 떨어져 나오면 그건 그대로 두 덩어리다.
   합쳐버리면 표에 없던 순서가 생긴다 */

eq(
  '떨어진 같은 값은 따로',
  short(P.mergeRuns(['가', '가', '나', '가'])),
  ['r2', '·', 'r1', 'r1'],
);
eq(
  '가-나-가-나 는 하나도 안 합쳐진다',
  short(P.mergeRuns(['가', '나', '가', '나'])),
  ['r1', 'r1', 'r1', 'r1'],
);

/* ------------------------------------------------- 표가 어긋나지 않는가
   한 칸이라도 틀리면 그 아래 열이 전부 밀린다. 눈으로는 늦게 발견되니
   여기서 못박는다: rowSpan 합 == 줄 수, 그리고 덮인 줄은 안 그린다 */

const cases = [
  [],
  ['가'],
  ['가', '가'],
  ['가', '나', '나', '다', '다', '다'],
  ['회계·정산', '회계·정산', '회계·정산', '회계·정산', '문서·총무', '문서·총무'],
  Array.from({ length: 48 }, (_, i) => `주제${Math.floor(i / 3)}`),
];
let sumOk = true;
let coverOk = true;
for (const v of cases) {
  const spans = P.mergeRuns(v);
  if (spans.length !== v.length) sumOk = false;
  const total = spans.filter((s) => s.render).reduce((a, s) => a + s.rowSpan, 0);
  if (total !== v.length) sumOk = false;

  // 그린 칸이 덮는 범위가 빈틈도 겹침도 없이 줄을 정확히 채워야 한다.
  // 그린 줄에서만 앞으로 나아가고, 그 사이 줄은 전부 덮인 줄이어야 한다
  let i = 0;
  while (i < spans.length) {
    if (!spans[i].render) { coverOk = false; break; }
    const n = spans[i].rowSpan;
    for (let k = 1; k < n; k += 1) if (spans[i + k]?.render) coverOk = false;
    i += n;
  }
  if (i !== v.length) coverOk = false;
}
eq('rowSpan 합 == 줄 수 (모든 경우)', sumOk, true);
eq('덮는 범위가 빈틈·겹침 없이 딱 맞는다', coverOk, true);

/* ---------------------------------------------------------- parts 파싱 */

eq('parts 없으면 전부', [...P.parseRoleParts(null)].sort(), ['dept', 'person', 'unassigned']);
eq('고른 것만', [...P.parseRoleParts('dept,person')].sort(), ['dept', 'person']);
eq('모르는 값은 버린다', [...P.parseRoleParts('dept,없는것')], ['dept']);
eq('전부 모르는 값이면 빈 것', [...P.parseRoleParts('없는것')], []);

rmSync(out, { recursive: true, force: true });
console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
