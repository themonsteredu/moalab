/**
 * 제안서를 **실제로 눌러본다** (dev 서버 + playwright).
 *
 *   npm run dev            # 다른 창에 띄워두고
 *   node scripts/proposal.check.mjs
 *
 * 계산(proposal.test.mjs)과 한글 파일(hwpx.test.mjs)은 따로 재지만, 그것만으로는
 * '숫자는 맞는데 눌러지지 않는' 걸 놓친다 (duty-table.check.mjs 와 같은 이유).
 *
 * 여기서 막고 싶은 것:
 *   · 프로그램을 골랐는데 학년·가격이 안 따라오는 것 / 보관된 프로그램이 목록에 섞이는 것
 *   · 가격·차시·인원을 고쳤는데 합계가 안 바뀌는 것
 *   · 폰에서 전화를 받고 돌아왔더니 쓰던 것이 날아가는 것 (초안)
 *   · 기관 표에서 `이 기관에 제안서 만들기` 로 왔는데 받는 곳이 안 채워지는 것
 *   · `제안서 보냄으로 표시` 가 그 줄이 아닌 다른 줄을 고치는 것
 *   · 인쇄 화면이 프로그램 수만큼 쪽을 안 만드는 것 / 375px 에서 가로로 새는 것
 *   · 한글 파일이 한글이 거부하는 모양(mimetype 이 첫 항목·무압축이 아님)으로 나가는 것
 *
 * Supabase REST 를 가로채 **메모리 안에서 진짜로 읽고 쓴다** — DB 없이 돈다.
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';

const BASE = process.env.MEASURE_BASE ?? 'http://localhost:3000';
const ME = '11111111-1111-4111-8111-111111111111';
const SHOT_DIR = process.env.MEASURE_SHOT ?? '';

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

const app = (id, title_ko, extra) => ({
  id, title_ko, slug: id, url: null, purpose: null, target_grade: null, topic_id: null, topic: null,
  creator_id: ME, due_date: null, current_round: 1, status: 'pending', archived: false, plan_body: null,
  created_at: '', ...extra,
});

const db = {
  members: [{ id: ME, name: '강양희', role: 'admin', active: true, pin: null, sort_order: 1, created_at: '' }],
  members_public: [{ id: ME, name: '강양희', role: 'admin', active: true, sort_order: 1, created_at: '' }],
  topics: [
    { id: 'tp1', name: 'AI 그림', sort_order: 0, created_at: '' },
    { id: 'tp2', name: '드론', sort_order: 1, created_at: '' },
  ],
  apps: [
    /* 학년·판매가·목표·샘플이 다 있는 것 — 고르면 그대로 따라와야 한다 */
    app('app0', 'AI 그림 수업', { purpose: 'AI 로 그림을 만들어 본다', target_grade: '초 4~6', topic_id: 'tp1' }),
    /* 아무것도 없는 것 — 가격은 '협의' 로 나가야 한다 */
    app('app1', '드론 코딩', { topic_id: 'tp2' }),
    /* 보관된 것 — 목록에 섞이면 안 된다 */
    app('app2', '보관된 프로그램', { archived: true }),
  ],
  lesson_plans: [{
    app_id: 'app0', category: 'AI', goal: '학생이 직접 그림을 만들어 본다', intro: null, dev_title: '', work_title: '',
    closing: null, tools: null, etc: null, logo_url: null, updated_by: ME, updated_at: '', created_at: '',
  }],
  cost_sheets: [{ id: 'cs0', app_id: 'app0', title: 'AI 그림 원가표', headcount: 20, sale_price: 15000, updated_at: '', created_at: '' }],
  app_samples: [
    { id: 'sp0', app_id: 'app0', url: '/icon-192.png', caption: null, sort_order: 0, created_at: '' },
    { id: 'sp1', app_id: 'app0', url: '/icon-512.png', caption: null, sort_order: 1, created_at: '' },
  ],
  settings: [],
  departments: [{ id: 'd1', name: '영업마케팅부', head_id: ME, sort_order: 1, flow_order: 1, is_support: false, created_at: '' }],
  duty_groups: [{ id: 'g1', dept_id: 'd1', name: '신규 발굴 — 학교', sort_order: 1, created_at: '' }],
  duties: [{ id: 'u1', group_id: 'g1', name: '중학교', note: null, owner_id: ME, link: null, sort_order: 1, created_at: '' }],
  duty_helpers: [],
  duty_files: [],
  duty_columns: [
    { id: 'c1', duty_id: 'u1', name: '기관 이름', kind: 'text', options: null, sort_order: 1, created_at: '' },
    { id: 'c2', duty_id: 'u1', name: '진행 상태', kind: 'select', options: ['연락 전', '연락함', '제안서 보냄', '보류'], sort_order: 2, created_at: '' },
    { id: 'c3', duty_id: 'u1', name: '담당자·부서', kind: 'text', options: null, sort_order: 3, created_at: '' },
    { id: 'c4', duty_id: 'u1', name: '연락처', kind: 'text', options: null, sort_order: 4, created_at: '' },
    { id: 'c5', duty_id: 'u1', name: '다음 연락일', kind: 'date', options: null, sort_order: 5, created_at: '' },
  ],
  duty_rows: [
    { id: 'r1', duty_id: 'u1', cells: { c1: '무등중학교', c2: '연락함', c3: '김선생님', c4: '062-111-2222', c5: '2026-09-10' },
      sort_order: 1, updated_by: ME, created_at: '', updated_at: '2026-08-20T00:00:00Z' },
    { id: 'r2', duty_id: 'u1', cells: { c1: '수완중학교', c2: '연락 전', c3: '', c4: '', c5: null },
      sort_order: 2, updated_by: ME, created_at: '', updated_at: '2026-08-20T00:00:00Z' },
  ],
  activity_logs: [], drive_uploads: [],
};

