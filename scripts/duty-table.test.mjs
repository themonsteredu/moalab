/**
 * 역할에 붙는 표 — 계산·분류 테스트.
 *
 *   node scripts/duty-table.test.mjs
 *
 * src/lib/dutyTable.ts 를 임시로 컴파일해서 **실제 코드 그대로** 돌린다
 * (org.test.mjs 와 같은 방식).
 *
 * 여기서 막고 싶은 것:
 *   · **앱에 이미 자리가 있는 일에 표를 권하는 것.** 원가·지출·갤러리처럼
 *     제 화면이 있는 일에 표를 또 만들면 **데이터가 두 벌**이 되고 둘 다 못 쓴다.
 *     이 앱이 '따로국밥을 없앤 곳' 인데 부서별로 쪼개면 되돌아간다
 *   · 아무 데도 안 걸리는 역할에 **표가 기본으로 붙는 것** — 쓰지도 않을 빈 표가 63개 생긴다
 *   · 숫자 칸에 글자를 넣었을 때 **0 으로 묻히는 것** ('안 적음' 과 '0' 은 다르다)
 *   · 빈 글자가 `''` 로 남아 '없음' 판정이 화면마다 달라지는 것
 *   · 첫 칸이 비었는데 제목이 빈 카드가 되어 **목록에서 못 찾게 되는 것**
 *   · 모르는 갈래가 흘러들어 화면이 죽는 것
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const out = mkdtempSync(join(tmpdir(), 'moalab-dutytable-'));
let T;
try {
  execFileSync(
    'npx',
    ['tsc', 'src/lib/dutyTable.ts', 'src/lib/types.ts', '--outDir', out,
     '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { stdio: 'pipe' },
  );
  T = createRequire(import.meta.url)(join(out, 'dutyTable.js'));
} catch (e) {
  console.error('컴파일 실패:', e.stdout?.toString() || e.message);
  process.exit(1);
}

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    console.log(`  ok  ${label}`);
  } else {
    fail++;
    console.log(`FAIL  ${label}\n      기대 ${w}\n      실제 ${g}`);
  }
};

const col = (id, name, kind = 'text', options = null) => ({
  id, duty_id: 'x', name, kind, options, sort_order: 0, created_at: '',
});
const row = (id, cells) => ({
  id, duty_id: 'x', cells, sort_order: 0, updated_by: null, created_at: '', updated_at: '',
});

/* ------------------------------------------------------------- 분류 */

