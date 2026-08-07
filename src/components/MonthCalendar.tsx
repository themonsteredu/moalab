'use client';

import { useMemo } from 'react';
import { toISODate, today } from '@/lib/format';

export type EntryKind = 'due' | 'meeting' | 'visit';

export interface CalEntry {
  id: string;
  kind: EntryKind;
  title: string;
  date: string;
  time?: string | null;
  place?: string | null;
  href?: string;
  /** 담당/참석자 이름 — 누가 하는 일인지 달력에서 바로 보이게 */
  who?: string[];
}

export const KIND_META: Record<EntryKind, { dot: string; chip: string; label: string }> = {
  due: { dot: 'bg-red-500', chip: 'bg-red-100 text-red-700', label: '마감' },
  meeting: { dot: 'bg-blue-500', chip: 'bg-blue-100 text-blue-700', label: '회의' },
  visit: { dot: 'bg-green-500', chip: 'bg-green-100 text-green-700', label: '방문' },
};

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * 월간 달력 그리드. 홈과 일정 화면이 같은 걸 쓴다.
 * 폰에서 한 화면에 들어가도록 셀 높이를 44px 로 묶어뒀다.
 */
export function MonthCalendar({
  month,
  entries,
  selected,
  onSelect,
}: {
  /** 이 달의 1일 */
  month: Date;
  entries: CalEntry[];
  selected: string;
  onSelect: (iso: string) => void;
}) {
  const byDate = useMemo(() => {
    const m = new Map<string, CalEntry[]>();
    for (const e of entries) {
      const list = m.get(e.date) ?? [];
      list.push(e);
      m.set(e.date, list);
    }
    return m;
  }, [entries]);

  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const total = Math.ceil((first.getDay() + last.getDate()) / 7) * 7;
    return Array.from({ length: total }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [month]);

  const todayStr = today();

  return (
    <div className="card p-2">
      <div className="grid grid-cols-7">
        {WEEK.map((w, i) => (
          <div
            key={w}
            className={`pb-1 text-center text-[11px] font-bold ${
              i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-neutral-400'
            }`}
          >
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px">
        {cells.map((d) => {
          const iso = toISODate(d);
          const inMonth = d.getMonth() === month.getMonth();
          const list = byDate.get(iso) ?? [];
          const isToday = iso === todayStr;
          const isPicked = iso === selected;
          const kinds = [...new Set(list.map((e) => e.kind))];

          return (
            <button
              key={iso}
              onClick={() => onSelect(iso)}
              aria-label={`${d.getMonth() + 1}월 ${d.getDate()}일${list.length ? `, 일정 ${list.length}건` : ''}`}
              aria-pressed={isPicked}
              className={`flex h-11 flex-col items-center justify-center rounded-lg transition ${
                isPicked ? 'bg-brand text-white' : isToday ? 'bg-brand-50' : 'active:bg-neutral-100'
              }`}
            >
              <span
                className={`text-[13px] font-bold leading-none ${
                  isPicked
                    ? 'text-white'
                    : !inMonth
                      ? 'text-neutral-300'
                      : d.getDay() === 0
                        ? 'text-red-500'
                        : d.getDay() === 6
                          ? 'text-blue-500'
                          : 'text-neutral-700'
                }`}
              >
                {d.getDate()}
              </span>
              <span className="mt-1 flex h-1.5 items-center gap-0.5">
                {kinds.slice(0, 3).map((k) => (
                  <span
                    key={k}
                    className={`h-1.5 w-1.5 rounded-full ${isPicked ? 'bg-white/90' : KIND_META[k].dot}`}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CalendarLegend() {
  return (
    <div className="flex flex-wrap gap-3 px-1">
      {(['due', 'meeting', 'visit'] as EntryKind[]).map((k) => (
        <span key={k} className="flex items-center gap-1.5 text-[11.5px] text-neutral-500">
          <span className={`h-2 w-2 rounded-full ${KIND_META[k].dot}`} />
          {KIND_META[k].label}
        </span>
      ))}
    </div>
  );
}
