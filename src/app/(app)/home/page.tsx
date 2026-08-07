'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { PIECES, useAppsOverview } from '@/lib/useAppsOverview';
import { CHECK_ITEMS, type ActivityLog, type CommentRow, type Schedule } from '@/lib/types';
import { CardSkeleton, ErrorBanner, ProgressBar, SectionTitle, Skeleton } from '@/components/ui';
import { Avatar } from '@/components/Brand';
import { Icon } from '@/components/Icon';
import {
  ddayClass,
  ddayLabel,
  hhmm,
  korDate,
  korDateFull,
  logTime,
  relTime,
  today,
  toISODate,
} from '@/lib/format';

/** 달력에 올라오는 세 종류 */
type EntryKind = 'due' | 'meeting' | 'visit';
interface Entry {
  id: string;
  kind: EntryKind;
  title: string;
  date: string;
  time?: string | null;
  place?: string | null;
  href: string;
}
const KIND: Record<EntryKind, { dot: string; chip: string; label: string }> = {
  due: { dot: 'bg-red-500', chip: 'bg-red-100 text-red-700', label: '마감' },
  meeting: { dot: 'bg-blue-500', chip: 'bg-blue-100 text-blue-700', label: '회의' },
  visit: { dot: 'bg-green-500', chip: 'bg-green-100 text-green-700', label: '방문' },
};

const HORIZON_DAYS = 14;

