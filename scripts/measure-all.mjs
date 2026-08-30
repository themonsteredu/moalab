/**
 * 열 화면을 **실제 데이터 규모 그대로** 그려놓고 재본다.
 *
 *   npm run dev                 (다른 창에서 띄워두고)
 *   node scripts/measure-all.mjs [주소]
 *
 * `measure.mjs` 는 진짜 Supabase 를 보기 때문에 개발 환경에서는 화면이 텅 빈다.
 * 여기서는 REST 응답을 가로채 **원장님 계정과 같은 규모**(프로그램 33 · 주제 16 ·
 * 원가표 10 · 지적 14 · 업무 6 · 공지 1 · 일정 4 · 지출 1, 갤러리·모의수업·강사양성 0)
 * 로 물려서 그린다. 짐작이 아니라 실측이라 "무엇을 줄일까" 를 여기서 정한다.
 *
 * 재는 것:
 *   · 세로 길이 (폰 한 화면 = 812px 기준으로 몇 화면인지)
 *   · **첫 내용까지** — 조작 줄(헤더·탭·칩·토글·요약카드)이 먹는 높이.
 *     이게 크면 "들어갔는데 정작 볼 게 안 보인다" 가 된다. 간소화의 과녁이다
 *   · 가로 스크롤 (나오면 실패다)
 *   · 44px 미만 탭 대상
 *
 * playwright 는 이 스크립트에만 필요해서 package.json 에 안 넣었다:
 *   npm i -D playwright
 */
import { existsSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const PHONE = { width: 375, height: 812 };
const ROLE = process.env.MEASURE_ROLE ?? 'admin';

const ME = '00000000-0000-0000-0000-000000000001';
const M = (n) => `00000000-0000-0000-0000-00000000000${n}`;
const TODAY = '2026-08-21';

/* ---------------------------------------------------------------- 가짜 데이터
   숫자는 실제 DB 를 세어서 맞췄다. 규모가 다르면 재는 의미가 없다. */

const MEMBERS = [
  { id: ME, name: '강양희', role: 'admin', active: true, sort_order: 0, pin: null },
  { id: M(2), name: '이서은', role: 'teacher', active: true, sort_order: 1, pin: null },
  { id: M(3), name: '주은서', role: 'teacher', active: true, sort_order: 2, pin: null },
  { id: M(4), name: '강지연', role: 'teacher', active: true, sort_order: 3, pin: null },
  { id: M(5), name: '윤창진', role: 'teacher', active: true, sort_order: 4, pin: null },
];

// 주제 16개 — 실제로 이만큼 있다. 트리 머리글이 16줄이라는 뜻이다
const TOPIC_NAMES = [
  'AI 그림', 'AI 음악', '업사이클링', '드론', '메타버스', '3D 프린팅',
  '코딩', '로봇', '환경', '진로', '디지털 시민', '데이터',
  '영상 제작', '게임 제작', '생성형 AI', '문화·역사',
];
const TOPICS = TOPIC_NAMES.map((name, i) => ({ id: `tp${i}`, name, sort_order: i, created_at: '2026-07-01T00:00:00Z' }));

// 프로그램 33개를 16주제에 흩는다 (2개씩 + 남는 것)
const APPS = Array.from({ length: 33 }, (_, i) => ({
  id: `app${i}`,
  title_ko: `${TOPIC_NAMES[i % 16]} 수업 ${Math.floor(i / 16) + 1}`,
  slug: `app-${i}`,
  topic_id: i < 30 ? `tp${i % 16}` : null,
  topic: null,
  grade: '초등 4~6학년',
  status: ['pending', 'fixing', 'done', 'pending'][i % 4],
  creator_id: MEMBERS[i % 5].id,
  deploy_url: 'https://example.com',
  repo_url: null,
  due_date: i % 3 === 0 ? '2026-08-28' : null,
  archived: false,
  plan_body: null,
  created_at: '2026-07-10T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
}));

const ROUNDS = APPS.map((a, i) => ({ id: `r${i}`, app_id: a.id, number: 1, note: null, created_at: '2026-07-11T00:00:00Z' }));

// 지적 14건 — 앞쪽 프로그램들에 몰려 있다
const FINDINGS = Array.from({ length: 14 }, (_, i) => ({
  id: `f${i}`,
  round_id: `r${i % 7}`,
  app_id: `app${i % 7}`,
  author_id: MEMBERS[i % 5].id,
  body: '버튼을 눌러도 다음 화면으로 안 넘어가요.',
  status: ['open', 'fixed', 'closed', 'recheck'][i % 4],
  created_at: '2026-08-10T00:00:00Z',
  updated_at: '2026-08-10T00:00:00Z',
}));

const REVIEWERS = APPS.slice(0, 20).flatMap((a, i) => [
  { app_id: a.id, member_id: M(2), created_at: '2026-07-11T00:00:00Z' },
  { app_id: a.id, member_id: M(3), created_at: '2026-07-11T00:00:00Z' },
]);

const TASKS = [
  ['강사 관리 메뉴얼 만들기', null, null, 'todo'],
  ['팜플렛 제작', M(3), '2026-08-19', 'todo'],
  ['강사 계약서 준비하기', M(2), TODAY, 'todo'],
  ['사이트 구축', M(4), null, 'doing'],
  ['블로그 포스팅', null, null, 'todo'],
  ['8월 지출 정리', ME, '2026-08-20', 'done'],
].map(([title, a, d, st], i) => ({
  id: `t${i}`, title, detail: null, assignee_id: a, due_date: d, state: st,
  app_id: null, batch_id: 'b1', batch_title: '말로 넣기 — 8월 21일 (금)',
  created_by: ME, sort_order: 0, reminded_on: null,
  done_at: st === 'done' ? '2026-08-20T00:00:00Z' : null,
  created_at: '2026-08-21T00:00:00Z', updated_at: '2026-08-21T00:00:00Z',
}));

const NOTICES = [{
  id: 'n1', title: '8월 정기 회의 안내', body: '8월 25일 오전 10시에 모두 모입니다.',
  pinned: true, author_id: ME, created_at: '2026-08-18T00:00:00Z', updated_at: '2026-08-18T00:00:00Z',
}];

const SCHEDULES = Array.from({ length: 4 }, (_, i) => ({
  id: `s${i}`, title: ['팀 회의', 'A초 방문', '재료 입고', '모의수업'][i],
  date: ['2026-08-25', '2026-08-27', '2026-08-28', '2026-09-01'][i],
  kind: 'meeting', memo: null, app_id: null, created_at: '2026-08-01T00:00:00Z',
}));

const EXPENSES = [{
  id: 'e1', spent_on: '2026-08-18', amount: 45000, category: '재료비',
  purpose: '색종이·풀 구매', member_id: ME, app_id: null, school: null, memo: null,
  approved: false, created_at: '2026-08-18T00:00:00Z', updated_at: '2026-08-18T00:00:00Z',
}];

// 역할분장 — 부서 5 · 중분류 15 · 역할 48 · 담당자 0 (실제와 같다)
const DEPTS = ['인사관리부', '경영지원부', '교육기획부', '영업마케팅부', '연구개발부']
  .map((name, i) => ({ id: `d${i}`, name, head_id: null, sort_order: i, created_at: '2026-08-01T00:00:00Z' }));
const DUTY_GROUPS = [
  '회계·정산', '문서·총무', '채용·교육', '평가·보상', '기획', '홍보', '제휴', '수업설계',
  '교재', '검수', '영업', '고객관리', '연구', '개발', '품질',
].map((name, i) => ({ id: `g${i}`, dept_id: `d${Math.floor(i / 3)}`, name, sort_order: i % 3, created_at: '2026-08-01T00:00:00Z' }));
const DUTY_NAMES = ['지출결의서 확인', '영수증 증빙 보관', '세금계산서·매출', '계약 행정문서 관리',
  '총무 자산관리', '계정 권한 관리', '개인정보 자료보안', '계약서·공문 보관'];
const DUTIES = Array.from({ length: 48 }, (_, i) => ({
  id: `u${i}`, group_id: `g${i % 15}`, name: DUTY_NAMES[i % 8],
  note: '올라온 지출을 확인한다', owner_id: null, sort_order: i, created_at: '2026-08-01T00:00:00Z',
}));

const COST_SHEETS = Array.from({ length: 10 }, (_, i) => ({
  id: `cs${i}`, title: `${TOPIC_NAMES[i]} 원가표`, app_id: `app${i}`,
  headcount: 20, price: 15000, memo: null,
  created_at: '2026-07-20T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
}));

/** 테이블 이름으로 갈라서 돌려준다. 없는 표는 빈 배열 (갤러리·모의수업·강사양성이 그렇다) */
function rowsFor(url) {
  const table = (url.match(/\/rest\/v1\/([a-z_]+)/) ?? [])[1] ?? '';
  const map = {
    members: MEMBERS, members_public: MEMBERS,
    apps: APPS, topics: TOPICS, rounds: ROUNDS, findings: FINDINGS,
    app_reviewers: REVIEWERS, tasks: TASKS, notices: NOTICES,
    schedules: SCHEDULES, expenses: EXPENSES, cost_sheets: COST_SHEETS,
    departments: DEPTS, duty_groups: DUTY_GROUPS, duties: DUTIES, duty_helpers: [],
  };
  return map[table] ?? [];
}

/* -------------------------------------------------------------------- 화면 */

const PAGES = [
  ['/home', '홈'],
  ['/notice', '공지사항'],
  ['/task', '업무'],
  ['/apps', '프로그램계획'],
  ['/verify', '프로그램검증'],
  ['/roles', '역할분장'],
  ['/mock', '모의수업'],
  ['/training', '강사양성'],
  ['/cost', '원가'],
  ['/expense', '지출결의서'],
  ['/gallery', '갤러리'],
  ['/schedule', '일정'],
  ['/admin', '관리'],
];

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright 가 없어요.  npm i -D playwright  후 다시 실행해주세요.');
  process.exit(1);
}