console.log('\n[갈래 — 원장님 실제 역할 63개를 그대로 돌린다]');
{
  /**
   * ⚠️ **여기가 이 파일의 본체다.** 지어낸 이름으로 재면 실제로 나는 사고를 못 잡는다.
   * 실제 중분류가 `[4주차] 검증, 피드백 및 파일럿 테스트` 처럼 넓은 말을 품고 있어서,
   * 이름과 중분류를 한 덩어리로 이어 재면 그 묶음이 통째로 '오류 목록' 이 됐다.
   * (그래서 `planFor` 는 **이름을 먼저** 보고, 이름이 아무 말도 안 할 때만 중분류를 본다)
   *
   * 열은 [역할, 중분류, 갈래, 갈 곳·양식, 부서] 다.
   */
  const REAL = [
    /* ── 기획개발부 ── */
    ["신규 주제 발굴 및 기획안 작성", "[1주차] 주제 발굴 및 핵심 기획 (아이디에이션 & 방향 설정)", "table", "idea", "기획개발부"],
    ["핵심 기능 정의", "[1주차] 주제 발굴 및 핵심 기획 (아이디에이션 & 방향 설정)", "table", "idea", "기획개발부"],
    ["원가·판매가 설계", "[1주차] 주제 발굴 및 핵심 기획 (아이디에이션 & 방향 설정)", "app", "/cost", "기획개발부"],
    ["웹앱 제작·배포", "[2주차] AI 웹앱 프로토타입 개발 및 커리큘럼 설계 (기술 구현 & 뼈대 잡기)", "app", "/apps", "기획개발부"],
    ["학년·차시 설계 (커리큘럼 뼈대)", "[2주차] AI 웹앱 프로토타입 개발 및 커리큘럼 설계 (기술 구현 & 뼈대 잡기)", "table", "curriculum", "기획개발부"],
    ["AI 키·사용량 관리 체계 세팅", "[2주차] AI 웹앱 프로토타입 개발 및 커리큘럼 설계 (기술 구현 & 뼈대 잡기)", "app", "/admin", "기획개발부"],
    ["강의계획서 및 강사 교육안 작성", "[3주차] 현장 실무 교안 및 수업 양식 제작 (패키지화)", "app", "/apps", "기획개발부"],
    ["활동지 및 학습 양식 제작", "[3주차] 현장 실무 교안 및 수업 양식 제작 (패키지화)", "table", "make", "기획개발부"],
    ["웹앱 UI/UX 최종 다듬기", "[3주차] 현장 실무 교안 및 수업 양식 제작 (패키지화)", "table", "bug", "기획개발부"],
    ["학년·차시 설계", "[3주차] 현장 실무 교안 및 수업 양식 제작 (패키지화)", "table", "curriculum", "기획개발부"],
    ["검증 지적 대응 및 디버깅", "[4주차] 검증, 피드백 및 파일럿 테스트 (마무리 및 런칭)", "table", "bug", "기획개발부"],
    ["데이터 백업 및 매뉴얼 문서화", "[4주차] 검증, 피드백 및 파일럿 테스트 (마무리 및 런칭)", "table", "doc", "기획개발부"],
    ["생산운영부 인계 (인프라 이관)", "[4주차] 검증, 피드백 및 파일럿 테스트 (마무리 및 런칭)", "table", "plan", "기획개발부"],
    /* ── 영업마케팅부 ── */
    ["제안서 작성·발송", "학교·기관 영업", "table", "school", "영업마케팅부"],
    ["견적·계약", "학교·기관 영업", "table", "school", "영업마케팅부"],
    ["신규 기관 발굴", "학교·기관 영업", "table", "school", "영업마케팅부"],
    ["SNS·블로그 운영", "홍보", "table", "make", "영업마케팅부"],
    ["브로셔만들기[A4버전]", "홍보", "table", "make", "영업마케팅부"],
    ["수업 사진 정리", "홍보", "app", "/gallery", "영업마케팅부"],
    ["브로셔만들기[영상]", "홍보", "table", "make", "영업마케팅부"],
    ["브로셔만들기[링크]", "홍보", "table", "make", "영업마케팅부"],
    ["명함제작", "홍보", "table", "make", "영업마케팅부"],
    ["담당 교사 응대", "고객 관리", "table", "school", "영업마케팅부"],
    ["만족도 조사", "고객 관리", "table", "school", "영업마케팅부"],
    ["재출강·재계약", "고객 관리", "table", "school", "영업마케팅부"],
    ["기관리스트관리", "고객 관리", "table", "school", "영업마케팅부"],
    /* ── 인사관리부 ── */
    ["강사 모집·면접", "강사 채용", "table", "people", "인사관리부"],
    ["신규 강사 등록", "강사 채용", "app", "/admin", "인사관리부"],
    ["양성과정 운영", "강사 교육", "app", "/training", "인사관리부"],
    ["모의수업 진행", "강사 교육", "app", "/mock", "인사관리부"],
    ["교육안 전달", "강사 교육", "table", "make", "인사관리부"],
    ["출강 일정 배정", "출강 관리", "app", "/schedule", "인사관리부"],
    ["강사 평가·피드백", "출강 관리", "table", "people", "인사관리부"],
    ["강사비 정산 자료", "출강 관리", "app", "/schedule", "인사관리부"],
    /* ── 경영지원부 ── */
    ["지출결의서 확인", "회계·정산", "app", "/expense", "경영지원부"],
    ["영수증 증빙 보관", "회계·정산", "app", "/expense", "경영지원부"],
    ["세금계산서·매출", "회계·정산", "app", "/revenue", "경영지원부"],
    ["계약 행정문서 관리", "회계·정산", "table", "doc", "경영지원부"],
    ["총무 자산관리", "회계·정산", "table", "stock", "경영지원부"],
    ["계정 권한 관리", "회계·정산", "app", "/admin", "경영지원부"],
    ["개인정보 자료보안", "회계·정산", "table", "check", "경영지원부"],
    ["계약서·공문 보관", "문서·총무", "table", "doc", "경영지원부"],
    ["사무용품·비품", "문서·총무", "table", "stock", "경영지원부"],
    ["업무앱 계정·권한", "전산·보안", "app", "/admin", "경영지원부"],
    ["데이터 백업", "전산·보안", "table", "doc", "경영지원부"],
    ["초상권 동의 관리", "전산·보안", "table", "people", "경영지원부"],
    /* ── 생산운영부 ── */
    ["재료 발주", "재료·교구", "table", "stock", "생산운영부"],
    ["재고·단가 확인", "재료·교구", "table", "stock", "생산운영부"],
    ["교구 점검·수리", "재료·교구", "table", "check", "생산운영부"],
    ["장비 충전 관리", "재료·교구", "table", "check", "생산운영부"],
    ["보관 위치 관리", "재료·교구", "table", "stock", "생산운영부"],
    ["원가율 관리•정산", "재료·교구", "app", "/cost", "생산운영부"],
    ["구매 증빙 전달", "재료·교구", "app", "/expense", "생산운영부"],
    ["키트 포장", "수업 키트 준비", "table", "plan", "생산운영부"],
    ["전날 준비물 점검", "수업 키트 준비", "table", "check", "생산운영부"],
    ["배송·운반", "수업 키트 준비", "table", "plan", "생산운영부"],
    ["키트 제작 메뉴얼 작성", "수업 키트 준비", "table", "make", "생산운영부"],
    ["작업 일정 관리", "수업 키트 준비", "table", "plan", "생산운영부"],
    ["현장 세팅·정리", "현장 운영", "table", "check", "생산운영부"],
    ["안전 지도", "현장 운영", "table", "check", "생산운영부"],
    ["수업 사진 촬영", "현장 운영", "app", "/gallery", "생산운영부"],
    ["긴급 준비물 관리", "현장 운영", "table", "check", "생산운영부"],
    ["수업 현장 사전 확인", "현장 운영", "table", "check", "생산운영부"],
  ];
  for (const [name, grp, mode, key] of REAL) {
    const p = T.planFor(name, grp);
    eq(name, [p.mode, p.href ?? p.preset], [mode, key]);
  }

  // 표를 권한 것은 전부 **실재하는 양식**이어야 한다 (없는 key 를 주면 화면이 빈다)
  const bad = REAL.filter(([n, g, m, k]) => m === 'table' && !T.presetOf(k));
  eq('권한 양식이 전부 실재한다', bad.map((b) => b[0]), []);

  // **앱에 자리가 있는 일에는 표를 권하지 않는다** — 데이터가 두 벌이 되면 둘 다 못 쓴다
  const dup = REAL.filter(([n, g, m, k]) => m === 'app' && k?.startsWith('/') === false);
  eq('바로가기는 전부 앱 주소다', dup.map((b) => b[0]), []);
}

