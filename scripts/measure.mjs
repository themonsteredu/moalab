/**
 * 폰(375px)에서 화면이 얼마나 긴지 **실제로 재본다.**
 *
 *   npm run dev          (다른 창에서 띄워두고)
 *   node scripts/measure.mjs [주소]      기본 http://localhost:3000
 *
 * CLAUDE.md 는 "375px 에서 실제로 재본다" 고 적어뒀지만 재는 도구가
 * 저장소에 없었다. 그래서 문서의 픽셀 숫자들이 전부 확인 불가능했다.
 * 이 스크립트가 그 자리를 채운다.
 *
 * 재는 것 세 가지:
 *   · 세로 길이 (폰 한 화면 = 812px 기준으로 몇 화면인지)
 *   · 가로 스크롤 (나오면 실패다 — CLAUDE.md 1번 원칙)
 *   · 44px 미만 탭 대상 (손가락이 안 닿는 버튼)
 *
 * playwright 는 이 스크립트에만 필요해서 package.json 에 넣지 않았다
 * (make-icons.mjs 와 같은 처리):  npm i -D playwright
 */
import { existsSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const PHONE = { width: 375, height: 812 };

/** 로그인 가드를 지나가기 위한 가짜 세션. 실제 멤버 id 가 아니어도 화면은 그려진다.
    ※ expiresAt 이 없으면 session.tsx 가 세션을 버리고 로그인 화면으로 보낸다 —
      그러면 모든 화면이 812px 로 나와서 '전부 한 화면' 이라는 거짓 결과가 된다 */
const SESSION = {
  id: '00000000-0000-0000-0000-000000000001',
  name: '측정',
  role: process.env.MEASURE_ROLE ?? 'admin',
  expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
};

const PAGES = [
  ['/home', '홈'],
  ['/task', '업무'],
  ['/apps', '프로그램계획'],
  ['/verify', '프로그램검증'],
  ['/notice', '공지사항'],
];

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright 가 없어요.  npm i -D playwright  후 다시 실행해주세요.');
  process.exit(1);
}

/* 이 환경에는 크로미움이 미리 깔려 있다 (playwright 판올림과 어긋나도 그걸 쓴다).
   PLAYWRIGHT_CHROMIUM 으로 직접 지정할 수도 있다 */
const exe = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium';
const launchOpts = existsSync(exe) ? { executablePath: exe } : {};
const browser = await chromium.launch(launchOpts);
const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 });

// 로그인 가드를 지나가게 세션을 미리 심어둔다
await ctx.addInitScript((s) => {
  window.localStorage.setItem('moalab.session.v1', JSON.stringify(s));
}, SESSION);

const page = await ctx.newPage();
let worst = 0;

console.log(`폰 ${PHONE.width}×${PHONE.height} 기준\n`);
console.log('화면            세로      화면수  가로스크롤  작은탭');
console.log('─'.repeat(58));

for (const [path, label] of PAGES) {
  try {
    /* 'commit' 으로 받고 직접 기다린다. networkidle·load 는 못 쓴다 —
       요청 하나가 늦게 끝나는 화면에서 영영 안 끝나고 통째로 실패한다 */
    await page.goto(BASE + path, { waitUntil: 'commit', timeout: 20000 });
    await page.waitForTimeout(4000); // 데이터가 들어와 화면이 자리잡을 때까지
  } catch (e) {
    console.log(`${label.padEnd(14)} 열지 못함 (${path}) — ${String(e).split('\n')[0].slice(0, 90)}`);
    continue;
  }

  if (new URL(page.url()).pathname.startsWith('/login')) {
    console.log(`${label.padEnd(14)} 로그인 화면으로 튕김 — 세션이 안 먹었어요`);
    continue;
  }

  const m = await page.evaluate((min) => {
    const doc = document.documentElement;
    const small = [...document.querySelectorAll('button, a, select, input, [role="button"]')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        // 화면에 안 보이는 것(닫힌 시트 등)은 세지 않는다
        return r.width > 0 && r.height > 0 && r.height < min;
      })
      .map((el) => `${el.tagName.toLowerCase()}:${(el.textContent ?? '').trim().slice(0, 16)}`);
    return {
      height: doc.scrollHeight,
      overflowX: doc.scrollWidth > doc.clientWidth,
      scrollWidth: doc.scrollWidth,
      small,
    };
  }, 44);

  const screens = (m.height / PHONE.height).toFixed(1);
  worst = Math.max(worst, m.height);
  const over = m.overflowX ? `있음(${m.scrollWidth}px)` : '없음';
  console.log(
    `${label.padEnd(14)} ${String(m.height).padStart(6)}px ${String(screens).padStart(6)}  ${over.padEnd(11)} ${m.small.length}`,
  );
  if (m.small.length > 0) {
    for (const s of [...new Set(m.small)].slice(0, 5)) console.log(`                 · ${s}`);
  }
}

console.log('─'.repeat(58));
console.log(`가장 긴 화면: ${worst}px (${(worst / PHONE.height).toFixed(1)}화면)`);

await browser.close();
