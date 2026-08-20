/**
 * 업무(tasks) 계산 테스트.
 *
 *   node scripts/task.test.mjs
 *
 * src/lib/task.ts 를 임시로 컴파일해서 **실제 코드 그대로** 돌린다
 * (expense.test.mjs 와 같은 방식).
 *
 * 여기서 막고 싶은 것:
 *   · 서버의 '오늘' 이 한국 날짜가 아니어서 **기한 알림이 하루 밀리는 것**
 *     — 이 기능에서 가장 흔한 버그다. UTC 15:00 이 한국 자정이다.
 *   · 월말·연말·윤년에서 기준일 ± N일이 틀어지는 것 (체크리스트로 뿌릴 때 쓴다)
 *   · 완료된 업무가 '기한 지남' 으로 세어져서 빨간 숫자가 안 줄어드는 것
 *   · 목록 정렬이 급한 순서가 아닌 것 (지난 것 → 가까운 것 → 기한 없음 → 완료)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const out = mkdtempSync(join(tmpdir(), 'moalab-task-'));
let T;
try {
  execFileSync(
    'npx',
    ['tsc', 'src/lib/task.ts', 'src/lib/types.ts', '--outDir', out,
     '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { stdio: 'pipe' },
  );
  T = createRequire(import.meta.url)(join(out, 'task.js'));
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

/** 테스트용 업무 한 건. 필요한 칸만 넣고 나머지는 기본값 */
let seq = 0;
const task = (o = {}) => ({
  id: o.id ?? `t${++seq}`,
  title: o.title ?? '할 일',
  detail: null,
  assignee_id: o.assignee_id ?? null,
  due_date: o.due_date ?? null,
  state: o.state ?? 'todo',
  app_id: null,
  batch_id: o.batch_id ?? null,
  batch_title: o.batch_title ?? null,
  created_by: null,
  sort_order: o.sort_order ?? 0,
  reminded_on: null,
  done_at: null,
  created_at: o.created_at ?? '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
});

const ids = (list) => list.map((t) => t.id);

console.log('--- kstDateStr — 서버의 오늘은 한국 날짜가 아니다 ---');
eq('UTC 14:59 → 아직 어제(한국 기준 8/20 23:59)', T.kstDateStr(new Date('2026-08-20T14:59:00Z')), '2026-08-20');
eq('UTC 15:00 → 한국은 자정을 넘겼다', T.kstDateStr(new Date('2026-08-20T15:00:00Z')), '2026-08-21');
eq('UTC 23:00 (cron 이 도는 시각) → 한국 아침 8시', T.kstDateStr(new Date('2026-08-20T23:00:00Z')), '2026-08-21');
eq('UTC 00:00 → 한국은 이미 오전 9시, 같은 날', T.kstDateStr(new Date('2026-08-21T00:00:00Z')), '2026-08-21');
eq('연 경계 — UTC 12/31 15:00 은 한국 1/1', T.kstDateStr(new Date('2025-12-31T15:00:00Z')), '2026-01-01');

console.log('\n--- shiftDate — 월말 · 연말 · 윤년 ---');
eq('8/25 -5 (수업 5일 전 재료 주문)', T.shiftDate('2026-08-25', -5), '2026-08-20');
eq('8/1 -1 (달을 거슬러 올라간다)', T.shiftDate('2026-08-01', -1), '2026-07-31');
eq('1/1 -1 (해를 거슬러 올라간다)', T.shiftDate('2026-01-01', -1), '2025-12-31');
eq('12/31 +1', T.shiftDate('2025-12-31', 1), '2026-01-01');
eq('2/28 +1 (평년)', T.shiftDate('2026-02-28', 1), '2026-03-01');
eq('2/28 +1 (윤년 2024)', T.shiftDate('2024-02-28', 1), '2024-02-29');
eq('2/29 +1 (윤년)', T.shiftDate('2024-02-29', 1), '2024-03-01');
eq('0일이면 그대로', T.shiftDate('2026-08-20', 0), '2026-08-20');
eq('왕복 (+30 -30)', T.shiftDate(T.shiftDate('2026-01-15', 30), -30), '2026-01-15');

const TODAY = '2026-08-20';

console.log('\n--- isOverdue — 완료된 건 지났다고 세지 않는다 ---');
eq('어제 기한, 안 끝남', T.isOverdue(task({ due_date: '2026-08-19' }), TODAY), true);
eq('어제 기한, 완료됨', T.isOverdue(task({ due_date: '2026-08-19', state: 'done' }), TODAY), false);
eq('오늘 기한은 아직 안 지났다', T.isOverdue(task({ due_date: TODAY }), TODAY), false);
eq('기한이 없으면 지날 것도 없다', T.isOverdue(task({}), TODAY), false);

