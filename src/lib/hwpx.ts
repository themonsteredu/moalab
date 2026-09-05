'use client';

/**
 * 강의계획서를 **한글 파일(.hwpx)** 로 내려받는다.
 *
 * ─ 왜 .hwp 가 아니라 .hwpx 인가
 *   .hwp(클래식)는 한컴 독점 바이너리(CFB)라 브라우저에서 만들 방법이 없다.
 *   .hwpx 는 **국가표준 KS X 6101(OWPML)** 이고 ZIP + XML 이라 만들 수 있다.
 *   한글 2010 SE+ 부터 열리고 2014+ 부터 안정적으로 편집된다.
 *   받은 뒤 한글에서 `다른 이름으로 저장 → hwp` 하면 .hwp 가 된다.
 *
 * ─ 라이브러리를 새로 안 넣는다
 *   ZIP 은 이미 쓰고 있는 jszip(사진 zip 다운로드)을 그대로 쓴다.
 *   XML 은 아래에서 직접 짓는다.
 *
 * ─ 주의 (한글이 파일을 거부하는 흔한 원인)
 *   · `mimetype` 은 **application/hwp+zip** 이고 zip 의 **첫 항목 · 무압축(STORE)** 이어야 한다.
 *   · 속성에는 네임스페이스 접두어를 **붙이지 않는다** (`paraPrIDRef`, `hp:paraPrIDRef` 아님).
 *   · 첫 문단에 `hp:secPr`(용지 설정)가 있어야 한다.
 *   · 표의 칸은 `cellAddr`·`cellSpan`·`cellSz`·`cellMargin` 이 모두 필요하고,
 *     **병합돼서 가려진 칸은 아예 쓰지 않는다.**
 *   구조는 scripts/hwpx.test.mjs 가 실제로 만들어 보고 검사한다.
 */

import type { LessonPlan, LessonPlanItem, OrgProfile, PlanSlot } from './types';
import {
  grandTotal,
  hasUnpriced,
  lineTotal,
  moneyInKoreanLine,
  orgLine,
  priceText,
  validUntil,
  vatLabel,
  vatSplit,
  type ProposalInput,
} from './proposal';

/* HWPUNIT = 1/7200 인치. 1mm = 7200/25.4 */
const PER_MM = 7200 / 25.4;
export const mm = (v: number) => Math.round(v * PER_MM);

/* A4 용지와 여백 — 인쇄(PlanSheet)와 같은 값으로 맞춘다 */
const PAGE_W = mm(210);
const PAGE_H = mm(297);
const MARGIN_X = mm(12);
const MARGIN_Y = mm(14);
const TEXT_W = PAGE_W - MARGIN_X * 2; // 186mm

/* 표 3칸 폭 — 과정 / 교구·기타 / 내용 */
const COL_STEP = mm(22);
const COL_SUB = mm(20);
const COL_BODY = TEXT_W - COL_STEP - COL_SUB;

/* borderFill 번호 (header.xml 에서 정의한 순서) */
const BF_NONE = 1; // 테두리 없음
const BF_CELL = 2; // 실선 칸
const BF_HEAD = 3; // 실선 + 머리칸 배경

/* charPr 번호 */
const CH_BODY = 0;
const CH_BOLD = 1;
const CH_TITLE = 2;
const CH_SMALL = 3;

/* paraPr 번호 */
const PA_LEFT = 0;
const PA_CENTER = 1;

const NS = [
  'xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app"',
  'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"',
  'xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph"',
  'xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"',
  'xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"',
  'xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"',
  'xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history"',
  'xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page"',
  'xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"',
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  'xmlns:opf="http://www.idpf.org/2007/opf/"',
  'xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart"',
  'xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar"',
  'xmlns:epub="http://www.idpf.org/2007/ops"',
  'xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"',
].join(' ');

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 문서 안에서 겹치지 않는 id. Math.random 을 안 써서 같은 입력이면 같은 파일이 나온다 */
function makeIds() {
  let n = 1000000;
  return () => String(++n);
}

/** 맨 아래 로고는 활동 줄이 아니라서 이 이름으로 구분해 싣는다 */
export const LOGO_ITEM_ID = '__logo__';

/** 이 문서에 들어갈 그림 한 장 */
export interface HwpxPic {
  /** 어느 활동 줄(lesson_plan_items.id)의 사진인지 */
  itemId: string;
  /** BIN0001 같은 참조 이름 */
  binId: string;
  ext: string;
  data: Uint8Array;
  /** 넣을 크기 (HWPUNIT) */
  w: number;
  h: number;
}

/* ------------------------------------------------------------------ 조각들 */

const LINESEG = (w: number) =>
  `<hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000" textheight="1000"` +
  ` baseline="850" spacing="600" horzpos="0" horzsize="${w}" flags="393216"/></hp:linesegarray>`;

/** 글 한 줄. 줄바꿈은 한글에서도 줄바꿈이 되도록 문단을 나눠 담는다 */
function para(
  id: () => string,
  text: string,
  opt: { charPr?: number; paraPr?: number; width?: number; inner?: string } = {},
): string {
  const ch = opt.charPr ?? CH_BODY;
  const pa = opt.paraPr ?? PA_LEFT;
  const w = opt.width ?? COL_BODY;
  const body =
    opt.inner ??
    (text.length > 0 ? `<hp:run charPrIDRef="${ch}"><hp:t>${esc(text)}</hp:t></hp:run>` : `<hp:run charPrIDRef="${ch}"><hp:t/></hp:run>`);
  return (
    `<hp:p paraPrIDRef="${pa}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0" id="${id()}">` +
    body +
    LINESEG(w) +
    `</hp:p>`
  );
}

/** 여러 줄 글 — 빈 줄도 살려서 문단으로 나눈다 */
function paras(
  id: () => string,
  text: string | null,
  opt: { charPr?: number; paraPr?: number; width?: number } = {},
): string {
  const lines = (text ?? '').split('\n');
  return lines.map((ln) => para(id, ln, opt)).join('');
}

