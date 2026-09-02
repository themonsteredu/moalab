'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { buildSalesBoard, lateLabel, type SalesInput } from '@/lib/sales';
import { Collapsible, Skeleton } from '@/components/ui';
import { Icon } from '@/components/Icon';
import type { DutyColumn, DutyRow } from '@/lib/types';

/**
 * **영업 한 판** — 기관 표 여럿을 읽어서 한 화면에 합친다.
 *
 * 신규 기관 발굴을 갈래 15개로 나눈 뒤(37단계) *"오늘 연락할 곳이 어디지"* 를 보려면
 * 표 15개를 하나씩 열어야 했다. 여기서는 **새 표 없이** 읽어서 계산만 한다
 * (계산은 `src/lib/sales.ts`, 어떤 표를 모으는지도 거기 적혀 있다).
 *
 * 위에서 아래로 — 상태별 개수 → **오늘 연락할 곳** → 갈래별.
 * 오늘 연락할 곳을 누르면 그 표를 **그 기관으로 검색해둔 채** 연다 (`?q=`) —
 * 14줄짜리 표에 떨어져 다시 찾게 하지 않는다.
 *
 * 모을 표가 하나도 없으면 아무것도 안 그린다 — 빈 섹션은 스크롤만 길어진다.
 */
export function SalesBoard({ inputs, today }: { inputs: SalesInput[]; today: string }) {
  const [cols, setCols] = useState<DutyColumn[] | null>(null);
  const [rows, setRows] = useState<DutyRow[]>([]);
  const [showAll, setShowAll] = useState(false);

  /* 역할 id 목록이 실제로 바뀔 때만 다시 읽는다 (배열 참조가 바뀔 때마다 읽으면 부모가
     그려질 때마다 요청이 나간다) */
  const key = useMemo(() => inputs.map((i) => i.duty.id).join(','), [inputs]);

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) {
      setCols([]);
      setRows([]);
      return;
    }
    let alive = true;
    (async () => {
      const [c, r] = await Promise.all([
        supabase.from('duty_columns').select('*').in('duty_id', ids).order('sort_order'),
        supabase.from('duty_rows').select('*').in('duty_id', ids).order('sort_order'),
      ]);
      if (!alive) return;
      // 표가 아직 없는 DB 에서도 화면이 죽으면 안 된다 — 실패는 조용히 빈 것
      setCols(c.error ? [] : ((c.data ?? []) as DutyColumn[]));
      setRows(r.error ? [] : ((r.data ?? []) as DutyRow[]));
    })();
    return () => {
      alive = false;
    };
  }, [key]);

  const board = useMemo(
    () => buildSalesBoard(inputs, cols ?? [], rows, today),
    [inputs, cols, rows, today],
  );

  if (cols === null) return <Skeleton className="h-14 w-full" />;
  if (board.tables.length === 0) return null;

  const DUE_SHOWN = 6;
  const dueShown = showAll ? board.due : board.due.slice(0, DUE_SHOWN);
  const rowLink = 'flex min-h-[44px] items-center gap-2 py-1.5';

  return (
    <section className="card p-3.5">
      <Collapsible
        id="mywork.sales"
        title="영업 한 판"
        defaultOpen
        badge={
          <>
            {board.due.length > 0 && (
              <span className="chip bg-red-100 text-red-700">오늘 연락 {board.due.length}</span>
            )}
            <span className="chip bg-neutral-100 text-neutral-500">기관 {board.total}곳</span>
          </>
        }
      >
        {/* 상태별 개수 — 표 전부를 합쳐서. 보기 순서대로, 0 건은 안 싣는다 */}
        {board.status.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {board.status.map((s) => (
              <span key={s.label} className="chip bg-neutral-100 text-neutral-600">
                {s.label} {s.n}
              </span>
            ))}
          </div>
        )}

        {/* 오늘 연락할 곳 — 오래 지난 것부터. 보류·완료는 안 뜬다 */}
        <h3 className="mt-3 text-[13px] font-bold text-neutral-800">
          오늘 연락할 곳
          {board.due.length > 0 && <span className="ml-1.5 text-neutral-400">{board.due.length}</span>}
        </h3>
        {board.due.length === 0 ? (
          <p className="mt-1 text-[12.5px] leading-relaxed text-neutral-400">
            {board.total === 0
              ? '아직 기관이 없어요. 아래 갈래를 열어 “여러 줄 넣기” 로 붙여넣으세요.'
              : '오늘 연락할 곳이 없어요. 기관 줄에 다음 연락일을 적어두면 그날 여기 모여요.'}
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {dueShown.map((d) => (
              <li key={d.rowId}>
                <Link href={`/roles/${d.dutyId}?q=${encodeURIComponent(d.title)}`} className={rowLink}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-neutral-800">{d.title}</span>
                    <span className="block truncate text-[11.5px] text-neutral-400">
                      {d.dutyName}
                      {d.status ? ` · ${d.status}` : ''}
                    </span>
                  </span>
                  <span
                    className={`chip shrink-0 ${
                      d.daysLate > 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {lateLabel(d.daysLate)}
                  </span>
                  <Icon name="chevronDown" size={13} className="shrink-0 -rotate-90 text-neutral-300" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {board.due.length > DUE_SHOWN && !showAll && (
          <button onClick={() => setShowAll(true)} className="tap w-full text-[12.5px] font-bold text-brand">
            {board.due.length - DUE_SHOWN}건 더 보기
          </button>
        )}

        {/* 갈래별 — 접어둔다. 바로 아래 `내 부서` 에 같은 이름이 또 있어서, 여기서는
            기관 몇 곳·오늘 몇 곳만 보이면 된다. 기관이 0곳이면 붙여넣을 곳을 찾아야 하니 연다 */}
        <div className="mt-3">
          <Collapsible
            id="mywork.sales.tables"
            dense
            title="갈래별"
            defaultOpen={board.total === 0}
            badge={<span className="chip bg-neutral-100 text-neutral-500">표 {board.tables.length}</span>}
          >
            <ul className="divide-y divide-neutral-100">
              {board.tables.map((t) => (
                <li key={t.dutyId}>
                  <Link href={`/roles/${t.dutyId}`} className={rowLink}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold text-neutral-800">{t.dutyName}</span>
                      {t.top.length > 0 && (
                        <span className="block truncate text-[11.5px] text-neutral-400">
                          {t.top.map((s) => `${s.label} ${s.n}`).join(' · ')}
                        </span>
                      )}
                    </span>
                    {t.due > 0 && <span className="chip shrink-0 bg-red-100 text-red-700">오늘 {t.due}</span>}
                    <span className="chip shrink-0 bg-neutral-100 text-neutral-500">{t.total}곳</span>
                    <Icon name="chevronDown" size={13} className="shrink-0 -rotate-90 text-neutral-300" />
                  </Link>
                </li>
              ))}
            </ul>
          </Collapsible>
        </div>
      </Collapsible>
    </section>
  );
}
