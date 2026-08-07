'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { useAppsOverview } from '@/lib/useAppsOverview';
import { CHECK_ITEMS, type ActivityLog, type CommentRow, type Schedule } from '@/lib/types';
import { CardSkeleton, EmptyState, ErrorBanner, ProgressBar, SectionTitle, Skeleton } from '@/components/ui';
import { ddayClass, ddayLabel, hhmm, korDate, korDateFull, logTime, relTime, today, toISODate } from '@/lib/format';

export default function HomePage() {
  const { session, isAdmin, signOut } = useSession();
  const { items, loading, error, reload } = useAppsOverview();
  const { nameOf, members } = useMembers();

  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [myComments, setMyComments] = useState<(CommentRow & { app_title: string })[] | null>(null);
  const [logs, setLogs] = useState<ActivityLog[] | null>(null);

  const meId = session?.id ?? '';

  const loadExtras = useCallback(async () => {
    const from = today();
    const to = toISODate(new Date(Date.now() + 7 * 86400000));

    const [schedRes, logRes] = await Promise.all([
      supabase.from('schedules').select('*').gte('date', from).lte('date', to).order('date').order('start_time'),
      isAdmin
        ? supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(12)
        : Promise.resolve({ data: [] as ActivityLog[] }),
    ]);
    setSchedules((schedRes.data ?? []) as Schedule[]);
    setLogs((logRes.data ?? []) as ActivityLog[]);
  }, [isAdmin]);

  useEffect(() => {
    void loadExtras();
  }, [loadExtras]);

  // 미해결 댓글 — 내가 만든 앱에 달린 것 (= 나를 향한 지적)
  useEffect(() => {
    if (items.length === 0) {
      setMyComments([]);
      return;
    }
    const myApps = items.filter((i) => i.app.creator_id === meId);
    if (myApps.length === 0) {
      setMyComments([]);
      return;
    }
    void (async () => {
      const { data } = await supabase
        .from('comments')
        .select('*')
        .eq('resolved', false)
        .in('app_id', myApps.map((a) => a.app.id))
        .order('created_at', { ascending: false })
        .limit(10);
      const titleOf = new Map(items.map((i) => [i.app.id, i.app.title_ko]));
      setMyComments(
        ((data ?? []) as CommentRow[])
          .filter((c) => c.member_id !== meId)
          .map((c) => ({ ...c, app_title: titleOf.get(c.app_id) ?? '' })),
      );
    })();
  }, [items, meId]);

  /** 내 할 일: 내가 검증자인데 아직 5개를 다 통과시키지 않은 것 + 내가 만든 앱 중 수정 필요 */
  const myTasks = useMemo(() => {
    const out: { id: string; title: string; sub: string; due: string | null; kind: 'review' | 'fix' }[] = [];
    for (const it of items) {
      const isReviewer = it.reviewerIds.includes(meId);
      if (isReviewer) {
        const mine = it.checks.filter((c) => c.member_id === meId);
        const passed = mine.filter((c) => c.result === 'pass').length;
        if (passed < CHECK_ITEMS.length) {
          out.push({
            id: it.app.id,
            title: it.app.title_ko,
            sub: `${it.currentRound?.round_no ?? 1}차 검증 · ${passed}/${CHECK_ITEMS.length} 완료`,
            due: it.app.due_date,
            kind: 'review',
          });
        }
      }
      if (it.app.creator_id === meId && it.status === 'fixing') {
        out.push({
          id: it.app.id,
          title: it.app.title_ko,
          sub: '검증에서 실패 항목이 나왔어요 — 수정 필요',
          due: it.app.due_date,
          kind: 'fix',
        });
      }
    }
    // 마감 임박순
    return out.sort((a, b) => {
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due < b.due ? -1 : 1;
    });
  }, [items, meId]);

  const doneCount = items.filter((i) => i.status === 'done').length;
  const overallPct = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0;

  /** 원장용: 강사별 남은 검증 개수. 배정이 하나도 없는 사람은 '다 했어요'와 구분한다. */
  const perMember = useMemo(() => {
    if (!isAdmin) return [];
    return members
      .map((m) => {
        let remain = 0;
        let assigned = 0;
        for (const it of items) {
          if (!it.reviewerIds.includes(m.id)) continue;
          assigned++;
          const mine = it.checks.filter((c) => c.member_id === m.id);
          if (mine.filter((c) => c.result === 'pass').length < CHECK_ITEMS.length) remain++;
        }
        return { name: m.name, remain, assigned };
      })
      .sort((a, b) => b.remain - a.remain || b.assigned - a.assigned);
  }, [isAdmin, members, items]);

  const overdue = useMemo(
    () =>
      items.filter((i) => {
        if (i.status === 'done' || !i.app.due_date) return false;
        return i.app.due_date < today();
      }),
    [items],
  );

  const now = new Date();

  // 멤버 이름 자체가 '원장'이면 "원장 원장님"이 되므로 호칭을 붙이지 않는다
  const honorific = isAdmin ? '원장님' : '선생님';
  const name = session?.name ?? '';
  const greeting = name.endsWith('원장') || name.endsWith('선생') ? `${name}님` : `${name} ${honorific}`;

  return (
    <>
      <header className="bg-white px-4 pb-4 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[21px] font-black leading-tight">안녕하세요 {greeting}</p>
            <p className="mt-1 text-[13px] text-neutral-500">{korDateFull(toISODate(now))}</p>
          </div>
          <button onClick={signOut} className="tap shrink-0 text-[12.5px] font-semibold text-neutral-400">
            로그아웃
          </button>
        </div>
      </header>

      <div className="space-y-6 px-4 pb-8 pt-4">
        {error && <ErrorBanner message={error} onRetry={() => void reload()} />}

        {/* 전체 진행률 */}
        <section className="card p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[13.5px] font-bold text-neutral-600">전체 검증 진행률</span>
            <span className="text-[19px] font-black text-brand">{overallPct}%</span>
          </div>
          <ProgressBar value={overallPct} />
          <p className="mt-2 text-[12.5px] text-neutral-500">
            앱 {items.length}개 중 {doneCount}개 검증 완료
          </p>
        </section>

        {/* 내 할 일 */}
        <section>
          <SectionTitle
            right={
              <Link href="/apps" className="text-[12.5px] font-bold text-neutral-400">
                전체 보기 ›
              </Link>
            }
          >
            내 할 일 {myTasks.length > 0 && <span className="text-brand">{myTasks.length}</span>}
          </SectionTitle>

          {loading ? (
            <CardSkeleton rows={2} />
          ) : myTasks.length === 0 ? (
            <EmptyState icon="✅" title="지금 할 일이 없어요" desc="새 검증이 배정되면 여기에 보여요." />
          ) : (
            <div className="space-y-2.5">
              {myTasks.map((t) => (
                <Link
                  key={`${t.kind}-${t.id}`}
                  href={`/apps/${t.id}`}
                  className="card flex items-center gap-3 p-4 transition active:bg-neutral-50"
                >
                  <span className="text-xl">{t.kind === 'fix' ? '🛠️' : '🔍'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold">{t.title}</span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-neutral-500">{t.sub}</span>
                  </span>
                  {t.due && <span className={`chip shrink-0 ${ddayClass(t.due)}`}>{ddayLabel(t.due)}</span>}
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* 미해결 댓글 */}
        <section>
          <SectionTitle>나를 향한 지적사항</SectionTitle>
          {myComments === null ? (
            <Skeleton className="h-16 w-full rounded-2xl" />
          ) : myComments.length === 0 ? (
            <p className="card px-4 py-6 text-center text-[13px] text-neutral-400">미해결 지적이 없어요.</p>
          ) : (
            <div className="space-y-2.5">
              {myComments.map((c) => (
                <Link key={c.id} href={`/apps/${c.app_id}`} className="card block p-3.5 active:bg-neutral-50">
                  <p className="text-[12px] font-bold text-brand">{c.app_title}</p>
                  <p className="mt-1 line-clamp-2 text-[13.5px] leading-relaxed text-neutral-700">{c.body}</p>
                  <p className="mt-1 text-[11.5px] text-neutral-400">
                    {nameOf(c.member_id)} · {relTime(c.created_at)}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* 이번 주 일정 */}
        <section>
          <SectionTitle
            right={
              <Link href="/schedule" className="text-[12.5px] font-bold text-neutral-400">
                달력 ›
              </Link>
            }
          >
            이번 주 일정
          </SectionTitle>
          {schedules === null ? (
            <Skeleton className="h-16 w-full rounded-2xl" />
          ) : schedules.length === 0 ? (
            <p className="card px-4 py-6 text-center text-[13px] text-neutral-400">7일 안에 잡힌 일정이 없어요.</p>
          ) : (
            <div className="card divide-y divide-neutral-100">
              {schedules.slice(0, 3).map((s) => (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${s.kind === 'visit' ? 'bg-green-500' : 'bg-blue-500'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{s.title}</span>
                    <span className="text-[12px] text-neutral-500">
                      {korDate(s.date)} {hhmm(s.start_time)} {s.place ? `· ${s.place}` : ''}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 원장 전용 */}
        {isAdmin && (
          <>
            <section>
              <SectionTitle>강사별 남은 검증</SectionTitle>
              <div className="card divide-y divide-neutral-100">
                {perMember.map((m) => (
                  <div key={m.name} className="flex items-center justify-between px-4 py-3">
                    <span className="text-[14px] font-semibold">{m.name}</span>
                    <span
                      className={`chip ${
                        m.assigned === 0
                          ? 'bg-neutral-100 text-neutral-500'
                          : m.remain === 0
                            ? 'bg-green-100 text-green-800'
                            : 'bg-brand-50 text-brand-700'
                      }`}
                    >
                      {m.assigned === 0 ? '배정 없음' : m.remain === 0 ? '다 했어요' : `${m.remain}개 남음`}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <SectionTitle>지연 항목 {overdue.length > 0 && <span className="text-red-600">{overdue.length}</span>}</SectionTitle>
              {overdue.length === 0 ? (
                <p className="card px-4 py-6 text-center text-[13px] text-neutral-400">지연된 앱이 없어요.</p>
              ) : (
                <div className="card divide-y divide-neutral-100">
                  {overdue.map((it) => (
                    <Link
                      key={it.app.id}
                      href={`/apps/${it.app.id}`}
                      className="flex items-center justify-between px-4 py-3 active:bg-neutral-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-semibold">{it.app.title_ko}</span>
                        <span className="text-[12px] text-neutral-500">제작 {nameOf(it.app.creator_id)}</span>
                      </span>
                      <span className={`chip shrink-0 ${ddayClass(it.app.due_date)}`}>
                        {ddayLabel(it.app.due_date)}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            <section>
              <SectionTitle
                right={
                  <Link href="/admin?tab=log" className="text-[12.5px] font-bold text-neutral-400">
                    전체 ›
                  </Link>
                }
              >
                최근 활동
              </SectionTitle>
              {logs === null ? (
                <Skeleton className="h-24 w-full rounded-2xl" />
              ) : logs.length === 0 ? (
                <p className="card px-4 py-6 text-center text-[13px] text-neutral-400">활동 기록이 없어요.</p>
              ) : (
                <div className="card px-4 py-3">
                  <ul className="space-y-2">
                    {logs.map((l) => (
                      <li key={l.id} className="text-[12.5px] leading-relaxed text-neutral-600">
                        <span className="text-neutral-400">{logTime(l.created_at)}</span>{' '}
                        <b className="text-neutral-800">{nameOf(l.member_id)}</b> — {l.action}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
