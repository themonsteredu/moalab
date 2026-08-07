'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { useAppsOverview, type AppOverview } from '@/lib/useAppsOverview';
import { STATUS_META } from '@/lib/status';
import { ddayClass, ddayLabel, relTime } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { RESPONSE_META } from '@/components/Checklist';
import { Icon } from '@/components/Icon';
import { CardSkeleton, EmptyState, ErrorBanner, ProgressBar } from '@/components/ui';
import { CHECK_ITEMS, type CheckRow } from '@/lib/types';

type Tab = 'mine' | 'answer' | 'all';

/**
 * 프로그램검증 — 검증만 따로 모아 보는 화면.
 * 프로그램계획(/apps)은 "무엇을 만드나"를, 여기는 "그게 돌아가나"만 본다.
 * 위에서부터 내가 지금 손대야 할 것 → 내 답을 기다리는 것 → 전체 순서다.
 */
export default function VerifyPage() {
  const { session, isAdmin } = useSession();
  const { nameOf } = useMembers(true);
  const { items, loading, error, reload } = useAppsOverview();
  /** null = 아직 사람이 안 골랐다 → 할 일이 있는 칸을 대신 열어준다 */
  const [picked, setPicked] = useState<Tab | null>(null);

  /** 내가 검증자인데 아직 미확인 항목이 남은 프로그램 */
  const mine = useMemo(
    () =>
      items.filter(
        (it) =>
          session &&
          it.reviewerIds.includes(session.id) &&
          it.checks.some((c) => c.member_id === session.id && c.result === 'none'),
      ),
    [items, session],
  );

  /** 내가 만든(또는 원장이면 전부) 프로그램에서 아직 답 안 한 지적 */
  const waiting = useMemo(() => {
    const out: { it: AppOverview; check: CheckRow }[] = [];
    for (const it of items) {
      const isOwner = isAdmin || (it.app.creator_id && it.app.creator_id === session?.id);
      if (!isOwner) continue;
      for (const c of it.checks) {
        if (c.result === 'fail' && c.response_state === 'none') out.push({ it, check: c });
      }
    }
    return out.sort((a, b) => b.check.updated_at.localeCompare(a.check.updated_at));
  }, [items, isAdmin, session]);

  const all = useMemo(
    () =>
      [...items].sort((a, b) => {
        const rank = { fixing: 0, pending: 1, done: 2 } as const;
        if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
        return a.progress - b.progress;
      }),
    [items],
  );

  const tab: Tab = picked ?? (mine.length > 0 ? 'mine' : waiting.length > 0 ? 'answer' : 'all');
  const setTab = setPicked;

  const TABS: { value: Tab; label: string; n: number }[] = [
    { value: 'mine', label: '내가 볼 것', n: mine.length },
    { value: 'answer', label: '내 답변 대기', n: waiting.length },
    { value: 'all', label: '전체', n: items.length },
  ];

  const doneCount = items.filter((i) => i.status === 'done').length;

  return (
    <div>
      <PageHeader
        title="프로그램검증"
        subtitle={loading ? '불러오는 중…' : `${items.length}개 중 ${doneCount}개 검증 완료`}
      />

      <div className="px-4 pb-8 pt-3 lg:px-0">
        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} onRetry={() => void reload()} />
          </div>
        )}

        <div className="mb-3 flex gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              aria-pressed={tab === t.value}
              className={`tap flex-1 gap-1 rounded-xl border text-[13px] font-bold transition ${
                tab === t.value
                  ? 'border-brand bg-brand text-white'
                  : 'border-neutral-200 bg-surface text-neutral-500'
              }`}
            >
              {t.label}
              <span className={tab === t.value ? 'text-white/80' : 'text-neutral-400'}>{t.n}</span>
            </button>
          ))}
        </div>

        {loading ? (
          <CardSkeleton rows={4} />
        ) : tab === 'answer' ? (
          waiting.length === 0 ? (
            <EmptyState
              icon="checkCircle"
              title="답변할 지적이 없어요"
              desc="검증자가 실패로 표시하면 여기로 모여요."
            />
          ) : (
            <ul className="space-y-2.5">
              {waiting.map(({ it, check }) => (
                <li key={check.id}>
                  <Link href={`/apps/${it.app.id}`} className="card block p-3.5 transition hover:bg-raised">
                    <p className="flex flex-wrap items-center gap-1.5">
                      <span className="chip bg-red-100 text-red-700">실패</span>
                      <span className="text-[13.5px] font-bold text-neutral-800">{it.app.title_ko}</span>
                    </p>
                    <p className="mt-1.5 text-[12.5px] font-semibold text-neutral-500">
                      {check.item_no}. {CHECK_ITEMS[check.item_no - 1]}
                    </p>
                    {check.note && (
                      <p className="mt-1 line-clamp-3 rounded-lg bg-red-50 px-2.5 py-2 text-[13px] leading-relaxed text-red-800">
                        {check.note}
                      </p>
                    )}
                    <p className="mt-1.5 text-[11.5px] text-neutral-400">
                      {nameOf(check.member_id)} · {relTime(check.updated_at)} · 눌러서 답하기
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : tab === 'mine' ? (
          mine.length === 0 ? (
            <EmptyState
              icon="checkCircle"
              title="지금 볼 검증이 없어요"
              desc="내가 검증자로 배정된 프로그램에 미확인 항목이 생기면 여기 보여요."
            />
          ) : (
            <ul className="space-y-2.5">
              {mine.map((it) => (
                <VerifyCard key={it.app.id} it={it} meId={session?.id ?? null} nameOf={nameOf} />
              ))}
            </ul>
          )
        ) : all.length === 0 ? (
          <EmptyState icon="checkCircle" title="프로그램이 없어요" desc="프로그램계획에서 먼저 추가해주세요." />
        ) : (
          <ul className="space-y-2.5">
            {all.map((it) => (
              <VerifyCard key={it.app.id} it={it} meId={session?.id ?? null} nameOf={nameOf} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function VerifyCard({
  it,
  meId,
  nameOf,
}: {
  it: AppOverview;
  meId: string | null;
  nameOf: (id: string | null) => string;
}) {
  const meta = STATUS_META[it.status];
  const dday = ddayLabel(it.app.due_date);
  const answered = it.checks.filter((c) => c.result === 'fail' && c.response_state !== 'none');
  const openFails = it.checks.filter((c) => c.result === 'fail' && c.response_state === 'none');

  return (
    <li>
      <Link href={`/apps/${it.app.id}`} className="card block p-3.5 transition hover:bg-raised">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[14.5px] font-bold text-neutral-900">{it.app.title_ko}</p>
            <p className="mt-0.5 truncate text-[11.5px] text-neutral-400">
              {it.currentRound ? `${it.currentRound.round_no}차 검증` : '라운드 없음'} ·{' '}
              {it.reviewerIds.length > 0 ? it.reviewerIds.map((r) => nameOf(r)).join(', ') : '검증자 없음'}
            </p>
          </div>
          <span className={`chip shrink-0 ${meta.chip}`}>{meta.label}</span>
        </div>

        <div className="mt-2.5 flex items-center gap-2">
          <ProgressBar value={it.progress} className="flex-1" />
          <span className="w-9 shrink-0 text-right text-[11px] font-bold tabular-nums text-neutral-500">
            {it.progress}%
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {dday && <span className={`chip ${ddayClass(it.app.due_date)}`}>{dday}</span>}
          {openFails.length > 0 && (
            <span className="chip bg-red-100 text-red-700">답변 대기 {openFails.length}</span>
          )}
          {answered.map((c) => {
            const m = RESPONSE_META[c.response_state as 'fixed' | 'explained'];
            return (
              <span key={c.id} className={`chip ${m.chip}`}>
                {c.item_no}번 {m.label}
              </span>
            );
          })}
          {meId && it.checks.some((c) => c.member_id === meId && c.result === 'none') && (
            <span className="chip bg-brand-50 text-brand-700">
              <Icon name="target" size={11} className="mr-1" />내 확인 필요
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}
