/*
 * 모아킷 로고에서 앱 아이콘·투명 PNG 를 뽑는다.
 *
 *   npm i -D playwright && node scripts/make-icons.mjs
 *
 * playwright 는 아이콘을 다시 만들 때만 필요해서 package.json 에 넣지 않았다.
 * 원본은 assets/moakit-logo-source.png (검정 배경의 원본 로고).
 *
 * 로고가 바뀌면 원본만 갈아끼우고 이 스크립트를 다시 돌리면 된다.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'assets/moakit-logo-source.png');
const PUB = path.join(ROOT, 'public');

/** 원본에서 측정한 값 (scripts 주석으로 남겨둔다) */
const BRAND_TEAL = '#06BDBD';
const LOGO_BG = '#000000';
/** 파비콘은 teal 판에 검정 M 이다 — 아래 faviconPlate 주석 참고 */
const FAVICON_MARK = '#0B0B0B';
/** M 심볼 영역 */
const SYMBOL = { x: 569, y: 221, w: 431, h: 273 };
/** 심볼 + 워드마크 (태그라인 제외) — 작게 쓸 땐 태그라인이 뭉개져서 뺀다 */
const MARK = { x: 283, y: 220, w: 1017, h: 498 };
/** 심볼 + 워드마크 + 태그라인 전체 */
const FULL = { x: 283, y: 220, w: 1017, h: 557 };

const b64 = fs.readFileSync(SRC).toString('base64');

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage();

/**
 * 검정 배경을 알파로 바꿔서 잘라낸다.
 * 로고가 순검정 위에 얹혀 있으니 alpha = max(r,g,b) 로 두고 색을 되살리면
 * 경계가 깨끗하게 떨어진다 (흰 'moa' 도 그대로 남는다).
 */
async function cutout(box, outWidth) {
  const dataUrl = await page.evaluate(
    async ({ b64, box, outWidth }) => {
      const img = new Image();
      await new Promise((r, j) => {
        img.onload = r;
        img.onerror = j;
        img.src = 'data:image/png;base64,' + b64;
      });

      const c = document.createElement('canvas');
      c.width = box.w;
      c.height = box.h;
      const g = c.getContext('2d');
      g.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);

      const id = g.getImageData(0, 0, box.w, box.h);
      const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const a = Math.max(d[i], d[i + 1], d[i + 2]);
        if (a === 0) {
          d[i + 3] = 0;
          continue;
        }
        // 프리멀티플라이 되돌리기 — 안 하면 경계가 어둡게 남는다
        d[i] = Math.min(255, Math.round((d[i] * 255) / a));
        d[i + 1] = Math.min(255, Math.round((d[i + 1] * 255) / a));
        d[i + 2] = Math.min(255, Math.round((d[i + 2] * 255) / a));
        d[i + 3] = a;
      }
      g.putImageData(id, 0, 0);

      if (!outWidth || outWidth === box.w) return c.toDataURL('image/png');
      const s = document.createElement('canvas');
      s.width = outWidth;
      s.height = Math.round((box.h / box.w) * outWidth);
      const sg = s.getContext('2d');
      sg.imageSmoothingQuality = 'high';
      sg.drawImage(c, 0, 0, s.width, s.height);
      return s.toDataURL('image/png');
    },
    { b64, box, outWidth },
  );
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

function write(name, buf) {
  fs.writeFileSync(path.join(PUB, name), buf);
  console.log(`  ${name.padEnd(28)} ${(buf.length / 1024).toFixed(1)}KB`);
}

console.log('투명 PNG 잘라내기');
const symbolPng = await cutout(SYMBOL, SYMBOL.w);
write('moakit-symbol.png', symbolPng);
write('moakit-mark.png', await cutout(MARK, MARK.w));
write('moakit-logo.png', await cutout(FULL, FULL.w));

/**
 * 앱 아이콘. 검정 바탕 + teal M — 로고가 검정 위에 설계돼 있으니 그대로 간다.
 * `pad` 는 아이콘 한 변 대비 M 이 차지할 비율.
 *   · 일반 아이콘은 여유 있게 0.62
 *   · maskable 은 안드로이드가 원형으로 잘라내므로 안전영역(중앙 80%) 안에 들어가게 0.48
 */
