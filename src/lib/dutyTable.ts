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
export const PRESETS: Preset[] = [
  {
    key: 'school',
    label: '학교·기관 목록',
    hint: '영업·제안을 어디에 넣었고 지금 어디까지 왔는지',
    columns: [
      { name: '학교·기관', kind: 'text' },
      { name: '담당 선생님', kind: 'text' },
      { name: '연락처', kind: 'text' },
      {
        name: '진행 상태',
        kind: 'select',
        options: ['연락 전', '연락함', '제안서 보냄', '미팅', '계약', '보류'],
      },
      { name: '다음 할 일', kind: 'text' },
      { name: '다음 연락일', kind: 'date' },
      { name: '메모', kind: 'text' },
    ],
  },
  {
    key: 'stock',
    label: '교구·재료 목록',
    hint: '무엇이 몇 개 있고 어디서 사는지',
    columns: [
      { name: '품목', kind: 'text' },
      { name: '수량', kind: 'number' },
      { name: '구매처', kind: 'text' },
      { name: '단가', kind: 'number' },
      { name: '더 사야 함', kind: 'check' },
      { name: '메모', kind: 'text' },
    ],
  },
  {
    key: 'people',
    label: '사람 명단',
    hint: '강사·지원자처럼 사람을 줄로 관리할 때',
    columns: [
      { name: '이름', kind: 'text' },
      { name: '연락처', kind: 'text' },
      { name: '상태', kind: 'select', options: ['지원', '면접', '합격', '보류', '종료'] },
      { name: '지원일', kind: 'date' },
      { name: '메모', kind: 'text' },
    ],
  },
  {
    key: 'doc',
    label: '문서·서류 목록',
    hint: '계약서·공문처럼 챙겨야 할 서류를 줄로',
    columns: [
      { name: '문서 이름', kind: 'text' },
      { name: '어디 것', kind: 'text' },
      { name: '받은 날', kind: 'date' },
      { name: '보관함', kind: 'text' },
      { name: '끝남', kind: 'check' },
    ],
  },
  {
    key: 'blank',
    label: '빈 표에서 시작',
    hint: '열을 직접 만들래요',
    columns: [{ name: '이름', kind: 'text' }],
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
const RULES: { has: string[]; plan: DutyPlan }[] = [
  /* ── 앱에 이미 자리가 있는 것 (여기가 제일 먼저다 — 표를 만들면 안 되는 것들) ── */
  { has: ['원가', '판매가'], plan: { mode: 'app', href: '/cost', why: '원가는 원가표에서 계산해요. 여기에 또 적으면 숫자가 두 벌이 돼요.' } },
  { has: ['지출', '영수증', '정산자료'], plan: { mode: 'app', href: '/expense', why: '쓴 돈과 영수증은 지출결의서에 쌓여요.' } },
  { has: ['세금계산서', '매출', '수익'], plan: { mode: 'app', href: '/revenue', why: '달별 수금·배분은 회계에 있어요.' } },
  /* ⚠️ **중분류까지 같이 보므로, 좁은 말이 먼저 와야 한다.** `웹앱 제작` 을 위에 두면
     중분류가 `AI 웹앱 제작` 인 것이 통째로 /apps 로 끌려가 `AI 키 관리` 까지
     프로그램 페이지로 갔다 — 실제 역할 45개로 돌려보고 잡은 것이다 */
  { has: ['계정', '권한', '멤버', '강사 등록', 'PIN'], plan: { mode: 'app', href: '/admin', why: '멤버와 PIN 은 관리 화면에서 바꿔요.' } },
  { has: ['AI 키', 'API'], plan: { mode: 'app', href: '/admin', why: 'AI 키와 모델은 관리 화면에 있어요.' } },
  { has: ['검증'], plan: { mode: 'app', href: '/verify', why: '지적과 답변은 검증 화면에 쌓여요.' } },
  { has: ['웹앱 제작', '배포'], plan: { mode: 'app', href: '/apps', why: '프로그램 페이지에 링크·상태가 이미 있어요.' } },
  { has: ['강의계획서', '교육안', '활동지', '샘플', '학년', '차시'], plan: { mode: 'app', href: '/apps', why: '프로그램 페이지의 문서 첨부에 올리면 판까지 쌓여요.' } },
  { has: ['수업 사진', '사진 정리', '촬영'], plan: { mode: 'app', href: '/gallery', why: '수업 사진은 갤러리 앨범에 모여요.' } },
  { has: ['양성과정', '이수'], plan: { mode: 'app', href: '/training', why: '과정 × 강사 이수표가 이미 있어요.' } },
  { has: ['모의수업'], plan: { mode: 'app', href: '/mock', why: '날짜·발표자·피드백 자리가 이미 있어요.' } },
  { has: ['출강 일정', '일정 배정', '강사비'], plan: { mode: 'app', href: '/schedule', why: '출강과 달별 타임 정산은 일정 화면에 있어요.' } },

  /* ── 줄이 쌓이는 것 → 표 ──
     ⚠️ **순서가 곧 규칙이다.** 위에서부터 먼저 걸리는 것을 쓰므로,
     좁은 말을 위에 둔다. `계약서` 를 `계약`(영업) 밑에 두면 계약서 보관이
     학교 명단으로 끌려가고, `문서` 를 넣으면 중분류가 `문서·총무` 인 것이
     통째로(사무용품까지) 서류 목록이 된다. 실제로 테스트가 둘 다 잡았다 */
  { has: ['계약서', '공문', '증빙', '서류', '백업'],
    plan: { mode: 'table', preset: 'doc', why: '챙겨야 할 것이 줄로 쌓이고 끝났는지 표시가 필요해요.' } },
  { has: ['학교', '기관', '제안서', '견적', '계약', '영업', '교사 응대', '재출강', '재계약', '만족도'],
    plan: { mode: 'table', preset: 'school', why: '어디에 넣었고 지금 어디까지 왔는지가 줄로 쌓여요.' } },
  { has: ['재료', '재고', '교구', '비품', '사무용품', '발주', '키트', '준비물'],
    plan: { mode: 'table', preset: 'stock', why: '무엇이 몇 개 있고 더 사야 하는지가 줄로 쌓여요.' } },
  { has: ['모집', '면접', '채용', '지원', '평가', '동의'],
    plan: { mode: 'table', preset: 'people', why: '사람이 한 줄씩 늘고 상태가 바뀌어요.' } },
  { has: ['주제 발굴', '아이디어', 'SNS', '블로그'],
    plan: { mode: 'table', preset: 'blank', why: '떠오른 것을 줄로 쌓아두는 일이에요.' } },
];

/**
 * 역할 이름(과 중분류)으로 갈래를 짐작한다. 아무 데도 안 걸리면 **업로드만** —
 * 표를 기본으로 두면 쓰지도 않을 빈 표가 63개 생긴다.
 */
export function planFor(dutyName: string, groupName?: string): DutyPlan {
  const hay = `${dutyName} ${groupName ?? ''}`;
  for (const r of RULES) {
    if (r.has.some((k) => hay.includes(k))) return r.plan;
  }
  return { mode: 'upload', why: '결과물이 파일 한 벌이면 표 없이 올리기만 해도 충분해요.' };
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
