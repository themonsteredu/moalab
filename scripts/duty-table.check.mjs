/**
 * 역할 표를 **실제로 눌러본다** (dev 서버 + playwright).
 *
 *   npm run dev            # 다른 창에 띄워두고
 *   node scripts/duty-table.check.mjs
 *
 * 계산만 재면 '숫자는 맞는데 눌러지지 않는' 걸 놓친다
 * (schedule-ui.check.mjs · chat-ui.check.mjs 와 같은 이유).
 *
 * 여기서 막고 싶은 것:
 *   · **자동저장이 실제로 안 나가는 것.** 이 화면은 저장 버튼이 없어서,
 *     안 나가면 원장은 다 적어놓고 나갔다가 통째로 잃는다
 *   · 타이핑하는 내내 저장이 나가는 것 (칸을 벗어날 때 한 번이어야 한다)
 *   · 한 글자도 안 적고 닫은 새 줄이 **'이름 없음'** 으로 목록에 남는 것
 *   · 양식을 골랐는데 열이 안 생기는 것
 *   · 표의 모양(열)까지 자동저장돼서 모두의 화면이 소리 없이 바뀌는 것
 *
 * Supabase REST 를 가로채 **메모리 안에서 진짜로 읽고 쓴다** — DB 없이 돈다.
 */
import { existsSync } from 'node:fs';

const BASE = process.env.MEASURE_BASE ?? 'http://localhost:3000';
const ME = '11111111-1111-4111-8111-111111111111';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright 가 없어요.  npm i -D playwright  후 다시 실행해주세요.');
  process.exit(1);
}

/* ------------------------------------------------- 메모리 DB (진짜로 쓴다) */

let seq = 0;
const uid = (p) => `${p}-${++seq}`;

const db = {
  members: [{ id: ME, name: '강양희', role: 'admin', active: true, pin: null, sort_order: 1, created_at: '' }],
  members_public: [{ id: ME, name: '강양희', role: 'admin', active: true, sort_order: 1, created_at: '' }],
  departments: [
    { id: 'd1', name: '영업마케팅부', head_id: ME, sort_order: 1, flow_order: 1, is_support: false, created_at: '' },
    { id: 'd2', name: '기획개발부', head_id: ME, sort_order: 2, flow_order: 2, is_support: false, created_at: '' },
  ],
  duty_groups: [
    { id: 'g1', dept_id: 'd1', name: '학교·기관 영업', sort_order: 1, created_at: '' },
    { id: 'g2', dept_id: 'd2', name: '수업자료 제작', sort_order: 1, created_at: '' },
  ],
  /* u1 = 줄이 쌓이는 일(표) · u2 = 결과물이 파일인 일(업로드만).
     **둘을 다 재야 한다** — 갈래에 따라 무엇이 펼쳐지는지가 이 화면의 전부다 */
  duties: [
    { id: 'u1', group_id: 'g1', name: '신규 기관 발굴', note: null, owner_id: ME, link: null, sort_order: 1, created_at: '' },
    /* 아무 규칙에도 안 걸리는 이름이라 **업로드만** 이 된다. 규칙에 걸리는 이름을 쓰면
       (`소개자료 관리` 처럼) 표 갈래로 잡혀서 이 절이 통째로 헛돈다 */
    { id: 'u2', group_id: 'g2', name: '외부 자문 회의록', note: null, owner_id: ME, link: null, sort_order: 2, created_at: '' },
  ],
  duty_helpers: [],
  duty_files: [],
  duty_columns: [
    { id: 'c1', duty_id: 'u1', name: '학교·기관', kind: 'text', options: null, sort_order: 1, created_at: '' },
    { id: 'c2', duty_id: 'u1', name: '진행 상태', kind: 'select', options: ['연락 전', '계약'], sort_order: 2, created_at: '' },
  ],
  duty_rows: [
    { id: 'r1', duty_id: 'u1', cells: { c1: '광주중학교', c2: '연락 전' }, sort_order: 1,
      updated_by: ME, created_at: '', updated_at: '2026-08-20T00:00:00Z' },
  ],
  apps: [], cost_sheets: [], activity_logs: [], drive_uploads: [],
};

/** 요청에 실린 `col=eq.값` 을 그대로 적용한다 */
const filtersOf = (url) => [...url.matchAll(/[?&]([a-z_]+)=eq\.([^&]+)/g)]
  .map(([, k, v]) => [k, decodeURIComponent(v)]);
const match = (row, fs) => fs.every(([k, v]) => String(row[k]) === v);