async function appIcon(size, { fraction, radius }) {
  const symbolB64 = symbolPng.toString('base64');
  const dataUrl = await page.evaluate(
    async ({ symbolB64, size, fraction, radius, bg }) => {
      const img = new Image();
      await new Promise((r, j) => {
        img.onload = r;
        img.onerror = j;
        img.src = 'data:image/png;base64,' + symbolB64;
      });

      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const g = c.getContext('2d');

      if (radius > 0) {
        g.beginPath();
        const r = size * radius;
        g.moveTo(r, 0);
        g.arcTo(size, 0, size, size, r);
        g.arcTo(size, size, 0, size, r);
        g.arcTo(0, size, 0, 0, r);
        g.arcTo(0, 0, size, 0, r);
        g.closePath();
        g.clip();
      }
      g.fillStyle = bg;
      g.fillRect(0, 0, size, size);

      const w = size * fraction;
      const h = (img.naturalHeight / img.naturalWidth) * w;
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      return c.toDataURL('image/png');
    },
    { symbolB64, size, fraction, radius, bg: LOGO_BG },
  );
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

console.log('앱 아이콘');
// 홈 화면 아이콘. iOS 는 자기가 모서리를 깎으니 radius 0 으로 준다
write('apple-touch-icon.png', await appIcon(180, { fraction: 0.62, radius: 0 }));
write('icon-192.png', await appIcon(192, { fraction: 0.62, radius: 0.22 }));
write('icon-512.png', await appIcon(512, { fraction: 0.62, radius: 0.22 }));
// 안드로이드 maskable — 원형으로 잘려도 M 이 안 잘리게 작게
write('icon-maskable-512.png', await appIcon(512, { fraction: 0.48, radius: 0 }));

/**
 * 파비콘은 **앱 아이콘을 그냥 줄인 것이 아니다.**
 *
 * 탭에 실제로 그려지는 크기는 16px 다. 앱 아이콘(검정 판 + M 62%)을 16px 로 줄이면
 * · M 의 가운데 V 홈이 사라져 **어두운 덩어리**로만 보이고
 * · 검정 판이라 **다크 테마 탭 배경에 묻힌다**
 * 실제로 재보고 확인한 것이라, 파비콘만 따로 그린다:
 *   · 판을 **teal**(로고색)로 뒤집어 밝은 탭·어두운 탭 양쪽에서 눈에 띄게
 *   · M 을 검정으로 얹고 **88%** 까지 키워 16px 에서도 두 봉우리가 남게
 */
async function faviconPlate(size) {
  const symbolB64 = symbolPng.toString('base64');
  const dataUrl = await page.evaluate(
    async ({ symbolB64, size, bg, mark, fraction, radius }) => {
      const img = new Image();
      await new Promise((r, j) => {
        img.onload = r;
        img.onerror = j;
        img.src = 'data:image/png;base64,' + symbolB64;
      });

      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');

      const r = size * radius;
      g.beginPath();
      g.moveTo(r, 0);
      g.arcTo(size, 0, size, size, r);
      g.arcTo(size, size, 0, size, r);
      g.arcTo(0, size, 0, 0, r);
      g.arcTo(0, 0, size, 0, r);
      g.closePath();
      g.clip();
      g.fillStyle = bg;
      g.fillRect(0, 0, size, size);

      /* M 을 한 번 딴 데 그린 뒤 `source-in` 으로 통째로 검정으로 물들인다.
         (원본은 teal 이라 teal 판 위에서는 안 보인다) */
      const off = document.createElement('canvas');
      off.width = off.height = size;
      const o = off.getContext('2d');
      const w = size * fraction;
      const h = (img.naturalHeight / img.naturalWidth) * w;
      o.imageSmoothingQuality = 'high';
      o.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      o.globalCompositeOperation = 'source-in';
      o.fillStyle = mark;
      o.fillRect(0, 0, size, size);

      g.drawImage(off, 0, 0);
      return c.toDataURL('image/png');
    },
    { symbolB64, size, bg: BRAND_TEAL, mark: FAVICON_MARK, fraction: 0.88, radius: 0.22 },
  );
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

/**
 * 여러 크기를 한 파일에 담은 `.ico`.
 *
 * 한 장짜리 PNG 만 주면 **브라우저가 알아서 줄인다** — 16px 로 줄어들 때
 * 획이 반투명해져 뭉갠다. 크기별로 미리 그려 담으면 브라우저가 그중 맞는 것을
 * 골라 쓰므로 그 단계가 없어진다. (Vista 이후 ico 는 PNG 를 그대로 품는다)
 */
function icoOf(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0); // reserved
  head.writeUInt16LE(1, 2); // 1 = icon
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  for (const [i, { size, buf }] of images.entries()) {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e);
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt8(0, e + 2); // 팔레트 없음
    head.writeUInt8(0, e + 3); // reserved
    head.writeUInt16LE(1, e + 4); // planes
    head.writeUInt16LE(32, e + 6); // 32bpp
    head.writeUInt32LE(buf.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += buf.length;
  }
  return Buffer.concat([head, ...images.map((i) => i.buf)]);
}

console.log('파비콘');
const favSizes = [16, 32, 48];
const favPngs = [];
for (const size of favSizes) favPngs.push({ size, buf: await faviconPlate(size) });

// Next.js app router 가 src/app/icon.png · src/app/favicon.ico 를 자동으로 집는다
const favicon = await faviconPlate(64);
fs.writeFileSync(path.join(ROOT, 'src/app/icon.png'), favicon);
console.log(`  src/app/icon.png             ${(favicon.length / 1024).toFixed(1)}KB`);
const ico = icoOf(favPngs);
fs.writeFileSync(path.join(ROOT, 'src/app/favicon.ico'), ico);
console.log(`  src/app/favicon.ico          ${(ico.length / 1024).toFixed(1)}KB  (${favSizes.join('·')}px)`);

await browser.close();
console.log(
  `\n브랜드 teal ${BRAND_TEAL} · 심볼 ${SYMBOL.w}x${SYMBOL.h} · ` +
    `마크 ${MARK.w}x${MARK.h} · 전체 ${FULL.w}x${FULL.h}`,
);
