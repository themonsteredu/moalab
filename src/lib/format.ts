/** 1234567 → "1,234,567" */
export function won(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '0';
  return Math.round(n).toLocaleString('ko-KR');
}

/** 소수 한 자리까지 (원가 단가처럼 잔돈이 중요한 값) */
export function won1(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '0';
  const r = Math.round(n * 10) / 10;
  return r.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
}

/** 'YYYY-MM-DD' (로컬 기준) */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function today(): string {
  return toISODate(new Date());
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** 오늘로부터 며칠 남았나. 음수면 지났다. */
export function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  const d = parseDate(dateStr);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}

export function ddayLabel(dateStr: string | null | undefined): string | null {
  const n = daysUntil(dateStr);
  if (n == null) return null;
  if (n === 0) return 'D-day';
  if (n < 0) return `${-n}일 지남`;
  return `D-${n}`;
}

/** D-day 배지 색: D-3 노랑 / D-1 주황 / D-day·지남 빨강 */
export function ddayClass(dateStr: string | null | undefined): string {
  const n = daysUntil(dateStr);
  if (n == null) return 'bg-neutral-100 text-neutral-500';
  if (n <= 0) return 'bg-red-100 text-red-700';
  if (n <= 1) return 'bg-orange-100 text-orange-700';
  if (n <= 3) return 'bg-yellow-100 text-yellow-800';
  return 'bg-neutral-100 text-neutral-600';
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

export function korDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const d = parseDate(dateStr);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
}

export function korDateFull(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const d = parseDate(dateStr);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
}

/** timestamptz → "8/6 22:11" */
export function shortTime(ts: string | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}

/** timestamptz → "2026-08-06 22:11" */
export function logTime(ts: string | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function relTime(ts: string | null | undefined): string {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  return shortTime(ts);
}

/** 'HH:MM:SS' → '14:30' */
export function hhmm(t: string | null | undefined): string {
  if (!t) return '';
  return t.slice(0, 5);
}