const exe = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {});
const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 });

/* 로그인 가드를 지나가게 세션을 심는다.
   ※ expiresAt 이 없으면 전부 로그인 화면으로 튕겨서 '전부 812px' 이라는 거짓 결과가 된다 */
await ctx.addInitScript((s) => {
  window.localStorage.setItem('moalab.session.v1', JSON.stringify(s));
}, { id: ME, name: '강양희', role: ROLE, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 });

await ctx.route('**/rest/v1/**', (route) =>
  route.fulfill({
    status: 200,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    body: JSON.stringify(rowsFor(route.request().url())),
  }),
);

const page = await ctx.newPage();
const rows = [];

for (const [path, label] of PAGES) {
  try {
    await page.goto(BASE + path, { waitUntil: 'commit', timeout: 25000 });
    await page.waitForTimeout(4000);
  } catch (e) {
    rows.push({ label, err: String(e).split('\n')[0].slice(0, 60) });
    continue;
  }
  if (new URL(page.url()).pathname.startsWith('/login')) {
    rows.push({ label, err: '로그인 화면으로 튕김' });
    continue;
  }

  rows.push({
    label,
    ...(await page.evaluate(() => {
      const doc = document.documentElement;

      /* '첫 내용' = 본문에서 처음 나오는 목록 줄. 목록이 없는 화면(관리 등)은
         마지막 카드를 쓴다. 그 위쪽이 전부 조작 줄이다 */
      const main = document.querySelector('main') ?? document.body;
      const first =
        main.querySelector('ul > li, ol > li, table tbody tr') ??
        main.querySelector('.card:not(:first-child)');
      const top = first ? Math.round(first.getBoundingClientRect().top + window.scrollY) : 0;

      const controls = [...main.querySelectorAll('button, select, a[href], input')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.top + window.scrollY < top;
      }).length;

      const small = [...document.querySelectorAll('button, a, select, input, [role="button"]')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          if (el.closest('[aria-hidden="true"]')) return false;
          /* 체크박스는 20px 이어도 감싼 <label> 줄 전체가 눌린다 —
             실제 탭 대상은 그 줄이다. 이걸 안 걸러내면 멀쩡한 화면이
             위반으로 잡혀서 진짜 위반이 묻힌다 */
          const lab = el.closest('label');
          if (lab && lab.getBoundingClientRect().height >= 44) return false;
          return r.height < 44;
        })
        .map((el) => (el.textContent || el.getAttribute('aria-label') || '?').trim().slice(0, 14));

      return {
        h: doc.scrollHeight,
        top,
        controls,
        overflow: doc.scrollWidth > window.innerWidth,
        small: [...new Set(small)],
      };
    })),
  });
}

/* -------------------------------------------------------------------- 결과 */

console.log(`폰 ${PHONE.width}×${PHONE.height} · ${ROLE === 'admin' ? '원장' : '강사'} · 실제 데이터 규모\n`);
console.log('화면            세로     화면수  첫내용까지  그 위 조작  가로  작은탭');
console.log('─'.repeat(70));

for (const r of rows) {
  if (r.err) {
    console.log(`${r.label.padEnd(14)} ${r.err}`);
    continue;
  }
  const screens = (r.h / PHONE.height).toFixed(1);
  const mark = r.top >= 400 ? ' ←' : '';
  console.log(
    `${r.label.padEnd(14)} ${String(r.h).padStart(5)}px ${String(screens).padStart(6)}  ` +
    `${String(r.top).padStart(7)}px ${String(r.controls).padStart(9)}개  ` +
    `${(r.overflow ? 'X' : '·').padStart(3)}  ${String(r.small.length).padStart(4)}${mark}`,
  );
}

const bad = rows.filter((r) => !r.err && r.small.length > 0);
if (bad.length) {
  console.log('\n44px 미만 탭 대상:');
  for (const r of bad) console.log(`  ${r.label} — ${r.small.join(', ')}`);
}
const wide = rows.filter((r) => !r.err && r.overflow);
if (wide.length) console.log(`\n가로 스크롤: ${wide.map((r) => r.label).join(', ')}`);

console.log('\n← 는 첫 내용까지 400px 이상 (한 화면의 절반을 조작 줄이 먹는다)');

await browser.close();