const writes = [];   // 어떤 요청이 언제 나갔는지 — '저장이 나갔나' 를 여기서 센다

async function handle(route) {
  const req = route.request();
  const url = req.url();
  const table = (url.match(/\/rest\/v1\/([a-z_]+)/) ?? [])[1] ?? '';
  const method = req.method();
  const fs = filtersOf(url);
  const one = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
  db[table] ??= [];
  let body = [];

  if (method === 'GET' || method === 'HEAD') {
    body = db[table].filter((r) => match(r, fs));
  } else if (method === 'POST') {
    const payload = JSON.parse(req.postData() || '[]');
    const list = (Array.isArray(payload) ? payload : [payload]).map((r) => ({
      id: r.id ?? uid(table), created_at: '', updated_at: '', ...r,
    }));
    db[table].push(...list);
    writes.push({ table, method, at: Date.now() });
    body = list;
  } else if (method === 'PATCH') {
    const patch = JSON.parse(req.postData() || '{}');
    body = db[table].filter((r) => match(r, fs));
    for (const r of body) Object.assign(r, patch);
    writes.push({ table, method, at: Date.now() });
  } else if (method === 'DELETE') {
    body = db[table].filter((r) => match(r, fs));
    db[table] = db[table].filter((r) => !match(r, fs));
    writes.push({ table, method, at: Date.now() });
  }

  return route.fulfill({
    status: 200,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'content-range': `0-${Math.max(0, body.length - 1)}/${body.length}`,
    },
    body: JSON.stringify(one ? body[0] ?? null : body),
  });
}

/* ------------------------------------------------------------------ 검사 */

let fail = 0;
const ok = (label, cond, extra = '') => {
  if (cond) console.log(`  ok  ${label}`);
  else {
    fail++;
    console.log(`FAIL  ${label}${extra ? `\n      ${extra}` : ''}`);
  }
};

const exe = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {});
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, acceptDownloads: true });
await ctx.addInitScript((s) => {
  window.localStorage.setItem('moalab.session.v1', JSON.stringify(s));
}, { id: ME, name: '강양희', role: 'admin', expiresAt: Date.now() + 30 * 864e5 });
await ctx.route('**/rest/v1/**', handle);

const page = await ctx.newPage();

console.log('\n[표가 있는 역할 — 줄 고치기가 자동저장된다]');
await page.goto(`${BASE}/roles/u1`, { waitUntil: 'commit' });
await page.waitForTimeout(2500);

ok('목록이 그려진다', await page.getByText('광주중학교').first().isVisible());
ok('상태 칩이 보인다', await page.getByText('연락 전', { exact: true }).first().isVisible());

await page.getByRole('button', { name: /광주중학교/ }).first().click();
await page.waitForTimeout(600);
const box = page.getByLabel('학교·기관');
ok('줄을 누르면 고치기 칸이 열린다', await box.isVisible());

const before = writes.filter((w) => w.method === 'PATCH').length;
await box.fill('광주중학교(본교)');
await page.waitForTimeout(700);
ok(
  '타이핑하는 동안에는 저장이 안 나간다',
  writes.filter((w) => w.method === 'PATCH').length === before,
  `PATCH ${writes.filter((w) => w.method === 'PATCH').length - before}건이 이미 나갔다`,
);

await box.blur();
await page.waitForTimeout(900);
ok('칸을 벗어나면 저장이 나간다', writes.filter((w) => w.method === 'PATCH').length === before + 1);
ok('DB 에 실제로 적혔다', db.duty_rows[0].cells.c1 === '광주중학교(본교)', JSON.stringify(db.duty_rows[0].cells));
ok('누가 고쳤는지 남는다', db.duty_rows[0].updated_by === ME);
ok('"저장됨" 이 화면에 뜬다', await page.getByText(/저장됨/).first().isVisible());

// 안 바뀐 칸을 지나가기만 해도 저장되면 '저장됨' 이 거짓말이 된다
const before2 = writes.filter((w) => w.method === 'PATCH').length;
await box.click();
await box.blur();
await page.waitForTimeout(600);
ok('안 바뀌었으면 저장을 안 보낸다', writes.filter((w) => w.method === 'PATCH').length === before2);

await page.getByRole('button', { name: '닫기', exact: true }).last().click();
await page.waitForTimeout(500);

