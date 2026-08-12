'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { useAppsOverview, type AppOverview } from '@/lib/useAppsOverview';
import { STATUS_META } from '@/lib/status';
import { ddayClass, ddayLabel, relTime } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { Icon } from '@/components/Icon';
import { CardSkeleton, EmptyState, ErrorBanner, ProgressBar } from '@/components/ui';
import { FINDING_META, type Finding } from '@/lib/types';

type Tab = 'mine' | 'answer' | 'all';

/**
 * 프로그램검증 — 검증만 따로 모아 보는 화면.
 * 프로그램계획(/apps)은 "무엇을 만드나"를, 여기는 "그게 돌아가나"만 본다.
 * 위에서부터 내가 지금 봐야 할 것 → 내가 답해야 할 지적 → 전체 순서다.
 */
export default function VerifyPage() {
  const { session, isAdmin } = useSession();
  const { nameOf } = useMembers(true);
  const { items, loading, error, reload } = useAppsOverview();
  /** null = 아직 사람이 안 골랐다 → 할 일이 있는 칸을 대신 열어준다 */
  const [picked, setPicked] = useState<Tab | null>(null);

  /** 내가 검증자인데 아직 '검증 완료' 를 안 누른 프로그램 */
  const mine = useMemo(
    () =>
      items.filter(
        (it) => session && it.reviewerIds.includes(session.id) && !it.signedIds.includes(session.id),
      ),
    [items, session],
  );

  /** 내가 만든(원장이면 전부) 프로그램에서 아직 답이 없는 지적 */
  const waiting = useMemo(() => {
    const out: { it: AppOverview; finding: Finding }[] = [];
    for (const it of items) {
      const isOwner = isAdmin || (it.app.creator_id && it.app.creator_id === session?.id);
      if (!isOwner) continue;
      for (const f of it.openFindings) {
        if (f.status === 'open' || f.status === 'recheck') out.push({ it, finding: f });
      }
    }
    return out.sort((a, b) => b.finding.updated_at.localeCompare(a.finding.updated_at));
  }, [items, isAdmin, session]);

  const all = useMemo(
    () =>
      [...items].sort((a, b) => {
        // 급한 것부터: 고칠 것 → 다시 볼 것 → 아직 안 본 것 → 끝난 것
        const rank = { fixing: 0, recheck: 1, pending: 2, done: 3 } as const;
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
              desc="검증자가 캡처와 함께 지적을 남기면 여기로 모여요."
            />
          ) : (
            <ul className="space-y-2.5">
              {waiting.map(({ it, finding }) => (
                <li key={finding.id}>
                  <Link href={`/apps/${it.app.id}`} className="card block p-3.5 transition hover:bg-raised">
                    <p className="flex flex-wrap items-center gap-1.5">
                      <span className={`chip ${FINDING_META[finding.status].chip}`}>
                        {FINDING_META[finding.status].label}
                      </span>
                      <span className="text-[13.5px] font-bold text-neutral-800">{it.app.title_ko}</span>
                    </p>
                    <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-700">
                      {finding.body}
                    </p>
                    <p className="mt-1.5 text-[11.5px] text-neutral-400">
                      {nameOf(finding.member_id)} · {relTime(finding.created_at)} · 눌러서 답하기
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
              desc="내가 검증자로 배정된 프로그램이 생기면 여기 보여요."
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
  /** 상태별로 몇 건인지 — 지적이 어디에 걸려 있는지 한눈에 */
  const byStatus = it.openFindings.reduce<Record<string, number>>((acc, f) => {
    acc[f.status] = (acc[f.status] ?? 0) + 1;
    return acc;
  }, {});

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
          <span className="w-16 shrink-0 text-right text-[11px] font-bold tabular-nums text-neutral-500">
            검증 {it.signedIds.length}/{it.reviewerIds.length}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {dday && <span className={`chip ${ddayClass(it.app.due_date)}`}>{dday}</span>}
          {(['open', 'recheck', 'fixed'] as const).map((k) =>
            byStatus[k] ? (
              <span key={k} className={`chip ${FINDING_META[k].chip}`}>
                {FINDING_META[k].label} {byStatus[k]}
              </span>
            ) : null,
          )}
          {meId && it.reviewerIds.includes(meId) && !it.signedIds.includes(meId) && (
            <span className="chip bg-brand-50 text-brand-700">
              <Icon name="target" size={11} className="mr-1" />내 확인 필요
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}
