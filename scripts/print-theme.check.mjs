/**
 * 다크 테마가 **인쇄를 깨지 않는지** 확인한다.
 *
 *   npm run build && npm start      # 다른 창에서 띄워둔다
 *   node scripts/print-theme.check.mjs
 *
 * 화면은 어둡고 종이는 희다. 색을 클래스에 박아두면 이 둘을 같이 만족시킬 수
 * 없어서, `neutral`·`canvas`·`surface` 를 **CSS 변수**로 받고 `@media print` 에서
 * 변수만 밝은 값으로 되돌린다 (`globals.css`). 화면 코드는 한 줄도 안 고친다.
 *
 * ⚠️ 이 검사가 없으면 **인쇄 화면 여섯 개가 흰 종이에 흰 글씨로 나가는 것**을
 * 아무도 모른다 — 지출결의서·강의계획서·부서업무는 실제로 종이로 나가는 문서다.
 */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
const exe = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium';
const b = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {});
const p = await b.newPage();
await p.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' });
await p.evaluate(() => {
  const d = document.createElement('div');
  d.id = 'probe';
  d.className = 'bg-surface text-neutral-900 border-neutral-200';
  d.textContent = '검사';
  document.body.appendChild(d);
});
const read = async () => p.evaluate(() => {
  const s = getComputedStyle(document.getElementById('probe'));
  const body = getComputedStyle(document.body);
  return { 글자: s.color, 배경: s.backgroundColor, 테두리: s.borderColor, 페이지배경: body.backgroundColor };
});
const screen = await read();
await p.emulateMedia({ media: 'print' });
const print = await read();
await b.close();
const line = (k, o) => `  ${k.padEnd(6)} 글자 ${o.글자.padEnd(18)} 배경 ${o.배경.padEnd(18)} 페이지 ${o.페이지배경}`;
console.log('화면(다크) / 인쇄(라이트) 비교\n');
console.log(line('화면', screen));
console.log(line('인쇄', print));
const dark = screen.글자 === 'rgb(242, 243, 245)';
const light = print.글자 === 'rgb(23, 23, 23)';
console.log(`\n  화면은 밝은 글자인가  ${dark ? 'OK' : '실패 — ' + screen.글자}`);
console.log(`  인쇄는 검은 글자인가  ${light ? 'OK' : '실패 — ' + print.글자}`);
process.exit(dark && light ? 0 : 1);