console.log('\n[한 글자도 안 적은 새 줄은 조용히 걷어낸다]');
const rowsBefore = db.duty_rows.length;
await page.getByRole('button', { name: /줄 추가/ }).click();
await page.waitForTimeout(700);
ok('줄을 추가하면 바로 고치기 칸이 열린다', await page.getByLabel('학교·기관').isVisible());
ok('그 순간 DB 에 줄이 선다', db.duty_rows.length === rowsBefore + 1);
await page.getByRole('button', { name: '닫기', exact: true }).last().click();
await page.waitForTimeout(800);
ok("'이름 없음' 이 목록에 안 남는다", db.duty_rows.length === rowsBefore, `${db.duty_rows.length}줄`);

console.log('\n[여러 줄 한꺼번에 넣기]');
{
  /* 기관 발굴 목록은 광주·전남에 수백 곳이다. `+ 줄 추가` 를 수백 번 누르게 하면
     아무도 시작을 못 한다. 여기서 막고 싶은 것:
       · 미리보기 없이 여러 건이 한꺼번에 들어가는 것 (지우는 것도 여러 번이다)
       · 같은 기관이 두 줄로 늘어 어느 쪽에 연락 기록을 적었는지 모르게 되는 것
       · 줄마다 요청이 나가는 것 — 300줄이면 요청 300번이다 */
  await page.getByRole('button', { name: /여러 줄 넣기/ }).click();
  await page.waitForTimeout(600);
  const box2 = page.getByLabel('넣을 줄 붙여넣기');
  ok('붙여넣는 칸이 열린다', await box2.isVisible());
  ok('칸 순서를 알려준다', await page.getByText(/칸 순서 —/).first().isVisible());
  ok('붙여넣기 전에는 넣기 버튼이 안 눌린다',
    await page.getByRole('button', { name: '붙여넣어 주세요' }).isDisabled());

  // 세 줄 중 하나는 이미 있는 기관이다 — 건너뛰어야 한다
  await box2.fill('광주청소년문화의집\t계약\n북구청소년문화의집\n광주중학교(본교)');
  await page.waitForTimeout(500);
  ok('저장 전에 몇 줄이 들어갈지 보여준다', await page.getByText('2줄이 들어갑니다').isVisible());
  ok('이미 있는 것은 건너뛴다고 알려준다', await page.getByText('이미 있음 1').isVisible());

  const posts = writes.filter((w) => w.table === 'duty_rows' && w.method === 'POST').length;
  await page.getByRole('button', { name: '2줄 넣기' }).click();
  await page.waitForTimeout(1200);

  ok('요청 한 번으로 넣는다 (줄마다 보내지 않는다)',
    writes.filter((w) => w.table === 'duty_rows' && w.method === 'POST').length === posts + 1);
  ok('DB 에 두 줄이 늘었다', db.duty_rows.length === 3, `${db.duty_rows.length}줄`);
  ok('탭으로 가른 칸이 제자리에 들어간다',
    db.duty_rows[1].cells.c1 === '광주청소년문화의집' && db.duty_rows[1].cells.c2 === '계약',
    JSON.stringify(db.duty_rows[1].cells));
  ok('안 적은 칸은 아예 안 넣는다', db.duty_rows[2].cells.c2 === undefined,
    JSON.stringify(db.duty_rows[2].cells));
  ok('누가 넣었는지 남는다', db.duty_rows[2].updated_by === ME);
  ok('넣고 나면 목록에 바로 보인다',
    await page.getByText('북구청소년문화의집').first().isVisible());
}

console.log('\n[표의 모양(열)은 명시적 저장이다]');
await page.getByRole('button', { name: '표 칸 고치기' }).click();
await page.waitForTimeout(600);
const nameBox = page.getByLabel('1번째 칸 이름');
ok('칸 목록이 열린다', await nameBox.isVisible());
const colWrites = writes.filter((w) => w.table === 'duty_columns').length;
await nameBox.fill('학교 이름');
await nameBox.blur();
await page.waitForTimeout(800);
ok(
  '칸 이름은 벗어나도 저장이 안 나간다 (모두의 화면 모양이 바뀌는 일이다)',
  writes.filter((w) => w.table === 'duty_columns').length === colWrites,
);
await page.getByRole('button', { name: '저장', exact: true }).click();
await page.waitForTimeout(900);
ok('저장을 눌러야 바뀐다', db.duty_columns.find((c) => c.id === 'c1').name === '학교 이름');

console.log('\n[업로드만 하면 되는 역할 — 자료가 먼저다]');
await page.goto(`${BASE}/roles/u2`, { waitUntil: 'commit' });
await page.waitForTimeout(2500);
ok('업로드만 하면 되는 일이라고 알려준다', await page.getByText(/파일 한 벌/).first().isVisible());
{
  // **자료가 목록보다 위에 있어야 한다** — 주인공이 갈래마다 다르다
  const y = (t) => page.getByText(t, { exact: true }).first().evaluate((el) => el.getBoundingClientRect().top);
  ok('만든 자료가 목록보다 위다', (await y('만든 자료')) < (await y('목록')));
}
ok('표는 접힌 채로 시작한다', !(await page.getByText('학교·기관 목록').first().isVisible()));