console.log('\n[갈래 — 규칙이 서로 잡아먹지 않는다]');
{
  // '단가' 는 원가 규칙에도 있다. 앱 규칙이 먼저라 재고 역할이 /cost 로 끌려가면
  // 재고를 셀 표를 영영 못 만든다 — 그래서 '재고' 가 든 이름은 표여야 한다
  eq('재고·단가 확인은 표다 (원가로 끌려가지 않는다)', T.planFor('재고·단가 확인').mode, 'table');
  eq('원가·판매가 설계는 원가표로 간다', T.planFor('원가·판매가 설계').href, '/cost');
  // 중분류도 같이 본다 — 역할 이름이 짧을 때 갈래를 잡아준다
  eq('중분류로도 걸린다', T.planFor('신규 발굴', '학교·기관 영업').preset, 'school');
  // 추천 양식은 늘 실재하는 양식이다 (없는 key 를 주면 화면이 빈다)
  for (const p of T.PRESETS) eq(`양식 ${p.key} 은 첫 칸이 있다`, p.columns.length > 0, true);
  eq('추천 양식은 실재한다', T.PRESETS.every((p) => T.presetOf(p.key) !== null), true);
  /* 아무 데도 안 걸리면 **표를 안 권한다** — 기본을 표로 두면 쓰지도 않을 빈 표가 63개 생긴다 */
  eq('처음 보는 역할은 업로드만', T.planFor('외부 자문 회의록').mode, 'upload');
  eq('안 걸리면 빈 표를 권한다', T.suggestPreset('처음 보는 일').key, 'blank');

  /* ★ **이름이 중분류를 이긴다.** 이 한 줄이 4주차 묶음이 통째로 '오류 목록' 이
     되던 것을 막는다 — 이름에 `백업` 이 있으면 중분류가 뭐라 하든 보관 대장이다 */
  eq('이름이 중분류를 이긴다',
    T.planFor('데이터 백업', '[4주차] 검증, 피드백 및 파일럿 테스트').preset, 'doc');
  eq('이름이 아무 말도 안 하면 중분류가 거든다',
    T.planFor('신규 발굴', '학교·기관 영업').preset, 'school');
}

