/**
 * 부서 간 협업 요청 계산 테스트.
 *
 *   node scripts/collab.test.mjs
 *
 * src/lib/collab.ts 를 임시로 컴파일해서 **실제 코드 그대로** 돌린다
 * (task.test.mjs · org.test.mjs 와 같은 방식).
 *
 * 여기서 막고 싶은 것:
 *   · 끝난 요청이 편지함 위에 남아서 **답할 것이 안 보이는 것**
 *   · 기한 지난 급한 요청이 아래로 밀리는 것
 *   · 받은 것 / 보낸 것이 섞이는 것 — 편지함이 이 화면의 축이다
 *   · **팀장이 없을 때 아무도 상태를 못 바꿔 요청이 영영 멈추는 것**
 *   · 알림이 아무에게도 안 가서 요청이 그냥 묻히는 것
 *   · 흐름(영업→기획개발→생산운영→인사관리)이 규칙처럼 굳어 다른 부서에
 *     못 보내게 되는 것 — 흐름은 먼저 보여주기만 해야 한다
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const out = mkdtempSync(join(tmpdir(), 'moalab-collab-'));
let C;
try {
  execFileSync(
    'npx',
    ['tsc', 'src/lib/collab.ts', 'src/lib/types.ts', '--outDir', out,
     '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { stdio: 'pipe' },
  );
  C = createRequire(import.meta.url)(join(out, 'collab.js'));
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

const TODAY = '2026-09-10';

/* 실제 조직 그대로 — 영업마케팅(1) → 기획개발(2) → 생산운영(3) → 인사관리(4),
   경영지원은 흐름 밖 지원 부서 */
const dept = (id, name, flow_order, is_support = false, head_id = null) => ({
  id, name, head_id, sort_order: flow_order ?? 9, flow_order, is_support,
  created_at: '2026-08-01T00:00:00Z',
});
const DEPTS = [
  dept('sales', '영업마케팅부', 1),
  dept('plan', '기획개발부', 2),
  dept('prod', '생산운영부', 3),
  dept('hr', '인사관리부', 4),
  dept('sup', '경영지원부', null, true),
];

let seq = 0;
const req = (o = {}) => ({
  id: o.id ?? `r${++seq}`,
  from_dept_id: o.from ?? 'sales',
  to_dept_id: o.to ?? 'plan',
  project: o.project ?? null,
  body: o.body ?? '교안이 필요합니다',
  due_date: o.due ?? null,
  priority: o.priority ?? 'normal',
  status: o.status ?? 'requested',
  created_by: o.created_by ?? 'm1',
  accepted_by: null,
  done_at: null,
  created_at: o.created_at ?? '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
});
const ids = (list) => list.map((r) => r.id);

/* ------------------------------------------------------------------- 흐름 */

eq('영업마케팅 다음은 기획개발', C.nextInFlow(DEPTS, 'sales')?.name, '기획개발부');
eq('기획개발 다음은 생산운영', C.nextInFlow(DEPTS, 'plan')?.name, '생산운영부');
eq('생산운영 다음은 인사관리', C.nextInFlow(DEPTS, 'prod')?.name, '인사관리부');
eq('흐름 마지막(인사관리)은 다음이 없다', C.nextInFlow(DEPTS, 'hr'), null);
eq('지원 부서(경영지원)는 흐름 밖이라 다음이 없다', C.nextInFlow(DEPTS, 'sup'), null);
eq('없는 부서', C.nextInFlow(DEPTS, '없음'), null);

{
  // 다음 단계가 맨 위지만 **나머지도 전부 고를 수 있어야 한다** — 흐름은 규칙이 아니다
  const order = C.targetOrder(DEPTS, 'sales').map((d) => d.name);
  eq('받는 곳 — 다음 단계가 맨 위', order[0], '기획개발부');
  eq('자기 부서는 뺀다', order.includes('영업마케팅부'), false);
  eq('나머지 부서도 전부 고를 수 있다', order.length, 4);
  eq('지원 부서는 맨 뒤', order[order.length - 1], '경영지원부');
}
{
  // flow_order 가 아직 안 채워진 옛 데이터에서도 죽지 않아야 한다
  const bare = [dept('a', '가부', null), dept('b', '나부', null)];
  eq('flow_order 가 비어도 목록은 나온다', C.targetOrder(bare, 'a').map((d) => d.name), ['나부']);
  eq('flow_order 가 비면 다음 단계는 없다', C.nextInFlow(bare, 'a'), null);
}

/* ------------------------------------------------------------------ 정렬 */

