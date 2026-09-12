import type { DutyColumn, DutyRow } from './types';

/**
 * 역할마다 붙는 **표** — "이 일은 무엇을 적어두는 일인가".
 *
 * 원장이 말했다: *"각각 해야 할 일에 맞는 문서 양식이 구현이 되어 있어야 다들
 * 일하기 편할 것 같음. 예를 들어 학교기관관리 → 리스트 업하고 관리하는 페이지."*
 *
 * **역할이 63개라 화면을 63개 만들 수는 없다.** 그래서 프로그램을 코드 수정 없이
 * 데이터로 늘리는 것과 **같은 방식**을 쓴다 — 표의 열(칼럼)을 데이터로 두고,
 * 역할마다 다르게 준다. 새 역할에 표를 붙일 때 고칠 파일은 **없다.**
 *
 * 자주 쓰는 몇 가지는 **미리 만든 양식**으로 골라 넣는다. 빈 표에서 열을 하나씩
 * 만들라고 하면 아무도 시작을 못 한다 (체크리스트를 미리 만들어두는 것과 같은 판단).
 */

export type ColumnKind = 'text' | 'number' | 'date' | 'select' | 'check';

export const COLUMN_KINDS: { value: ColumnKind; label: string }[] = [
  { value: 'text', label: '글' },
  { value: 'number', label: '숫자' },
  { value: 'date', label: '날짜' },
  { value: 'select', label: '고르기' },
  { value: 'check', label: '예/아니오' },
];

export function columnKindLabel(k: string): string {
  return COLUMN_KINDS.find((c) => c.value === k)?.label ?? '글';
}

/** 모르는 값이 흘러들어도 화면이 안 죽게 (schedules.kind 를 막는 것과 같은 갈래) */
export function safeKind(k: string | null | undefined): ColumnKind {
  return COLUMN_KINDS.some((c) => c.value === k) ? (k as ColumnKind) : 'text';
}

/* ------------------------------------------------------------- 미리 만든 양식 */

export interface Preset {
  key: string;
  label: string;
  hint: string;
  columns: { name: string; kind: ColumnKind; options?: string[] }[];
}

/**
 * **첫 열이 그 줄의 제목이다.** 폰에서는 표를 그대로 못 쓰니 줄 하나를 카드로
 * 그리는데, 그때 제목이 되는 것이 첫 열이다. 그래서 양식마다 첫 열은 반드시
 * *이름* 성격의 칸이다.
 */
/**
 * **자주 쓰는 열 벌.** 원장이 정한 개수다 —
 * *"가장 잘 사용할 양식을 10가지 만들어놓으면 기획·영업·강사관리 등 복합적으로 쓸 수 있을 것 같아."*
 *
 * 부서마다 따로 만들지 **않았다.** 실제 역할 63개를 늘어놓고 보니 부서는 달라도
 * *줄의 모양* 은 겹쳤다 — 학교 명단은 영업·고객관리가 같이 쓰고, 점검 체크리스트는
 * 생산운영부의 일곱 역할이 같이 쓴다. 부서별로 쪼개면 같은 표가 부서 수만큼 생기고
 * 그때부터 서로 다르게 자란다 (이 앱이 '따로국밥' 을 없앤 이유 그대로다).
 *
 * ⚠️ **첫 열이 그 줄의 제목이다.** 폰에서는 표를 그대로 못 쓰니 줄 하나를 카드로
 * 그리는데, 그때 제목이 되는 것이 첫 열이다. 그래서 양식마다 첫 열은 반드시
 * *이름* 성격의 칸이다. 그리고 **첫 `select` 열이 오른쪽 상태 칩**이 된다.
 */