console.log('\n[양식 열 벌 — 화면이 기대하는 모양을 지킨다]');
{
  // 원장이 정한 개수다: "가장 잘 사용할 양식을 10가지". + 빈 표(양식이 아니라 빠져나갈 문)
  eq('양식 10 + 빈 표', T.PRESETS.length, 11);
  eq('마지막이 빈 표다 (안 걸릴 때 권하는 것)', T.PRESETS[T.PRESETS.length - 1].key, 'blank');
  eq('키가 겹치지 않는다', new Set(T.PRESETS.map((p) => p.key)).size, T.PRESETS.length);
  for (const p of T.PRESETS) {
    // 첫 칸은 그 줄의 제목이 된다 — 고르기·예/아니오면 카드 제목이 '예' 가 돼버린다
    eq(`${p.label} — 첫 칸이 이름 성격`, p.columns[0].kind, 'text');
    // 첫 select 열이 목록 오른쪽 상태 칩이다. 없으면 한눈에 진행이 안 보인다
    eq(`${p.label} — 상태 칩이 될 칸이 있다`, p.columns.some((c) => c.kind === 'select'), true);
    // 고르기 칸에 보기가 없으면 고를 수가 없다
    eq(`${p.label} — 고르기 칸엔 보기가 있다`,
      p.columns.filter((c) => c.kind === 'select').every((c) => (c.options ?? []).length > 0), true);
    eq(`${p.label} — 칸 이름이 겹치지 않는다`,
      new Set(p.columns.map((c) => c.name)).size, p.columns.length);
  }
}

/* --------------------------------------------------------------- 값 */

console.log('\n[값 다듬기]');
{
  eq('빈 글자는 null (빈 문자열을 남기면 없음 판정이 갈린다)', T.cleanCell('text', '  '), null);
  eq('앞뒤 공백은 턴다', T.cleanCell('text', ' 광주중 '), '광주중');
  eq('숫자는 숫자로', T.cleanCell('number', '1200'), 1200);
  eq('콤마가 섞여도 숫자로', T.cleanCell('number', '12,000'), 12000);
  eq('숫자 아닌 글자는 null — 0 으로 묻지 않는다', T.cleanCell('number', '몰라'), null);
  eq('0 은 0 으로 남는다', T.cleanCell('number', '0'), 0);
  eq('예/아니오는 늘 참·거짓', T.cleanCell('check', undefined), false);
  eq('예/아니오는 참', T.cleanCell('check', true), true);
  eq('날짜도 빈 값은 null', T.cleanCell('date', ''), null);
}

