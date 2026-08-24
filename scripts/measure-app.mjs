/**
 * **프로그램 페이지(`/apps/[id]`)를 375px 에서 실제로 재본다.**
 *
 *   npm run dev                     (다른 창에서 띄워두고)
 *   node scripts/measure-app.mjs [주소]        기본 http://localhost:3000
 *   SHOT=out.png node scripts/measure-app.mjs  화면도 같이 찍는다
 *
 * `scripts/measure.mjs` 는 목록 화면 다섯 개만 재고, 진짜 데이터가 있어야 한다.
 * 그런데 이 앱에서 제일 긴 화면은 프로그램 **상세**다 — 검증·계획서·문서·원가·
 * 샘플·사진·댓글이 다 한 장에 있다. 그래서 이 스크립트는 **Supabase REST 응답을
 * playwright 가 가로채서 가짜 데이터를 물린다.** 진짜 DB 가 없어도 잰다.
 *
 * ※ `.env.local` 에는 **아무 값이나** 들어 있어야 한다. 비어 있으면 supabase.ts 가
 *   stub(부르면 던지는 프록시)을 줘서 화면이 에러로 막히고 못 잰다:
 *     NEXT_PUBLIC_SUPABASE_URL=https://measure-fake.supabase.co
 *     NEXT_PUBLIC_SUPABASE_ANON_KEY=measure-fake-anon-key
 *
 * 재는 것은 measure.mjs 와 같다 — 세로 길이 · 가로 스크롤 · 44px 미만 탭 대상.
 *
 * playwright 는 이 스크립트에만 필요해서 package.json 에 넣지 않았다
 * (make-icons.mjs · measure.mjs 와 같은 처리):  npm i -D playwright
 */
import { existsSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const PHONE = { width: 375, height: 812 };
const APP = '11111111-1111-1111-1111-111111111111';
const ME = '00000000-0000-0000-0000-000000000001';
const NOW = '2026-08-20T02:00:00.000Z';

/** 문서 첨부 — 네 갈래가 다 섞인 가장 나쁜 경우로 잰다 */
const pf = (id, name, kind, version, note) => ({
  id, app_id: APP, file_url: `https://example.com/${name}`, file_name: name,
  file_size: 254000, member_id: ME, note: note ?? null, group_id: id, version, kind, created_at: NOW,
});
const FIXTURES = {
  plan_files: [
    pf('f1', '제과제빵_강사교육안_v2.hwp', 'guide', 2, '3차시 활동을 모둠으로 바꿨어요.'),
    pf('f2', '제과제빵_활동지.hwp', 'form', 1),
    pf('f3', '제과제빵_수업계획안_최종.hwp', 'plan', 1),
    pf('f4', '제과제빵_수업PPT.pptx', 'etc', 1),
    pf('f5', '안전지도_체크리스트.pdf', 'form', 1),
  ],
  members: [
    { id: ME, name: '강양희', role: 'admin', active: true, sort_order: 1, created_at: NOW },
    { id: 'm2', name: '이서은', role: 'teacher', active: true, sort_order: 2, created_at: NOW },
  ],
  apps: [{
    id: APP, slug: 'ai-bakery', title_ko: '제과제빵', url: 'https://ai-bakery.vercel.app',
    purpose: '제과제빵 진로체험', target_grade: '초5~6', topic_id: 't1', topic: null,
    creator_id: ME, due_date: '2026-09-01', current_round: 1, status: 'pending',
    archived: false, plan_body: null, created_at: NOW,
  }],
  rounds: [{ id: 'r1', app_id: APP, round_no: 1, change_note: null, opened_at: NOW, closed_at: null }],
  topics: [{ id: 't1', name: '진로체험', sort_order: 1, created_at: NOW }],
};

function rowsFor(pathname) {
  const t = (pathname.split('/rest/v1/')[1] ?? '').split('?')[0];
  if (t.startsWith('plan_files')) return FIXTURES.plan_files;
  if (t.startsWith('members')) return FIXTURES.members;
  if (t.startsWith('apps')) return FIXTURES.apps;
  if (t.startsWith('rounds')) return FIXTURES.rounds;
  if (t.startsWith('topics')) return FIXTURES.topics;
  return [];
}

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

/* expiresAt 이 없으면 세션이 버려져 로그인 화면으로 튕긴다 —
   그러면 전부 812px 로 나와 '한 화면' 이라는 거짓 결과가 된다 (measure.mjs 와 같은 함정) */
await ctx.addInitScript(
  (s) => window.localStorage.setItem('moalab.session.v1', JSON.stringify(s)),
  { id: ME, name: '강양희', role: process.env.MEASURE_ROLE ?? 'admin', expiresAt: Date.now() + 30 * 864e5 },
);

await ctx.route('**/rest/v1/**', async (route) => {
  const rows = rowsFor(new URL(route.request().url()).pathname);
  const one = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object');
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` },
    body: JSON.stringify(one ? (rows[0] ?? null) : rows),
  });
});

const page = await ctx.newPage();
await page.goto(`${BASE}/apps/${APP}`, { waitUntil: 'commit', timeout: 30000 });
await page.waitForTimeout(4500);

if (new URL(page.url()).pathname.startsWith('/login')) {
  console.error('로그인 화면으로 튕겼어요 — 가짜 세션이 안 먹었습니다.');
  await browser.close();
  process.exit(1);
}

const probe = () =>
  page.evaluate(() => {
    const d = document.documentElement;
    const small = [];
    for (const el of document.querySelectorAll('a,button,label[for],select,[role="button"]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 44) {
        const t = (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 22);
        small.push(`${el.tagName.toLowerCase()} "${t}" ${Math.round(r.height)}px`);
      }
    }
    return { h: d.scrollHeight, w: d.scrollWidth, cw: d.clientWidth, small };
  });

async function measure(tag) {
  const m = await probe();
  const xs = m.w > m.cw ? `있음(${m.w}px)` : '없음';
  console.log(
    `${tag.padEnd(20)} 세로 ${String(m.h).padStart(5)}px  ${(m.h / PHONE.height).toFixed(1)}화면  ` +
      `가로스크롤 ${xs}  44px미만 ${m.small.length}`,
  );
  return m;
}

console.log(`폰 ${PHONE.width}×${PHONE.height} · /apps/[id]\n`);
console.log('상태                 세로       화면수  가로스크롤  작은탭');
console.log('─'.repeat(66));

await measure('접힌 상태(기본)');
await page.getByRole('button', { name: /문서 첨부/ }).first().click();
await page.waitForTimeout(800);
const open = await measure('문서 첨부 펼침');
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });

const chips = await page.evaluate(() => {
  const row = [...document.querySelectorAll('div.no-scrollbar.flex')].find(
    (d) => /전체/.test(d.textContent || '') && /교육안|양식|계획안/.test(d.textContent || ''),
  );
  return row ? { s: row.scrollWidth, c: row.clientWidth } : null;
});
console.log(
  '\n갈래 칩 줄  :',
  chips
    ? `내용 ${chips.s}px / 칸 ${chips.c}px → ${chips.s > chips.c ? '가로 스크롤 한 줄' : '한 줄에 들어감'}`
    : '안 그려짐 (갈래가 하나뿐일 때는 줄 자체를 안 그린다)',
);

/* 올리기 시트 — 갈래를 고르기 전에는 버튼이 안 눌려야 한다.
   목록 맨 위 갈래로 여러 개가 한꺼번에 잘못 들어가면 되돌리는 것도 여러 번이다 */
await page.setInputFiles(`#plan-files-${APP}`, [
  { name: '교육안.hwp', mimeType: 'application/octet-stream', buffer: Buffer.from('x'.repeat(2048)) },
  { name: '활동지.pdf', mimeType: 'application/pdf', buffer: Buffer.from('y'.repeat(4096)) },
]);
await page.waitForTimeout(800);
const goText = () =>
  page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) =>
      /갈래로 올리기|갈래를 골라주세요/.test(x.textContent || ''),
    );
    return b ? { t: (b.textContent || '').trim(), d: b.disabled } : null;
  });
const before = await goText();
const sheet = await probe();
console.log(`올리기 시트 : 가로스크롤 ${sheet.w > sheet.cw ? '있음' : '없음'} · "${before?.t}" disabled=${before?.d}`);
await page.getByRole('button', { name: /교육안/ }).last().click();
await page.waitForTimeout(300);
const after = await goText();
console.log(`갈래 고른 뒤: "${after?.t}" disabled=${after?.d}`);

if (open.small.length) {
  console.log('\n44px 미만 탭 대상');
  open.small.forEach((s) => console.log('  · ' + s));
}

await browser.close();
