'use client';

import Link from 'next/link';
import { STATUS_META } from '@/lib/status';
import { ddayClass, ddayLabel } from '@/lib/format';
import { ProgressBar } from '@/components/ui';
import type { AppOverview } from '@/lib/useAppsOverview';

export function AppCard({ item, nameOf }: { item: AppOverview; nameOf: (id: string | null) => string }) {
  const { app, status, progress, currentRound, reviewerIds, openComments } = item;
  const meta = STATUS_META[status];
  const dday = ddayLabel(app.due_date);

  return (
    <Link
      href={`/apps/${app.id}`}
      className="card block p-4 transition active:scale-[.995] active:bg-neutral-50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[16px] font-bold leading-tight">{app.title_ko}</p>
          <p className="mt-0.5 truncate font-mono text-[11.5px] text-neutral-400">{app.slug}</p>
        </div>
        <span className={`chip shrink-0 ${meta.chip}`}>{meta.label}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="chip bg-neutral-100 text-neutral-600">
          {currentRound?.round_no ?? app.current_round}차 검증{status === 'done' ? ' 완료' : ' 중'}
        </span>
        {dday && <span className={`chip ${ddayClass(app.due_date)}`}>{dday}</span>}
        {openComments > 0 && (
          <span className="chip bg-brand-50 text-brand-700">💬 미해결 {openComments}</span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2.5">
        <ProgressBar value={progress} className="flex-1" />
        <span className="w-9 shrink-0 text-right text-[11.5px] font-bold text-neutral-500">{progress}%</span>
      </div>

      <p className="mt-2.5 truncate text-[12px] text-neutral-500">
        제작 {nameOf(app.creator_id)} · 검증 {reviewerIds.map((id) => nameOf(id)).join(', ') || '미배정'}
      </p>
    </Link>
  );
}