export default function HomePage() {
  const { session, isAdmin, signOut } = useSession();
  const { items, loading, error, reload } = useAppsOverview();
  const { nameOf, members } = useMembers();

  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [myComments, setMyComments] = useState<(CommentRow & { app_title: string })[] | null>(null);
  const [logs, setLogs] = useState<ActivityLog[] | null>(null);

  const meId = session?.id ?? '';
  const todayStr = today();
  const horizon = toISODate(new Date(Date.now() + HORIZON_DAYS * 86400000));

  const loadExtras = useCallback(async () => {
    const [schedRes, logRes] = await Promise.all([
      supabase.from('schedules').select('*').gte('date', todayStr).lte('date', horizon).order('date').order('start_time'),
      isAdmin
        ? supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(5)
        : Promise.resolve({ data: [] as ActivityLog[] }),
    ]);
    setSchedules((schedRes.data ?? []) as Schedule[]);
    setLogs((logRes.data ?? []) as ActivityLog[]);
  }, [isAdmin, todayStr, horizon]);

  useEffect(() => {
    void loadExtras();
  }, [loadExtras]);

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

  /* ------------------------------------------------------------ 일정 */
  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    for (const it of items) {
      const d = it.app.due_date;
      if (!d || d < todayStr || d > horizon) continue;
      if (it.status === 'done') continue; // 끝난 건 마감으로 안 띄운다
      out.push({
        id: `due-${it.app.id}`,
        kind: 'due',
        title: `${it.app.title_ko} 제출 마감`,
        date: d,
        href: `/apps/${it.app.id}`,
      });
    }
    for (const s of schedules ?? []) {
      out.push({
        id: s.id,
        kind: s.kind,
        title: s.title,
        date: s.date,
        time: s.start_time,
        place: s.place,
        href: '/schedule',
      });
    }
    return out.sort(
      (a, b) => a.date.localeCompare(b.date) || (a.time ?? '99').localeCompare(b.time ?? '99'),
    );
  }, [items, schedules, todayStr, horizon]);

  const byDate = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of entries) {
      const list = m.get(e.date) ?? [];
      list.push(e);
      m.set(e.date, list);
    }
    return [...m.entries()];
  }, [entries]);

  const tomorrow = toISODate(new Date(Date.now() + 86400000));
  const dayLabel = (d: string) => (d === todayStr ? '오늘' : d === tomorrow ? '내일' : korDate(d));

  /* ------------------------------------------------------------ 현황 */
  const stats = useMemo(() => {
    const done = items.filter((i) => i.status === 'done').length;
    const fixing = items.filter((i) => i.status === 'fixing').length;
    return { total: items.length, done, fixing, pending: items.length - done - fixing };
  }, [items]);
  const overallPct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  /** 5개 구성요소별로 몇 개 프로그램이 채웠나 */
  const pieceStats = useMemo(
    () =>
      PIECES.map((p) => ({
        ...p,
        n: items.filter((i) => i.done[p.key]).length,
        total: items.length,
      })),
    [items],
  );

  /* -------------------------------------------------------- 내 할 일 */
  const myTasks = useMemo(() => {
    const out: { id: string; title: string; sub: string; due: string | null; kind: 'review' | 'fix' }[] = [];
    for (const it of items) {
      if (it.reviewerIds.includes(meId)) {
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
    return out.sort((a, b) => {
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due < b.due ? -1 : 1;
    });
  }, [items, meId]);

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

  /** 실제로 검증을 맡은 사람만. '배정 없음' 줄만 늘어놔봐야 스크롤만 길어진다. */
  const assigned = useMemo(() => perMember.filter((m) => m.assigned > 0), [perMember]);

  const overdue = useMemo(
    () => items.filter((i) => i.status !== 'done' && i.app.due_date && i.app.due_date < todayStr),
    [items, todayStr],
  );

  const honorific = isAdmin ? '원장님' : '선생님';
  const name = session?.name ?? '';
  const greeting = name.endsWith('원장') || name.endsWith('선생') ? `${name}님` : `${name} ${honorific}`;

  /* ------------------------------------------------------------ 블록 */

  const StatusBlock = (
    <section>
      <SectionTitle
        right={
          <Link href="/apps" className="text-[12.5px] font-bold text-neutral-400">
            프로그램 ›
          </Link>
        }
      >
        전체 현황
      </SectionTitle>

      <div className="card p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[13px] text-neutral-500">검증 완료</span>
          <span className="text-[22px] font-black leading-none text-brand">{overallPct}%</span>
        </div>
        <ProgressBar value={overallPct} />

        <div className="mt-3 grid grid-cols-4 gap-1.5">
          <Tile n={stats.total} label="전체" />
          <Tile n={stats.done} label="완료" tone="green" />
          <Tile n={stats.fixing} label="수정 필요" tone="red" />
          <Tile n={stats.pending} label="진행 중" />
        </div>

        {/* 프로그램마다 검증·계획안·원가·샘플·사진이 다 있는지 */}
        <div className="mt-3.5 border-t border-neutral-100 pt-3">
          <p className="mb-2 text-[11.5px] font-bold text-neutral-400">프로그램 구성 채움 정도</p>
          <div className="space-y-1.5">
            {pieceStats.map((p) => (
              <div key={p.key} className="flex items-center gap-2">
                <span className="flex w-[58px] shrink-0 items-center gap-1 text-[11.5px] text-neutral-500">
                  <Icon name={p.icon} size={11} className="text-neutral-400" />
                  {p.label}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className="h-full rounded-full bg-brand/70"
                    style={{ width: `${p.total ? (p.n / p.total) * 100 : 0}%` }}
                  />
                </div>
                <span className="w-11 shrink-0 text-right text-[11px] font-bold tabular-nums text-neutral-500">
                  {p.n}/{p.total}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );

  const ScheduleBlock = (
    <section>
      <SectionTitle
        right={
          <Link href="/schedule" className="text-[12.5px] font-bold text-neutral-400">
            달력 ›
          </Link>
        }
      >
        앞으로 2주 일정
      </SectionTitle>

      <div className="mb-2 flex flex-wrap gap-3 px-1">
        {(['due', 'meeting', 'visit'] as EntryKind[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5 text-[11.5px] text-neutral-500">
            <span className={`h-2 w-2 rounded-full ${KIND[k].dot}`} />
            {KIND[k].label}
          </span>
        ))}
      </div>

      {schedules === null || loading ? (
        <Skeleton className="h-28 w-full rounded-2xl" />
      ) : byDate.length === 0 ? (
        <p className="card px-4 py-7 text-center text-[13px] text-neutral-400">
          2주 안에 잡힌 일정이 없어요.
        </p>
      ) : (
        <div className="card divide-y divide-neutral-100">
          {byDate.map(([date, list]) => {
            const isToday = date === todayStr;
            return (
              <div key={date} className="flex gap-3 px-4 py-3">
                <div className="w-[54px] shrink-0 pt-0.5">
                  <p
                    className={`text-[12.5px] font-bold ${
                      isToday ? 'text-brand' : date === tomorrow ? 'text-neutral-700' : 'text-neutral-400'
                    }`}
                  >
                    {dayLabel(date)}
                  </p>
                </div>
                <ul className="min-w-0 flex-1 space-y-2">
                  {list.map((e) => (
                    <li key={e.id}>
                      <Link href={e.href} className="flex items-start gap-2 active:opacity-70">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${KIND[e.kind].dot}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-semibold text-neutral-800">
                            {e.title}
                          </span>
                          {(e.time || e.place) && (
                            <span className="text-[11.5px] text-neutral-500">
                              {hhmm(e.time)}
                              {e.place ? ` · ${e.place}` : ''}
                            </span>
                          )}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );

  const MyTasksBlock = (
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
        <p className="card flex items-center justify-center gap-1.5 px-4 py-3.5 text-[13px] text-neutral-400">
          <Icon name="check" size={14} className="text-green-500" />
          지금 할 일이 없어요
        </p>
      ) : (
        <div className="space-y-2.5">
          {myTasks.map((t) => (
            <Link
              key={`${t.kind}-${t.id}`}
              href={`/apps/${t.id}`}
              className="card flex items-center gap-3 p-4 transition active:bg-neutral-50"
            >
              <Icon
                name={t.kind === 'fix' ? 'wrench' : 'search'}
                size={17}
                className={t.kind === 'fix' ? 'text-red-500' : 'text-neutral-400'}
              />
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
  );

  // 없으면 섹션을 아예 안 그린다. 빈 카드가 쌓이면 스크롤만 길어진다.
  const CommentsBlock = !myComments || myComments.length === 0 ? null : (
    <section>
      <SectionTitle>나를 향한 지적사항</SectionTitle>
      {(
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
  );

  return (
    <>
      <header className="bg-white px-4 pb-4 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {session && <Avatar name={session.name} size={42} />}
            <div>
              <p className="text-[19px] font-black leading-tight">안녕하세요 {greeting}</p>
              <p className="mt-0.5 text-[12.5px] text-neutral-500">{korDateFull(todayStr)}</p>
            </div>
          </div>
          <button onClick={signOut} className="tap shrink-0 text-[12.5px] font-semibold text-neutral-400">
            로그아웃
          </button>
        </div>
      </header>

      <div className="space-y-6 px-4 pb-8 pt-4">
        {error && <ErrorBanner message={error} onRetry={() => void reload()} />}

        {/* 원장은 현황·일정을 먼저, 강사는 자기 할 일을 먼저 본다 */}
        {isAdmin ? (
          <>
            {StatusBlock}
            {ScheduleBlock}
            {MyTasksBlock}
          </>
        ) : (
          <>
            {MyTasksBlock}
            {ScheduleBlock}
            {StatusBlock}
          </>
        )}

        {CommentsBlock}

        {isAdmin && (
          <>
            {overdue.length > 0 && (
            <section>
              <SectionTitle>
                지연 항목 <span className="text-red-600">{overdue.length}</span>
              </SectionTitle>
              {(
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
            )}

            {assigned.length > 0 && (
            <section>
              <SectionTitle>강사별 남은 검증</SectionTitle>
              <div className="card divide-y divide-neutral-100">
                {assigned.map((m) => (
                  <div key={m.name} className="flex items-center justify-between px-4 py-3">
                    <span className="flex items-center gap-2">
                      <Avatar name={m.name} size={26} />
                      <span className="text-[14px] font-semibold">{m.name}</span>
                    </span>
                    <span
                      className={`chip ${
                        m.remain === 0 ? 'bg-green-100 text-green-800' : 'bg-brand-50 text-brand-700'
                      }`}
                    >
                      {m.remain === 0 ? `다 했어요 (${m.assigned}개)` : `${m.remain}개 남음`}
                    </span>
                  </div>
                ))}
              </div>
            </section>
            )}

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

function Tile({ n, label, tone }: { n: number; label: string; tone?: 'green' | 'red' }) {
  return (
    <div className="rounded-xl bg-neutral-50 py-2 text-center">
      <p
        className={`text-[19px] font-black leading-none ${
          tone === 'green' ? 'text-green-700' : tone === 'red' ? 'text-red-600' : 'text-neutral-800'
        }`}
      >
        {n}
      </p>
      <p className="mt-1 text-[10.5px] text-neutral-500">{label}</p>
    </div>
  );
}