const filtersOf = (url) => [...url.matchAll(/[?&]([a-z_]+)=eq\.([^&]+)/g)]
  .map(([, k, v]) => [k, decodeURIComponent(v)]);
const match = (row, fs) => fs.every(([k, v]) => String(row[k]) === v);

const writes = [];

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
    // upsert — 같은 열쇠가 있으면 덮어쓴다 (settings 의 key)
    for (const r of list) {
      const i = db[table].findIndex((x) => (r.key !== undefined && x.key === r.key) || (r.id !== undefined && x.id === r.id));
      if (i >= 0) db[table][i] = { ...db[table][i], ...r };
      else db[table].push(r);
    }
    writes.push({ table, method, payload });
    body = list;
  } else if (method === 'PATCH') {
    const patch = JSON.parse(req.postData() || '{}');
    body = db[table].filter((r) => match(r, fs));
    for (const r of body) Object.assign(r, patch);
    writes.push({ table, method, payload: patch, filters: fs });
  } else if (method === 'DELETE') {
    body = db[table].filter((r) => match(r, fs));
    db[table] = db[table].filter((r) => !match(r, fs));
    writes.push({ table, method });
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

/** measure-all.mjs 와 같은 잣대 — 가로 스크롤 · 44px 미만 탭 대상 */
const audit = (page) =>
  page.evaluate(() => {
    const small = [...document.querySelectorAll('button, a, select, input, [role="button"]')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        if (el.closest('[aria-hidden="true"]')) return false;
        const lab = el.closest('label');
        if (lab && lab.getBoundingClientRect().height >= 44) return false;
        return r.height < 44;
      })
      .map((el) => (el.textContent || el.getAttribute('aria-label') || '?').trim().slice(0, 14));
    return {
      h: document.documentElement.scrollHeight,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      small: [...new Set(small)],
    };
  });


/** 접힌 구역(Collapsible)을 연다 — 이미 열려 있으면 그대로 둔다 */
async function openSection(p, name) {
  const btn = p.getByRole('button', { name }).first();
  if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
  await p.waitForTimeout(300);
}

const exe = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {});
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, acceptDownloads: true });
await ctx.addInitScript((s) => {
  window.localStorage.setItem('moalab.session.v1', JSON.stringify(s));
}, { id: ME, name: '강양희', role: 'admin', expiresAt: Date.now() + 30 * 864e5 });
await ctx.route('**/rest/v1/**', handle);

