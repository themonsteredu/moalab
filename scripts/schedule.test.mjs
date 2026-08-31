/**
 * 일정·출강 달력 계산 테스트.
 *
 *   node scripts/schedule.test.mjs
 *
 * src/lib/schedule.ts 를 임시로 컴파일해서 **실제 코드 그대로** 돌린다
 * (task.test.mjs · collab.test.mjs 와 같은 방식).
 *
 * 여기서 막고 싶은 것:
 *   · 마감이 두 곳(프로그램·협업요청)에서 오는데 **id 가 겹쳐 하나가 사라지는 것**
 *   · 끝난 협업 요청의 기한이 달력에 계속 남아 오늘 급한 게 안 보이는 것
 *   · **부서별 보기에서 그 부서가 받은 협업 기한이 통째로 사라지는 것**
 *     (일정은 사람에 붙고 협업 기한은 부서에 붙는다 — 거르는 축이 두 개다)
 *   · 정산 집계가 **타임 수를 안 적은 건을 조용히 0 으로 묻는 것**
 *   · 모르는 kind 가 흘러들어 화면이 죽는 것 (apps.status 에서 실제로 겪었다)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const out = mkdtempSync(join(tmpdir(), 'moalab-schedule-'));
let S;
try {
  execFileSync(
    'npx',
    ['tsc', 'src/lib/schedule.ts', 'src/lib/types.ts', '--outDir', out,
     '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { stdio: 'pipe' },
  );
  S = createRequire(import.meta.url)(join(out, 'schedule.js'));
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

/* ------------------------------------------------------------------ 밑감 */

const app = (o = {}) => ({
  id: o.id ?? 'a1',
  slug: 'x',
  title_ko: o.title ?? '제과제빵',
  url: null, purpose: null, target_grade: null, topic_id: null, topic: null,
  creator_id: o.creator ?? 'm1',
  due_date: o.due ?? null,
  current_round: 1, status: 'pending', archived: false, plan_body: null,
  created_at: '2026-08-01T00:00:00Z',
});

const sched = (o = {}) => ({
  id: o.id ?? 's1',
  kind: o.kind ?? 'class',
  title: o.title ?? '모아초 4학년 출강',
  date: o.date ?? '2026-09-10',
  start_time: o.time === undefined ? '10:00:00' : o.time,
  end_time: o.end ?? null,
  place: o.place ?? null,
  memo: null,
  app_id: o.app_id ?? null,
  school: o.school ?? '모아초등학교',
  headcount: o.headcount ?? 24,
  periods: o.periods === undefined ? 2 : o.periods,
  created_at: '2026-09-01T00:00:00Z',
});

const collab = (o = {}) => ({
  id: o.id ?? 'c1',
  from_dept_id: o.from ?? 'sales',
  to_dept_id: o.to ?? 'plan',
  project: o.project ?? '○○중 3학년 4차시',
  body: '교안이 필요합니다',
  due_date: o.due === undefined ? '2026-09-20' : o.due,
  priority: 'normal',
  status: o.status ?? 'requested',
  created_by: 'm1', accepted_by: null, done_at: null,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
});

const DEPT = { sales: '영업마케팅부', plan: '기획개발부' };
const deptName = (id) => DEPT[id] ?? '';
const ids = (list) => list.map((e) => e.id);

/* ---------------------------------------------------------------- 이름표 */

eq('갈래 이름', S.SCHEDULE_KINDS.map((k) => k.label), ['출강', '회의', '기타']);
eq('출강 이름표', S.scheduleKindLabel('class'), '출강');
eq('모르는 갈래는 기타로', S.scheduleKindLabel('없음'), '기타');
eq('옛 값(visit)이 남아 있어도 안 죽는다', S.safeKind('visit'), 'etc');
eq('빈 값도 기타', S.safeKind(null), 'etc');
eq('아는 값은 그대로', S.safeKind('meeting'), 'meeting');

/* ----------------------------------------------------------- 항목 만들기 */