await page.getByRole('button', { name: /목록/ }).first().click();
await page.waitForTimeout(600);
ok('펼치면 양식 고르는 자리가 있다', await page.getByText('학교·기관 목록').first().isVisible());
await page.getByRole('button', { name: /재료·교구 재고/ }).click();
await page.waitForTimeout(900);
ok('고른 양식의 열이 실제로 만들어진다', db.duty_columns.filter((c) => c.duty_id === 'u2').length === 10,
  `${db.duty_columns.filter((c) => c.duty_id === 'u2').length}칸`);
ok('첫 칸이 제목이 될 칸이다', db.duty_columns.find((c) => c.duty_id === 'u2' && c.sort_order === 1)?.name === '품목');

console.log('\n[인쇄·엑셀로 받기]');
await page.goto(`${BASE}/roles/u1`, { waitUntil: 'commit' });
await page.waitForTimeout(2500);
{
  const link = page.getByRole('link', { name: /인쇄/ });
  ok('인쇄 버튼이 있다', await link.isVisible());
  ok('새 창으로 연다 (보던 목록을 잃지 않게)', (await link.getAttribute('target')) === '_blank');
  ok('그 역할의 인쇄 주소로 간다', (await link.getAttribute('href')) === '/roles/u1'.replace('/roles/', '/print/duty/'));

  /* ⚠️ **CSV 는 서버가 내려준다.** 브라우저에서 Blob 으로 만들면 크로미움이
     파일 이름에 한글이 있을 때 그 이름을 통째로 버리고 `download`(확장자도 없이)로
     저장한다 — 원장님이 엑셀에서 못 여는 파일을 받는다. 실제로 여기서 잡아 고쳤다.
     헤더를 짓는 계산(`csvDisposition`)과 CSV 내용은 duty-table.test.mjs 가 지킨다.
     여기서는 **화면이 그 길로 이어지는지**만 본다 — 이 점검은 가짜 DB 로 도는데
     라우트는 서버에서 진짜 DB 를 보므로 여기서 끝까지 부를 수가 없다 */
  const csvLink = page.getByRole('link', { name: '엑셀(CSV)로 받기' });
  ok('엑셀로 받기가 링크다 (Blob 이 아니라 서버가 내려준다)', await csvLink.isVisible());
  ok('그 역할의 CSV 주소로 간다', (await csvLink.getAttribute('href')) === '/api/duty/csv?dutyId=u1');
  ok('새 창을 안 연다 (내려받기라 화면이 그대로 있어야 한다)', (await csvLink.getAttribute('target')) === null);
}

console.log('\n[인쇄 화면]');
await page.goto(`${BASE}/print/duty/u1`, { waitUntil: 'commit' });
await page.waitForTimeout(2500);
{
  ok('역할 이름이 제목이다', await page.getByRole('heading', { name: '신규 기관 발굴' }).isVisible());
  ok('부서 › 중분류가 적힌다', await page.getByText('영업마케팅부 › 학교·기관 영업').isVisible());
  const cells = await page.locator('table tbody tr td').allInnerTexts();
  ok('표로 그린다', cells.includes('광주중학교(본교)'), cells.slice(0, 6).join(' | '));
  ok('번호가 붙는다 (종이에서 줄을 세려면 필요하다)', cells[0] === '1');
  ok('가로 인쇄로 정해둔다', (await page.locator('style').allInnerTexts()).join('').includes('A4 landscape'));
  ok('조작 줄은 인쇄에서 빠진다', await page.locator('.no-print').first().isVisible());
}

console.log('\n[폰 375px]');
await page.goto(`${BASE}/roles/u1`, { waitUntil: 'commit' });
await page.waitForTimeout(2000);
const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
ok('가로 스크롤이 없다', !wide);
const small = await page.evaluate(() =>
  [...document.querySelectorAll('button, a, select, input')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const lab = el.closest('label');
      if (lab && lab.getBoundingClientRect().height >= 44) return false;
      return r.height < 44;
    })
    .map((el) => (el.textContent || el.getAttribute('aria-label') || '?').trim().slice(0, 14)));
ok('44px 미만 탭 대상이 없다', small.length === 0, small.join(' · '));

await browser.close();
console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