const page = await ctx.newPage();
const shot = async (p, name) => {
  if (SHOT_DIR) await p.screenshot({ path: join(SHOT_DIR, `${name}.png`), fullPage: true });
};

console.log('\n[빈 제안서에서 시작 — 회사 정보부터]');
await page.goto(`${BASE}/proposal`, { waitUntil: 'commit' });
await page.waitForTimeout(3000);
ok('제안서 화면이 열린다', await page.getByRole('heading', { name: '제안서' }).first().isVisible());
{
  const a = await audit(page);
  ok('375px 에서 가로 스크롤이 없다', !a.overflow);
  ok('44px 미만 탭 대상이 없다', a.small.length === 0, a.small.join(', '));
  console.log(`      빈 제안서 세로 ${a.h}px`);
}
ok('회사 정보가 비어 있으면 그 칸이 펼쳐진 채 시작한다', await page.getByLabel('회사 이름 *').isVisible());
ok("'아직 안 적음' 배지가 보인다", await page.getByText('아직 안 적음').first().isVisible());
ok('회사 이름이 비면 저장 버튼이 안 눌린다', await page.getByRole('button', { name: '회사 정보 저장' }).isDisabled());
await page.getByLabel('회사 이름 *').fill('모아킷');
await page.getByLabel('대표', { exact: true }).fill('강양희');
await page.getByRole('button', { name: '회사 정보 저장' }).click();
await page.waitForTimeout(800);
ok('회사 정보가 settings.org 한 줄로 저장된다',
  db.settings.length === 1 && db.settings[0].key === 'org' && db.settings[0].value?.name === '모아킷' && db.settings[0].value?.ceo === '강양희',
  JSON.stringify(db.settings));
ok('누가 저장했는지 남는다', db.settings[0]?.updated_by === ME);
ok('저장 토스트가 뜬다', await page.getByText('회사 정보를 저장했어요.').isVisible());

console.log('\n[프로그램 고르기]');
ok('고른 프로그램이 없으면 안내가 보인다', await page.getByText(/아직 고른 프로그램이 없어요/).isVisible());
ok('고르기 전엔 인쇄 버튼이 안 눌린다', await page.getByRole('button', { name: /미리보기 · 인쇄/ }).isDisabled());
await page.getByRole('button', { name: /프로그램 고르기/ }).click();
await page.waitForTimeout(600);
const dialog = page.getByRole('dialog');
ok('고르기 시트가 열린다', await dialog.isVisible());
ok('보관된 프로그램은 목록에 없다', (await dialog.getByText('보관된 프로그램').count()) === 0);
ok('주제별로 묶여 나온다', await dialog.getByText('AI 그림', { exact: true }).isVisible() && await dialog.getByText('드론', { exact: true }).isVisible());
ok('학년·가격이 있는 프로그램은 그 사실이 보인다', await dialog.getByText(/초 4~6 · 1인당 15,000원 · 사진 2/).isVisible());
ok('없는 프로그램은 적으면 된다고 알려준다', await dialog.getByText(/학년·가격이 아직 없어요/).isVisible());
{
  const a = await audit(page);
  ok('시트 안에도 44px 미만 탭 대상이 없다', a.small.length === 0, a.small.join(', '));
}
await dialog.getByLabel('프로그램 검색').fill('드론');
await page.waitForTimeout(300);
ok('이름으로 거른다', (await dialog.getByText('AI 그림 수업').count()) === 0 && await dialog.getByText('드론 코딩').isVisible());
await dialog.getByLabel('프로그램 검색').fill('');
await page.waitForTimeout(300);
await dialog.getByRole('button', { name: /AI 그림 수업/ }).click();
await dialog.getByRole('button', { name: /드론 코딩/ }).click();
await page.waitForTimeout(300);
ok('담은 개수가 닫기 버튼에 적힌다', await dialog.getByRole('button', { name: '2개 담고 닫기' }).isVisible());
await dialog.getByRole('button', { name: '2개 담고 닫기' }).click();
await page.waitForTimeout(500);