{
  const list = S.buildEntries({
    apps: [app({ id: 'a1', due: '2026-09-15' }), app({ id: 'a2', due: null })],
    reviewers: { a1: ['m2', 'm3'] },
    collabs: [collab({ id: 'c1', due: '2026-09-20' })],
    deptName,
    schedules: [sched({ id: 's1', date: '2026-09-10' })],
    attendees: { s1: ['m2'] },
  });
  eq('기한 없는 프로그램은 안 싣는다', ids(list).includes('due-app-a2'), false);
  eq('날짜 순으로 나온다', ids(list), ['s1', 'due-app-a1', 'due-collab-c1']);
  eq('마감 두 갈래가 안 겹친다', new Set(ids(list)).size, list.length);
  eq('프로그램 마감은 제작자 + 검증자의 것', list.find((e) => e.id === 'due-app-a1').who, ['m1', 'm2', 'm3']);
  eq('협업 기한 제목', list.find((e) => e.id === 'due-collab-c1').title, '○○중 3학년 4차시 — 기획개발부 협업 기한');
  eq('협업 기한은 두 부서 모두의 것', list.find((e) => e.id === 'due-collab-c1').deptIds, ['plan', 'sales']);
  eq('일정 갈래는 그대로', list.find((e) => e.id === 's1').kind, 'class');
}
{
  // 끝난 요청의 기한이 남아 있으면 지난 마감이 쌓여서 오늘 급한 게 안 보인다
  const list = S.buildEntries({
    apps: [], collabs: [collab({ status: 'done' }), collab({ id: 'c2', status: 'doing' })],
    deptName, schedules: [],
  });
  eq('완료된 협업 요청은 안 싣는다', ids(list), ['due-collab-c2']);
  const noDue = S.buildEntries({ apps: [], collabs: [collab({ due: null })], deptName, schedules: [] });
  eq('기한 없는 협업 요청도 안 싣는다', noDue.length, 0);
}
{
  const list = S.buildEntries({
    apps: [], schedules: [
      sched({ id: 'late', date: '2026-09-10', time: '14:00:00' }),
      sched({ id: 'allday', date: '2026-09-10', time: null }),
      sched({ id: 'early', date: '2026-09-10', time: '09:00:00' }),
    ],
  });
  eq('같은 날은 시간 순, 시간 없는 것은 맨 뒤', ids(list), ['early', 'late', 'allday']);
}
{
  const list = S.buildEntries({
    apps: [], schedules: [sched({ id: 's1', app_id: 'a1' })],
    appTitle: (id) => (id === 'a1' ? '제과제빵' : ''),
  });
  eq('프로그램 이름이 붙는다', list[0].program, '제과제빵');
  const bare = S.buildEntries({ apps: [], schedules: [sched({ id: 's1', app_id: null })] });
  eq('프로그램을 안 걸면 비어 있다', bare[0].program, null);
}

/* ------------------------------------------------------------- 거르기 */

{
  const list = S.buildEntries({
    apps: [app({ id: 'a1', due: '2026-09-15', creator: 'm9' })],
    reviewers: { a1: ['m9'] },
    collabs: [collab({ id: 'c1', from: 'sales', to: 'plan' })],
    deptName,
    schedules: [sched({ id: 'mine', date: '2026-09-01' }), sched({ id: 'theirs', date: '2026-09-02' })],
    attendees: { mine: ['me'], theirs: ['m9'] },
  });

  eq('전체는 그대로 전부', S.filterEntries(list, 'all', { memberIds: [], deptIds: [] }).length, 4);
  eq(
    '내 일정 — 내가 낀 것만',
    ids(S.filterEntries(list, 'mine', { memberIds: ['me'], deptIds: [] })),
    ['mine'],
  );
  eq(
    '내 부서가 받은 협업 기한도 내 일정이다',
    ids(S.filterEntries(list, 'mine', { memberIds: ['me'], deptIds: ['plan'] })),
    ['mine', 'due-collab-c1'],
  );
  eq(
    '보낸 부서에서도 보인다',
    ids(S.filterEntries(list, 'dept', { memberIds: [], deptIds: ['sales'] })),
    ['due-collab-c1'],
  );
  eq(
    '부서별 — 그 부서 사람의 일정 + 그 부서 협업 기한',
    ids(S.filterEntries(list, 'dept', { memberIds: ['m9'], deptIds: ['plan'] })),
    ['theirs', 'due-app-a1', 'due-collab-c1'],
  );
  eq(
    '어디에도 안 묶인 사람은 빈 목록',
    S.filterEntries(list, 'mine', { memberIds: ['nobody'], deptIds: [] }).length,
    0,
  );
}