console.log('\n[모르는 갈래가 흘러들어도 안 죽는다]');
{
  eq('모르는 갈래는 글로', T.safeKind('rating'), 'text');
  eq('빈 값도 글로', T.safeKind(null), 'text');
  eq('아는 갈래는 그대로', T.safeKind('select'), 'select');
  eq('모르는 갈래의 값도 글자로 나온다', T.cellText(col('c', 'x', 'rating'), '별셋'), '별셋');
}

console.log('\n[화면 글자]');
{
  eq('숫자는 천 단위로 끊는다', T.cellText(col('c', '단가', 'number'), 1200000), '1,200,000');
  eq('예/아니오', T.cellText(col('c', '끝남', 'check'), true), '예');
  eq('안 적은 예/아니오는 아니오', T.cellText(col('c', '끝남', 'check'), null), '아니오');
  eq('안 적은 칸은 빈 글자', T.cellText(col('c', '메모'), null), '');
}

console.log('\n[줄 제목 — 첫 칸이다]');
{
  const cols = [col('c1', '학교·기관'), col('c2', '담당 선생님')];
  eq('첫 칸이 제목', T.rowTitle(cols, row('r1', { c1: '광주중', c2: '김선생' })), '광주중');
  eq('첫 칸이 비면 이름 없음 (빈 카드가 생기면 못 찾는다)', T.rowTitle(cols, row('r2', { c2: '김선생' })), '이름 없음');
  eq('공백만 적어도 이름 없음', T.rowTitle(cols, row('r3', { c1: '   ' })), '이름 없음');
  eq('열이 하나도 없어도 안 죽는다', T.rowTitle([], row('r4', {})), '이름 없음');
  eq('값이 통째로 없어도 안 죽는다', T.rowTitle(cols, { id: 'r5', cells: null }), '이름 없음');
}

console.log('\n[검색 — 어느 칸에 걸려도 남긴다]');
{
  const cols = [col('c1', '학교·기관'), col('c2', '담당 선생님'), col('c3', '수량', 'number')];
  const rows = [
    row('r1', { c1: '광주중학교', c2: '김선생', c3: 30 }),
    row('r2', { c1: '무등초등학교', c2: '이선생', c3: 25 }),
  ];
  eq('빈 검색어는 전부', T.filterRows(cols, rows, '  ').length, 2);
  eq('제목으로 찾기', T.filterRows(cols, rows, '광주').map((r) => r.id), ['r1']);
  eq('다른 칸으로도 찾기', T.filterRows(cols, rows, '이선생').map((r) => r.id), ['r2']);
  eq('숫자도 찾힌다', T.filterRows(cols, rows, '25').map((r) => r.id), ['r2']);
  eq('없는 말은 0건', T.filterRows(cols, rows, '없는말').length, 0);
}

console.log('\n[머리글에 싣는 상태 개수]');
{
  const cols = [
    col('c1', '학교'),
    col('c2', '진행 상태', 'select', ['연락 전', '제안서 보냄', '계약']),
    col('c3', '급한 정도', 'select', ['상', '하']),
  ];
  const rows = [
    row('r1', { c1: 'A중', c2: '연락 전' }),
    row('r2', { c1: 'B중', c2: '계약' }),
    row('r3', { c1: 'C중', c2: '계약' }),
    row('r4', { c1: 'D중' }),
  ];
  const s = T.statusCounts(cols, rows);
  eq('첫 고르기 칸만 센다 (두 개를 세면 머리글이 두 줄이 된다)', s.col.id, 'c2');
  eq('0건인 보기는 안 싣는다', s.counts, [{ label: '연락 전', n: 1 }, { label: '계약', n: 2 }]);
  eq('고르기 칸이 없으면 안 그린다', T.statusCounts([col('c1', '이름')], rows), null);
  eq('보기가 없는 고르기 칸도 안 그린다', T.statusCounts([col('c9', '상태', 'select', [])], rows), null);
  eq('아무도 안 고르면 안 그린다', T.statusCounts(cols, [row('rx', { c1: 'E중' })]), null);
}

