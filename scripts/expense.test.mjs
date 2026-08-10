/**
 * 지출결의서 달·합계 계산 테스트.
 *
 *   node scripts/expense.test.mjs
 *
 * src/lib/expense.ts 를 임시로 컴파일해서 **실제 코드 그대로** 돌린다
 * (friendly-error.test.mjs 는 정규식만 보니 소스를 잘라 썼지만,
 *  이쪽은 달 계산·합계라 진짜 함수를 돌려야 의미가 있다).
 *
 * 여기서 막고 싶은 것:
 *   · 연 경계 (2026-01 에서 한 달 뒤로 = 2025-12)
 *   · 말일·윤년 (2월이 28/29 로 갈린다 — 월별 조회 범위가 여기서 샌다)
 *   · 필터를 걸었을 때 합계가 화면과 어긋나는 것
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const out = mkdtempSync(join(tmpdir(), 'moalab-expense-'));
let E;
try {
  execFileSync(
    'npx',
    ['tsc', 'src/lib/expense.ts', 'src/lib/types.ts', '--outDir', out,
     '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { stdio: 'pipe' },
  );
  E = createRequire(import.meta.url)(join(out, 'expense.js'));
} catch (e) {
  console.error('컴파일 실패:', e.stdout?.toString() || e.message);
  process.exit(1);
}

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} → ${g}${ok ? '' : `   (기대: ${w})`}`);
};

console.log('--- 달 표기 ---');
eq("monthKey('2026-08-08')", E.monthKey('2026-08-08'), '2026-08');
eq("monthLabel('2026-08')", E.monthLabel('2026-08'), '2026년 8월');
eq("monthLabel('2026-12')", E.monthLabel('2026-12'), '2026년 12월');

console.log('\n--- shiftMonth (연 경계가 제일 잘 깨진다) ---');
eq('2026-01 -1', E.shiftMonth('2026-01', -1), '2025-12');
eq('2025-12 +1', E.shiftMonth('2025-12', 1), '2026-01');
eq('2026-08 -8', E.shiftMonth('2026-08', -8), '2025-12');
eq('2026-03 -15', E.shiftMonth('2026-03', -15), '2024-12');
eq('2026-08 +5', E.shiftMonth('2026-08', 5), '2027-01');
eq('2026-01 -13', E.shiftMonth('2026-01', -13), '2024-12');
eq('왕복 (+7 -7)', E.shiftMonth(E.shiftMonth('2026-06', 7), -7), '2026-06');

console.log('\n--- monthRange (말일 / 윤년) ---');
eq('2026-08', E.monthRange('2026-08'), { from: '2026-08-01', to: '2026-08-31' });
eq('2026-02 평년', E.monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
eq('2028-02 윤년', E.monthRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
eq('2026-04 30일', E.monthRange('2026-04'), { from: '2026-04-01', to: '2026-04-30' });
eq('2026-12', E.monthRange('2026-12'), { from: '2026-12-01', to: '2026-12-31' });
eq('2026-01', E.monthRange('2026-01'), { from: '2026-01-01', to: '2026-01-31' });

console.log('\n--- 금액 입력 (폰에서 0 개수를 눈으로 못 센다) ---');
eq("digitsOnly('4만5,000원')", E.digitsOnly('4만5,000원'), '45000');
eq("commaNumber('45000')", E.commaNumber('45000'), '45,000');
eq("commaNumber('')", E.commaNumber(''), '');
eq("commaNumber('abc')", E.commaNumber('abc'), '');
eq("commaNumber('1234567')", E.commaNumber('1234567'), '1,234,567');
eq("commaNumber('007')", E.commaNumber('007'), '7');

console.log('\n--- 합계 ---');
const rows = [
  { id: 'a', spent_on: '2026-08-08', amount: 45000, category: 'material', pay_method: 'card', approved: true },
  { id: 'b', spent_on: '2026-08-08', amount: 12000, category: 'transport', pay_method: 'cash', approved: false },
  { id: 'c', spent_on: '2026-08-01', amount: 3000, category: 'material', pay_method: 'card', approved: false },
];
const rc = (id) => (id === 'a' ? 2 : 0); // a 만 영수증 있음
const t = E.expenseTotals(rows, rc);
eq('total', t.total, 60000);
eq('count', t.count, 3);
eq('noReceipt', t.noReceipt, 2);
eq('unapproved', t.unapproved, 2);
eq('byCategory (0건은 빠진다)', t.byCategory.map((c) => [c.label, c.amount, c.count]), [
  ['재료비', 48000, 2],
  ['교통비', 12000, 1],
]);
eq('byMethod', t.byMethod.map((m) => [m.label, m.amount, m.count]), [
  ['카드', 48000, 2],
  ['현금', 12000, 1],
]);
eq(
  '빈 목록',
  (() => {
    const z = E.expenseTotals([], rc);
    return [z.total, z.count, z.byCategory.length];
  })(),
  [0, 0, 0],
);

console.log('\n--- 날짜별 묶기 ---');
eq('desc (목록 화면)', E.groupByDate(rows).map((d) => [d.date, d.rows.length, d.amount]), [
  ['2026-08-08', 2, 57000],
  ['2026-08-01', 1, 3000],
]);
eq('asc (인쇄물)', E.groupByDate(rows, false).map((d) => d.date), ['2026-08-01', '2026-08-08']);
eq('날짜별 합 = 전체 합', E.groupByDate(rows).reduce((s, d) => s + d.amount, 0), 60000);

console.log('\n--- 인쇄 묶음 파싱 ---');
eq('없으면 전부', [...E.parseExpenseParts(null)].length, 4);
eq('빈 문자열이면 전부', [...E.parseExpenseParts('')].length, 4);
eq('쓰레기값이면 전부 (빈 문서 방지)', [...E.parseExpenseParts('xxx,yyy')].length, 4);
eq('고른 것만', [...E.parseExpenseParts('list,receipt')], ['list', 'receipt']);

console.log('\n--- 이름표 ---');
eq('구분', [E.expenseCategoryLabel('material'), E.expenseCategoryLabel('outsource')], ['재료비', '외주·용역비']);
eq('모르는 값은 기타로', E.expenseCategoryLabel('nope'), '기타');
eq('결제수단', [E.payMethodLabel('card'), E.payMethodLabel('transfer')], ['카드', '계좌이체']);
eq('좁은 표에서는 짧게', [E.payMethodShort('transfer'), E.payMethodShort('card')], ['이체', '카드']);

rmSync(out, { recursive: true, force: true });
console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