/** 그림 한 장 (글자처럼 취급 — treatAsChar=1) */
function picXml(id: () => string, p: HwpxPic): string {
  const n = id();
  return (
    `<hp:pic textWrap="SQUARE" textFlow="BOTH_SIDES" reverse="0" id="${n}" zOrder="0"` +
    ` numberingType="PICTURE" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${n}">` +
    `<hp:offset x="0" y="0"/>` +
    `<hp:orgSz width="${p.w}" height="${p.h}"/>` +
    `<hp:curSz width="${p.w}" height="${p.h}"/>` +
    `<hp:flip horizontal="0" vertical="0"/>` +
    `<hp:rotationInfo angle="0" centerX="${Math.round(p.w / 2)}" centerY="${Math.round(p.h / 2)}" rotateimage="1"/>` +
    `<hp:renderingInfo>` +
    `<hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>` +
    `<hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>` +
    `<hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>` +
    `</hp:renderingInfo>` +
    `<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${p.w}" y="0"/><hc:pt2 x="${p.w}" y="${p.h}"/><hc:pt3 x="0" y="${p.h}"/></hp:imgRect>` +
    `<hp:imgClip left="0" right="${p.w}" top="0" bottom="${p.h}"/>` +
    `<hp:inMargin left="0" right="0" top="0" bottom="0"/>` +
    `<hp:imgDim dimwidth="${p.w}" dimheight="${p.h}"/>` +
    `<hc:img binaryItemIDRef="${p.binId}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>` +
    `<hp:effects/>` +
    `<hp:sz width="${p.w}" height="${p.h}" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE" protect="0"/>` +
    `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0"` +
    ` vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
    `<hp:outMargin left="0" right="0" top="0" bottom="0"/>` +
    `<hp:shapeComment/>` +
    `</hp:pic>`
  );
}

/** 그림만 든 문단 */
function picPara(id: () => string, p: HwpxPic, width: number): string {
  return para(id, '', {
    paraPr: PA_CENTER,
    width,
    inner: `<hp:run charPrIDRef="${CH_BODY}">${picXml(id, p)}</hp:run>`,
  });
}

interface Cell {
  /** 칸 안 문단 XML */
  body: string;
  col: number;
  row: number;
  colSpan?: number;
  rowSpan?: number;
  width: number;
  height: number;
  head?: boolean;
}

function cellXml(c: Cell): string {
  const bf = c.head ? BF_HEAD : BF_CELL;
  return (
    `<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${bf}">` +
    `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${c.head ? 'CENTER' : 'TOP'}"` +
    ` linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">` +
    c.body +
    `</hp:subList>` +
    `<hp:cellAddr colAddr="${c.col}" rowAddr="${c.row}"/>` +
    `<hp:cellSpan colSpan="${c.colSpan ?? 1}" rowSpan="${c.rowSpan ?? 1}"/>` +
    `<hp:cellSz width="${c.width}" height="${c.height}"/>` +
    `<hp:cellMargin left="510" right="510" top="141" bottom="141"/>` +
    `</hp:tc>`
  );
}

