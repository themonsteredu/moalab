/**
 * 영업 한 판 — 계산 테스트.
 *
 *   node scripts/sales.test.mjs
 *
 * src/lib/sales.ts 를 임시로 컴파일해서 **실제 코드 그대로** 돌린다 (org.test.mjs 와 같은 방식).
 *
 * 여기서 막고 싶은 것:
 *   · **다음 연락할 날이 없는 표(견적·계약, 만족도)가 섞이는 것** — 성격이 다르다
 *   · 보류해둔 곳이 매일 '오늘 연락할 곳' 에 뜨는 것 — 그날로 이 판을 안 본다
 *   · 상태 순서가 표마다 달라지는 것 (보기 순서를 따라야 한다)
 *   · 아직 안 온 연락일이 '오늘' 로 잡히는 것 / 잘못 적힌 날짜에 화면이 죽는 것
 *   · 역할 표 화면과 다른 규칙으로 이름·상태를 읽어 숫자가 어긋나는 것
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const out = mkdtempSync(join(tmpdir(), 'moalab-sales-'));
let S;
try {
  execFileSync(
    'npx',
    ['tsc', 'src/lib/sales.ts', 'src/lib/types.ts', '--outDir', out,
     '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { stdio: 'pipe' },
  );
  S = createRequire(import.meta.url)(join(out, 'sales.js'));
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

const col = (duty_id, id, name, kind = 'text', options = null, sort_order = 0) => ({
  id, duty_id, name, kind, options, sort_order, created_at: '',
});
const row = (duty_id, id, cells, sort_order = 0) => ({
  id, duty_id, cells, sort_order, updated_by: null, created_at: '', updated_at: '',
});
const duty = (id, name) => ({ id, group_id: 'g', name, note: null, owner_id: null, link: null, sort_order: 0, created_at: '' });
const TODAY = '2026-09-02';
const STATES = ['연락 전', '연락함', '제안서 보냄', '미팅', '견적·계약', '진행 중', '완료', '보류'];

/* 기관 표 둘 (청소년문화의집 · 지역아동센터) + 성격이 다른 표 둘 (견적·계약 · 만족도) */
const inputs = [
  { duty: duty('a', '청소년문화의집'), groupName: '신규발굴 청소년기관' },
  { duty: duty('b', '지역아동센터'), groupName: '신규발굴 아동·돌봄' },
  { duty: duty('c', '견적·계약'), groupName: '학교·기관 영업' },
  { duty: duty('d', '만족도 조사'), groupName: '고객 관리' },
  { duty: duty('e', '명함제작'), groupName: '홍보' },      // 표 자체가 없다
];
const cols = [
  col('a', 'a1', '기관 이름'), col('a', 'a2', '진행 상태', 'select', STATES, 1), col('a', 'a3', '지역', 'select', ['광주 동구'], 2), col('a', 'a4', '다음 연락일', 'date', null, 3),
  col('b', 'b1', '기관 이름'), col('b', 'b2', '진행 상태', 'select', STATES, 1), col('b', 'b4', '다음연락일', 'date', null, 2),
  col('c', 'c1', '기관 이름'), col('c', 'c2', '상태', 'select', ['견적 보냄', '계약'], 1), col('c', 'c3', '계약일', 'date', null, 2),
  col('d', 'd1', '기관'), col('d', 'd2', '상태', 'select', ['받음'], 1), col('d', 'd3', '수업 날', 'date', null, 2),
];
const rows = [
  row('a', 'r1', { a1: '동구청소년문화의집', a2: '연락 전', a4: '2026-08-30' }),       // 사흘 지남
  row('a', 'r2', { a1: '서구청소년문화의집', a2: '제안서 보냄', a4: '2026-09-02' }),   // 오늘
  row('a', 'r3', { a1: '남구청소년문화의집', a2: '연락함', a4: '2026-09-10' }),       // 아직
  row('a', 'r4', { a1: '북구청소년문화의집', a2: '보류', a4: '2026-08-01' }),         // 보류 — 안 뜬다
  row('a', 'r5', { a1: '광산구청소년문화의집' }),                                     // 상태·날짜 없음
  row('b', 'r6', { b1: '햇살지역아동센터', b2: '연락 전', b4: '2026-09-01' }),        // 하루 지남
  row('b', 'r7', { b1: '', b2: '연락 전', b4: '2026-09-02' }),                        // 이름 없음
  row('b', 'r8', { b1: '무지개지역아동센터', b2: '완료', b4: '2026-09-02' }),         // 완료 — 안 뜬다
  row('b', 'r9', { b1: '별빛지역아동센터', b2: '연락함', b4: '이상한 날짜' }),         // 안 죽어야 한다
  row('c', 'r10', { c1: '광주중학교', c2: '계약', c3: '2026-08-01' }),
  row('d', 'r11', { d1: '광주중학교', d2: '받음', d3: '2026-08-01' }),
];

