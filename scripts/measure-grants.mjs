/**
 * 폰에서 **"정부지원사업 메뉴에 들어갈 때"** 몇 초 걸리는지 실제로 잰다.
 *
 *   npm run build && npm start          # 다른 창에서 띄워둔다
 *   node scripts/measure-grants.mjs
 *
 * 세 가지를 나눠 잰다 — 셋이 원인이 다르다:
 *   1. 메뉴 누르기 · 캐시 없음  → 서버 답을 기다리는 시간이 그대로 보인다
 *   2. 메뉴 누르기 · 캐시 있음  → `pageCache` 가 듣는지 (이게 짧아야 한다)
 *   3. 앱 새로 켜서 바로 열기   → 앱이 통째로 뜨는 시간까지 포함
 *
 * 환경변수
 *   API_DELAY  서버가 답하기까지 (기본 900ms — 함수가 잠에서 깨는 시간을 흉내낸다)
 *   FONT_KB    한글 폰트 굵기당 크기 (기본 0 = 안 받음). 1500 이면 실제 규모다
 *
 * ⚠️ **`NEXT_PUBLIC_*` 을 넣고 빌드해야 한다.** 이 값은 빌드 때 박히므로 빼고
 * 빌드하면 가짜 데이터가 안 물려서 화면이 로그인으로 튕긴다
 * (measure-mock.mjs 와 같은 함정).
 *
 * ⚠️ 폰트는 이 환경에서 jsDelivr 이 막혀 있어 크기를 흉내낸다. 재보면
 * **글자가 뜨는 시각은 거의 안 변한다**(`font-display: swap`) — 대신 내려받는
 * 양이 6MB 넘게 늘어난다. 폰트는 '느림' 이 아니라 '데이터 낭비' 쪽 문제다.
 */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const PHONE = { width: 375, height: 812 };
const ME = '00000000-0000-0000-0000-000000000001';
/** 서버가 잠에서 깨어 답하기까지 (서울이어도 남는 시간) */
const API_DELAY_MS = Number(process.env.API_DELAY ?? 900);
/** 0 이면 **토큰 없는 세션** — 서버가 신원을 확인 못 하는 상태를 재현한다 */
const WITH_TOKEN = process.env.NO_TOKEN !== '1';

const MEMBERS = [
  { id: ME, name: '강양희', role: 'admin', active: true, sort_order: 0 },
  { id: '00000000-0000-0000-0000-000000000002', name: '이서은', role: 'teacher', active: true, sort_order: 1 },
];
const PROJECTS = [{
  id: '128cfb74-e025-4216-be2d-9373611ce9f1',
  title: '2026 모두의 창업', agency: '한국과학창의재단', announcement_url: null,
  deadline: '2026-09-20', item_name: null, target_audience: null, concept_summary: null,
  differentiation: null, support_needed: null, status: 'discovered', duplicate_checked: false,
  submitted_at: null, result_note: null, lead_id: null, created_by: ME, updated_by: ME,
  concept_shared_at: null, created_at: '2026-09-03T00:00:00Z', updated_at: '2026-09-03T00:00:00Z',
}];

const exe = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {});

/** 느린 폰 網 (다운로드 Mbps, 왕복 지연 ms) */
const NET = { down: 8 * 1024 * 1024 / 8, up: 2 * 1024 * 1024 / 8, latency: 120 };

