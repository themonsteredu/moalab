/**
 * 말 → 업무 정리 테스트.
 *
 *   node scripts/task-parse.test.mjs
 *
 * **AI 가 준 것을 그대로 믿지 않는다**는 게 이 파일의 전부다.
 * 응답이 이상하게 와도 화면과 DB 로는 멀쩡한 것만 넘어가야 한다.
 *
 * 여기서 막고 싶은 것:
 *   · 없는 사람에게 배정되는 것 (지금 멤버 id 가 아니면 담당자 미정으로 돌린다)
 *   · 2026-02-30 같은 **없는 날짜**가 기한으로 박히는 것
 *   · 응답이 폭주해서 수백 건이 한꺼번에 생기는 것
 *   · 제목이 없는 줄이 업무로 만들어지는 것
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const out = mkdtempSync(join(tmpdir(), 'moalab-parse-'));
let P;
try {
  execFileSync(
    'npx',
    ['tsc', 'src/lib/taskParse.ts', '--outDir', out,
     '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { stdio: 'pipe' },
  );
  P = createRequire(import.meta.url)(join(out, 'taskParse.js'));
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

const MEMBERS = ['m-seoeun', 'm-eunseo', 'm-jiyeon'];
const row = (o = {}) => ({
  title: o.title ?? '할 일',
  assignee_id: o.assignee_id ?? '',
  due_date: o.due_date ?? '',
  detail: o.detail ?? '',
});

console.log('--- isRealDate — 없는 날짜를 걸러낸다 ---');
eq('평범한 날', P.isRealDate('2026-08-25'), true);
eq('2월 30일은 없다', P.isRealDate('2026-02-30'), false);
eq('평년 2월 29일은 없다', P.isRealDate('2026-02-29'), false);
eq('윤년 2월 29일은 있다', P.isRealDate('2024-02-29'), true);
eq('4월 31일은 없다', P.isRealDate('2026-04-31'), false);
eq('12월 31일은 있다', P.isRealDate('2026-12-31'), true);
eq('13월은 없다', P.isRealDate('2026-13-01'), false);
eq('0월은 없다', P.isRealDate('2026-00-10'), false);
eq('0일은 없다', P.isRealDate('2026-08-00'), false);
eq('형식이 다르면 거짓', P.isRealDate('2026/08/25'), false);
eq('말로 된 날짜는 거짓', P.isRealDate('다음 주 화요일'), false);
eq('빈 값', P.isRealDate(''), false);
eq('숫자로 오면', P.isRealDate(20260825), false);
eq('null', P.isRealDate(null), false);

console.log('\n--- normalizeParsed — 담당자 ---');
eq(
  '아는 사람이면 그대로',
  P.normalizeParsed({ tasks: [row({ assignee_id: 'm-eunseo' })] }, MEMBERS)[0].assignee_id,
  'm-eunseo',
);
eq(
  '모르는 id 면 담당자 미정 (줄은 살린다)',
  P.normalizeParsed({ tasks: [row({ assignee_id: 'm-없는사람' })] }, MEMBERS)[0].assignee_id,
  null,
);
eq(
  'AI 가 이름을 그대로 준 경우도 미정',
  P.normalizeParsed({ tasks: [row({ assignee_id: '이서은' })] }, MEMBERS)[0].assignee_id,
  null,
);
eq('빈 값이면 미정', P.normalizeParsed({ tasks: [row({})] }, MEMBERS)[0].assignee_id, null);
eq(
  '모르는 사람이어도 업무는 남는다',
  P.normalizeParsed({ tasks: [row({ title: 'A초 제안서', assignee_id: 'xxx' })] }, MEMBERS).length,
  1,
);

console.log('\n--- normalizeParsed — 기한 ---');
eq('제대로 온 날짜', P.normalizeParsed({ tasks: [row({ due_date: '2026-08-25' })] }, MEMBERS)[0].due_date, '2026-08-25');
eq('없는 날짜는 기한 없음', P.normalizeParsed({ tasks: [row({ due_date: '2026-02-30' })] }, MEMBERS)[0].due_date, null);
eq('말로 된 날짜는 기한 없음', P.normalizeParsed({ tasks: [row({ due_date: '다음주' })] }, MEMBERS)[0].due_date, null);
eq('빈 값이면 기한 없음', P.normalizeParsed({ tasks: [row({})] }, MEMBERS)[0].due_date, null);

console.log('\n--- normalizeParsed — 제목 ---');
eq('앞뒤 공백은 턴다', P.normalizeParsed({ tasks: [row({ title: '  제안서 쓰기  ' })] }, MEMBERS)[0].title, '제안서 쓰기');
eq('제목이 없으면 버린다', P.normalizeParsed({ tasks: [row({ title: '' })] }, MEMBERS).length, 0);
eq('공백뿐이어도 버린다', P.normalizeParsed({ tasks: [row({ title: '   ' })] }, MEMBERS).length, 0);
eq('제목이 문자열이 아니면 버린다', P.normalizeParsed({ tasks: [row({ title: 123 })] }, MEMBERS).length, 0);
{
  const long = '가'.repeat(80);
  const r = P.normalizeParsed({ tasks: [row({ title: long })] }, MEMBERS)[0];
  eq('긴 제목은 잘린다', r.title.length, 61); // 60자 + …
  eq('잘린 티를 낸다', r.title.endsWith('…'), true);
  eq('원문은 자세히로 내려간다', r.detail.startsWith('가'.repeat(80)), true);
}
{
  const r = P.normalizeParsed({ tasks: [row({ title: '가'.repeat(80), detail: '급함' })] }, MEMBERS)[0];
  eq('원래 자세히도 같이 남는다', r.detail.endsWith('급함'), true);
}

console.log('\n--- normalizeParsed — 응답이 이상할 때 ---');
eq('빈 배열', P.normalizeParsed({ tasks: [] }, MEMBERS), []);
eq('tasks 가 없으면', P.normalizeParsed({}, MEMBERS), []);
eq('null 이면', P.normalizeParsed(null, MEMBERS), []);
eq('문자열이면', P.normalizeParsed('어쩌구', MEMBERS), []);
eq('배열이 그대로 와도 받는다', P.normalizeParsed([row({ title: 'A' })], MEMBERS).length, 1);
eq('줄이 객체가 아니면 건너뛴다', P.normalizeParsed({ tasks: ['x', null, row({ title: 'A' })] }, MEMBERS).length, 1);
{
  const many = Array.from({ length: 100 }, (_, i) => row({ title: `일 ${i}` }));
  eq(`${P.PARSE_MAX}건에서 자른다 (폭주 방지)`, P.normalizeParsed({ tasks: many }, MEMBERS).length, P.PARSE_MAX);
}

console.log('\n--- normalizeParsed — 실제로 올 법한 응답 ---');
{
  const got = P.normalizeParsed(
    {
      tasks: [
        row({ title: 'A초 제안서 초안', assignee_id: 'm-seoeun', due_date: '2026-08-25' }),
        row({ title: '제과제빵 재료 주문', assignee_id: 'm-eunseo', due_date: '2026-08-21', detail: '20인분' }),
        row({ title: '샘플 작품 사진 찍기', assignee_id: 'm-jiyeon' }),
        row({ title: '', assignee_id: 'm-seoeun' }),
      ],
    },
    MEMBERS,
  );
  eq('제목 없는 줄만 빠진다', got.length, 3);
  eq(
    '전부 제자리에',
    got.map((t) => `${t.title}/${t.assignee_id ?? '-'}/${t.due_date ?? '-'}`),
    [
      'A초 제안서 초안/m-seoeun/2026-08-25',
      '제과제빵 재료 주문/m-eunseo/2026-08-21',
      '샘플 작품 사진 찍기/m-jiyeon/-',
    ],
  );
  eq('자세히는 있을 때만', [got[1].detail, got[2].detail], ['20인분', null]);
}

console.log('\n--- parsePrompt — 서버가 박아 넣는 것 ---');
{
  const p = P.parsePrompt('2026-08-21', [
    { id: 'm-seoeun', name: '이서은' },
    { id: 'm-eunseo', name: '주은서' },
  ]);
  eq('오늘 날짜가 들어간다', p.includes('2026-08-21'), true);
  eq('멤버 이름과 id 가 짝지어 들어간다', p.includes('이서은: m-seoeun'), true);
  eq('목록에 없는 사람은 비우라고 못박는다', p.includes('목록에 없는 사람이면 빈 문자열'), true);
  eq('없는 기한을 지어내지 말라고 한다', p.includes('지어내지 않는다'), true);
  eq('최대 건수도 알려준다', p.includes(String(P.PARSE_MAX)), true);
}

console.log('\n--- PARSE_SCHEMA — 응답 모양 ---');
eq('추가 필드를 막는다', P.PARSE_SCHEMA.properties.tasks.items.additionalProperties, false);
eq('네 칸 다 필수', P.PARSE_SCHEMA.properties.tasks.items.required, ['title', 'assignee_id', 'due_date', 'detail']);

rmSync(out, { recursive: true, force: true });
console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