console.log('\n[어떤 표를 모으나]');
{
  eq('연락 날짜 칸이 있는 표만 잡는다', S.contactCol(cols.filter((c) => c.duty_id === 'a'))?.name, '다음 연락일');
  eq('띄어쓰기가 달라도 잡는다', S.contactCol(cols.filter((c) => c.duty_id === 'b'))?.name, '다음연락일');
  eq('계약일은 연락일이 아니다', S.contactCol(cols.filter((c) => c.duty_id === 'c')), null);
  eq('날짜 칸이 아니면 이름에 연락이 있어도 아니다', S.contactCol([col('x', 'x1', '연락처', 'text')]), null);
}

const board = S.buildSalesBoard(inputs, cols, rows, TODAY);

console.log('\n[한 판]');
{
  eq('기관 표 둘만 모인다 (견적·만족도·표 없는 역할은 빠진다)', board.tables.map((t) => t.dutyName), ['청소년문화의집', '지역아동센터']);
  eq('기관 전부 몇 곳', board.total, 9);
  eq('갈래별 기관 수', board.tables.map((t) => t.total), [5, 4]);
  eq('갈래별 오늘 연락할 곳', board.tables.map((t) => t.due), [2, 2]);
  eq('갈래별 많은 상태 둘', board.tables[0].top, [{ label: '연락 전', n: 1 }, { label: '제안서 보냄', n: 1 }]);
}

console.log('\n[상태별 개수 — 보기 순서대로, 0 건은 뺀다]');
{
  eq('순서가 보기(option) 순서다', board.status.map((s) => s.label), ['연락 전', '연락함', '제안서 보냄', '완료', '보류']);
  eq('표를 합쳐 센다', board.status.find((s) => s.label === '연락 전')?.n, 3);
  eq('0 건인 보기는 안 싣는다', board.status.some((s) => s.label === '미팅'), false);
  eq('상태 안 고른 줄은 안 센다', board.status.reduce((n, s) => n + s.n, 0), 8);
}

console.log('\n[오늘 연락할 곳]');
{
  eq('오래 지난 것부터', board.due.map((d) => d.title), ['동구청소년문화의집', '햇살지역아동센터', '서구청소년문화의집', '이름 없음']);
  eq('며칠 지났는지', board.due.map((d) => d.daysLate), [3, 1, 0, 0]);
  eq('아직 안 온 연락일은 안 뜬다', board.due.some((d) => d.title === '남구청소년문화의집'), false);
  eq('보류·완료는 안 뜬다', board.due.some((d) => ['북구청소년문화의집', '무지개지역아동센터'].includes(d.title)), false);
  eq('잘못 적힌 날짜는 조용히 넘긴다', board.due.some((d) => d.title === '별빛지역아동센터'), false);
  eq('어느 표의 어느 줄인지 들고 있다 (누르면 그 줄로 간다)', [board.due[0].dutyId, board.due[0].rowId], ['a', 'r1']);
  eq('첫 칸이 비면 이름 없음 (역할 표 화면과 같은 규칙)', board.due[3].title, '이름 없음');
}

console.log('\n[표기·날짜]');
{
  eq('오늘', S.lateLabel(0), '오늘');
  eq('사흘 지남', S.lateLabel(3), '3일 지남');
  eq('날짜 차이', S.daysBetween('2026-08-30', '2026-09-02'), 3);
  eq('연 경계', S.daysBetween('2025-12-31', '2026-01-01'), 1);
  eq('윤년 2/29', S.daysBetween('2028-02-28', '2028-03-01'), 2);
  eq('날짜가 아니면 null', S.daysBetween('2026-02-30', '2026-09-02') === null || S.daysBetween('없음', TODAY) === null, true);
}

console.log('\n[빈 것]');
{
  const empty = S.buildSalesBoard(inputs, cols, [], TODAY);
  eq('줄이 없어도 표는 잡힌다 (갈래 목록은 보여야 붙여넣을 곳을 안다)', empty.tables.length, 2);
  eq('기관 0곳', empty.total, 0);
  eq('상태 0건이면 빈 목록', empty.status, []);
  eq('표가 하나도 없으면 아무것도 없다', S.buildSalesBoard(inputs, [], [], TODAY).tables, []);
}

rmSync(out, { recursive: true, force: true });
console.log(fail === 0 ? `\n전부 통과` : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