function tableXml(
  id: () => string,
  rows: Cell[][],
  totalH: number,
  colCnt = 3,
  totalW = TEXT_W,
): string {
  const rowCnt = rows.length;
  const trs = rows.map((r) => `<hp:tr>${r.map(cellXml).join('')}</hp:tr>`).join('');
  return (
    `<hp:tbl id="${id()}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES"` +
    ` lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="0" rowCnt="${rowCnt}" colCnt="${colCnt}"` +
    ` cellSpacing="0" borderFillIDRef="${BF_CELL}" noAdjust="0">` +
    `<hp:sz width="${totalW}" widthRelTo="ABSOLUTE" height="${totalH}" heightRelTo="ABSOLUTE" protect="0"/>` +
    `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0"` +
    ` vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
    `<hp:outMargin left="0" right="0" top="0" bottom="0"/>` +
    `<hp:inMargin left="510" right="510" top="141" bottom="141"/>` +
    trs +
    `</hp:tbl>`
  );
}

/* ------------------------------------------------------- header.xml (고정) */

const FONT_LANGS = ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER'];

/** 언어 7종 × 폰트 1개. 한글 기본 글꼴을 쓴다 (없는 글꼴을 넣으면 한글이 대체 글꼴을 묻는다) */
const FONTFACES =
  `<hh:fontfaces itemCnt="7">` +
  FONT_LANGS.map(
    (lang) =>
      `<hh:fontface lang="${lang}" fontCnt="1">` +
      `<hh:font id="0" face="함초롬돋움" type="TTF" isEmbedded="0">` +
      `<hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1"` +
      ` armStyle="1" letterform="1" midline="1" xHeight="1"/>` +
      `</hh:font></hh:fontface>`,
  ).join('') +
  `</hh:fontfaces>`;

function borderFill(id: number, line: boolean, fill?: string): string {
  const b = (tag: string) =>
    `<hh:${tag} type="${line ? 'SOLID' : 'NONE'}" width="0.12 mm" color="#000000"/>`;
  return (
    `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">` +
    `<hh:slash type="NONE" Crooked="0" isCounter="0"/>` +
    `<hh:backSlash type="NONE" Crooked="0" isCounter="0"/>` +
    b('leftBorder') +
    b('rightBorder') +
    b('topBorder') +
    b('bottomBorder') +
    `<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>` +
    (fill
      ? `<hc:fillBrush><hc:winBrush faceColor="${fill}" hatchColor="#999999" alpha="0"/></hc:fillBrush>`
      : '') +
    `</hh:borderFill>`
  );
}

/** 글자 모양 — 크기는 1/100pt (1000 = 10pt) */
function charPr(id: number, height: number, bold: boolean): string {
  const seven = (tag: string, v: string) =>
    `<hh:${tag} hangul="${v}" latin="${v}" hanja="${v}" japanese="${v}" other="${v}" symbol="${v}" user="${v}"/>`;
  return (
    `<hh:charPr id="${id}" height="${height}" textColor="#000000" shadeColor="none" useFontSpace="0"` +
    ` useKerning="0" symMark="NONE" borderFillIDRef="${BF_NONE}">` +
    seven('fontRef', '0') +
    seven('ratio', '100') +
    seven('spacing', '0') +
    seven('relSz', '100') +
    seven('offset', '0') +
    (bold ? `<hh:bold/>` : '') +
    `<hh:underline type="NONE" shape="SOLID" color="#000000"/>` +
    `<hh:strikeout shape="NONE" color="#000000"/>` +
    `<hh:outline type="NONE"/>` +
    `<hh:shadow type="NONE" color="#C0C0C0" offsetX="10" offsetY="10"/>` +
    `</hh:charPr>`
  );
}

function paraPr(id: number, align: string): string {
  const margin =
    `<hh:margin>` +
    `<hc:intent value="0" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/>` +
    `<hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/>` +
    `<hc:next value="0" unit="HWPUNIT"/>` +
    `</hh:margin>` +
    `<hh:lineSpacing type="PERCENT" value="150" unit="HWPUNIT"/>`;
  return (
    `<hh:paraPr id="${id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1"` +
    ` suppressLineNumbers="0" checked="0" textDir="LTR">` +
    `<hh:align horizontal="${align}" vertical="BASELINE"/>` +
    `<hh:heading type="NONE" idRef="0" level="0"/>` +
    `<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="BREAK_WORD" widowOrphan="0"` +
    ` keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>` +
    `<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>` +
    `<hp:switch>` +
    `<hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar">${margin}</hp:case>` +
    `<hp:default>${margin}</hp:default>` +
    `</hp:switch>` +
    `<hh:border borderFillIDRef="${BF_NONE}" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0"` +
    ` connect="0" ignoreMargin="0"/>` +
    `</hh:paraPr>`
  );
}

function headerXml(bins: { binId: string; ext: string }[]): string {
  return (
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<hh:head ${NS} version="1.5" secCnt="1">` +
  `<hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>` +
  `<hh:refList>` +
  FONTFACES +
  `<hh:borderFills itemCnt="3">` +
  borderFill(BF_NONE, false) +
  borderFill(BF_CELL, true) +
  borderFill(BF_HEAD, true, '#DCE4F5') +
  `</hh:borderFills>` +
  `<hh:charProperties itemCnt="4">` +
  charPr(CH_BODY, 900, false) +
  charPr(CH_BOLD, 900, true) +
  charPr(CH_TITLE, 1200, true) +
  charPr(CH_SMALL, 800, false) +
  `</hh:charProperties>` +
  `<hh:tabProperties itemCnt="1"><hh:tabPr id="0" autoTabLeft="0" autoTabRight="0"/></hh:tabProperties>` +
  `<hh:numberings itemCnt="1">` +
  `<hh:numbering id="1" start="0">` +
  Array.from({ length: 7 })
    .map(
      (_, i) =>
        `<hh:paraHead start="1" level="${i + 1}" align="LEFT" useInstWidth="1" autoIndent="1"` +
        ` widthAdjust="0" textOffsetType="PERCENT" textOffset="50" numFormat="DIGIT"` +
        ` charPrIDRef="4294967295" checkable="0">^${i + 1}.</hh:paraHead>`,
    )
    .join('') +
  `</hh:numbering>` +
  `</hh:numberings>` +
  `<hh:paraProperties itemCnt="2">` +
  paraPr(PA_LEFT, 'LEFT') +
  paraPr(PA_CENTER, 'CENTER') +
  `</hh:paraProperties>` +
  `<hh:styles itemCnt="1">` +
  `<hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0"` +
  ` nextStyleIDRef="0" langID="1042" lockForm="0"/>` +
  `</hh:styles>` +
  // 넣은 그림을 여기서 선언해야 한글이 hc:img 의 binaryItemIDRef 를 찾는다.
  // 잇는 열쇠는 id 가 아니라 **BinData 파일이름(확장자 뺀 것)** 이다.
  `<hh:binDataList itemCnt="${bins.length}">` +
  bins
    .map(
      (b, i) =>
        `<hh:binItem id="${i}" Type="Embedding" BinData="${b.binId}.${b.ext}" Format="${b.ext}"/>`,
    )
    .join('') +
  `</hh:binDataList>` +
  `</hh:refList>` +
  // 이게 없으면 한글이 '호환 문서' 정보를 못 찾는다
  `<hh:compatibleDocument targetProgram="HWP201X"><hh:layoutCompatibility/></hh:compatibleDocument>` +
  `</hh:head>`
  );
}

/* --------------------------------------------------- section0.xml (본문) */

const SEC_PR =
  `<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="4000"` +
  ` tabStopUnit="HWPUNIT" outlineShapeIDRef="1" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0">` +
  `<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/>` +
  `<hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>` +
  `<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL"` +
  ` fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>` +
  `<hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>` +
  `<hp:pagePr landscape="WIDELY" width="${PAGE_W}" height="${PAGE_H}" gutterType="LEFT_ONLY">` +
  `<hp:margin header="${mm(10)}" footer="${mm(10)}" gutter="0" left="${MARGIN_X}" right="${MARGIN_X}"` +
  ` top="${MARGIN_Y}" bottom="${MARGIN_Y}"/>` +
  `</hp:pagePr>` +
  `<hp:footNotePr>` +
  `<hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>` +
  `<hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/>` +
  `<hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/>` +
  `<hp:numbering type="CONTINUOUS" newNum="1"/>` +
  `<hp:placement place="EACH_COLUMN" beneathText="0"/>` +
  `</hp:footNotePr>` +
  `<hp:endNotePr>` +
  `<hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>` +
  `<hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/>` +
  `<hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/>` +
  `<hp:numbering type="CONTINUOUS" newNum="1"/>` +
  `<hp:placement place="END_OF_DOCUMENT" beneathText="0"/>` +
  `</hp:endNotePr>` +
  ['BOTH', 'EVEN', 'ODD']
    .map(
      (t) =>
        `<hp:pageBorderFill type="${t}" borderFillIDRef="${BF_NONE}" textBorder="PAPER" headerInside="0"` +
        ` footerInside="0" fillArea="PAPER">` +
        `<hp:offset left="1417" right="1417" top="1417" bottom="1417"/>` +
        `</hp:pageBorderFill>`,
    )
    .join('') +
  `</hp:secPr>`;

const bySlot = (items: LessonPlanItem[], s: PlanSlot) =>
  items.filter((i) => i.slot === s).sort((a, b) => a.sort_order - b.sort_order);

/**
 * 전개 칸 — 인쇄물(PlanSheet)과 같은 배치로 만든다.
 * 웹앱활동·만드는 순서·결과 이미지 모두 **가로 한 줄**(최대 3칸)이라
 * 칸 안에 작은 표를 하나 더 넣는다.
 */
function devCell(
  id: () => string,
  plan: LessonPlan,
  items: LessonPlanItem[],
  picOf: (item: LessonPlanItem, w: number) => HwpxPic | null,
  cellW: number,
): string {
  const steps = bySlot(items, 'step');
  const orders = bySlot(items, 'order');
  const results = bySlot(items, 'result');
  const out: string[] = [];

  const block = (title: string | null, rows: LessonPlanItem[]) => {
    if (rows.length === 0) return;
    if (title) out.push(para(id, title, { charPr: CH_BOLD, width: cellW }));

    // 사진이 1장뿐이면 표를 만들지 않고 **반 폭으로 가운데** 놓는다 — 인쇄물·원본 양식과 같다.
    // (빈 칸을 옆에 붙이는 식으로 하면 왼쪽으로 쏠린다)
    if (rows.length === 1) {
      const r = rows[0];
      out.push(para(id, r.label ?? '', { charPr: CH_SMALL, paraPr: PA_CENTER, width: cellW }));
      const p = picOf(r, Math.floor(cellW / 2));
      if (p) out.push(picPara(id, p, cellW));
      return;
    }

    // 한 줄에 3칸씩 끊는다. 넘치면 다음 줄
    for (let i = 0; i < rows.length; i += 3) {
      const chunk = rows.slice(i, i + 3);
      const cols = chunk.length;
      const colW = Math.floor(cellW / cols);
      const picW = colW - mm(4);
      const cells: Cell[] = chunk.map((r, ci) => {
        const p = picOf(r, picW);
        const inner =
          para(id, r.label ?? '', { charPr: CH_SMALL, width: colW }) +
          (p ? picPara(id, p, colW) : '');
        return { body: inner, col: ci, row: 0, width: colW, height: mm(35) };
      });
      out.push(
        para(id, '', {
          width: cellW,
          inner: `<hp:run charPrIDRef="${CH_BODY}">${tableXml(id, [cells], mm(35), cols, cellW)}</hp:run>`,
        }),
      );
    }
  };

  block(steps.length > 0 ? plan.dev_title : null, steps);
  if (orders.length > 0 || results.length > 0) {
    if (plan.work_title) out.push(para(id, plan.work_title, { charPr: CH_BOLD, width: cellW }));
    block('*만드는 순서', orders);
    block('* 결과 이미지', results);
  }
  if (out.length === 0) out.push(para(id, '', { width: cellW }));
  return out.join('');
}

/** 강의계획서 한 장을 표로 짓는다 — 칸 이름·순서는 PlanSheet(인쇄)와 같다 */
function planSectionXml(
  plan: LessonPlan,
  items: LessonPlanItem[],
  title: string,
  picOf: (item: LessonPlanItem, w: number) => HwpxPic | null,
): string {
  const id = makeIds();
  const wide = COL_SUB + COL_BODY; // 내용 칸(2칸 병합)
  const H = mm(9);

  const headCell = (text: string, row: number, opt: Partial<Cell> = {}): Cell => ({
    body: para(id, text, { charPr: CH_BOLD, paraPr: PA_CENTER, width: opt.width ?? COL_STEP }),
    col: 0,
    row,
    width: COL_STEP,
    height: H,
    head: true,
    ...opt,
  });
  const textRow = (label: string, value: string | null, row: number, h = H): Cell[] => [
    headCell(label, row, { height: h }),
    {
      body: paras(id, value, { width: wide }),
      col: 1,
      row,
      colSpan: 2,
      width: wide,
      height: h,
    },
  ];

  const devH = mm(120);
  const rows: Cell[][] = [
    // 제목 — 프로그램명 + 분류
    [
      {
        body: para(id, plan.category ? `${title}   [${plan.category}]` : title, {
          charPr: CH_TITLE,
          paraPr: PA_CENTER,
          width: TEXT_W,
        }),
        col: 0,
        row: 0,
        colSpan: 3,
        width: TEXT_W,
        height: mm(12),
        head: true,
      },
    ],
    // 과정 | 강의내용
    [
      headCell('과 정', 1),
      {
        body: para(id, '강 의 내 용', { charPr: CH_BOLD, paraPr: PA_CENTER, width: wide }),
        col: 1,
        row: 1,
        colSpan: 2,
        width: wide,
        height: H,
        head: true,
      },
    ],
    textRow('목 표', plan.goal, 2, mm(14)),
    textRow('도 입', plan.intro, 3, mm(12)),
    // 전개 — 사진이 들어가는 칸
    [
      headCell('전 개', 4, { height: devH }),
      {
        body: devCell(id, plan, items, picOf, wide),
        col: 1,
        row: 4,
        colSpan: 2,
        width: wide,
        height: devH,
      },
    ],
    textRow('마 무 리', plan.closing, 5, mm(12)),
    // 운영사항 — 왼쪽 칸이 두 줄에 걸친다
    [
      headCell('운 영 사 항', 6, { rowSpan: 2, height: H }),
      {
        body: para(id, '교 구', { charPr: CH_BOLD, paraPr: PA_CENTER, width: COL_SUB }),
        col: 1,
        row: 6,
        width: COL_SUB,
        height: H,
        head: true,
      },
      { body: paras(id, plan.tools, { width: COL_BODY }), col: 2, row: 6, width: COL_BODY, height: H },
    ],
    // 병합돼 가려진 왼쪽 칸은 아예 쓰지 않는다
    [
      {
        body: para(id, '기타사항', { charPr: CH_BOLD, paraPr: PA_CENTER, width: COL_SUB }),
        col: 1,
        row: 7,
        width: COL_SUB,
        height: H,
        head: true,
      },
      { body: paras(id, plan.etc, { width: COL_BODY }), col: 2, row: 7, width: COL_BODY, height: H },
    ],
  ];

  const totalH = rows.reduce((s, r) => s + (r[0]?.height ?? H), 0);

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<hs:sec ${NS}>` +
    // 첫 문단에 용지 설정 + 제목
    para(id, '강 의 계 획 서', {
      charPr: CH_TITLE,
      paraPr: PA_CENTER,
      width: TEXT_W,
      inner:
        `<hp:run charPrIDRef="${CH_BODY}">${SEC_PR}<hp:ctrl>` +
        `<hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/>` +
        `</hp:ctrl></hp:run>` +
        `<hp:run charPrIDRef="${CH_TITLE}"><hp:t>강 의 계 획 서</hp:t></hp:run>`,
    }) +
    // 표
    para(id, '', {
      width: TEXT_W,
      inner: `<hp:run charPrIDRef="${CH_BODY}">${tableXml(id, rows, totalH)}</hp:run>`,
    }) +
    // 맨 아래 — 로고를 올렸으면 로고, 없으면 기본 문구 (인쇄물과 같다)
    (() => {
      const logo = picOf({ id: LOGO_ITEM_ID } as LessonPlanItem, mm(40));
      if (logo) return picPara(id, logo, TEXT_W);
      return para(id, '모아킷_교육을 위한 모든 것', {
        charPr: CH_SMALL,
        paraPr: PA_CENTER,
        width: TEXT_W,
      });
    })() +
    `</hs:sec>`
  );
}

/* ------------------------------------------------- 패키지(ZIP) 로 묶기 */

/**
 * 한글이 읽을 수 있는 그림 형식만 여기 넣는다.
 * **WebP 를 넣지 말 것** — 이 앱은 사진을 WebP 로 저장하지만(`image.ts`)
 * 한글은 WebP 를 못 읽어서 그림 자리에 깨진 아이콘만 나온다.
 * 그래서 넣기 전에 toHwpImage() 가 JPEG/PNG 로 바꾼다.
 */
export const HWP_IMAGE_MEDIA: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
};
const MEDIA = HWP_IMAGE_MEDIA;

/**
 * .hwpx 안에 들어갈 파일들을 만든다. **브라우저 API 를 안 쓰는 순수 함수**라
 * scripts/hwpx.test.mjs 가 node 에서 그대로 돌려보고 검사한다.
 */
export function buildPlanHwpxFiles(
  plan: LessonPlan,
  items: LessonPlanItem[],
  title: string,
  pics: HwpxPic[],
): Record<string, string | Uint8Array> {
  const picFor = (item: LessonPlanItem, w: number): HwpxPic | null => {
    const found = pics.find((p) => p.itemId === item.id);
    if (!found) return null;
    // 칸 폭에 맞춰 비율 그대로 줄인다 (자르지 않는다)
    const scale = Math.min(1, w / found.w);
    return { ...found, w: Math.round(found.w * scale), h: Math.round(found.h * scale) };
  };

  return packageFiles(
    title,
    planSectionXml(plan, items, title, picFor),
    [title, plan.goal ?? '', plan.intro ?? '', plan.closing ?? ''].join('\n'),
    pics,
  );
}

/**
 * 본문(section0.xml)만 다른 문서들이 **같은 껍데기**를 쓴다 — 강의계획서·제안서.
 * mimetype·manifest·header 를 문서마다 따로 두면 한쪽만 고쳐져서 한글이 한쪽만 거부한다.
 */
function packageFiles(
  title: string,
  sectionXml: string,
  preview: string,
  pics: HwpxPic[],
): Record<string, string | Uint8Array> {
  const bins = pics.map((p) => ({
    ...p,
    href: `BinData/${p.binId}.${p.ext}`,
    media: MEDIA[p.ext] ?? 'image/png',
  }));

  const manifest =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" odf:version="1.2">` +
    bins
      .map(
        (b) =>
          `<odf:file-entry odf:full-path="${b.href}" odf:media-type="${b.media}"/>`,
      )
      .join('') +
    `</odf:manifest>`;

  const contentHpf =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:dc="http://purl.org/dc/elements/1.1/"` +
    ` version="" unique-identifier="" id="">` +
    `<opf:metadata>` +
    `<opf:title>${esc(title)}</opf:title>` +
    `<opf:language>ko</opf:language>` +
    `<opf:meta name="creator" content="모아랩"/>` +
    `</opf:metadata>` +
    `<opf:manifest>` +
    `<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>` +
    `<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>` +
    `<opf:item id="settings" href="settings.xml" media-type="application/xml"/>` +
    `<opf:item id="version" href="version.xml" media-type="application/xml"/>` +
    bins
      .map(
        (b) =>
          `<opf:item id="${b.binId}" href="${b.href}" media-type="${b.media}" isEmbeded="1"/>`,
      )
      .join('') +
    `</opf:manifest>` +
    `<opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine>` +
    `</opf:package>`;

  const files: Record<string, string | Uint8Array> = {
    mimetype: 'application/hwp+zip',
    'version.xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version"` +
      ` tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="1" buildNumber="0"` +
      ` os="1" xmlVersion="1.5" application="moalab" appVersion="1.0"/>`,
    'settings.xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app">` +
      `<ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/>` +
      `</ha:HWPApplicationSetting>`,
    'META-INF/container.xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container"` +
      ` xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf">` +
      `<ocf:rootfiles>` +
      `<ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/>` +
      `</ocf:rootfiles>` +
      `</ocf:container>`,
    'META-INF/manifest.xml': manifest,
    'Contents/content.hpf': contentHpf,
    'Contents/header.xml': headerXml(bins),
    'Contents/section0.xml': sectionXml,
    'Preview/PrvText.txt': preview,
  };
  for (const b of bins) files[b.href] = b.data;
  return files;
}

