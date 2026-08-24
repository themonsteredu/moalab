'use client';

import Link from 'next/link';
import { STATUS_META } from '@/lib/status';
import { ddayClass, ddayLabel } from '@/lib/format';
import { ProgressBar } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { PIECES, type AppOverview } from '@/lib/useAppsOverview';

/** 검증·문서·원가·샘플·사진 중 뭐가 채워졌는지 한 줄로 */
export function PieceRow({ item, compact = false }: { item: AppOverview; compact?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {PIECES.map((p) => {
        const on = item.done[p.key];
        return (
          <span
            key={p.key}
            title={`${p.label} ${on ? '있음' : '없음'}`}
            className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10.5px] font-bold transition ${
              on ? 'bg-green-50 text-green-700' : 'bg-neutral-100 text-neutral-300'
            }`}
          >
            <Icon name={p.icon} size={11} />
            {!compact && p.label}
          </span>
        );
      })}
    </div>
  );
}

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

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="chip bg-neutral-100 text-neutral-600">
          {currentRound?.round_no ?? app.current_round}차 검증{status === 'done' ? ' 완료' : ' 중'}
        </span>
        {dday && <span className={`chip ${ddayClass(app.due_date)}`}>{dday}</span>}
        {openComments > 0 && (
          <span className="chip gap-1 bg-brand-50 text-brand-700">
            <Icon name="comment" size={11} />
            미해결 {openComments}
          </span>
        )}
      </div>

      <div className="mt-2.5">
        <PieceRow item={item} />
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

/** 갤러리 뷰 카드 — 샘플 이미지가 있으면 썸네일로 */
export function AppGalleryCard({ item }: { item: AppOverview }) {
  const { app, status, cover } = item;
  const meta = STATUS_META[status];
  return (
    <Link href={`/apps/${app.id}`} className="card overflow-hidden active:opacity-80">
      <div className="aspect-[4/3] bg-neutral-100">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-neutral-300">
            <Icon name="puzzle" size={28} />
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate text-[14px] font-bold leading-tight">{app.title_ko}</p>
          <span className={`chip shrink-0 ${meta.chip}`}>{meta.label}</span>
        </div>
        <div className="mt-2">
          <PieceRow item={item} compact />
        </div>
      </div>
    </Link>
  );
}

/** 보드(칸반) 뷰 카드 */
export function AppBoardCard({ item, nameOf }: { item: AppOverview; nameOf: (id: string | null) => string }) {
  const { app, progress, currentRound, openComments } = item;
  const dday = ddayLabel(app.due_date);
  return (
    <Link href={`/apps/${app.id}`} className="card block p-3 active:bg-neutral-50">
      <p className="truncate text-[14px] font-bold leading-tight">{app.title_ko}</p>
      <p className="mt-1 truncate text-[11.5px] text-neutral-500">{nameOf(app.creator_id)}</p>
      <div className="mt-2">
        <PieceRow item={item} compact />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <ProgressBar value={progress} className="flex-1" />
        <span className="shrink-0 text-[10.5px] font-bold text-neutral-400">{progress}%</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="chip bg-neutral-100 text-neutral-500">{currentRound?.round_no ?? 1}차</span>
        {dday && <span className={`chip ${ddayClass(app.due_date)}`}>{dday}</span>}
        {openComments > 0 && (
          <span className="chip gap-0.5 bg-brand-50 text-brand-700">
            <Icon name="comment" size={10} />
            {openComments}
          </span>
        )}
      </div>
    </Link>
  );
}