console.log('\n[가격·차시·인원 → 합계]');
ok('프로그램 2개가 담겼다', await page.getByText('프로그램 2개').isVisible() || await page.getByText(/^2개$/).count() > 0
  || (await page.locator('input[id^="g-"]').count()) === 2);
ok('학년이 프로그램에서 따라온다', (await page.locator('#g-app0').inputValue()) === '초 4~6');
ok('판매가가 원가표에서 따라온다 (콤마 포함)', (await page.locator('#p-app0').inputValue()) === '15,000');
ok('인원이 원가표에서 따라온다', (await page.locator('#h-app0').inputValue()) === '20');
ok('한 줄 금액 = 15,000 × 20 × 1', await page.getByText('300,000원').first().isVisible());
ok("가격 없는 줄이 있으면 합계에 '일부 협의'", await page.getByText('(일부 협의)').isVisible());
await page.locator('#s-app0').fill('2');
await page.waitForTimeout(200);
ok('차시를 2로 바꾸면 600,000원', await page.getByText('600,000원').first().isVisible());
await page.locator('#p-app1').fill('10000');
await page.waitForTimeout(200);
ok('가격을 치면 콤마가 붙는다', (await page.locator('#p-app1').inputValue()) === '10,000');
ok("두 줄 다 가격이 있으면 '일부 협의' 가 사라진다", (await page.getByText('(일부 협의)').count()) === 0);
ok('합계 = 600,000 + 200,000', await page.getByText('800,000원').first().isVisible());
await page.getByLabel('기관 이름 *').fill('테스트 기관');
await page.waitForTimeout(200);
ok('인사말은 접힌 채 시작한다 (기본 문구)', await page.getByText('기본 문구').isVisible());
await openSection(page, /인사말 · 맺음말/);
ok('기관 이름을 적으면 인사말에 그 이름이 들어간다', (await page.locator('#p-greeting').inputValue()).startsWith('테스트 기관의'));
ok('이제 인쇄 버튼이 눌린다', await page.getByRole('button', { name: /미리보기 · 인쇄/ }).isEnabled());

await page.getByRole('button', { name: /소개 · 목표 · 사진 보기/ }).first().click();
await page.waitForTimeout(300);
ok('목표가 강의계획서에서 따라온다', (await page.locator('#go-app0').inputValue()) === '학생이 직접 그림을 만들어 본다');
ok('샘플 사진 2장이 보인다', (await page.getByLabel('이 사진 빼기').count()) === 2);
await page.getByLabel('이 사진 빼기').first().click();
await page.waitForTimeout(200);
ok('사진 하나를 빼면 1장 남는다', (await page.getByLabel('이 사진 빼기').count()) === 1);
{
  const a = await audit(page);
  ok('채운 뒤에도 가로 스크롤이 없다', !a.overflow);
  ok('채운 뒤에도 44px 미만 탭 대상이 없다', a.small.length === 0, a.small.join(', '));
  console.log(`      프로그램 2개 담은 제안서 세로 ${a.h}px`);
}
await shot(page, 'proposal-filled');

console.log('\n[초안 — 폰에서 나갔다 와도 그대로]');
await page.reload({ waitUntil: 'commit' });
await page.waitForTimeout(3000);
ok('다시 열어도 프로그램 2개가 그대로', (await page.locator('input[id^="g-"]').count()) === 2);
ok('다시 열어도 기관 이름이 그대로', (await page.getByLabel('기관 이름 *').inputValue()) === '테스트 기관');
ok('다시 열어도 고친 차시가 그대로', (await page.locator('#s-app0').inputValue()) === '2');
ok('회사 정보를 저장해뒀으면 그 칸은 접힌 채 시작한다', (await page.getByLabel('회사 이름 *').count()) === 0);