/* ------------------------------------------------------- 제안서 본문 */

/** 제안서 사진의 itemId — `프로그램id#몇번째` */
export const proposalPicId = (appId: string, index: number) => `${appId}#${index}`;

/**
 * 제안서 한 벌을 짓는다 — 배치는 인쇄물(ProposalSheet)과 같다.
 * 표지(받는 곳·인사말·요약표) → 프로그램마다 한 묶음(소개·목표·사진) → 맺음말·회사 정보.
 * 한글에서는 쪽을 억지로 가르지 않는다 — 글 길이대로 흐르게 두는 편이 편집하기 낫다.
 */
function proposalSectionXml(
  input: ProposalInput,
  org: OrgProfile,
  picOf: (itemId: string, w: number) => HwpxPic | null,
): string {
  const id = makeIds();
  const H = mm(8);
  const out: string[] = [];

  // 첫 문단 — 용지 설정 + 제목
  out.push(
    para(id, '프로그램 제안서', {
      charPr: CH_TITLE,
      paraPr: PA_CENTER,
      width: TEXT_W,
      inner:
        `<hp:run charPrIDRef="${CH_BODY}">${SEC_PR}<hp:ctrl>` +
        `<hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/>` +
        `</hp:ctrl></hp:run>` +
        `<hp:run charPrIDRef="${CH_TITLE}"><hp:t>프로그램 제안서</hp:t></hp:run>`,
    }),
  );
  out.push(para(id, '', { width: TEXT_W }));
  out.push(para(id, `받는 곳 : ${input.org}${input.contact ? `  (담당 ${input.contact})` : ''}`, { charPr: CH_BOLD, width: TEXT_W }));
  out.push(para(id, `제안일 : ${input.date}${org.name ? `    보내는 곳 : ${org.name}` : ''}`, { width: TEXT_W }));
  out.push(para(id, '', { width: TEXT_W }));
  out.push(paras(id, input.greeting, { width: TEXT_W }));
  out.push(para(id, '', { width: TEXT_W }));

  // 요약표 — 프로그램 | 대상 | 차시 | 인원 | 1인당 | 금액
  const widths = [mm(62), mm(24), mm(16), mm(16), mm(30), TEXT_W - mm(62) - mm(24) - mm(16) - mm(16) - mm(30)];
  const cell = (text: string, col: number, row: number, opt: Partial<Cell> = {}): Cell => ({
    body: para(id, text, { charPr: opt.head ? CH_BOLD : CH_BODY, paraPr: col === 0 && !opt.head ? PA_LEFT : PA_CENTER, width: widths[col] }),
    col,
    row,
    width: widths[col],
    height: H,
    ...opt,
  });
  const rows: Cell[][] = [
    ['프로그램', '대상', '차시', '인원', '1인당', '금액'].map((t, c) => cell(t, c, 0, { head: true })),
    ...input.items.map((it, i) => [
      cell(it.title, 0, i + 1),
      cell(it.grade || '-', 1, i + 1),
      cell(String(it.sessions), 2, i + 1),
      cell(String(it.headcount), 3, i + 1),
      cell(priceText(it.unitPrice), 4, i + 1),
      cell(priceText(lineTotal(it)), 5, i + 1),
    ]),
  ];
  const last = input.items.length + 1;
  rows.push([
    { ...cell('합계', 0, last, { head: true }), colSpan: 5, width: TEXT_W - widths[5] },
    cell(priceText(grandTotal(input.items)) + (hasUnpriced(input.items) ? ' (일부 협의)' : ''), 5, last, { head: true }),
  ]);
  out.push(
    para(id, '', {
      width: TEXT_W,
      inner: `<hp:run charPrIDRef="${CH_BODY}">${tableXml(id, rows, H * rows.length, 6, TEXT_W)}</hp:run>`,
    }),
  );
  out.push(para(id, '', { width: TEXT_W }));

  // 프로그램마다 한 묶음
  input.items.forEach((it, i) => {
    out.push(para(id, `${i + 1}. ${it.title}`, { charPr: CH_TITLE, width: TEXT_W }));
    const meta = [
      it.grade && `대상 ${it.grade}`,
      `${it.sessions}차시`,
      `${it.headcount}명`,
      `1인당 ${priceText(it.unitPrice)}`,
    ].filter(Boolean).join(' · ');
    out.push(para(id, meta, { charPr: CH_SMALL, width: TEXT_W }));
    if (it.purpose) out.push(paras(id, `이런 수업입니다 — ${it.purpose}`, { width: TEXT_W }));
    if (it.goal) out.push(paras(id, `수업 목표 — ${it.goal}`, { width: TEXT_W }));
    const pics = it.samples.map((_, k) => picOf(proposalPicId(it.appId, k), 0)).filter((p): p is HwpxPic => p !== null);
    if (pics.length > 0) {
      const cols = pics.length;
      const colW = Math.floor(TEXT_W / cols);
      const cells: Cell[] = pics.map((_, ci) => {
        const p = picOf(proposalPicId(it.appId, ci), colW - mm(4));
        return { body: p ? picPara(id, p, colW) : para(id, '', { width: colW }), col: ci, row: 0, width: colW, height: mm(45) };
      });
      out.push(
        para(id, '', {
          width: TEXT_W,
          inner: `<hp:run charPrIDRef="${CH_BODY}">${tableXml(id, [cells], mm(45), cols, TEXT_W)}</hp:run>`,
        }),
      );
    }
    out.push(para(id, '', { width: TEXT_W }));
  });

  out.push(paras(id, input.closing, { width: TEXT_W }));
  out.push(para(id, '', { width: TEXT_W }));
  if (org.name) out.push(para(id, orgLine(org), { charPr: CH_SMALL, paraPr: PA_CENTER, width: TEXT_W }));

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><hs:sec ${NS}>` + out.join('') + `</hs:sec>`;
}

/**
 * 제안서 .hwpx 안에 들어갈 파일들 — **브라우저 API 를 안 쓰는 순수 함수**라
 * scripts/hwpx.test.mjs 가 node 에서 그대로 검사한다.
 */
export function buildProposalHwpxFiles(
  input: ProposalInput,
  org: OrgProfile,
  pics: HwpxPic[],
): Record<string, string | Uint8Array> {
  const picFor = (itemId: string, w: number): HwpxPic | null => {
    const found = pics.find((p) => p.itemId === itemId);
    if (!found) return null;
    if (w <= 0) return found;
    const scale = Math.min(1, w / found.w);
    return { ...found, w: Math.round(found.w * scale), h: Math.round(found.h * scale) };
  };
  return packageFiles(
    `제안서 ${input.org}`,
    proposalSectionXml(input, org, picFor),
    [input.org, input.greeting, ...input.items.map((i) => i.title)].join('\n'),
    pics,
  );
}

/* -------------------------------------------------- 브라우저에서 내려받기 */

/** 사진 한 장을 받아서 크기까지 잰다. 못 받으면 그 장만 건너뛴다 (문서는 나간다) */
/**
 * 한글이 **읽을 수 있는 형식**으로 바꾼다.
 *
 * 이 앱은 올린 사진을 전부 **WebP** 로 저장하는데(`image.ts`) 한글은 WebP 를 못 읽는다.
 * 그대로 넣으면 파일은 열리고 배치도 맞는데 **그림 자리마다 깨진 아이콘**만 나온다.
 * 그래서 브라우저에서 캔버스로 다시 그려 JPEG(사진) / PNG(로고) 로 바꿔 넣는다.
 *
 * 인쇄용이라 원본 1600px 을 그대로 넣을 이유가 없다 — 넣는 칸이 60mm 안팎이라
 * 1200px 이면 충분하고, 파일도 그만큼 가벼워진다.
 */
const HWP_MAX_EDGE = 1200;

async function toHwpImage(
  url: string,
  wantPng: boolean,
): Promise<{ data: Uint8Array; ext: 'png' | 'jpg'; w: number; h: number } | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  // createImageBitmap 이 WebP 도 풀어준다
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, HWP_MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bmp.close?.();
    return null;
  }
  // JPEG 는 투명을 검게 칠하므로 흰 바탕을 먼저 깐다
  if (!wantPng) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();

  const out = await new Promise<Blob | null>((r) =>
    canvas.toBlob(r, wantPng ? 'image/png' : 'image/jpeg', 0.9),
  );
  if (!out || out.size === 0) return null;
  return { data: new Uint8Array(await out.arrayBuffer()), ext: wantPng ? 'png' : 'jpg', w, h };
}

/** 사진 한 장을 받아 한글용으로 바꾼다. 못 받으면 그 장만 건너뛴다 (문서는 나간다) */
async function loadPic(url: string, itemId: string, index: number, png = false): Promise<HwpxPic | null> {
  try {
    const img = await toHwpImage(url, png);
    if (!img) return null;
    const w = mm(60);
    return {
      itemId,
      binId: `BIN${String(index + 1).padStart(4, '0')}`,
      ext: img.ext,
      data: img.data,
      w,
      h: Math.round((w * img.h) / img.w),
    };
  } catch {
    return null;
  }
}


/* ------------------------------------------------------- 견적서 본문 */

/**
 * 견적서 한 벌 — 배치는 인쇄물(QuoteSheet)과 같다. 사진이 없어 그림 부품이 안 든다.
 * 수신·공급자 → 합계(한글 금액) → 품목 표(공급가액·부가세·합계 줄 포함) → 비고 → (인)
 */
function quoteSectionXml(input: ProposalInput, org: OrgProfile): string {
  const id = makeIds();
  const H = mm(8);
  const out: string[] = [];
  const split = vatSplit(input.items, input.vat);

  out.push(
    para(id, '견 적 서', {
      charPr: CH_TITLE,
      paraPr: PA_CENTER,
      width: TEXT_W,
      inner:
        `<hp:run charPrIDRef="${CH_BODY}">${SEC_PR}<hp:ctrl>` +
        `<hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/>` +
        `</hp:ctrl></hp:run>` +
        `<hp:run charPrIDRef="${CH_TITLE}"><hp:t>견 적 서</hp:t></hp:run>`,
    }),
  );
  out.push(para(id, '', { width: TEXT_W }));
  const until = validUntil(input.date, input.validDays);
  out.push(
    para(id, `견적번호 : ${input.quoteNo}    견적일 : ${input.date}    유효기간 : ${until ? `${until} 까지` : ''} (견적일로부터 ${input.validDays}일)`, {
      charPr: CH_SMALL,
      width: TEXT_W,
    }),
  );
  const who = [input.contact && `담당 ${input.contact}`, input.tel].filter(Boolean).join(' · ');
  out.push(para(id, `수신 : ${input.org} 귀하${who ? `  (${who})` : ''}`, { charPr: CH_BOLD, width: TEXT_W }));
  const supplier = [
    org.name && `상호 ${org.name}`,
    org.ceo && `대표 ${org.ceo}`,
    org.bizNo && `사업자등록번호 ${org.bizNo}`,
    org.tel,
    org.email,
    org.address,
  ]
    .filter(Boolean)
    .join(' · ');
  if (supplier) out.push(para(id, `공급자 : ${supplier}`, { width: TEXT_W }));
  out.push(para(id, '', { width: TEXT_W }));
  out.push(para(id, '아래와 같이 견적합니다.', { width: TEXT_W }));
  out.push(
    para(id, `합계 금액 (${vatLabel(input.vat)}) : ${moneyInKoreanLine(split.total)} (₩${split.total.toLocaleString('ko-KR')})`, {
      charPr: CH_BOLD,
      width: TEXT_W,
    }),
  );
  out.push(para(id, '', { width: TEXT_W }));

  // 품목 표 — No. | 품목 | 규격 | 수량 | 단가 | 금액
  const widths = [mm(12), mm(58), mm(36), mm(18), mm(28), TEXT_W - mm(12) - mm(58) - mm(36) - mm(18) - mm(28)];
  const cell = (text: string, col: number, row: number, opt: Partial<Cell> = {}): Cell => ({
    body: para(id, text, { charPr: opt.head ? CH_BOLD : CH_BODY, paraPr: col === 1 && !opt.head ? PA_LEFT : PA_CENTER, width: widths[col] }),
    col,
    row,
    width: widths[col],
    height: H,
    ...opt,
  });
  const rows: Cell[][] = [
    ['No.', '품목', '규격', '수량', '단가', '금액'].map((t, c) => cell(t, c, 0, { head: true })),
    ...input.items.map((it, i) => [
      cell(String(i + 1), 0, i + 1),
      cell(it.title, 1, i + 1),
      cell([it.grade, `${it.sessions}차시`].filter(Boolean).join(' · '), 2, i + 1),
      cell(`${it.headcount}명`, 3, i + 1),
      cell(priceText(it.unitPrice), 4, i + 1),
      cell(priceText(lineTotal(it)), 5, i + 1),
    ]),
  ];
  const foot: [string, number][] = [
    ['공급가액', split.supply],
    [input.vat === 'exempt' ? '부가세 (면세)' : '부가세', split.vat],
    ['합계', split.total],
  ];
  foot.forEach(([label, n], k) => {
    const r = input.items.length + 1 + k;
    const head = k === 2;
    rows.push([
      { ...cell(label, 0, r, { head }), colSpan: 5, width: TEXT_W - widths[5] },
      cell(`${n.toLocaleString('ko-KR')}원`, 5, r, { head }),
    ]);
  });
  out.push(
    para(id, '', {
      width: TEXT_W,
      inner: `<hp:run charPrIDRef="${CH_BODY}">${tableXml(id, rows, H * rows.length, 6, TEXT_W)}</hp:run>`,
    }),
  );
  out.push(para(id, '금액 = 단가(1인당) × 수량(인원) × 차시', { charPr: CH_SMALL, width: TEXT_W }));
  out.push(para(id, '', { width: TEXT_W }));

  if (input.terms.trim()) {
    out.push(para(id, '비고', { charPr: CH_BOLD, width: TEXT_W }));
    out.push(paras(id, input.terms, { width: TEXT_W }));
    out.push(para(id, '', { width: TEXT_W }));
  }
  out.push(para(id, `${input.date}    ${org.name}${org.ceo ? ` 대표 ${org.ceo}` : ''}  (인)`, { paraPr: PA_CENTER, width: TEXT_W }));

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><hs:sec ${NS}>` + out.join('') + `</hs:sec>`;
}

