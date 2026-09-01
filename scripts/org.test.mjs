/**
 * 역할분장(부서 › 중분류 › 소분류) 계산 테스트.
 *
 *   node scripts/org.test.mjs
 *
 * src/lib/org.ts 를 임시로 컴파일해서 **실제 코드 그대로** 돌린다
 * (task.test.mjs 와 같은 방식).
 *
 * 여기서 막고 싶은 것:
 *   · 주담당이 부담당 목록에도 들어가 **한 사람이 두 번 세어지는 것**
 *   · '담당자 미정' 이 맨 위가 아니어서 채워야 할 것이 안 보이는 것
 *   · **역할 0건인 사람이 화면에서 사라지는 것** — 업무와 반대다.
 *     아무것도 안 맡은 사람이 있다는 것 자체가 봐야 할 정보다
 *   · 순서가 원장이 정한 sort_order 를 안 따르는 것
 *   · 검색이 걸렸는데 부서·중분류만 걸러 소분류를 놓치는 것
 *   · 순서 바꾸기가 sort_order 가 같은 줄에서 아무 일도 안 하는 것
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const out = mkdtempSync(join(tmpdir(), 'moalab-org-'));
let O;
try {
  execFileSync(
    'npx',
    ['tsc', 'src/lib/org.ts', 'src/lib/types.ts', '--outDir', out,
     '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { stdio: 'pipe' },
  );
  O = createRequire(import.meta.url)(join(out, 'org.js'));
} catch (e) {
  console.error('컴파일 실패:', e.stdout?.toString() || e.message);
  process.exit(1);
}

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    console.log(`  ok  ${label}`);
  } else {
    fail++;
    console.log(`FAIL  ${label}\n      기대 ${w}\n      실제 ${g}`);
  }
};

const dept = (id, name, ord) => ({ id, name, head_id: null, sort_order: ord, created_at: '' });
const grp = (id, dept_id, name, ord) => ({ id, dept_id, name, sort_order: ord, created_at: '' });
const duty = (id, group_id, name, ord, owner_id = null, note = null) => ({
  id, group_id, name, note, owner_id, sort_order: ord, created_at: '',
});
const mem = (id, name) => ({ id, name, role: 'teacher', active: true, sort_order: 0, created_at: '' });

const DEPTS = [dept('d2', '영업마케팅부', 2), dept('d1', '기획개발부', 1)];
const GROUPS = [
  grp('g2', 'd1', 'AI 웹앱 제작', 2),
  grp('g1', 'd1', '프로그램 기획', 1),
  grp('g3', 'd2', '홍보', 1),
];
const DUTIES = [
  duty('t2', 'g1', '학년·차시 설계', 2, 'm2'),
  duty('t1', 'g1', '신규 주제 발굴', 1, 'm1', '학교가 찾는 주제를 잡는다'),
  duty('t3', 'g2', '웹앱 제작·배포', 1, null),
  duty('t4', 'g3', 'SNS 운영', 1, 'm1'),
];
const HELPERS = [
  { duty_id: 't1', member_id: 'm2' },
  // 주담당이 부담당에도 들어가 있는 줄 — 실수로 이런 줄이 생길 수 있다
  { duty_id: 't1', member_id: 'm1' },
  { duty_id: 't3', member_id: 'm2' },
];
const MEMBERS = [mem('m1', '이서은'), mem('m2', '주은서'), mem('m3', '강지연')];

const tree = O.buildOrg(DEPTS, GROUPS, DUTIES, HELPERS);

console.log('\n[트리 만들기]');
eq('부서는 sort_order 순', tree.map((d) => d.dept.name), ['기획개발부', '영업마케팅부']);
eq('중분류도 sort_order 순', tree[0].groups.map((g) => g.group.name), ['프로그램 기획', 'AI 웹앱 제작']);
eq('소분류도 sort_order 순', tree[0].groups[0].duties.map((n) => n.duty.name), ['신규 주제 발굴', '학년·차시 설계']);
eq('부서 소분류 합계', tree[0].total, 3);
eq('부서 미정 수', tree[0].unassigned, 1);
eq('중분류 미정 수', tree[0].groups[1].unassigned, 1);

console.log('\n[주담당이 부담당에 겹치면]');
eq('주담당은 부담당에서 빠진다', tree[0].groups[0].duties[0].helperIds, ['m2']);
eq('안 겹치는 부담당은 그대로', tree[0].groups[1].duties[0].helperIds, ['m2']);

console.log('\n[전체 합계]');
eq('합계', O.orgTotals(tree), { depts: 2, duties: 4, unassigned: 1 });
eq('빈 조직도 0으로', O.orgTotals([]), { depts: 0, duties: 0, unassigned: 0 });

console.log('\n[사람별 보기]');
const people = O.groupByPerson(tree, MEMBERS);
eq('담당자 미정이 맨 위', people[0].memberId, null);
eq('미정에 담긴 역할', people[0].own.map((r) => r.duty.id), ['t3']);
eq('사람 순서는 멤버 목록 순', people.slice(1).map((p) => p.name), ['이서은', '주은서', '강지연']);
eq('주담당 두 건 (부서가 달라도 모인다)', people[1].own.map((r) => r.duty.id), ['t1', 't4']);
eq('겹친 부담당은 안 실린다', people[1].help.map((r) => r.duty.id), []);
eq('부담당만 두 건', people[2].help.map((r) => r.duty.id), ['t1', 't3']);
eq('역할 0건인 사람도 그린다', people[3].name, '강지연');
eq('0건인 사람은 빈 목록', [people[3].own.length, people[3].help.length], [0, 0]);
eq('부서·중분류 이름이 줄마다 붙는다', [people[1].own[0].deptName, people[1].own[0].groupName], ['기획개발부', '프로그램 기획']);

{
  // 미정이 0건이면 '담당자 미정' 칸 자체를 안 그린다 — 다 채웠는데 빈 칸이 남으면 안 된다
  const full = O.buildOrg(DEPTS, GROUPS, DUTIES.map((d) => ({ ...d, owner_id: d.owner_id ?? 'm3' })), HELPERS);
  eq('미정 0건이면 미정 칸이 없다', O.groupByPerson(full, MEMBERS)[0].memberId, 'm1');
}

console.log('\n[내 역할]');
eq('주담당', O.myDuties(tree, 'm1').own.map((r) => r.duty.id), ['t1', 't4']);
eq('부담당', O.myDuties(tree, 'm2').help.map((r) => r.duty.id), ['t1', 't3']);
eq('주담당이면 부담당으로 또 안 센다', O.myDuties(tree, 'm2').own.map((r) => r.duty.id), ['t2']);
eq('로그인 전이면 빈 목록', O.myDuties(tree, null), { own: [], help: [] });

{
  /* ★ 주담당이 비면 그 부서 팀장이 맡은 것으로 센다.
     예전엔 사람별 보기(groupByPerson)만 이 규칙을 써서, 팀장의 '내 역할' 은
     0건인데 사람별 보기에는 N건이 잡히는 어긋남이 있었다 */
  const headed = O.buildOrg(
    DEPTS.map((d) => (d.id === 'd1' ? { ...d, head_id: 'm3' } : d)),
    GROUPS,
    DUTIES,
    HELPERS,
  );
  const asHead = O.myDuties(headed, 'm3');
  const asPerson = O.groupByPerson(headed, MEMBERS).find((p) => p.memberId === 'm3');
  eq('★ 팀장은 담당자 미정인 역할을 자기 것으로 본다', asHead.own.length > 0, true);
  eq(
    '★ 내 역할과 사람별 보기가 같은 것을 센다',
    asHead.own.map((r) => r.duty.id),
    asPerson.own.map((r) => r.duty.id),
  );
  eq('팀장을 안 정한 부서는 여전히 미정', O.groupByPerson(tree, MEMBERS)[0].memberId, null);
}