export const PRESETS: Preset[] = [
  {
    key: 'school',
    label: '학교·기관 목록',
    hint: '어디에 넣었고 지금 어디까지 왔는지',
    columns: [
      { name: '학교·기관', kind: 'text' },
      {
        name: '진행 상태',
        kind: 'select',
        options: ['연락 전', '연락함', '제안서 보냄', '미팅', '견적·계약', '진행 중', '완료', '보류'],
      },
      { name: '담당 선생님', kind: 'text' },
      { name: '연락처', kind: 'text' },
      { name: '프로그램', kind: 'text' },
      { name: '인원', kind: 'number' },
      { name: '금액', kind: 'number' },
      { name: '다음 할 일', kind: 'text' },
      { name: '다음 연락일', kind: 'date' },
      { name: '메모', kind: 'text' },
    ],
  },
  {
    key: 'idea',
    label: '아이디어·기획 목록',
    hint: '떠오른 주제를 쌓아두고 무엇을 만들지 고른다',
    columns: [
      { name: '주제·아이디어', kind: 'text' },
      { name: '상태', kind: 'select', options: ['후보', '검토 중', '채택', '보류', '취소'] },
      { name: '한 줄 설명', kind: 'text' },
      { name: '대상 학년', kind: 'text' },
      { name: '왜 좋은가', kind: 'text' },
      { name: '올린 사람', kind: 'text' },
      { name: '정한 날', kind: 'date' },
      { name: '메모', kind: 'text' },
    ],
  },
  {
    key: 'curriculum',
    label: '차시 커리큘럼',
    hint: '몇 차시에 무엇을 하는지 — 그대로 강의계획서가 된다',
    columns: [
      { name: '차시', kind: 'text' },
      { name: '상태', kind: 'select', options: ['안 짬', '초안', '검토', '확정'] },
      { name: '학년', kind: 'text' },
      { name: '수업 주제', kind: 'text' },
      { name: '활동 내용', kind: 'text' },
      { name: '쓰는 웹앱·도구', kind: 'text' },
      { name: '준비물', kind: 'text' },
      { name: '시간(분)', kind: 'number' },
      { name: '만드는 것', kind: 'text' },
    ],
  },
  {
    key: 'make',
    label: '제작물 목록',
    hint: '브로셔·명함·활동지처럼 만들어서 내보내는 것',
    columns: [
      { name: '만들 것', kind: 'text' },
      { name: '상태', kind: 'select', options: ['기획', '작업 중', '검수', '완료', '보류'] },
      { name: '갈래', kind: 'select', options: ['브로셔', '영상', '링크', '명함', '활동지', '매뉴얼', '기타'] },
      { name: '담당', kind: 'text' },
      { name: '마감', kind: 'date' },
      { name: '링크·파일', kind: 'text' },
      { name: '메모', kind: 'text' },
    ],
  },
  {
    key: 'check',
    label: '점검 체크리스트',
    hint: '수업 전후로 매번 확인하는 것 — 빠뜨리면 현장에서 터진다',
    columns: [
      { name: '점검 항목', kind: 'text' },
      { name: '언제', kind: 'select', options: ['수업 전날', '수업 당일', '수업 후', '매주', '매월'] },
      { name: '담당', kind: 'text' },
      { name: '확인함', kind: 'check' },
      { name: '이상 있음', kind: 'check' },
      { name: '확인한 날', kind: 'date' },
      { name: '조치 내용', kind: 'text' },
    ],
  },
  {
    key: 'stock',
    label: '재료·교구 재고',
    hint: '무엇이 몇 개 있고 어디에 두었고 더 사야 하는지',
    columns: [
      { name: '품목', kind: 'text' },
      { name: '상태', kind: 'select', options: ['넉넉함', '보통', '부족', '없음', '수리 필요'] },
      { name: '수량', kind: 'number' },
      { name: '단위', kind: 'text' },
      { name: '보관 위치', kind: 'text' },
      { name: '구매처', kind: 'text' },
      { name: '묶음가', kind: 'number' },
      { name: '재사용', kind: 'check' },
      { name: '확인한 날', kind: 'date' },
      { name: '메모', kind: 'text' },
    ],
  },
  {
    key: 'people',
    label: '사람 명단',
    hint: '지원자·강사처럼 사람을 줄로 관리할 때',
    columns: [
      { name: '이름', kind: 'text' },
      { name: '상태', kind: 'select', options: ['지원', '서류', '면접', '합격', '보류', '종료'] },
      { name: '구분', kind: 'select', options: ['지원자', '강사', '외주', '기타'] },
      { name: '연락처', kind: 'text' },
      { name: '날짜', kind: 'date' },
      { name: '동의 받음', kind: 'check' },
      { name: '메모', kind: 'text' },
    ],
  },
  {
    key: 'doc',
    label: '문서·계약 대장',
    hint: '계약서·공문·계산서처럼 챙겨야 할 서류',
    columns: [
      { name: '문서 이름', kind: 'text' },
      { name: '갈래', kind: 'select', options: ['계약서', '공문', '견적서', '세금계산서', '증빙', '기타'] },
      { name: '어디 것', kind: 'text' },
      { name: '받은 날', kind: 'date' },
      { name: '끝나는 날', kind: 'date' },
      { name: '보관 위치', kind: 'text' },
      { name: '끝남', kind: 'check' },
      { name: '메모', kind: 'text' },
    ],
  },
  {
    key: 'bug',
    label: '오류·개선 목록',
    hint: '써보다 이상했던 것 — 무엇이 어떻게 이상한지',
    columns: [
      { name: '무엇이 이상한가', kind: 'text' },
      { name: '상태', kind: 'select', options: ['확인 필요', '고치는 중', '고침', '안 고침'] },
      { name: '어디서', kind: 'text' },
      { name: '급한 정도', kind: 'select', options: ['높음', '보통', '낮음'] },
      { name: '남긴 사람', kind: 'text' },
      { name: '고친 내용', kind: 'text' },
      { name: '고친 날', kind: 'date' },
    ],
  },
  {
    key: 'plan',
    label: '작업 일정·배정',
    hint: '언제 누가 몇 개를 — 키트 제작·배송처럼 손이 가는 일',
    columns: [
      { name: '할 일', kind: 'text' },
      { name: '상태', kind: 'select', options: ['예정', '진행 중', '완료', '미룸'] },
      { name: '날짜', kind: 'date' },
      { name: '담당', kind: 'text' },
      { name: '몇 개·몇 명', kind: 'number' },
      { name: '걸린 시간', kind: 'text' },
      { name: '메모', kind: 'text' },
    ],
  },
  {
    /* 열한 번째지만 **양식이 아니다** — 위 열에 안 맞는 일을 위한 빠져나갈 문이다.
       그래서 `이 역할에 어울려요` 의 기본값이기도 하다 (아무 규칙에도 안 걸릴 때) */
    key: 'blank',
    label: '빈 표에서 시작',
    hint: '위에 맞는 게 없어요 — 열을 직접 만들래요',
    columns: [
      { name: '이름', kind: 'text' },
      { name: '상태', kind: 'select', options: ['할 일', '하는 중', '완료'] },
      { name: '메모', kind: 'text' },
    ],
  },
];