/* ----------------------------------------------------------------- 달 */

eq('달 뽑기', S.monthOf('2026-09-01'), '2026-09');
eq('1일도 그 달이다 (시간대로 새지 않는다)', S.inMonth('2026-09-01', '2026-09'), true);
eq('말일도 그 달이다', S.inMonth('2026-09-30', '2026-09'), true);
eq('다음 달 1일은 아니다', S.inMonth('2026-10-01', '2026-09'), false);
eq('윤년 2월 29일', S.inMonth('2028-02-29', '2028-02'), true);

/* -------------------------------------------------------------- 정산 집계 */

{
  const schedules = [
    sched({ id: 's1', date: '2026-09-03', periods: 2 }),
    sched({ id: 's2', date: '2026-09-10', periods: 4 }),
    sched({ id: 's3', date: '2026-09-12', periods: null }),   // 타임 수 안 적음
    sched({ id: 's4', date: '2026-10-01', periods: 9 }),      // 다음 달
    sched({ id: 's5', date: '2026-09-20', kind: 'meeting', periods: 9 }), // 회의는 정산 대상이 아니다
  ];
  const att = { s1: ['a'], s2: ['a', 'b'], s3: ['b'], s4: ['a'], s5: ['a'] };
  const load = S.classLoad(schedules, att, '2026-09');

  eq('많이 나간 사람부터', load.map((l) => l.memberId), ['a', 'b']);
  eq('타임 수 합계', load.find((l) => l.memberId === 'a'), { memberId: 'a', classes: 2, periods: 6, missing: 0 });
  eq(
    '안 적은 건은 0 으로 묻지 않고 따로 센다',
    load.find((l) => l.memberId === 'b'),
    { memberId: 'b', classes: 2, periods: 4, missing: 1 },
  );
  eq('다음 달은 안 센다', S.classLoad(schedules, att, '2026-10').map((l) => l.memberId), ['a']);
  eq('출강이 없는 달은 빈 목록', S.classLoad(schedules, att, '2026-11').length, 0);
  eq('담당 강사가 없는 출강은 아무에게도 안 붙는다', S.classLoad([sched({ id: 'x' })], {}, '2026-09').length, 0);
}

/* --------------------------------------------------------------- 한 줄 문구 */

eq('출강 제목 — 학교 · 프로그램', S.classTitle('모아초등학교', '제과제빵'), '모아초등학교 · 제과제빵');
eq('프로그램을 안 걸면 학교만', S.classTitle('모아초등학교', null), '모아초등학교');
eq('둘 다 비면 갈래 이름이라도 남긴다', S.classTitle('', ''), '출강');
eq('앞뒤 공백은 지운다', S.classTitle('  모아초  ', ' 제빵 '), '모아초 · 제빵');

eq(
  '출강 한 줄',
  S.classLine({ school: '모아초등학교', headcount: 24, periods: 2 }, '제과제빵'),
  '모아초등학교 · 제과제빵 · 24명 · 2타임',
);
eq('안 적은 칸은 빼고 잇는다', S.classLine({ school: '모아초', headcount: null, periods: null }, null), '모아초');
eq('전부 비면 빈 글', S.classLine({ school: null, headcount: null, periods: null }, null), '');
eq('0명도 적는다 (안 적은 것과 다르다)', S.classLine({ school: null, headcount: 0, periods: 0 }, null), '0명 · 0타임');

rmSync(out, { recursive: true, force: true });
console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