console.log('\n[엑셀로 내보내기 — 열리는 것이 목적이다]');
{
  const cols = [
    col('c1', '학교·기관'),
    col('c2', '진행 상태', 'select', ['연락 전', '계약']),
    col('c3', '인원', 'number'),
    col('c4', '끝남', 'check'),
  ];
  const rows = [
    row('r1', { c1: '광주중학교', c2: '연락 전', c3: 30, c4: false }),
    row('r2', { c1: '무등, 초등학교', c2: '계약', c3: 1200, c4: true }),
    row('r3', { c1: '따옴표 "본교"', c2: null, c3: null, c4: null }),
    row('r4', { c1: '줄바꿈\n있음' }),
  ];
  const csv = T.toCsv(cols, rows);
  const lines = csv.split('\r\n');
  eq('머리글 + 줄 수', lines.length, 5);
  eq('머리글은 칸 이름', lines[0], '학교·기관,진행 상태,인원,끝남');
  eq('예/아니오는 사람이 읽는 말로', lines[1], '광주중학교,연락 전,30,아니오');
  eq('쉼표가 든 값은 따옴표로 감싼다', lines[2], '"무등, 초등학교",계약,"1,200",예');
  eq('따옴표는 두 번 쓴다 (RFC 4180)', lines[3], '"따옴표 ""본교""",,,아니오');
  eq('줄바꿈이 든 값도 따옴표 안에', csv.includes('"줄바꿈\n있음"'), true);
  eq('줄 끝은 CRLF — 엑셀이 한 줄로 붙여 읽지 않게', csv.includes('\r\n'), true);
  eq('줄이 없어도 머리글은 나간다', T.toCsv(cols, []), '학교·기관,진행 상태,인원,끝남');

  // 파일 이름에 못 쓰는 글자가 그대로 나가면 내려받기가 조용히 실패한다
  eq('파일 이름을 다듬는다', T.safeFileName('학교/기관: 목록?'), '학교_기관_ 목록_');
  eq('글자가 하나도 안 남으면 기본 이름', T.safeFileName('///'), '목록');
  eq('기본 이름은 부르는 쪽이 정한다 (zip 은 photos 를 쓴다)', T.safeFileName('///', 'photos'), 'photos');

  /* ★ **한글 파일 이름이 살아남는지.** 크로미움은 `<a download>` 에 한글이 있으면
     이름을 통째로 버리고 `download` 로 저장한다 — 그래서 서버가 헤더로 내려준다.
     이 한 줄이 깨지면 원장님은 엑셀에서 못 여는 파일을 받는다 */
  const cd = T.csvDisposition('신규 기관 발굴');
  eq('첨부로 내려준다', cd.startsWith('attachment; '), true);
  eq('filename* 에 한글 이름을 싣는다 (RFC 5987)',
    cd.includes("filename*=UTF-8''" + encodeURIComponent('신규 기관 발굴.csv')), true);
  eq('filename= 은 ASCII 로 둔다 (옛 브라우저용)', /filename="[\x20-\x7e]+"/.test(cd), true);
  eq('헤더에 줄바꿈이 섞이지 않는다', /[\r\n]/.test(T.csvDisposition('줄\n바꿈')), false);
}

