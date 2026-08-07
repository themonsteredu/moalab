'use client';

import { won } from '@/lib/format';
import type { SheetTotals } from '@/lib/cost';

/**
 * 구분별 소계. 도넛 + 막대를 같이 보여준다.
 * 라이브러리 없이 SVG 로 그린다 (번들 가볍게).
 */
export function CostChart({ totals }: { totals: SheetTotals }) {
  const { byCategory, total } = totals;
  if (byCategory.length === 0 || total === 0) return null;

  const R = 42;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="card p-4">
      <p className="mb-3 text-[13.5px] font-bold text-neutral-700">구분별 소계</p>

      <div className="flex items-center gap-5">
        <svg viewBox="0 0 110 110" className="h-[110px] w-[110px] shrink-0 -rotate-90" role="img" aria-label="구분별 원가 비율">
          {byCategory.map((c) => {
            const len = c.ratio * C;
            const el = (
              <circle
                key={c.category}
                cx="55"
                cy="55"
                r={R}
                fill="none"
                stroke={c.color}
                strokeWidth="16"
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
        </svg>

        <ul className="min-w-0 flex-1 space-y-2">
          {byCategory.map((c) => (
            <li key={c.category}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: c.color }} />
                  <span className="truncate text-[13px] font-semibold text-neutral-700">{c.label}</span>
                </span>
                <span className="shrink-0 text-[13px] font-bold tabular-nums">{won(c.total)}원</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.round(c.ratio * 100)}%`, backgroundColor: c.color }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
