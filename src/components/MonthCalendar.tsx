'use client';

import { useMemo } from 'react';
import { toISODate, today, hhmm } from '@/lib/format';
import type { EntryKind } from '@/lib/schedule';

export type { EntryKind };

export interface CalEntry {
  id: string;
  kind: EntryKind;
  title: string;
  date: string;
  time?: string | null;
  place?: string | null;
  href?: string;
  /** 담당/참석자 이름 */
  who?: string[];
}

export const KIND_META: Record<
  EntryKind,
  { dot: string; chip: string; pill: string; label: string }
> = {
  due: {
    dot: 'bg-red-500',
    chip: 'bg-red-100 text-red-700',
    pill: 'bg-red-50 text-red-700 border-red-200',
    label: '마감',
  },
  class: {
    dot: 'bg-green-500',
    chip: 'bg-green-100 text-green-800',
    pill: 'bg-green-50 text-green-800 border-green-200',
    label: '출강',
  },
  meeting: {
    dot: 'bg-blue-500',
    chip: 'bg-blue-100 text-blue-700',
    pill: 'bg-blue-50 text-blue-700 border-blue-200',
    label: '회의',
  },
  etc: {
    dot: 'bg-neutral-400',
    chip: 'bg-neutral-100 text-neutral-700',
    pill: 'bg-neutral-50 text-neutral-700 border-neutral-200',
    label: '기타',
  },
};

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
/** 셀 안에 글씨로 보여줄 최대 개수. 넘으면 +N */
const MAX_IN_CELL = 2;

/**
 * 월간 달력.
 * 점만 찍으면 눌러봐야 뭔지 알 수 있어서, 칸 안에 일정 제목을 바로 적는다.
 * 폭이 좁으면 잘리지만 색 + 앞 글자만으로도 뭔지 짐작이 된다.
 */
export function MonthCalendar({
  month,
  entries,
  selected,
  onSelect,
}: {
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
    for (const list of m.values()) {
      list.sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99'));
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
    <div className="overflow-hidden rounded-xl border border-neutral-200">
      <div className="grid grid-cols-7 border-b border-neutral-200 bg-raised">
        {WEEK.map((w, i) => (
          <div
            key={w}
            className={`py-1.5 text-center text-[11px] font-bold ${
              i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-neutral-400'
            }`}
          >
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((d, idx) => {
          const iso = toISODate(d);
          const inMonth = d.getMonth() === month.getMonth();
          const list = byDate.get(iso) ?? [];
          const isToday = iso === todayStr;
          const isPicked = iso === selected;
          const lastRow = idx >= cells.length - 7;

          return (
            <button
              key={iso}
              onClick={() => onSelect(iso)}
              aria-label={`${d.getMonth() + 1}월 ${d.getDate()}일${list.length ? `, 일정 ${list.length}건` : ''}`}
              aria-pressed={isPicked}
              className={`flex min-h-[62px] flex-col items-stretch gap-0.5 border-neutral-100 p-1 text-left transition
                          lg:min-h-[92px] ${idx % 7 !== 6 ? 'border-r' : ''} ${lastRow ? '' : 'border-b'} ${
                            isPicked ? 'bg-brand-50 ring-1 ring-inset ring-brand' : 'hover:bg-raised'
                          }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11.5px] font-bold ${
                  isToday
                    ? 'bg-brand text-white'
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

              {list.slice(0, MAX_IN_CELL).map((e) => (
                <span
                  key={e.id}
                  title={`${e.title}${e.time ? ` ${hhmm(e.time)}` : ''}`}
                  className={`truncate rounded border px-1 py-[1px] text-[9.5px] font-semibold leading-[13px]
                              lg:text-[10.5px] lg:leading-[15px] ${KIND_META[e.kind].pill}`}
                >
                  {e.title}
                </span>
              ))}
              {list.length > MAX_IN_CELL && (
                <span className="px-1 text-[9.5px] font-bold text-neutral-400">
                  +{list.length - MAX_IN_CELL}
                </span>
              )}
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
      {(['due', 'class', 'meeting', 'etc'] as EntryKind[]).map((k) => (
        <span key={k} className="flex items-center gap-1.5 text-[11.5px] text-neutral-500">
          <span className={`h-2 w-2 rounded-full ${KIND_META[k].dot}`} />
          {KIND_META[k].label}
        </span>
      ))}
    </div>
  );
}
