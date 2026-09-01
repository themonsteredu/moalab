/**
 * 일정 화면을 **실제로 눌러보는** 점검.
 *
 *   npm run dev                 (다른 창에서 띄워두고)
 *   node scripts/schedule-ui.check.mjs
 *
 * 계산은 `scripts/schedule.test.mjs` 가 지킨다. 여기서 보는 것은
 * **눌렀을 때 실제로 그렇게 되는가** 다 — 숫자만 재면 '짧아졌는데 망가진' 걸 놓친다.
 *
 *   · 출강을 고르면 학교·프로그램·인원·타임 칸이 나오는가
 *   · 회의를 고르면 그 칸들이 사라지고 제목 칸이 나오는가
 *   · 학교를 안 적고 저장을 누르면 **한글로** 막아주는가
 *   · 끝나는 시간이 시작보다 빠르면 막아주는가
 *   · `내 일정 / 부서별 / 전체` 를 바꾸면 달력에 뜨는 건수가 실제로 달라지는가
 *
 * playwright 는 이 스크립트에만 필요해서 package.json 에 안 넣었다.
 */
import { existsSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:3000';

/**
 * ⚠️ **날짜를 박아두지 않는다.** 달력은 늘 이번 달로 열리므로, 고정 날짜를 쓰면
 * 그 달이 지나는 순간 화면에 아무것도 안 뜨고 **네 건이 통째로 실패한다**
 * (실제로 2026-08 로 박아뒀다가 9월이 되자 그렇게 됐다).
 * 그러니 이번 달의 며칠로 만든다 — 달을 넘기지 않게 10일 안쪽만 쓴다.
 */
const NOW = new Date();
const d = (day) =>
  `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const ME = '00000000-0000-0000-0000-000000000001';
const M = (n) => `00000000-0000-0000-0000-00000000000${n}`;

const MEMBERS = [
  { id: ME, name: '강양희', role: 'admin', active: true, sort_order: 0 },
  { id: M(2), name: '이서은', role: 'teacher', active: true, sort_order: 1 },
  { id: M(3), name: '주은서', role: 'teacher', active: true, sort_order: 2 },
];
const APPS = [
  { id: 'app0', title_ko: '제과제빵', slug: 'a0', topic_id: null, topic: null, url: null, purpose: null,
    target_grade: null, creator_id: ME, due_date: d(8), current_round: 1, status: 'pending',
    archived: false, plan_body: null, created_at: '2026-08-01T00:00:00Z' },
];
const DEPTS = [
  { id: 'd0', name: '영업마케팅부', head_id: ME, sort_order: 0, flow_order: 1, is_support: false, created_at: '2026-08-01T00:00:00Z' },
  { id: 'd1', name: '기획개발부', head_id: M(2), sort_order: 1, flow_order: 2, is_support: false, created_at: '2026-08-01T00:00:00Z' },
];
/* 출강 셋 — 내 것 1, 남의 것 2. '내 일정' 과 '전체' 가 실제로 갈리는지 보려면 필요하다 */
const SCHEDULES = [
  { id: 's1', kind: 'class', title: '모아초 · 제과제빵', date: d(7), start_time: '09:00:00',
    end_time: '12:00:00', place: null, memo: null, app_id: 'app0', school: '모아초', headcount: 24, periods: 3 },
  { id: 's2', kind: 'class', title: '한빛중 · 제과제빵', date: d(8), start_time: '13:00:00',
    end_time: null, place: null, memo: null, app_id: 'app0', school: '한빛중', headcount: 18, periods: 2 },
  { id: 's3', kind: 'meeting', title: '팀 회의', date: d(5), start_time: '10:00:00',
    end_time: null, place: '사무실', memo: null, app_id: null, school: null, headcount: null, periods: null },
].map((s) => ({ ...s, created_at: '2026-08-01T00:00:00Z' }));

const SCHEDULE_MEMBERS = [
  { schedule_id: 's1', member_id: ME },
  { schedule_id: 's2', member_id: M(2) },
  { schedule_id: 's3', member_id: M(2) },
];
/* 기획개발부(d1)가 받은 요청 — 부서별 보기에서 마감으로 떠야 한다 */
const COLLABS = [
  { id: 'cr1', from_dept_id: 'd0', to_dept_id: 'd1', project: '○○중 3학년 4차시',
    body: '교안이 필요합니다', due_date: d(6), priority: 'high', status: 'requested',
    created_by: ME, accepted_by: null, done_at: null,
    created_at: '2026-08-20T00:00:00Z', updated_at: '2026-08-20T00:00:00Z' },
];

const TABLES = {
  members: MEMBERS, members_public: MEMBERS, apps: APPS, app_reviewers: [],
  schedules: SCHEDULES, schedule_members: SCHEDULE_MEMBERS, collab_requests: COLLABS,
  departments: DEPTS, duty_groups: [], duties: [], duty_helpers: [],
};

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright 가 없어요.  npm i -D playwright  후 다시 실행해주세요.');
  process.exit(1);
}

const exe = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {});
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });

// ※ expiresAt 이 없으면 로그인 화면으로 튕겨서 전부 '통과' 처럼 보인다
await ctx.addInitScript((s) => {
  window.localStorage.setItem('moalab.session.v1', JSON.stringify(s));
  window.localStorage.setItem('moalab.schedule.scope', 'mine');
}, { id: ME, name: '강양희', role: 'admin', expiresAt: Date.now() + 30 * 24 * 3600 * 1000 });

await ctx.route('**/rest/v1/**', (route) => {
  const t = (route.request().url().match(/\/rest\/v1\/([a-z_]+)/) ?? [])[1] ?? '';
  route.fulfill({
    status: 200,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    body: JSON.stringify(TABLES[t] ?? []),
  });
});

const page = await ctx.newPage();
let fail = 0;
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) fail += 1;
};

await page.goto(BASE + '/schedule', { waitUntil: 'commit' });
await page.waitForTimeout(4000);
ok('로그인 화면으로 안 튕긴다', new URL(page.url()).pathname === '/schedule', page.url());

/* ------------------------------------------------------- 내 일정 / 부서별 / 전체 */

// 달력 칸 안의 알약 개수 = 그 달에 실제로 그려진 항목 수
const pills = () => page.locator('button[aria-label*="일정"] span[class*="border"]').count();

await page.getByRole('button', { name: '내 일정', exact: true }).click();
await page.waitForTimeout(400);
const mine = await pills();
/* 나는 s1 담당 강사이고 app0 제작자이며 영업마케팅부(d0) 팀장이다.
   d0 가 **보낸** 협업 요청의 기한도 내 것이다 — 보낸 쪽도 그 날짜를 봐야 한다 */
ok('내 일정 — 출강 1 + 프로그램 마감 1 + 우리 부서가 보낸 협업 기한 1', mine === 3, `${mine}건`);

await page.getByRole('button', { name: '전체', exact: true }).click();
await page.waitForTimeout(400);
const all = await pills();
ok('전체 — 남의 일정까지 다 (일정 3 + 마감 2)', all === 5, `${all}건`);

await page.getByRole('button', { name: '부서별', exact: true }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '기획개발부', exact: true }).click();
await page.waitForTimeout(400);
const deptTexts = await page.locator('button[aria-label*="일정"] span[class*="border"]').allInnerTexts();
ok(
  '부서별 — 그 부서가 받은 협업 기한이 마감으로 뜬다',
  deptTexts.some((t) => t.includes('○○중')),
  deptTexts.join(' / ') || '없음',
);

/* ------------------------------------------------------------------ 정산 */

await page.getByRole('button', { name: '전체', exact: true }).click();
await page.waitForTimeout(300);
// 달 이름도 박아두지 않는다 — 위 d() 와 같은 이유다
const settle = await page.getByText(`${NOW.getMonth() + 1}월 출강 정산`).first().isVisible();
ok('이번 달 출강 정산 카드가 있다', settle);

/* ------------------------------------------------------------------ 폼 */

await page.getByRole('button', { name: '+ 일정' }).click();
await page.waitForTimeout(600);

ok('출강이 기본 — 학교 칸이 보인다', await page.locator('#sc-school').isVisible());
ok('출강 — 강의 타임 수 칸이 보인다', await page.locator('#sc-periods').isVisible());
ok('출강 — 제목 칸은 없다 (학교·프로그램으로 만든다)', (await page.locator('#sc-title').count()) === 0);

await page.getByRole('button', { name: '회의', exact: true }).click();
await page.waitForTimeout(300);
ok('회의 — 제목 칸으로 바뀐다', await page.locator('#sc-title').isVisible());
ok('회의 — 학교 칸은 사라진다', (await page.locator('#sc-school').count()) === 0);

await page.getByRole('button', { name: '출강', exact: true }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '저장' }).click();
await page.waitForTimeout(500);
ok(
  '학교를 안 적으면 한글로 막아준다',
  await page.getByText('학교(기관) 이름을 입력해주세요.').isVisible(),
);

await page.locator('#sc-school').fill('모아초등학교');
await page.locator('#sc-time').fill('14:00');
await page.locator('#sc-end').fill('10:00');
await page.getByRole('button', { name: '저장' }).click();
await page.waitForTimeout(500);
ok(
  '끝나는 시간이 시작보다 빠르면 막아준다',
  await page.getByText('끝나는 시간이 시작 시간보다 빨라요.').isVisible(),
);

await page.locator('#sc-app').selectOption('app0');
await page.waitForTimeout(300);
ok(
  '제목이 학교 · 프로그램으로 미리 보인다',
  await page.getByText('모아초등학교 · 제과제빵').first().isVisible(),
);

await browser.close();
console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