export function presetOf(key: string): Preset | null {
  return PRESETS.find((p) => p.key === key) ?? null;
}

/* ------------------------------------------------------------------- 값 */

/** 열 하나의 값. jsonb 에 그대로 들어간다 */
export type CellValue = string | number | boolean | null;

/**
 * 칸에 적힌 것을 저장할 값으로 다듬는다.
 *
 * · 숫자는 숫자로 (숫자가 아니면 `null` — `0` 으로 바꾸면 '안 적음' 과 '0' 이 섞인다)
 * · 빈 글자는 `null` (빈 문자열을 남기면 '없음' 판정이 화면마다 달라진다)
 */
export function cleanCell(kind: ColumnKind, raw: unknown): CellValue {
  if (kind === 'check') return Boolean(raw);
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  if (kind === 'number') {
    const n = Number(s.replace(/[,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return s;
}

/** 화면에 보여줄 글자 */
export function cellText(col: Pick<DutyColumn, 'kind'>, v: CellValue): string {
  const kind = safeKind(col.kind);
  if (kind === 'check') return v ? '예' : '아니오';
  if (v === null || v === undefined || v === '') return '';
  if (kind === 'number') return Number(v).toLocaleString('ko-KR');
  return String(v);
}

/** 줄의 제목 — **첫 열**이다. 비어 있으면 '이름 없음' (빈 카드가 생기면 못 찾는다) */
export function rowTitle(cols: DutyColumn[], row: DutyRow): string {
  const first = cols[0];
  if (!first) return '이름 없음';
  const t = cellText(first, (row.cells ?? {})[first.id] ?? null);
  return t.trim() === '' ? '이름 없음' : t;
}

/* --------------------------------------------- 여러 줄 한꺼번에 넣기 */

/**
 * **목록은 손으로 한 줄씩 채우는 게 아니다.**
 *
 * 신규 기관 발굴만 해도 광주·전남에 청소년문화의집·지역아동센터·청년센터가
 * 수백 곳이다. 폰에서 `+ 줄 추가` 를 수백 번 누르게 하면 아무도 시작을 못 한다
 * (빈 표에서 열을 하나씩 만들라고 하지 않는 것과 같은 판단).
 * 엑셀·한글 표에서 복사한 것을 그대로 붙여넣으면 줄이 된다.
 *
 * 규칙은 셋뿐이다 — **붙여넣기 전에 결과를 짐작할 수 있어야** 쓴다:
 *
 * · **한 줄이 한 개다.** 빈 줄은 조용히 넘긴다
 * · 줄 안에 **탭이 있으면 칸 구분**으로 본다 (엑셀·한글 표를 복사하면 탭으로 온다).
 *   **쉼표는 칸 구분으로 안 본다** — `광주 동구, 서구` 같은 값이 쪼개진다
 * · **첫 칸이 비면 그 줄은 버린다.** 첫 칸이 줄의 제목이라, 비면 `이름 없음` 이 쌓여
 *   목록에서 아무것도 못 찾게 된다 (`+ 줄 추가` 가 빈 새 줄을 걷어내는 것과 같은 이유)
 *
 * 이미 있는 이름, 그리고 **붙여넣기 안에서 겹치는 이름**은 건너뛴다 —
 * 같은 기관이 두 줄이면 어느 쪽에 연락 기록을 적었는지 모르게 된다.
 */
export interface PastedPlan {
  /** 넣을 줄들 — 열 id 를 열쇠로 한 값 (duty_rows.cells 에 그대로 들어간다) */
  rows: Record<string, CellValue>[];
  /** 미리보기에 쓸 제목 (첫 칸 값) */
  titles: string[];
  /** 첫 칸이 비어서 버린 줄 */
  blank: number;
  /** 이미 있거나 붙여넣기 안에서 겹쳐서 건너뛴 줄 */
  dup: number;
  /** 최대치를 넘어 잘린 줄 */
  cut: number;
  /** 표의 열보다 칸이 많아 뒤쪽을 버린 줄 */
  over: number;
}

/**
 * 한 번에 넣을 수 있는 최대 줄 수. 잘리면 **몇 줄이 잘렸는지 화면에 적는다** —
 * 조용히 자르면 붙여넣은 것과 들어간 것이 다른 걸 아무도 모른다.
 */
export const PASTE_MAX = 300;

/** 붙여넣기에서 `예/아니오` 칸에 적힌 글자. 체크박스와 달리 글자로 오기 때문에 따로 본다 */
const YES = /^(예|y|yes|true|1|o|참|있음|완료)$/i;

export function parsePasted(
  cols: DutyColumn[],
  existing: DutyRow[],
  text: string,
  max = PASTE_MAX,
): PastedPlan {
  const plan: PastedPlan = { rows: [], titles: [], blank: 0, dup: 0, cut: 0, over: 0 };
  const first = cols[0];
  if (!first) return plan;

  /* 이미 있는 제목 — 겹치면 건너뛴다. 붙여넣기 안에서 겹치는 것도 같은 자루에 담는다 */
  const seen = new Set(
    existing
      .map((r) => cellText(first, (r.cells ?? {})[first.id] ?? null).trim())
      .filter((t) => t !== ''),
  );

  for (const raw of text.split(/\r?\n/)) {
    /* ⚠️ **줄 전체를 trim 하면 안 된다.** 앞의 탭까지 털려서 `\t연락함\t10` 처럼
       **첫 칸이 빈 줄**이 두 번째 칸을 제목으로 삼고 들어간다 (테스트가 잡았다).
       끝의 공백만 털고, 칸을 가른 **뒤에** 칸마다 턴다 */
    const line = raw.replace(/\s+$/, '');
    if (line.trim() === '') continue;

    const parts = (line.includes('\t') ? line.split('\t') : [line]).map((x) => x.trim());
    const title = parts[0] ?? '';
    if (title === '') {
      plan.blank += 1;
      continue;
    }
    if (seen.has(title)) {
      plan.dup += 1;
      continue;
    }
    if (plan.rows.length >= max) {
      plan.cut += 1;
      continue;
    }
    if (parts.length > cols.length) plan.over += 1;

    seen.add(title);
    const cells: Record<string, CellValue> = {};
    cols.forEach((c, i) => {
      const kind = safeKind(c.kind);
      const s = parts[i] ?? '';
      if (s === '') return;
      // 안 적은 칸은 아예 안 넣는다 (`false`·`null` 을 넣으면 '안 적음' 과 섞인다)
      const v = kind === 'check' ? YES.test(s) || null : cleanCell(kind, s);
      if (v === null || v === false) return;
      cells[c.id] = v;
    });
    plan.rows.push(cells);
    plan.titles.push(title);
  }
  return plan;
}

/**
 * 검색 — 어느 칸에 걸려도 남긴다 (`filterOrg` 와 같은 갈래).
 * 열 이름으로도 걸린다 — "상태" 로 찾으면 상태 칸이 있는 줄이 나온다.
 */
export function filterRows(cols: DutyColumn[], rows: DutyRow[], q: string): DutyRow[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) =>
    cols.some((c) => {
      const t = cellText(c, (r.cells ?? {})[c.id] ?? null).toLowerCase();
      return t.includes(needle);
    }),
  );
}

/**
 * 고르기 칸의 값별 개수 — 머리글에 `연락 전 3 · 계약 2` 처럼 싣는다.
 * **첫 번째 `select` 열만** 센다. 여러 개를 세면 머리글이 두 줄이 된다.
 */
export function statusCounts(
  cols: DutyColumn[],
  rows: DutyRow[],
): { col: DutyColumn; counts: { label: string; n: number }[] } | null {
  const col = cols.find((c) => safeKind(c.kind) === 'select');
  if (!col) return null;
  const opts = col.options ?? [];
  if (opts.length === 0) return null;
  const counts = opts
    .map((label) => ({
      label,
      n: rows.filter((r) => ((r.cells ?? {})[col.id] ?? null) === label).length,
    }))
    .filter((c) => c.n > 0);
  return counts.length > 0 ? { col, counts } : null;
}

/** 맨 뒤로 붙일 순서 (org.ts 의 nextOrder 와 같은 꼴) */
export function nextOrder(items: { sort_order: number }[]): number {
  return items.reduce((m, i) => Math.max(m, i.sort_order), 0) + 1;
}

/* ------------------------------------------------- 이 일은 어떤 갈래인가 */

/**
 * **역할 전부에 표를 붙이면 안 된다.**
 *
 * 원장이 물었다: *"그냥 업로드만 해야 할 것들과 양식이 있으면 좋을 것들을 분류해."*
 * 실제로 재보니 갈래가 **셋**이었다. 가르는 질문은 하나다 —
 *
 * > 이 일을 하면 **파일이 하나 나오나, 줄이 하나 늘어나나?**
 *
 * · 줄이 는다 → `table` **표**. 학교 명단·재고·지원자처럼 계속 쌓이고 상태가 바뀐다
 * · 파일이 난다 → `upload` **업로드만**. 교육안·활동지·소개자료는 결과물이 파일 한 벌이다
 * · **앱에 이미 자리가 있다** → `app` **바로가기**. 표를 또 만들면 **데이터가 두 벌**이 되고
 *   둘 다 못 쓴다. 이 앱이 '따로국밥을 없앤 곳' 인데 부서별로 쪼개면 되돌아간다
 *
 * ⚠️ **이건 추천일 뿐이다.** 진짜 상태는 데이터다 — 열이 있으면 표, 없으면 파일함.
 * 역할 이름은 원장이 언제든 바꾸므로 이름으로 잠그지 않는다.
 */
export type DutyMode = 'table' | 'upload' | 'app';

export interface DutyPlan {
  mode: DutyMode;
  /** `table` 일 때 먼저 권하는 양식 */
  preset?: string;
  /** `app` 일 때 갈 곳 */
  href?: string;
  /** 화면에 그대로 적는 한 줄 */
  why: string;
}

/** 이름에 이 말이 들어가면 그 갈래. **위에서부터 먼저 걸리는 것을 쓴다** */
/**
 * 이름에 이 말이 들어가면 그 갈래. **위에서부터 먼저 걸리는 것을 쓴다.**
 *
 * ⚠️ **순서가 곧 뜻이고, 중분류까지 같이 본다.** 그래서 넓은 말 하나가 그 묶음을
 * 통째로 끌고 간다 — 실제 역할 63개로 돌려보면 바로 드러난다 (회귀 테스트가 그렇게 한다).
 * 좁은 말이 위로, 넓은 말이 아래로.
 */
const RULES: { has: string[]; plan: DutyPlan }[] = [
  /* ── ① 앱에 이미 자리가 있는 것 — 여기가 제일 먼저다.
        표를 또 만들면 데이터가 두 벌이 되고 둘 다 못 쓴다 ── */
  { has: ['원가율', '판매가', '원가표'], plan: { mode: 'app', href: '/cost', why: '원가는 원가표에서 계산해요. 여기에 또 적으면 숫자가 두 벌이 돼요.' } },
  { has: ['강사비'], plan: { mode: 'app', href: '/schedule', why: '출강 횟수·타임은 일정 화면의 달별 정산에 있어요.' } },
  { has: ['지출결의', '영수증', '구매 증빙'], plan: { mode: 'app', href: '/expense', why: '쓴 돈과 영수증은 지출결의서에 쌓여요.' } },
  { has: ['세금계산서', '매출'], plan: { mode: 'app', href: '/revenue', why: '달별 수금·배분은 회계에 있어요.' } },
  { has: ['계정', '권한', 'PIN', 'AI 키', 'API'], plan: { mode: 'app', href: '/admin', why: '계정·PIN·AI 키는 관리 화면에서 바꿔요.' } },
  { has: ['강사 등록', '멤버'], plan: { mode: 'app', href: '/admin', why: '멤버와 PIN 은 관리 화면에서 바꿔요.' } },
  { has: ['배포'], plan: { mode: 'app', href: '/apps', why: '배포 링크와 상태는 프로그램 페이지에 있어요.' } },
  { has: ['강의계획서'], plan: { mode: 'app', href: '/apps', why: '강의계획서는 프로그램 페이지에서 채우면 그대로 A4 로 인쇄돼요.' } },
  { has: ['수업 사진', '사진 정리', '사진 촬영', '갤러리'], plan: { mode: 'app', href: '/gallery', why: '수업 사진은 갤러리 앨범에 모여요.' } },
  { has: ['양성과정', '이수'], plan: { mode: 'app', href: '/training', why: '과정 × 강사 이수표가 이미 있어요.' } },
  { has: ['모의수업'], plan: { mode: 'app', href: '/mock', why: '날짜·발표자·피드백 자리가 이미 있어요.' } },
  { has: ['출강 일정', '일정 배정'], plan: { mode: 'app', href: '/schedule', why: '출강과 달별 타임 정산은 일정 화면에 있어요.' } },

  /* ── ② 줄이 쌓이는 것 → 표. 좁은 말부터 ── */
  { has: ['차시 설계', '커리큘럼', '차시'],
    plan: { mode: 'table', preset: 'curriculum', why: '몇 차시에 무엇을 하는지가 줄로 쌓여요.' } },
  { has: ['주제 발굴', '기획안', '아이디어', '기능 정의', 'Scope'],
    plan: { mode: 'table', preset: 'idea', why: '떠오른 것을 쌓아두고 그중에서 고르는 일이에요.' } },
  { has: ['검증', '디버깅', '오류', 'UI/UX', '다듬기'],
    plan: { mode: 'table', preset: 'bug', why: '무엇이 어떻게 이상한지가 한 줄씩 쌓여요.' } },
  { has: ['점검', '충전', '사전 확인', '세팅', '안전', '준비물', '보안', '자료보안'],
    plan: { mode: 'table', preset: 'check', why: '매번 확인하는 것이라 빠뜨렸는지 표시가 필요해요.' } },
  /* '백업·아카이빙' 은 만드는 일이 아니라 **보관하는 일**이다. `매뉴얼 문서화` 와
     한 이름에 같이 들어 있어서(4주차 `데이터 백업 및 매뉴얼 문서화`) 순서로 가른다 */
  { has: ['백업', '아카이빙', '보관 대장'],
    plan: { mode: 'table', preset: 'doc', why: '무엇을 어디에 보관했는지가 줄로 쌓여요.' } },
  { has: ['브로셔', '명함', '활동지', '학습 양식', '교육안', '매뉴얼', '문서화', '제작 메뉴얼', '소개자료'],
    plan: { mode: 'table', preset: 'make', why: '만들어서 내보내는 것이라 무엇을 어디까지 만들었는지가 줄이에요.' } },
  { has: ['재고', '재료', '교구', '비품', '자산', '발주', '보관 위치', '긴급'],
    plan: { mode: 'table', preset: 'stock', why: '무엇이 몇 개 있고 더 사야 하는지가 줄로 쌓여요.' } },
  { has: ['모집', '면접', '채용', '지원', '평가', '동의'],
    plan: { mode: 'table', preset: 'people', why: '사람이 한 줄씩 늘고 상태가 바뀌어요.' } },
  { has: ['계약서', '공문', '행정문서', '증빙 보관'],
    plan: { mode: 'table', preset: 'doc', why: '챙겨야 할 서류가 줄로 쌓이고 끝났는지 표시가 필요해요.' } },
  { has: ['키트', '포장', '배송', '운반', '작업 일정', '인계', '이관'],
    plan: { mode: 'table', preset: 'plan', why: '언제 누가 몇 개를 하는지가 줄로 쌓여요.' } },
  { has: ['학교', '기관', '제안서', '견적', '계약', '영업', '교사 응대', '재출강', '재계약', '만족도', '고객'],
    plan: { mode: 'table', preset: 'school', why: '어디에 넣었고 지금 어디까지 왔는지가 줄로 쌓여요.' } },
  { has: ['SNS', '블로그', '홍보물', '콘텐츠'],
    plan: { mode: 'table', preset: 'make', why: '무엇을 언제 올렸는지가 줄로 쌓여요.' } },
];

/**
 * 역할 이름(과 중분류)으로 갈래를 짐작한다. 아무 데도 안 걸리면 **업로드만** —
 * 표를 기본으로 두면 쓰지도 않을 빈 표가 63개 생긴다.
 */
export function planFor(dutyName: string, groupName?: string): DutyPlan {
  /**
   * ⚠️ **이름이 이기고, 이름이 아무 말도 안 할 때만 중분류가 거든다.**
   *
   * 둘을 한 덩어리로 이어붙여 재면 **넓은 중분류가 그 묶음을 통째로 끌고 간다.**
   * 원장의 실제 중분류가 `[4주차] 검증, 피드백 및 파일럿 테스트` 인데, 그러면
   * 그 안의 *데이터 백업* 도 *생산운영부 인계* 도 전부 '오류 목록' 이 됐다.
   * 역할 이름은 그 일을 정확히 부르는 말이고 중분류는 맥락일 뿐이라, 순서가 이래야 한다.
   */
  const hit = (hay: string) => RULES.find((r) => r.has.some((k) => hay.includes(k)))?.plan;
  return (
    hit(dutyName) ??
    (groupName ? hit(`${dutyName} ${groupName}`) : undefined) ??
    { mode: 'upload', why: '결과물이 파일 한 벌이면 표 없이 올리기만 해도 충분해요.' }
  );
}

export const MODE_LABEL: Record<DutyMode, string> = {
  table: '표로 관리',
  upload: '자료 올리기',
  app: '앱 안에 자리 있음',
};

/** 이름에서 권할 양식 (표를 처음 만들 때 미리 골라둔다) */
export function suggestPreset(dutyName: string, groupName?: string): Preset {
  const p = planFor(dutyName, groupName);
  return (p.preset && presetOf(p.preset)) || PRESETS[PRESETS.length - 1];
}

/* ----------------------------------------------------------- 내보내기 */

/**
 * 표를 CSV 로. **엑셀에서 열리는 것이 목적**이라 규칙이 몇 가지 있다:
 *
 * · 쉼표·따옴표·줄바꿈이 든 값은 따옴표로 감싸고 안의 따옴표는 두 번 쓴다 (RFC 4180)
 * · 줄 끝은 `\r\n` — 엑셀이 `\n` 만 있으면 한 줄로 붙여 읽는 판이 있다
 * · **BOM 은 내려받을 때 붙인다** (`downloadCsv`). 안 붙이면 엑셀이 한글을 깨서 연다
 * · 예/아니오는 `예`·`아니오` 그대로 — `true` 로 내보내면 사람이 읽을 수 없다
 */
export function toCsv(cols: DutyColumn[], rows: DutyRow[]): string {
  const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const head = cols.map((c) => esc(c.name)).join(',');
  const body = rows.map((r) =>
    cols.map((c) => esc(cellText(c, (r.cells ?? {})[c.id] ?? null))).join(','),
  );
  return [head, ...body].join('\r\n');
}

/**
 * 파일 이름으로 못 쓰는 글자만 바꾼다 (drivePath 의 `safeSeg` 와 같은 갈래).
 * 바꾸고 나서 **글자·숫자가 하나도 안 남으면** 기본 이름을 쓴다 —
 * `///` 같은 이름이 `___.csv` 로 내려가면 받는 쪽이 무슨 파일인지 알 수 없다.
 */
export function safeFileName(name: string, fallback = '목록'): string {
  const out = name.replace(/[\\/:*?"<>|]/g, '_').trim();
  return /[\p{L}\p{N}]/u.test(out) ? out : fallback;
}

/**
 * 내려받기 헤더 한 줄.
 *
 * ⚠️ **여기가 이 기능에서 제일 잘 깨지는 곳이다.** 처음엔 브라우저에서 Blob 을 만들어
 * `<a download="신규 기관 발굴.csv">` 로 내려받게 했는데, **크로미움은 파일 이름에
 * 한글이 들어가면 그 이름을 통째로 버리고 `download`(확장자도 없이)로 저장한다** —
 * 원장님은 엑셀에서 열 수도 없는 파일을 받는다. 점검 스크립트가 잡아서 서버가
 * 내려주는 방식으로 바꿨다.
 *
 * · `filename=` 에는 **ASCII 이름**을 둔다 — `filename*` 을 모르는 옛 브라우저용
 * · `filename*=UTF-8''…` 에 진짜 이름을 percent-encoding 해서 싣는다 (RFC 5987)
 */
export function csvDisposition(name: string): string {
  const file = `${safeFileName(name)}.csv`;
  return `attachment; filename="duty-table.csv"; filename*=UTF-8''${encodeURIComponent(file)}`;
}