console.log('\n--- sortTasks — 급한 순서 ---');
{
  const list = [
    task({ id: 'done-old', due_date: '2026-08-01', state: 'done' }),
    task({ id: 'none', due_date: null }),
    task({ id: 'soon', due_date: '2026-08-22' }),
    task({ id: 'over-1', due_date: '2026-08-19' }),
    task({ id: 'over-2', due_date: '2026-08-10' }),
    task({ id: 'today', due_date: TODAY }),
    task({ id: 'later', due_date: '2026-09-30' }),
  ];
  eq(
    '지남(오래된 순) → 오늘 → 가까운 순 → 기한없음 → 완료',
    ids(T.sortTasks(list, TODAY)),
    ['over-2', 'over-1', 'today', 'soon', 'later', 'none', 'done-old'],
  );
  eq('원본을 건드리지 않는다', ids(list)[0], 'done-old');
}
{
  const list = [
    task({ id: 'b', due_date: TODAY, sort_order: 2 }),
    task({ id: 'a', due_date: TODAY, sort_order: 1 }),
  ];
  eq('같은 기한이면 sort_order', ids(T.sortTasks(list, TODAY)), ['a', 'b']);
}
{
  const list = [
    task({ id: 'late', due_date: TODAY, created_at: '2026-08-05T00:00:00Z' }),
    task({ id: 'early', due_date: TODAY, created_at: '2026-08-02T00:00:00Z' }),
  ];
  eq('기한·순서가 같으면 먼저 만든 것', ids(T.sortTasks(list, TODAY)), ['early', 'late']);
}

console.log('\n--- taskBuckets — 머리글 경계 ---');
{
  const list = [
    task({ id: 'over', due_date: '2026-08-19' }),
    task({ id: 'today', due_date: TODAY }),
    task({ id: 'd1', due_date: '2026-08-21' }),
    task({ id: 'd7', due_date: '2026-08-27' }),
    task({ id: 'd8', due_date: '2026-08-28' }),
    task({ id: 'none', due_date: null }),
    task({ id: 'fin', due_date: '2026-08-19', state: 'done' }),
  ];
  const b = T.taskBuckets(list, TODAY);
  eq('지남', ids(b.overdue), ['over']);
  eq('오늘', ids(b.today), ['today']);
  eq('7일 안 (당일+7 까지 포함)', ids(b.soon), ['d1', 'd7']);
  eq('그 뒤 + 기한 없음 (기한 없는 건 맨 뒤)', ids(b.later), ['d8', 'none']);
  eq('완료는 따로', ids(b.done), ['fin']);
  eq('빠뜨린 것 없이 전부 담긴다', b.overdue.length + b.today.length + b.soon.length + b.later.length + b.done.length, list.length);
}

console.log('\n--- groupByBatch — 묶음 진행률 ---');
{
  const list = [
    task({ id: 'x1', batch_id: 'B1', batch_title: '8/25 A초 준비', due_date: '2026-08-22', state: 'done' }),
    task({ id: 'x2', batch_id: 'B1', batch_title: '8/25 A초 준비', due_date: '2026-08-23' }),
    task({ id: 'x3', batch_id: 'B1', batch_title: '8/25 A초 준비', due_date: '2026-08-25' }),
    task({ id: 'y1', batch_id: 'B2', batch_title: '9/10 B중 준비', due_date: '2026-09-08', state: 'done' }),
    task({ id: 'y2', batch_id: 'B2', batch_title: '9/10 B중 준비', due_date: '2026-09-09', state: 'done' }),
    task({ id: 'solo', batch_id: null, due_date: TODAY }),
  ];
  const g = T.groupByBatch(list, TODAY);
  eq('낱개 업무는 묶음에 안 들어온다', g.length, 2);
  eq('안 끝난 묶음이 위로', g.map((x) => x.id), ['B1', 'B2']);
  eq('진행률', g.map((x) => `${x.done}/${x.total}`), ['1/3', '2/2']);
  eq('묶음 이름', g[0].title, '8/25 A초 준비');
  eq('가장 급한 기한 (완료된 건 빼고)', g[0].nextDue, '2026-08-23');
  eq('다 끝난 묶음은 남은 기한이 없다', g[1].nextDue, null);
}

console.log('\n--- loadByMember / unassigned — 원장이 보는 것 ---');
{
  const list = [
    task({ assignee_id: 'm1', due_date: '2026-08-19' }),
    task({ assignee_id: 'm1', due_date: '2026-08-19', state: 'done' }),
    task({ assignee_id: 'm1', due_date: '2026-08-25', state: 'doing' }),
    task({ assignee_id: 'm2', due_date: '2026-08-10' }),
    task({ assignee_id: null, due_date: '2026-08-30' }),
    task({ assignee_id: null, state: 'done' }),
  ];
  eq(
    '사람별 안 끝난 / 지남 / 하는 중',
    T.loadByMember(list, ['m1', 'm2', 'm3'], TODAY),
    [
      { memberId: 'm1', open: 2, overdue: 1, doing: 1 },
      { memberId: 'm2', open: 1, overdue: 1, doing: 0 },
      { memberId: 'm3', open: 0, overdue: 0, doing: 0 },
    ],
  );
  eq('담당자 미정 (완료된 건 뺀다)', T.unassigned(list).length, 1);
}

console.log('\n--- 이름표 ---');
eq('상태', [T.taskStateLabel('todo'), T.taskStateLabel('doing'), T.taskStateLabel('done')], ['할 일', '하는 중', '완료']);
eq('모르는 값은 할 일로', T.taskStateLabel('nope'), '할 일');

rmSync(out, { recursive: true, force: true });
console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
