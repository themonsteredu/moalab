/**
 * 강의계획서 → 한글 파일(.hwpx) 만들기 테스트.
 *
 *   node scripts/hwpx.test.mjs
 *
 * .hwpx 는 한글이 조금만 어긋나도 **"파일을 열 수 없습니다"** 로 통째로 거부한다.
 * 화면에서 눌러보기 전에는 알 수가 없어서, 만들어진 XML 이 규칙을 지키는지
 * 여기서 미리 잡는다. 실제 한글로 열어 확인한 것과 같은 규칙이다.
 *
 * 특히 막고 싶은 것:
 *   · `mimetype` 이 application/hwp+zip 이 아니거나 압축되면 → 못 연다
 *   · 속성에 네임스페이스 접두어를 붙이면(hp:paraPrIDRef) → 못 연다
 *   · 첫 문단에 hp:secPr(용지 설정)가 없으면 → 못 연다
 *   · header.xml 에 binDataList 가 없으면 → **사진이 통째로 안 보인다**
 *     (파일은 열리는데 그림만 사라져서 제일 늦게 발견된다)
 *   · 표에서 병합돼 가려진 칸을 그리면 → 표가 깨진다
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const out = mkdtempSync(join(tmpdir(), 'moalab-hwpx-'));
let H;
try {
  execFileSync(
    'npx',
    ['tsc', 'src/lib/hwpx.ts', 'src/lib/types.ts', '--outDir', out,
     '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck', '--esModuleInterop', '--lib', 'es2020,dom'],
    { stdio: 'pipe' },
  );
  const req = createRequire(import.meta.url);
  H = req(join(out, 'hwpx.js'));
} catch (e) {
  console.error('컴파일 실패:', e.stdout?.toString() || e.message);
  process.exit(1);
}

let pass = 0;
const fails = [];
const ok = (name, cond) => (cond ? pass++ : fails.push(name));

const plan = {
  app_id: 'x', category: '푸드테크',
  goal: '목표 <칸> & "따옴표" 도 안전해야 한다',
  intro: '도입 첫 줄\n도입 둘째 줄',
  dev_title: '[AI 웹앱활동]', work_title: '[활동작품]',
  closing: '마무리', tools: '교구', etc: '기타',
  logo_url: null, updated_by: null, updated_at: '', created_at: '',
};
const mk = (slot, i, url) => ({ id: `${slot}-${i}`, app_id: 'x', slot, label: `${slot}${i}`, url, sort_order: i, created_at: '' });
const items = [
  mk('step', 0, 'u'), mk('step', 1, 'u'), mk('step', 2, 'u'),
  mk('order', 0, 'u'), mk('order', 1, 'u'), mk('order', 2, 'u'), mk('order', 3, 'u'),
  mk('result', 0, 'u'),
];
const pics = items.map((it, i) => ({
  itemId: it.id, binId: `BIN${String(i + 1).padStart(4, '0')}`, ext: 'png',
  data: new Uint8Array([1, 2, 3]), w: 17008, h: 12756,
}));

const files = H.buildPlanHwpxFiles(plan, items, '라면공작소', pics);
const sec = files['Contents/section0.xml'];
const head = files['Contents/header.xml'];
const hpf = files['Contents/content.hpf'];

// ── 패키지 규칙
ok('mimetype 은 application/hwp+zip', files.mimetype === 'application/hwp+zip');
ok('필수 부품이 다 있다', [
  'version.xml', 'settings.xml', 'META-INF/container.xml', 'META-INF/manifest.xml',
  'Contents/content.hpf', 'Contents/header.xml', 'Contents/section0.xml',
].every((p) => typeof files[p] === 'string' && files[p].length > 0));
ok('그림 파일이 BinData 로 들어간다', pics.every((p) => files[`BinData/${p.binId}.png`] instanceof Uint8Array));

// ── XML 이 깨지지 않았는가 (여는 태그/닫는 태그 수가 맞는가)
for (const [name, xml] of Object.entries(files)) {
  if (typeof xml !== 'string' || !xml.startsWith('<?xml')) continue;
  const open = (xml.match(/<[a-zA-Z][^>]*?(?<!\/)>/g) || []).length;
  const close = (xml.match(/<\/[^>]+>/g) || []).length;
  ok(`${name} 태그 짝이 맞는다`, open === close);
}

// ── 한글이 거부하는 흔한 실수
ok('속성에 네임스페이스 접두어를 안 붙였다', !/\s(hp|hh|hc):[a-zA-Z]+=/.test(sec + head));
ok('첫 문단에 용지 설정(secPr)이 있다', sec.indexOf('<hp:secPr') > 0 && sec.indexOf('<hp:secPr') < sec.indexOf('<hp:tbl'));
ok('용지가 A4 다', sec.includes(`width="${H.mm(210)}"`) && sec.includes(`height="${H.mm(297)}"`));

// ── 그림 — 이게 빠지면 파일은 열리는데 사진만 사라진다
ok('header 에 binDataList 가 있다', head.includes('<hh:binDataList itemCnt="8"'));
ok('binItem 이 BinData 파일이름으로 잇는다', pics.every((p) => head.includes(`BinData="${p.binId}.png"`)));
ok('본문 그림이 그 이름을 가리킨다', pics.every((p) => sec.includes(`binaryItemIDRef="${p.binId}"`)));
ok('그림 수와 본문 pic 수가 같다', (sec.match(/<hp:pic /g) || []).length === pics.length);
ok('content.hpf 가 그림을 싣는다', pics.every((p) => hpf.includes(`href="BinData/${p.binId}.png"`)));

// ── 표
ok('표는 8줄 3칸', sec.includes('rowCnt="8" colCnt="3"'));
ok('제목줄이 3칸 병합', sec.includes('colSpan="3" rowSpan="1"'));
ok('운영사항이 2줄 병합', sec.includes('colSpan="1" rowSpan="2"'));
// 병합돼 가려진 칸을 그리면 마지막 줄 칸이 3개가 된다
const lastRow = sec.slice(sec.lastIndexOf('<hp:tr>'));
ok('가려진 칸은 안 그린다', (lastRow.match(/<hp:tc /g) || []).length === 2);
ok('모든 칸에 주소·병합·크기가 있다', (() => {
  const tc = (sec.match(/<hp:tc /g) || []).length;
  return ['cellAddr', 'cellSpan', 'cellSz', 'cellMargin'].every(
    (t) => (sec.match(new RegExp(`<hp:${t} `, 'g')) || []).length === tc,
  );
})());

// ── 내용
ok('제목과 분류가 들어간다', sec.includes('라면공작소') && sec.includes('푸드테크'));
ok('여러 줄 글이 문단으로 나뉜다', sec.includes('도입 첫 줄') && sec.includes('도입 둘째 줄'));
ok('꺾쇠·따옴표가 이스케이프된다', sec.includes('&lt;칸&gt;') && sec.includes('&amp;') && !sec.includes('<칸>'));
ok('사진 4장이면 다음 줄로 넘어간다', (sec.match(/<hp:tbl /g) || []).length >= 4);

// 사진이 1장뿐인 묶음(결과 이미지)은 표를 안 만들고 가운데로 — 표를 쓰면 왼쪽으로 쏠린다
const oneEach = H.buildPlanHwpxFiles(
  plan,
  [{ id: 'result-0', app_id: 'x', slot: 'result', label: '완성', url: 'u', sort_order: 0, created_at: '' }],
  '한장', [{ itemId: 'result-0', binId: 'BIN0001', ext: 'jpg', data: new Uint8Array([1]), w: 17008, h: 12756 }],
)['Contents/section0.xml'];
ok('1장짜리 묶음은 안쪽 표를 안 만든다', (oneEach.match(/<hp:tbl /g) || []).length === 1);
ok('1장짜리 묶음은 가운데 정렬', oneEach.includes('paraPrIDRef="1"') && oneEach.includes('binaryItemIDRef="BIN0001"'));

// ── 형식 — 한글은 WebP 를 못 읽는다.
//    앱은 사진을 WebP 로 저장하므로 넣기 전에 JPEG/PNG 로 바꿔야 하고,
//    이 표에 webp 가 들어가면 그 변환을 건너뛴 채 깨진 그림이 나간다
ok('WebP 를 쓸 수 있는 형식으로 두지 않았다', !('webp' in H.HWP_IMAGE_MEDIA));
ok('한글이 읽는 형식만 있다', Object.keys(H.HWP_IMAGE_MEDIA).every((e) => ['png','jpg','jpeg','gif','bmp'].includes(e)));
ok('binDataList 의 Format 이 실제 파일 확장자와 같다', pics.every((p) => head.includes(`BinData="${p.binId}.${p.ext}" Format="${p.ext}"`)));

// ── 사진이 없는 경우에도 문서가 나온다
const bare = H.buildPlanHwpxFiles(plan, [], '빈 계획서', []);
ok('사진 0장이어도 만들어진다', bare['Contents/section0.xml'].includes('빈 계획서'));
ok('사진 0장이면 binDataList 가 비어 있다', bare['Contents/header.xml'].includes('<hh:binDataList itemCnt="0"'));
ok('로고가 없으면 기본 문구가 들어간다', bare['Contents/section0.xml'].includes('모아킷_교육을 위한 모든 것'));

// ── 로고 — 활동 줄이 아니라 특별한 이름으로 실린다
const withLogo = H.buildPlanHwpxFiles(
  { ...plan, logo_url: '/logo.png' }, [], '로고 계획서',
  [{ itemId: H.LOGO_ITEM_ID, binId: 'BIN0001', ext: 'png', data: new Uint8Array([1]), w: 11339, h: 3402 }],
);
ok('로고가 그림으로 들어간다', withLogo['Contents/section0.xml'].includes('binaryItemIDRef="BIN0001"'));
ok('로고가 있으면 기본 문구를 안 넣는다', !withLogo['Contents/section0.xml'].includes('모아킷_교육을 위한 모든 것'));

rmSync(out, { recursive: true, force: true });
console.log(`${pass}건 통과${fails.length ? `, ${fails.length}건 실패` : ''}`);
if (fails.length) { for (const f of fails) console.error('  ✗', f); process.exit(1); }