{
  const list = [
    req({ id: 'done', status: 'done', priority: 'high', due: '2026-09-01' }),
    req({ id: 'late', due: '2026-09-05' }),                       // 기한 지남
    req({ id: 'high', priority: 'high', due: '2026-09-30' }),
    req({ id: 'soon', due: '2026-09-12' }),
    req({ id: 'none' }),                                          // 기한 없음
  ];
  eq(
    '지난 것 → 급한 것 → 가까운 순 → 기한 없음 → 완료',
    ids(C.sortRequests(list, TODAY)),
    ['late', 'high', 'soon', 'none', 'done'],
  );
  eq('완료는 기한이 지나도 지남으로 안 센다', C.isLate(list[0], TODAY), false);
  eq('안 끝난 것만 살아있다', C.isOpenRequest(req({ status: 'doing' })), true);
}
{
  // 같은 조건이면 새 것이 위 — 방금 온 요청이 눈에 띄어야 한다
  const list = [
    req({ id: 'old', created_at: '2026-09-01T00:00:00Z' }),
    req({ id: 'new', created_at: '2026-09-09T00:00:00Z' }),
  ];
  eq('같은 조건이면 새 것부터', ids(C.sortRequests(list, TODAY)), ['new', 'old']);
}

/* ---------------------------------------------------------------- 편지함 */

{
  const list = [
    req({ id: 'in1', from: 'sales', to: 'plan' }),
    req({ id: 'in2', from: 'sup', to: 'plan', priority: 'high' }),
    req({ id: 'out1', from: 'plan', to: 'prod' }),
    req({ id: 'other', from: 'hr', to: 'sup' }),
  ];
  const box = C.inbox(list, ['plan'], TODAY);
  eq('받은 것만 받은함에', ids(box.received).sort(), ['in1', 'in2']);
  eq('보낸 것만 보낸함에', ids(box.sent), ['out1']);
  eq('남의 부서 것은 어느 쪽에도 없다', [...ids(box.received), ...ids(box.sent)].includes('other'), false);
  eq('받은함도 급한 순이다', ids(box.received)[0], 'in2');
}
{
  // 지금 담당자가 0명이라 '어느 부서에도 안 묶인 사람' 이 흔하다.
  // 그때 남의 요청이 새어 보이면 안 된다
  const box = C.inbox([req({ from: 'sales', to: 'plan' })], [], TODAY);
  eq('부서가 없으면 받은함 비어 있음', box.received.length, 0);
  eq('부서가 없으면 보낸함도 비어 있음', box.sent.length, 0);
}
{
  const m = C.pendingByDept([
    req({ to: 'plan' }),
    req({ to: 'plan', status: 'doing' }),
    req({ to: 'plan', status: 'done' }),
    req({ to: 'prod' }),
  ]);
  eq('부서별 남은 요청 — 완료는 안 센다', m.get('plan'), 2);
  eq('다른 부서', m.get('prod'), 1);
  eq('받은 게 없는 부서는 아예 없다', m.get('hr'), undefined);
}

/* ------------------------------------------------------- 권한 · 알림 대상 */

{
  const withHead = [...DEPTS.filter((d) => d.id !== 'plan'), dept('plan', '기획개발부', 2, false, 'boss')];
  const r = req({ to: 'plan' });
  eq('받는 부서 팀장은 바꿀 수 있다', C.canRespond(r, withHead, 'boss', false), true);
  eq('남은 못 바꾼다', C.canRespond(r, withHead, 'other', false), false);
  eq('원장은 언제나 바꿀 수 있다', C.canRespond(r, withHead, 'other', true), true);
}
{
  // ⚠️ 지금 팀장이 0명이다. 팀장이 없을 때 아무도 못 누르면 요청이 영영 멈춘다
  const r = req({ to: 'plan' });
  eq('팀장이 없으면 막지 않는다', C.canRespond(r, DEPTS, 'anyone', false), true);
  eq('없는 부서로 온 요청은 못 바꾼다', C.canRespond(req({ to: '없음' }), DEPTS, 'x', false), false);
}
{
  const withHead = [...DEPTS.filter((d) => d.id !== 'plan'), dept('plan', '기획개발부', 2, false, 'boss')];
  eq('알림은 받는 부서 팀장에게', C.notifyTargets({ to_dept_id: 'plan' }, withHead, ['admin']), ['boss']);
  eq('팀장이 없으면 원장에게', C.notifyTargets({ to_dept_id: 'prod' }, DEPTS, ['admin']), ['admin']);
  eq('원장도 없으면 빈 목록(조용히 안 보냄)', C.notifyTargets({ to_dept_id: 'prod' }, DEPTS, []), []);
}

/* -------------------------------------------------------------- 이름표·문구 */

eq('상태 이름', [C.collabStatusLabel('requested'), C.collabStatusLabel('doing'), C.collabStatusLabel('done')],
  ['요청', '진행중', '완료']);
eq('모르는 상태는 요청으로', C.collabStatusLabel('없음'), '요청');
eq('중요도 이름', C.collabPriorityLabel('high'), '급함');
eq('알림 문구 — 프로젝트와 기한', C.notifyBody('영업마케팅부', '○○중 3학년 4차시', '9월 20일'),
  '영업마케팅부 → ○○중 3학년 4차시 · 9월 20일까지');
eq('프로젝트가 없으면 부서만', C.notifyBody('영업마케팅부', null, null), '영업마케팅부');

rmSync(out, { recursive: true, force: true });
console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
