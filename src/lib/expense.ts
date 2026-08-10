import {
  EXPENSE_CATEGORIES,
  PAY_METHODS,
  type Expense,
  type ExpenseCategory,
  type PayMethod,
} from './types';

/* ------------------------------------------------------------------ 이름표 */

export function expenseCategoryLabel(c: ExpenseCategory | string): string {
  return EXPENSE_CATEGORIES.find((x) => x.value === c)?.label ?? '기타';
}

export function expenseCategoryColor(c: ExpenseCategory | string): string {
  return EXPENSE_CATEGORIES.find((x) => x.value === c)?.color ?? '#8A8A8A';
}

export function payMethodLabel(m: PayMethod | string): string {
  return PAY_METHODS.find((x) => x.value === m)?.label ?? '-';
}

/** 표 칸이 좁을 때 (인쇄물의 결제 칸) — '계좌이체' 가 두 줄로 접히면 표가 지저분해진다 */
export function payMethodShort(m: PayMethod | string): string {
  return m === 'transfer' ? '이체' : payMethodLabel(m);
}

/* ------------------------------------------------------------------- 달 계산
   회계는 달 단위로 끊는다. 'YYYY-MM' 문자열을 그대로 키로 쓴다 —
   Date 로 왔다갔다 하면 시간대 때문에 1일·말일이 앞뒤 달로 새는 일이 생긴다. */

/** '2026-08-08' → '2026-08' */
export function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** '2026-08' → '2026년 8월' */
export function monthLabel(mk: string): string {
  const [y, m] = mk.split('-');
  return `${y}년 ${Number(m)}월`;
}

/** 달을 n칸 옮긴다. shiftMonth('2026-01', -1) → '2025-12' */
export function shiftMonth(mk: string, n: number): string {
  const [y, m] = mk.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

/** 그 달의 시작·끝 날짜 (both inclusive, 'YYYY-MM-DD') */
export function monthRange(mk: string): { from: string; to: string } {
  const [y, m] = mk.split('-').map(Number);
  const last = new Date(y, m, 0).getDate(); // m 월의 마지막 날
  return { from: `${mk}-01`, to: `${mk}-${String(last).padStart(2, '0')}` };
}

/* -------------------------------------------------------------------- 합계 */

export interface ExpenseTotals {
  total: number;
  count: number;
  /** 영수증이 한 장도 안 붙은 건수 — 회계처리 때 제일 먼저 막히는 것 */
  noReceipt: number;
  /** 원장이 아직 확인 안 한 건수 */
  unapproved: number;
  byCategory: { value: ExpenseCategory; label: string; color: string; amount: number; count: number }[];
  byMethod: { value: PayMethod; label: string; amount: number; count: number }[];
}

export function expenseTotals(rows: Expense[], receiptCount: (id: string) => number): ExpenseTotals {
  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);

  const byCategory = EXPENSE_CATEGORIES.map((c) => {
    const hit = rows.filter((r) => r.category === c.value);
    return {
      value: c.value,
      label: c.label,
      color: c.color,
      amount: hit.reduce((s, r) => s + Number(r.amount || 0), 0),
      count: hit.length,
    };
  }).filter((c) => c.count > 0);

  const byMethod = PAY_METHODS.map((m) => {
    const hit = rows.filter((r) => r.pay_method === m.value);
    return {
      value: m.value,
      label: m.label,
      amount: hit.reduce((s, r) => s + Number(r.amount || 0), 0),
      count: hit.length,
    };
  }).filter((m) => m.count > 0);

  return {
    total,
    count: rows.length,
    noReceipt: rows.filter((r) => receiptCount(r.id) === 0).length,
    unapproved: rows.filter((r) => !r.approved).length,
    byCategory,
    byMethod,
  };
}

/** 날짜별로 묶는다. 인쇄물의 '날짜별 소계' 와 목록 화면이 같은 함수를 쓴다 */
export function groupByDate(
  rows: Expense[],
  desc = true,
): { date: string; rows: Expense[]; amount: number }[] {
  const m = new Map<string, Expense[]>();
  for (const r of rows) {
    const list = m.get(r.spent_on) ?? [];
    list.push(r);
    m.set(r.spent_on, list);
  }
  return [...m.entries()]
    .sort((a, b) => (desc ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0])))
    .map(([date, list]) => ({
      date,
      rows: list,
      amount: list.reduce((s, r) => s + Number(r.amount || 0), 0),
    }));
}

/* --------------------------------------------------------------- 인쇄 묶음
   프로그램 인쇄(print.ts)와 같은 방식이다. Next.js page 파일에서는
   컴포넌트 외의 export 를 못 하니 상수를 여기에 둔다. */

export const EXPENSE_PRINT_PARTS = [
  { key: 'summary', label: '구분별 소계' },
  { key: 'daily', label: '날짜별 소계' },
  { key: 'list', label: '지출 명세 표' },
  { key: 'receipt', label: '영수증 첨부 (사진)' },
] as const;

export type ExpensePrintPart = (typeof EXPENSE_PRINT_PARTS)[number]['key'];

export function parseExpenseParts(raw: string | null): Set<ExpensePrintPart> {
  if (!raw) return new Set(EXPENSE_PRINT_PARTS.map((p) => p.key));
  const keys = raw
    .split(',')
    .filter((k): k is ExpensePrintPart => EXPENSE_PRINT_PARTS.some((p) => p.key === k));
  return keys.length > 0 ? new Set(keys) : new Set(EXPENSE_PRINT_PARTS.map((p) => p.key));
}

/* ----------------------------------------------------------------- 금액 입력
   폰에서 0 을 몇 개 쳤는지 눈으로 못 세니 입력 중에도 콤마를 찍어준다. */

/** '4만5000' 같은 오타를 막으려고 숫자만 남긴다 */
export function digitsOnly(s: string): string {
  return s.replace(/[^\d]/g, '');
}

/** '45000' → '45,000' (빈 값은 빈 값으로) */
export function commaNumber(s: string): string {
  const d = digitsOnly(s);
  if (!d) return '';
  return Number(d).toLocaleString('ko-KR');
}
