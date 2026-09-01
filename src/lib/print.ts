/**
 * 인쇄 / PDF 저장에 넣을 묶음.
 *
 * PDF 라이브러리를 쓰지 않고 **브라우저 인쇄**를 그대로 쓴다.
 * 아이폰은 사파리 공유 → 프린트 → 'PDF로 저장', PC 는 인쇄 대화상자에서 저장한다.
 * 라이브러리로 그리면 한글 폰트를 따로 심어야 하고 표가 깨진다.
 *
 * (Next.js page 파일에서는 이런 상수를 export 할 수 없어서 따로 뺐다)
 */
export const PRINT_PARTS = [
  { key: 'verify', label: '검증 (지적·답변)' },
  // 한글 양식 그대로의 A4 한 장. 늘 새 쪽에서 시작한다
  { key: 'plan', label: '강의계획서 (양식 그대로)' },
  { key: 'planfile', label: '문서 첨부 목록' },
  { key: 'cost', label: '원가표' },
  { key: 'sample', label: '샘플 이미지' },
  { key: 'photo', label: '수업 사진' },
] as const;

export type PrintPart = (typeof PRINT_PARTS)[number]['key'];

/** 순서와 이름이 실제 인쇄물 순서와 같다 */
export function parsePrintParts(raw: string | null): Set<PrintPart> {
  if (!raw) return new Set(PRINT_PARTS.map((p) => p.key));
  const keys = raw.split(',').filter((k): k is PrintPart => PRINT_PARTS.some((p) => p.key === k));
  return new Set(keys);
}

/* ------------------------------------------------------------- 부서업무 인쇄
   부서 5 · 중분류 15 · 역할 48 이면 한 장에 안 들어간다. 그래서 무엇을 넣을지
   고르게 한다 (프로그램 인쇄·지출결의서 인쇄와 같은 방식).

   `사람별` 은 **한 사람 = 한 쪽**이다. 그래야 뽑아서 그 사람에게 그대로 건넨다 —
   "이게 당신 담당입니다" 가 이 문서의 쓸모다. */

export const ROLE_PRINT_PARTS = [
  { key: 'dept', label: '부서별 통합 (부서 › 중분류 › 역할)' },
  { key: 'person', label: '사람별 (한 사람 = 한 쪽, 나눠주기용)' },
  { key: 'unassigned', label: '담당자 미정만 따로' },
] as const;

export type RolePrintPart = (typeof ROLE_PRINT_PARTS)[number]['key'];

export function parseRoleParts(raw: string | null): Set<RolePrintPart> {
  if (!raw) return new Set(ROLE_PRINT_PARTS.map((p) => p.key));
  const keys = raw.split(',').filter((k): k is RolePrintPart =>
    ROLE_PRINT_PARTS.some((p) => p.key === k),
  );
  return new Set(keys);
}

/* ---------------------------------------------------------------- 통합 셀
   인쇄물에서 **같은 값이 이어지는 칸은 하나로 합친다** (`rowSpan`).

   예전엔 첫 줄에만 이름을 적고 나머지는 빈 칸으로 뒀는데, 빈 칸도 칸이라
   줄마다 가로선이 그어져서 묶음이 안 보였다. 종이에서 "이 넷이 회계·정산" 이
   한눈에 들어와야 표를 읽는 값어치가 있다.

   **연속한 것만 합친다.** 떨어져 있는 같은 값을 합치면 표가 뒤집힌다
   (같은 부서가 두 군데 떨어져 나오면 그건 그대로 두 덩어리다). */

/** 한 줄이 그 칸을 그릴지 / 몇 줄을 덮을지 */
export interface CellSpan {
  /** false 면 `<td>` 를 아예 그리지 않는다 — 위 칸이 이미 덮고 있다 */
  render: boolean;
  /** render 일 때만 의미가 있다 */
  rowSpan: number;
}

/**
 * 값 목록을 받아 줄마다 통합 셀 정보를 낸다.
 *
 * `['a','a','b','a']` → `[{true,2},{false,0},{true,1},{true,1}]`
 * (마지막 'a' 는 'b' 로 끊겼으니 앞의 'a' 와 안 합친다)
 */
export function mergeRuns(values: string[]): CellSpan[] {
  const out: CellSpan[] = values.map(() => ({ render: false, rowSpan: 0 }));
  let i = 0;
  while (i < values.length) {
    let n = 1;
    while (i + n < values.length && values[i + n] === values[i]) n += 1;
    out[i] = { render: true, rowSpan: n };
    i += n;
  }
  return out;
}