async function makeContext() {
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await ctx.addInitScript(([me, withToken]) => {
    localStorage.setItem('moalab.session.v1', JSON.stringify({
      id: me, name: '강양희', role: 'admin',
      // 토큰이 없는 세션 = 이 칸이 생기기 전에 로그인했거나 발급이 실패한 경우
      ...(withToken ? { token: '11111111-1111-1111-1111-111111111111' } : {}),
      expiresAt: Date.now() + 30 * 24 * 3600 * 1000,
    }));
  }, [ME, WITH_TOKEN]);

  // 이 환경은 jsDelivr 이 막혀 있다. 실제 한글 폰트 무게(굵기당 FONT_KB)를
  // 그대로 흉내내서 폰이 얼마나 더 기다리는지 잰다. 0 이면 끊는다(= 폰트 없음).
  const fonts = [];
  const FONT_KB = Number(process.env.FONT_KB ?? 0);
  const blob = Buffer.alloc(FONT_KB * 1024, 0);
  await ctx.route('**cdn.jsdelivr.net/**', (r) => {
    fonts.push(r.request().url());
    if (!FONT_KB) return r.abort();
    return r.fulfill({ status: 200, contentType: 'font/woff2', body: blob });
  });

  await ctx.route('**/rest/v1/**', (route) => {
    const u = route.request().url();
    const body = u.includes('members_public') ? MEMBERS : [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  // 서버(/api/grants)는 일부러 늦게 답한다
  await ctx.route('**/api/grants', async (route) => {
    await new Promise((r) => setTimeout(r, API_DELAY_MS));
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ projects: PROJECTS, collaborators: [] }),
    });
  });
  return { ctx, fonts };
}

async function run(label, ctx, { mode }) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, downloadThroughput: NET.down, uploadThroughput: NET.up, latency: NET.latency,
  });

  let bytes = 0;
  page.on('response', async (res) => {
    try { bytes += Number((await res.allHeaders())['content-length'] ?? 0); } catch { /* 무시 */ }
  });

  let shown = null;
  let t0;
  if (mode === 'coldstart') {
    // 앱을 새로 켜서 바로 정부지원사업으로 (홈 화면 아이콘 → 그 메뉴)
    t0 = Date.now();
    await page.goto(`${BASE}/grants`, { waitUntil: 'commit' });
  } else {
    // 앱은 이미 켜져 있고, 아래 '더보기 → 정부지원사업' 을 누른다
    await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '더보기' }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500); // 앱이 자리를 잡을 시간
    t0 = Date.now();
    await page.getByRole('button', { name: '더보기' }).click();
    await page.getByRole('link', { name: '정부지원사업' }).click();
  }

  let notice = '';
  try {
    await page.getByText('2026 모두의 창업', { exact: false }).first().waitFor({ timeout: 20000 });
    shown = Date.now() - t0;
  } catch {
    shown = null;
    // 안 떴다면 — 안내라도 나왔나, 아니면 스켈레톤만 돌고 있나?
    const banner = page.locator('text=다시 로그인').first();
    notice = (await banner.count()) ? '안내 뜸 (다시 로그인 버튼)' : '아무 안내 없음 — 스켈레톤만';
    if (!notice.startsWith('안내')) {
      const spin = await page.locator('.animate-pulse').count();
      notice = spin ? '아무 안내 없음 — 스켈레톤만 돎' : '아무것도 없음';
    }
  }

  await page.close();
  return { label, shown, bytes: Math.round(bytes / 1024), notice };
}

const { ctx, fonts } = await makeContext();
const tapCold = await run('메뉴 누르기 — 캐시 없음', ctx, { mode: 'tap' });
const tapWarm = await run('메뉴 누르기 — 캐시 있음', ctx, { mode: 'tap' });
const boot    = await run('앱 새로 켜서 바로 열기', ctx, { mode: 'coldstart' });
await browser.close();

const ms = (v) => v === null ? '안 뜸' : `${(v / 1000).toFixed(2)}초`;
console.log(`\n서버 응답 지연을 ${API_DELAY_MS}ms 로 두고 잰 값 (폰 375px, 지연 ${NET.latency}ms)\n`);
for (const r of [tapCold, tapWarm, boot]) {
  const tail = r.shown === null ? `  → ${r.notice}` : `   내려받기 ${r.bytes}KB`;
  console.log(`  ${r.label.padEnd(26)} 공고가 보일 때까지  ${ms(r.shown).padStart(7)}${tail}`);
}
console.log(`\n  외부 폰트 요청 ${fonts.length}건 (${[...new Set(fonts)].length}개 파일) — 이 환경에선 막혀 있어 끊었다`);
for (const f of [...new Set(fonts)]) console.log(`     ${f.replace('https://cdn.jsdelivr.net/gh/fonts-archive/', '')}`);