console.log('\n[검색]');
eq('소분류 이름으로', O.filterOrg(tree, 'SNS').map((d) => d.dept.name), ['영업마케팅부']);
eq('설명으로도 걸린다', O.filterOrg(tree, '학교가 찾는').map((d) => d.dept.name), ['기획개발부']);
eq('중분류 이름이면 그 묶음 통째로', O.filterOrg(tree, '웹앱 제작')[0].groups[0].duties.length, 1);
eq('부서 이름이면 부서 통째로', O.filterOrg(tree, '기획개발')[0].total, 3);
eq('대소문자 무시', O.filterOrg(tree, 'sns').length, 1);
eq('안 걸리면 빈 목록', O.filterOrg(tree, '없는말').length, 0);
eq('빈 검색어는 그대로', O.filterOrg(tree, '   ').length, 2);
{
  const hit = O.filterOrg(tree, 'SNS');
  eq('걸러진 뒤 합계도 다시 센다', [hit[0].total, hit[0].unassigned], [1, 0]);
}

console.log('\n[순서]');
eq('다음 순서는 맨 뒤', O.nextOrder([{ sort_order: 1 }, { sort_order: 5 }]), 6);
eq('비어 있으면 1', O.nextOrder([]), 1);
{
  const items = [
    { id: 'a', name: '가', sort_order: 1 },
    { id: 'b', name: '나', sort_order: 2 },
    { id: 'c', name: '다', sort_order: 3 },
  ];
  eq('위로 올리면 두 줄만 바뀐다', O.swapOrder(items, 'b', -1), [{ id: 'b', sort_order: 0 }, { id: 'a', sort_order: 1 }]);
  eq('아래로 내리기', O.swapOrder(items, 'b', 1), [{ id: 'b', sort_order: 2 }, { id: 'c', sort_order: 1 }]);
  eq('맨 위에서 더 못 올린다', O.swapOrder(items, 'a', -1), []);
  eq('맨 아래에서 더 못 내린다', O.swapOrder(items, 'c', 1), []);
  eq('없는 id 는 아무 일도 안 한다', O.swapOrder(items, 'zz', 1), []);
}
{
  // sort_order 가 전부 0 인 옛 데이터에서도 순서가 실제로 바뀌어야 한다
  const flat = [
    { id: 'a', name: '가', sort_order: 0 },
    { id: 'b', name: '나', sort_order: 0 },
  ];
  eq('sort_order 가 같아도 자리로 다시 매긴다', O.swapOrder(flat, 'b', -1), [{ id: 'b', sort_order: 0 }, { id: 'a', sort_order: 1 }]);
}

console.log('\n[망가진 데이터]');
{
  // 부서가 사라진 중분류 · 중분류가 사라진 소분류 (DB 는 cascade 라 없지만 화면이 죽으면 안 된다)
  const t = O.buildOrg([dept('d1', '기획개발부', 1)], [grp('gX', 'dGone', '떠도는 묶음', 1)], DUTIES, []);
  eq('부모 없는 중분류는 조용히 빠진다', t.length === 1 && t[0].groups.length, 0);
  eq('빈 부서도 그려진다', t[0].total, 0);
}

rmSync(out, { recursive: true, force: true });
console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