/** 견적서 .hwpx 안에 들어갈 파일들 — 순수 함수 (scripts/hwpx.test.mjs 가 검사한다) */
export function buildQuoteHwpxFiles(input: ProposalInput, org: OrgProfile): Record<string, string | Uint8Array> {
  return packageFiles(`견적서 ${input.org}`, quoteSectionXml(input, org), `견적서 ${input.org}`, []);
}

/** 갈래에 맞는 한 벌 — 인쇄 화면·제안서 화면이 쓴다 */
export function buildDocumentHwpxFiles(
  input: ProposalInput,
  org: OrgProfile,
  pics: HwpxPic[],
): Record<string, string | Uint8Array> {
  return input.kind === 'quote' ? buildQuoteHwpxFiles(input, org) : buildProposalHwpxFiles(input, org, pics);
}

/**
 * 강의계획서를 .hwpx 로 내려받는다.
 * 사진을 못 받아도 문서는 나가고, 몇 장이 빠졌는지 돌려준다.
 */
export async function downloadPlanHwpx(
  plan: LessonPlan,
  items: LessonPlanItem[],
  title: string,
): Promise<{ skipped: number; blob: Blob; fileName: string }> {
  const withUrl = items.filter((i) => i.url);
  const jobs: Promise<HwpxPic | null>[] = withUrl.map((i, idx) =>
    loadPic(i.url as string, i.id, idx),
  );
  // 로고는 투명한 배경을 살려야 해서 PNG 로 넣는다
  if (plan.logo_url) {
    jobs.push(loadPic(plan.logo_url, LOGO_ITEM_ID, withUrl.length, true));
  }
  const loaded = await Promise.all(jobs);
  const pics = loaded.filter((p): p is HwpxPic => p !== null);

  const files = buildPlanHwpxFiles(plan, items, title, pics);

  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  // mimetype 은 **첫 항목 · 무압축** 이어야 한글이 연다
  zip.file('mimetype', files.mimetype as string, { compression: 'STORE' });
  for (const [path, data] of Object.entries(files)) {
    if (path === 'mimetype') continue;
    zip.file(path, data);
  }

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/hwp+zip',
    compression: 'DEFLATE',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // 파일 이름에 못 쓰는 글자만 걷어낸다 (zip.ts 의 safeFileName 은 빈 이름을
  // 'photos' 로 되돌려서 여기엔 안 맞는다)
  const name = title.replace(/[\\/:*?"<>|]/g, '_').trim() || '강의계획서';
  a.download = `${name}.hwpx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 바로 revoke 하면 브라우저가 blob 을 다 읽기 전에 끊겨서
  // 파일 이름이 'download' 로 떨어진다 (zip.ts 와 같은 이유로 미룬다)
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  /* 만든 파일을 그대로 돌려준다 — 부르는 쪽이 구글 드라이브에도 한 벌 넣는다.
     여기서 직접 올리지 않는 이유: 이 파일은 순수 계산이고 서버·저장소를 모른다 */
  return { skipped: jobs.length - pics.length, blob, fileName: `${name}.hwpx` };
}

/**
 * 제안서를 .hwpx 로 내려받는다. 샘플 사진을 못 받아도 문서는 나가고, 몇 장이 빠졌는지 돌려준다.
 * 파일 이름은 ASCII 로 둔다 — 크로미움은 `<a download>` 에 한글이 있으면 이름을 통째로
 * 버린다 (CSV 에서 실제로 겪은 일. 안에 적힌 기관 이름은 그대로다).
 */
export async function downloadProposalHwpx(
  input: ProposalInput,
  org: OrgProfile,
): Promise<{ skipped: number; fileName: string }> {
  const jobs: Promise<HwpxPic | null>[] = [];
  let n = 0;
  if (input.kind !== 'quote') {
    // 견적서에는 사진이 안 든다 — 받을 것도 없다
    for (const it of input.items) {
      it.samples.forEach((url, k) => {
        jobs.push(loadPic(url, proposalPicId(it.appId, k), n));
        n += 1;
      });
    }
  }
  const loaded = await Promise.all(jobs);
  const pics = loaded.filter((p): p is HwpxPic => p !== null);
  const files = buildDocumentHwpxFiles(input, org, pics);

  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('mimetype', files.mimetype as string, { compression: 'STORE' });
  for (const [path, data] of Object.entries(files)) {
    if (path === 'mimetype') continue;
    zip.file(path, data);
  }
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/hwp+zip', compression: 'DEFLATE' });
  const fileName = `${input.kind === 'quote' ? 'quote' : 'proposal'}_${input.date}.hwpx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { skipped: jobs.length - pics.length, fileName };
}