console.log('\n[기관 표에서 → 이 기관에 제안서 만들기]');
await page.goto(`${BASE}/roles/u1`, { waitUntil: 'commit' });
await page.waitForTimeout(3000);
await page.getByRole('button', { name: /무등중학교/ }).first().click();
await page.waitForTimeout(600);
const link = page.getByRole('link', { name: /이 기관에 제안서 만들기/ });
ok('줄 시트에 제안서 링크가 있다', await link.isVisible());
ok('링크가 그 줄을 가리킨다', ((await link.getAttribute('href')) ?? '').includes('/proposal?duty=u1&row=r1'));
await link.click();
await page.waitForTimeout(3000);
ok('제안서 화면으로 간다', new URL(page.url()).pathname === '/proposal');
ok('받는 곳이 그 줄의 기관 이름으로 채워진다', (await page.getByLabel('기관 이름 *').inputValue()) === '무등중학교');
ok('담당자·연락처도 따라온다',
  (await page.getByLabel('담당자').inputValue()) === '김선생님' && (await page.getByLabel('연락처').inputValue()) === '062-111-2222');
await openSection(page, /인사말 · 맺음말/);
ok('인사말이 새 기관 이름으로 바뀐다', (await page.locator('#p-greeting').inputValue()).startsWith('무등중학교의'));
ok('담아둔 프로그램은 그대로 남는다', (await page.locator('input[id^="g-"]').count()) === 2);
ok('어디서 왔는지 알려준다', await page.getByText(/기관 표의/).isVisible());

const mark = page.getByRole('button', { name: /'제안서 보냄' 으로 표시/ });
ok("'제안서 보냄으로 표시' 버튼이 있다", await mark.isVisible());
await mark.click();
await page.waitForTimeout(800);
ok('그 줄의 진행 상태만 바뀐다', db.duty_rows[0].cells.c2 === '제안서 보냄' && db.duty_rows[1].cells.c2 === '연락 전', JSON.stringify(db.duty_rows.map((r) => r.cells.c2)));
ok('다른 칸은 안 건드린다', db.duty_rows[0].cells.c1 === '무등중학교' && db.duty_rows[0].cells.c3 === '김선생님');
ok('누가 바꿨는지 남는다', db.duty_rows[0].updated_by === ME);
ok('요청은 PATCH 한 번', writes.filter((w) => w.table === 'duty_rows').length === 1);
ok('표시한 뒤에는 버튼이 잠긴다', await page.getByRole('button', { name: /으로 표시됨/ }).isDisabled());

console.log('\n[인쇄 화면 — 프로그램마다 한 쪽]');
const [popup] = await Promise.all([
  ctx.waitForEvent('page'),
  page.getByRole('button', { name: /미리보기 · 인쇄/ }).click(),
]);
await popup.waitForLoadState('domcontentloaded');
await popup.waitForFunction(() => document.querySelectorAll('.print-a4-sheet').length >= 3, null, { timeout: 15000 }).catch(() => {});
await popup.waitForTimeout(1500);
ok('새 창에 인쇄 화면이 열린다', new URL(popup.url()).pathname === '/print/proposal');
ok('표지 1 + 프로그램 2 = 3쪽', (await popup.locator('.print-a4-sheet').count()) === 3);
ok('표지에 받는 곳·제목이 있다', await popup.getByText('프로그램 제안서').isVisible() && (await popup.getByText('무등중학교').count()) > 0);
ok('요약표에 금액이 맞게 실린다', (await popup.getByText('600,000원').count()) > 0 && (await popup.getByText('800,000원').count()) > 0);
ok('보내는 곳(회사)이 실린다', (await popup.getByText(/모아킷/).count()) > 0);
{
  const a = await audit(popup);
  ok('인쇄 미리보기도 375px 에서 가로 스크롤이 없다', !a.overflow);
}
await shot(popup, 'proposal-print');

