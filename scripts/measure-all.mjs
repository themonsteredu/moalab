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
const SHOT_DIR = process.env.MEASURE_SHOT ?? '';

const ME = '00000000-0000-0000-0000-000000000001';
const M = (n) => `00000000-0000-0000-0000-00000000000${n}`;
/**
 * ⚠️ **날짜를 박아두지 않는다.** 달력은 늘 이번 달로 열리므로 고정 날짜를 쓰면
 * 그 달이 지나는 순간 일정·업무·지출이 통째로 안 뜨고 **텅 빈 화면을 재게 된다** —
 * 숫자는 짧아지는데 그건 좋아진 게 아니다 (`schedule-ui.check.mjs` 도 같은 이유로 고쳤다).
 * `off` 는 달 넘김 (1 이면 다음 달).
 */
const NOW = new Date();
const d = (day, off = 0) => {
  const x = new Date(NOW.getFullYear(), NOW.getMonth() + off, day);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const TODAY = d(NOW.getDate());

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
  due_date: i % 3 === 0 ? d(28) : null,
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
  ['팜플렛 제작', M(3), d(19), 'todo'],
  ['강사 계약서 준비하기', M(2), TODAY, 'todo'],
  ['사이트 구축', M(4), null, 'doing'],
  ['블로그 포스팅', null, null, 'todo'],
  ['8월 지출 정리', ME, d(20), 'done'],
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

/* 일정 — 출강 3 · 회의 1. 출강은 학교·프로그램·인원·타임까지 채워서 카드가 실제 높이로 그려지게 한다 */
const SCHEDULES = [
  { id: 's0', kind: 'meeting', title: '팀 회의', date: d(25), start_time: '10:00:00', end_time: null,
    place: '사무실', memo: null, app_id: null, school: null, headcount: null, periods: null },
  { id: 's1', kind: 'class', title: '모아초등학교 · AI 그림 수업 1', date: d(27), start_time: '09:00:00',
    end_time: '12:00:00', place: '3층 과학실', memo: null, app_id: 'app0', school: '모아초등학교', headcount: 24, periods: 3 },
  { id: 's2', kind: 'class', title: '한빛중학교 · 드론 수업 1', date: d(28), start_time: '13:00:00',
    end_time: null, place: null, memo: null, app_id: 'app3', school: '한빛중학교', headcount: 18, periods: 2 },
  { id: 's3', kind: 'class', title: '새샘초등학교 · 코딩 수업 1', date: d(1, 1), start_time: '10:00:00',
    end_time: null, place: null, memo: null, app_id: 'app6', school: '새샘초등학교', headcount: 20, periods: null },
].map((s) => ({ ...s, created_at: '2026-08-01T00:00:00Z' }));

const SCHEDULE_MEMBERS = [
  { schedule_id: 's0', member_id: ME }, { schedule_id: 's0', member_id: M(2) },
  { schedule_id: 's1', member_id: M(2) }, { schedule_id: 's1', member_id: M(3) },
  { schedule_id: 's2', member_id: M(4) },
  { schedule_id: 's3', member_id: M(2) },
];

const EXPENSES = [{
  id: 'e1', spent_on: d(18), amount: 45000, category: '재료비',
  purpose: '색종이·풀 구매', member_id: ME, app_id: null, school: null, memo: null,
  approved: false, created_at: '2026-08-18T00:00:00Z', updated_at: '2026-08-18T00:00:00Z',
}];

// 역할분장 — 부서 5 · 중분류 15 · 역할 48 · 담당자 0 (실제와 같다)
const DEPTS = ['인사관리부', '경영지원부', '교육기획부', '영업마케팅부', '연구개발부']
  /* 실제와 같게 **부서마다 팀장이 있다** (다섯 명이 한 부서씩 맡고 있다).
     팀장이 없으면 `내 부서` 가 늘 빈 화면이라 그 화면을 한 번도 안 그려보게 된다 */
  .map((name, i) => ({
    id: `d${i}`, name, head_id: i === 0 ? ME : M(((i % 4) + 2)),
    sort_order: i, created_at: '2026-08-01T00:00:00Z',
  }));
const DUTY_GROUPS = [
  '회계·정산', '문서·총무', '채용·교육', '평가·보상', '기획', '홍보', '제휴', '수업설계',
  '교재', '검수', '영업', '고객관리', '연구', '개발', '품질',
].map((name, i) => ({ id: `g${i}`, dept_id: `d${Math.floor(i / 3)}`, name, sort_order: i % 3, created_at: '2026-08-01T00:00:00Z' }));
const DUTY_NAMES = ['지출결의서 확인', '영수증 증빙 보관', '세금계산서·매출', '계약 행정문서 관리',
  '총무 자산관리', '계정 권한 관리', '개인정보 자료보안', '계약서·공문 보관'];
/* 주담당을 여덟 개는 나에게 준다 — 실제 원장 계정이 그렇다(주담당 8).
   예전엔 전부 owner_id: null 이라 `내 역할` 이 **늘 빈 화면**이었고, 그래서
   그 목록의 줄이 눌리지 않는 것(자료를 못 올린다)을 측정에서 한 번도 못 잡았다 */
const DUTIES = Array.from({ length: 48 }, (_, i) => ({
  id: `u${i}`, group_id: `g${i % 15}`, name: DUTY_NAMES[i % 8],
  note: '올라온 지출을 확인한다', owner_id: i % 6 === 0 ? ME : null,
  sort_order: i, created_at: '2026-08-01T00:00:00Z',
}));
/* 표가 주인공인 역할 하나 — 원장이 예로 든 '학교기관관리' 다.
   위 여덟 이름은 전부 앱에 자리가 있는 일(지출·계약서…)이라 표가 접힌 채로 열려서
   그것만 재면 '늘 한 화면' 이라는 거짓 결과가 나온다 */
DUTIES.push({
  id: 'u48', group_id: 'g0', name: '신규 기관 발굴',
  note: '교육청·진로교육원·기관 담당자 접촉', owner_id: ME, link: null,
  sort_order: 48, created_at: '2026-08-01T00:00:00Z',
});

/* 역할에 붙는 표 — `학교·기관 목록` 양식 그대로. u0(내가 주담당인 역할)에 매단다.
   ⚠️ **줄이 있는 상태로 재야 한다.** 빈 표는 늘 짧아서 '한 화면' 이라는 거짓 결과가 나온다 */
const DUTY_COLUMNS = [
  ['학교·기관', 'text', null], ['담당 선생님', 'text', null], ['연락처', 'text', null],
  ['진행 상태', 'select', ['연락 전', '연락함', '제안서 보냄', '미팅', '계약', '보류']],
  ['다음 할 일', 'text', null], ['다음 연락일', 'date', null], ['메모', 'text', null],
].map(([name, kind, options], i) => ({
  id: `dc${i}`, duty_id: 'u48', name, kind, options, sort_order: i + 1,
  created_at: '2026-08-01T00:00:00Z',
}));
const DUTY_STATES = ['연락 전', '연락함', '제안서 보냄', '미팅', '계약'];
const DUTY_ROWS = Array.from({ length: 14 }, (_, i) => ({
  id: `dr${i}`, duty_id: 'u48', sort_order: i, updated_by: ME,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-20T00:00:00Z',
  cells: {
    dc0: `${['광주', '무등', '수완', '첨단', '봉선'][i % 5]}${i % 2 ? '중학교' : '초등학교'}`,
    dc1: `${['김', '이', '박', '최'][i % 4]}선생님`,
    dc2: `010-0000-00${String(i).padStart(2, '0')}`,
    dc3: DUTY_STATES[i % 5],
    dc4: '제안서 보내고 연락하기',
    /* 다음 연락일 — 지난 것·오늘·아직 안 온 것을 섞는다. 전부 다음 달로 두면
       영업 한 판의 '오늘 연락할 곳' 이 늘 비어서 그 목록의 높이를 영영 못 잰다 */
    dc5: i % 3 === 0 ? d(NOW.getDate() - 2) : i % 3 === 1 ? TODAY : d(10, 1),
    dc6: i % 3 === 0 ? '작년에 한 번 나갔던 곳' : null,
  },
}));

/* 부서 협업 요청 — 기한이 달력에 마감으로 얹힌다 (①→② 연결) */
const COLLABS = [
  { id: 'cr1', from_dept_id: 'd3', to_dept_id: 'd2', project: '○○중 3학년 4차시',
    body: '계약이 확정됐어요. 9/20까지 교안이 필요합니다.', due_date: d(30),
    priority: 'high', status: 'requested' },
  { id: 'cr2', from_dept_id: 'd2', to_dept_id: 'd4', project: '드론 교구 확인',
    body: '드론 배터리 수량 확인 부탁드려요.', due_date: d(3, 1),
    priority: 'normal', status: 'doing' },
].map((r) => ({ ...r, created_by: ME, accepted_by: null, done_at: null,
  created_at: '2026-08-20T00:00:00Z', updated_at: '2026-08-20T00:00:00Z' }));

const COST_SHEETS = Array.from({ length: 10 }, (_, i) => ({
  id: `cs${i}`, title: `${TOPIC_NAMES[i]} 원가표`, app_id: `app${i}`,
  headcount: 20, price: 15000, memo: null,
  created_at: '2026-07-20T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
}));

/* 제안서 화면이 읽는 것 — 강의계획서 목표 · 샘플 사진 · 회사 정보.
   회사 정보는 **저장된 상태**로 잰다 (첫 한 번만 펼쳐지는 칸이라 그게 평소 모습이다) */
const LESSON_PLANS = [{ app_id: 'app0', category: 'AI', goal: '학생이 직접 AI 로 그림을 만들어 본다',
  intro: null, dev_title: '', work_title: '', closing: null, tools: null, etc: null, logo_url: null,
  updated_by: ME, updated_at: '2026-08-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z' }];
const APP_SAMPLES = [0, 1, 2].map((i) => ({ id: `sp${i}`, app_id: 'app0', url: `/icon-192.png?${i}`, caption: null,
  sort_order: i, created_at: '2026-08-01T00:00:00Z' }));
const SETTINGS = [{ key: 'org', value: { name: '모아킷', ceo: '강양희', tel: '010-0000-0000', email: 'moakit@example.com',
  address: '광주광역시', bizNo: '' }, updated_by: ME, updated_at: '2026-08-01T00:00:00Z' }];

/** 테이블 이름으로 갈라서 돌려준다. 없는 표는 빈 배열 (갤러리·모의수업·강사양성이 그렇다) */
function rowsFor(url) {
  const table = (url.match(/\/rest\/v1\/([a-z_]+)/) ?? [])[1] ?? '';
  const map = {
    members: MEMBERS, members_public: MEMBERS,
    apps: APPS, topics: TOPICS, rounds: ROUNDS, findings: FINDINGS,
    app_reviewers: REVIEWERS, tasks: TASKS, notices: NOTICES,
    schedules: SCHEDULES, schedule_members: SCHEDULE_MEMBERS,
    expenses: EXPENSES, cost_sheets: COST_SHEETS,
    departments: DEPTS, duty_groups: DUTY_GROUPS, duties: DUTIES, duty_helpers: [],
    duty_files: [], duty_columns: DUTY_COLUMNS, duty_rows: DUTY_ROWS,
    collab_requests: COLLABS, collab_comments: [],
    lesson_plans: LESSON_PLANS, app_samples: APP_SAMPLES, settings: SETTINGS,
  };
  let rows = map[table] ?? [];
  /* `id=eq.x` · `duty_id=eq.x` 를 실제로 걸러준다.
     ⚠️ 안 거르면 `/roles/[dutyId]` 처럼 한 줄을 집는 화면이 48줄을 통째로 받아
     `maybeSingle()` 에서 죽는다 — 그러면 그 화면은 영영 못 잰다 */
  for (const [, key, val] of url.matchAll(/[?&]([a-z_]+)=eq\.([^&]+)/g)) {
    rows = rows.filter((r) => String(r[key]) === decodeURIComponent(val));
  }
  return rows;
}

/* -------------------------------------------------------------------- 화면 */

const PAGES = [
  ['/home', '홈'],
  ['/mywork', '내 업무'],
  ['/notice', '공지사항'],
  ['/task', '업무배분'],
  ['/collab', '부서협업'],
  ['/apps', '프로그램계획'],
  ['/verify', '프로그램검증'],
  ['/proposal', '제안서·견적서'],
  ['/roles', '부서업무'],
  ['/roles/u48', '역할 한 장(표)'],
  ['/mock', '모의수업'],
  ['/training', '강사양성'],
  ['/money', '돈'],
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

await ctx.route('**/rest/v1/**', (route) => {
  const rows = rowsFor(route.request().url());
  // single()·maybeSingle() 은 배열이 아니라 객체를 기대한다 (Accept 헤더로 알 수 있다)
  const one = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object');
  return route.fulfill({
    status: 200,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    body: JSON.stringify(one ? rows[0] ?? null : rows),
  });
});

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

  /* MEASURE_SHOT=<폴더> 를 주면 화면을 통째로 찍어둔다 — 숫자만 보면
     '짧아졌는데 망가진' 경우를 놓친다 */
  if (SHOT_DIR) {
    await page.screenshot({ path: `${SHOT_DIR}/${path.replace(/\//g, '') || 'root'}.png`, fullPage: true });
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