console.log('\n[여러 줄 한꺼번에 넣기]');
{
  /* 기관 발굴 목록은 광주·전남에 수백 곳이라 `+ 줄 추가` 를 수백 번 누를 수 없다.
     여기서 막고 싶은 것은 **붙여넣은 것과 들어간 것이 다른 것**이다 —
     조용히 자르거나, 같은 기관이 두 줄로 늘거나, 첫 칸이 빈 줄이 쌓이는 것 */
  const cs = [
    col('c1', '기관 이름'),
    col('c2', '진행 상태', 'select', ['연락 전', '연락함']),
    col('c3', '인원', 'number'),
    col('c4', '방문함', 'check'),
  ];

  const one = T.parsePasted(cs, [], '광주청소년문화의집\n북구청소년문화의집');
  eq('한 줄이 한 개다', one.rows.length, 2);
  eq('첫 칸에 이름이 들어간다', one.rows[0].c1, '광주청소년문화의집');
  eq('안 적은 칸은 아예 안 넣는다', Object.keys(one.rows[0]), ['c1']);
  eq('미리보기 제목', one.titles, ['광주청소년문화의집', '북구청소년문화의집']);

  eq('빈 줄은 조용히 넘긴다', T.parsePasted(cs, [], 'ㄱ\n\n \n\nㄴ').rows.length, 2);
  eq('앞뒤 공백을 턴다', T.parsePasted(cs, [], '  광주청년센터  ').rows[0].c1, '광주청년센터');

  /* ★ 탭이 있으면 칸 구분. **쉼표는 안 본다** — `광주 동구, 서구` 가 쪼개진다 */
  const tab = T.parsePasted(cs, [], '동구청소년문화의집\t연락함\t30\t예');
  eq('탭은 칸을 가른다', tab.rows[0], { c1: '동구청소년문화의집', c2: '연락함', c3: 30, c4: true });
  const comma = T.parsePasted(cs, [], '광주 동구, 서구 청소년센터');
  eq('쉼표는 칸을 안 가른다', comma.rows[0].c1, '광주 동구, 서구 청소년센터');

  eq('예/아니오는 글자로 온다', T.parsePasted(cs, [], 'ㄱ\t\t\t아니오').rows[0].c4, undefined);
  eq('숫자가 아니면 0 으로 안 묻는다', T.parsePasted(cs, [], 'ㄱ\t\t미정').rows[0].c3, undefined);
  eq('숫자의 쉼표는 털어낸다', T.parsePasted(cs, [], 'ㄱ\t\t1,200').rows[0].c3, 1200);

  /* ★ 같은 기관이 두 줄이면 어느 쪽에 연락 기록을 적었는지 모르게 된다 */
  const dup = T.parsePasted(cs, [row('r1', { c1: '광주청년센터' })], '광주청년센터\n전남청년센터\n전남청년센터');
  eq('이미 있는 이름은 건너뛴다', dup.rows.length, 1);
  eq('붙여넣기 안에서 겹치는 것도 건너뛴다', dup.dup, 2);
  eq('건너뛴 것 말고는 그대로 들어간다', dup.titles, ['전남청년센터']);

  /* ★ 첫 칸이 비면 `이름 없음` 이 쌓여 목록에서 아무것도 못 찾는다 */
  const blank = T.parsePasted(cs, [], '\t연락함\t10\nㄱ');
  eq('첫 칸이 비면 버린다', blank.rows.length, 1);
  eq('버린 줄을 세어서 알려준다', blank.blank, 1);

  /* ★ 조용히 자르면 붙여넣은 것과 들어간 것이 다른 걸 아무도 모른다 */
  const many = T.parsePasted(cs, [], Array.from({ length: 8 }, (_, i) => `기관${i}`).join('\n'), 5);
  eq('최대치에서 자른다', many.rows.length, 5);
  eq('몇 줄이 잘렸는지 센다', many.cut, 3);

  eq('열보다 칸이 많으면 알려준다', T.parsePasted(cs, [], 'ㄱ\t\t\t\t남는 칸').over, 1);
  eq('열이 없으면 아무것도 안 넣는다', T.parsePasted([], [], 'ㄱ\nㄴ').rows.length, 0);
  eq('빈 붙여넣기', T.parsePasted(cs, [], '   ').rows.length, 0);
}

console.log('\n[맨 뒤에 붙이기]');
{
  eq('빈 목록은 1', T.nextOrder([]), 1);
  eq('제일 큰 수 다음', T.nextOrder([{ sort_order: 3 }, { sort_order: 7 }, { sort_order: 5 }]), 8);
  eq('전부 0 이어도 늘어난다', T.nextOrder([{ sort_order: 0 }, { sort_order: 0 }]), 1);
}

rmSync(out, { recursive: true, force: true });
console.log(fail === 0 ? `\n전부 통과` : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