console.log('\n[한글 파일]');
const [dl] = await Promise.all([
  popup.waitForEvent('download', { timeout: 20000 }),
  popup.getByRole('button', { name: /한글 파일 받기/ }).click(),
]);
const fileName = dl.suggestedFilename();
ok('파일 이름이 .hwpx 이고 ASCII 다 (크로미움이 한글 이름을 버리지 않게)', /^[\x20-\x7e]+\.hwpx$/.test(fileName), fileName);
const saved = join(mkdtempSync(join(tmpdir(), 'moalab-proposal-')), fileName);
await dl.saveAs(saved);
const bytes = readFileSync(saved);
ok('zip 이다', bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04);
ok('첫 항목이 mimetype 이고 무압축(STORE)이다',
  bytes.readUInt16LE(8) === 0 && bytes.subarray(30, 38).toString('ascii') === 'mimetype');
{
  const zip = await JSZip.loadAsync(bytes);
  const mimetype = await zip.file('mimetype')?.async('string');
  const sec = (await zip.file('Contents/section0.xml')?.async('string')) ?? '';
  const head = (await zip.file('Contents/header.xml')?.async('string')) ?? '';
  ok('mimetype 이 application/hwp+zip', mimetype === 'application/hwp+zip');
  ok('본문에 기관·프로그램·금액이 들어간다', sec.includes('무등중학교') && sec.includes('AI 그림 수업') && sec.includes('600,000원'));
  ok('샘플 사진이 그림으로 들어간다 (WebP 아닌 형식)', head.includes('<hh:binDataList itemCnt="1"') && /BinData="BIN0001\.(jpg|png)"/.test(head));
  ok('그림 파일이 실제로 들어 있다', Object.keys(zip.files).some((p) => /^BinData\/BIN0001\.(jpg|png)$/.test(p)));
}
ok('인쇄 화면이 받았다고 알려준다', await popup.getByText(/받았어요/).isVisible());
await popup.close();

console.log('\n[인쇄 화면에 넘겨줄 것이 없을 때]');
await page.evaluate(() => window.localStorage.removeItem('moalab.proposal.print'));
const bare = await ctx.newPage();
await bare.goto(`${BASE}/print/proposal`, { waitUntil: 'commit' });
await bare.waitForTimeout(2500);
ok('보여줄 것이 없다고 알려준다', await bare.getByText(/보여줄 제안서가 없어요/).isVisible());
ok('그때는 인쇄 버튼이 잠긴다', await bare.getByRole('button', { name: /인쇄 \/ PDF 저장/ }).isDisabled());
await bare.close();

console.log('\n[새로 시작]');
await page.getByRole('button', { name: '새로 시작' }).click();
await page.waitForTimeout(500);
ok('프로그램이 비워진다', (await page.locator('input[id^="g-"]').count()) === 0);
ok('받는 곳이 비워진다', (await page.getByLabel('기관 이름 *').inputValue()) === '');
await page.reload({ waitUntil: 'commit' });
await page.waitForTimeout(3000);
ok('새로 시작한 뒤 다시 열어도 비어 있다 (초안이 덮였다)', (await page.locator('input[id^="g-"]').count()) === 0);

console.log('\n[강사 — 회사 정보는 원장만 고친다]');
const tctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
await tctx.addInitScript((s) => {
  window.localStorage.setItem('moalab.session.v1', JSON.stringify(s));
}, { id: '22222222-2222-4222-8222-222222222222', name: '이서은', role: 'teacher', expiresAt: Date.now() + 30 * 864e5 });
await tctx.route('**/rest/v1/**', handle);
const tpage = await tctx.newPage();
await tpage.goto(`${BASE}/proposal`, { waitUntil: 'commit' });
await tpage.waitForTimeout(3000);
ok('강사도 제안서를 만들 수 있다', await tpage.getByRole('button', { name: /프로그램 고르기/ }).isVisible());
ok('강사도 회사 정보를 저장해뒀으면 접힌 채 시작한다', (await tpage.getByRole('button', { name: /보내는 곳 \(우리 회사 정보\)/ }).getAttribute('aria-expanded')) === 'false');
await openSection(tpage, /보내는 곳 \(우리 회사 정보\)/);
ok('강사에게는 회사 정보 칸이 잠겨 있다', await tpage.getByLabel('회사 이름 *').isDisabled());
ok('강사에게는 저장 버튼이 없다', (await tpage.getByRole('button', { name: '회사 정보 저장' }).count()) === 0);
await tctx.close();

await browser.close();
console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
