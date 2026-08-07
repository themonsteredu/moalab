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

// 파비콘 (Next.js app router 가 src/app/icon.png 을 자동으로 쓴다)
const favicon = await appIcon(64, { fraction: 0.66, radius: 0.22 });
fs.writeFileSync(path.join(ROOT, 'src/app/icon.png'), favicon);
console.log(`  src/app/icon.png             ${(favicon.length / 1024).toFixed(1)}KB`);

await browser.close();
console.log(
  `\n브랜드 teal ${BRAND_TEAL} · 심볼 ${SYMBOL.w}x${SYMBOL.h} · ` +
    `마크 ${MARK.w}x${MARK.h} · 전체 ${FULL.w}x${FULL.h}`,
);
