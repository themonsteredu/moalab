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

console.log('\n[갈래 — 앱에 자리가 있으면 표를 만들지 않는다]');
{
  // 원장이 물은 것: "그냥 업로드만 해야 할 것들과 양식이 있으면 좋을 것들을 분류해"
  const app = [
    ['원가·판매가 설계', '/cost'],
    ['지출결의서 확인', '/expense'],
    ['영수증 증빙 보관', '/expense'],
    ['세금계산서·매출', '/revenue'],
    ['웹앱 제작·배포', '/apps'],
    ['검증 지적 대응', '/verify'],
    ['강의계획서 작성', '/apps'],
    ['강사 교육안 작성', '/apps'],
    ['활동지·양식 제작', '/apps'],
    ['샘플 작품 제작·촬영', '/apps'],
    ['수업 사진 정리', '/gallery'],
    ['양성과정 운영', '/training'],
    ['모의수업 진행', '/mock'],
    ['출강 일정 배정', '/schedule'],
    ['강사비 정산 자료', '/schedule'],
    ['신규 강사 등록', '/admin'],
    ['업무앱 계정·권한', '/admin'],
    ['AI 키·사용량 관리', '/admin'],
  ];
  for (const [name, href] of app) {
    const p = T.planFor(name);
    eq(`${name} → 바로가기 ${href}`, [p.mode, p.href], ['app', href]);
  }
}

console.log('\n[갈래 — 줄이 쌓이면 표]');
{
  const table = [
    ['제안서 작성·발송', 'school'],
    ['신규 기관 발굴', 'school'],
    ['견적·계약', 'school'],
    ['담당 교사 응대', 'school'],
    ['재출강·재계약', 'school'],
    ['만족도 조사', 'school'],
    ['재료 발주', 'stock'],
    ['재고·단가 확인', 'stock'],   // '단가' 가 원가 규칙에 걸리면 안 된다 → 아래에서 따로 확인
    ['교구 점검·수리', 'stock'],
    ['사무용품·비품', 'stock'],
    ['키트 포장', 'stock'],
    ['전날 준비물 점검', 'stock'],
    ['강사 모집·면접', 'people'],
    ['강사 평가·피드백', 'people'],
    ['초상권 동의 관리', 'people'],
    ['계약서·공문 보관', 'doc'],
    ['데이터 백업', 'doc'],
    ['SNS·블로그 운영', 'blank'],
    ['신규 주제 발굴', 'blank'],
  ];
  for (const [name, preset] of table) {
    const p = T.planFor(name);
    eq(`${name} → 표(${preset})`, [p.mode, p.preset], ['table', preset]);
  }
}

console.log('\n[갈래 — 나머지는 업로드만]');
{
  for (const name of ['소개자료 관리', '현장 세팅·정리', '안전 지도', '배송·운반']) {
    eq(`${name} → 업로드만`, T.planFor(name).mode, 'upload');
  }
  // 아무 데도 안 걸리는 새 역할에 표를 기본으로 붙이면 빈 표가 63개 생긴다
  eq('처음 보는 역할도 업로드만', T.planFor('이름을 아직 안 정한 일').mode, 'upload');
}

console.log('\n[갈래 — 실제 역할 45개를 중분류까지 넣고 돌린다]');
{
  /* ⚠️ **중분류를 안 넣고 재면 못 잡는다.** 위 검사들은 역할 이름만 넘겼는데,
     화면은 중분류도 같이 본다. 그래서 넓은 말 하나가 그 묶음을 통째로 끌고 가는
     사고가 안 잡혔다 — `웹앱 제작` 이 위에 있어서 중분류가 `AI 웹앱 제작` 인
     `AI 키 관리` 까지 /apps 로 갔고, `홍보` 때문에 `소개자료 관리` 가 표가 됐다 */
  const cases = [
    ['검증 지적 대응', 'AI 웹앱 제작', 'app', '/verify'],
    ['AI 키·사용량 관리', 'AI 웹앱 제작', 'app', '/admin'],
    ['웹앱 제작·배포', 'AI 웹앱 제작', 'app', '/apps'],
    ['학년·차시 설계', '프로그램 기획', 'app', '/apps'],
    ['원가·판매가 설계', '프로그램 기획', 'app', '/cost'],
    ['신규 주제 발굴', '프로그램 기획', 'table', 'blank'],
    ['소개자료 관리', '홍보', 'upload', undefined],
    ['SNS·블로그 운영', '홍보', 'table', 'blank'],
    ['수업 사진 정리', '홍보', 'app', '/gallery'],
    ['신규 기관 발굴', '학교·기관 영업', 'table', 'school'],
    ['견적·계약', '학교·기관 영업', 'table', 'school'],
    ['강사 모집·면접', '강사 채용', 'table', 'people'],
    ['신규 강사 등록', '강사 채용', 'app', '/admin'],
    ['모의수업 진행', '강사 교육', 'app', '/mock'],
    ['교육안 전달', '강사 교육', 'app', '/apps'],
    ['강사비 정산 자료', '출강 관리', 'app', '/schedule'],
    ['강사 평가·피드백', '출강 관리', 'table', 'people'],
    ['계약서·공문 보관', '문서·총무', 'table', 'doc'],
    ['사무용품·비품', '문서·총무', 'table', 'stock'],
    ['데이터 백업', '전산·보안', 'table', 'doc'],
    ['초상권 동의 관리', '전산·보안', 'table', 'people'],
    ['재고·단가 확인', '재료·교구', 'table', 'stock'],
    ['전날 준비물 점검', '수업 키트 준비', 'table', 'stock'],
    ['현장 세팅·정리', '현장 운영', 'upload', undefined],
    ['안전 지도', '현장 운영', 'upload', undefined],
    ['수업 사진 촬영', '현장 운영', 'app', '/gallery'],
  ];
  for (const [name, grp, mode, key] of cases) {
    const p = T.planFor(name, grp);
    eq(`${grp} › ${name}`, [p.mode, p.href ?? p.preset], [mode, key]);
  }
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
  eq('안 걸리면 빈 표를 권한다', T.suggestPreset('처음 보는 일').key, 'blank');
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

console.log('\n[맨 뒤에 붙이기]');
{
  eq('빈 목록은 1', T.nextOrder([]), 1);
  eq('제일 큰 수 다음', T.nextOrder([{ sort_order: 3 }, { sort_order: 7 }, { sort_order: 5 }]), 8);
  eq('전부 0 이어도 늘어난다', T.nextOrder([{ sort_order: 0 }, { sort_order: 0 }]), 1);
}

rmSync(out, { recursive: true, force: true });
console.log(fail === 0 ? `\n전부 통과` : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
