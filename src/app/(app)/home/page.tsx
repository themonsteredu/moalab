'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { PIECES, useAppsOverview } from '@/lib/useAppsOverview';
import type { ActivityLog, CommentRow, Notice, NoticeRead, Schedule } from '@/lib/types';
import { CardSkeleton, ErrorBanner, ProgressBar, Skeleton } from '@/components/ui';
import { Avatar } from '@/components/Brand';
import { Icon } from '@/components/Icon';
import { CalendarLegend, KIND_META, MonthCalendar, type CalEntry } from '@/components/MonthCalendar';
import { TeamBoard, useTeamWork } from '@/components/TeamBoard';
import { Sparkline, StatCard, Timeline, WeekBars, type TimelineRow } from '@/components/Charts';
import { ddayClass, ddayLabel, hhmm, korDate, korDateFull, parseDate, relTime, today, toISODate } from '@/lib/format';

const WEEK_LABEL = ['일', '월', '화', '수', '목', '금', '토'];
/** 타임라인이 보는 기간 */
const TIMELINE_DAYS = 30;

export default function HomePage() {
  const { session, isAdmin, signOut } = useSession();
  const { items, loading, error, reload } = useAppsOverview();
  const { nameOf, members } = useMembers();
  const router = useRouter();

  const todayStr = today();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [picked, setPicked] = useState(todayStr);

  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [attendees, setAttendees] = useState<Record<string, string[]>>({});
  const [myComments, setMyComments] = useState<(CommentRow & { app_title: string })[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [noticeReads, setNoticeReads] = useState<NoticeRead[]>([]);

  const meId = session?.id ?? '';

  const range = useMemo(() => {
    const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    from.setDate(from.getDate() - 7);
    const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    to.setDate(to.getDate() + 7);
    return { from: toISODate(from), to: toISODate(to) };
  }, [cursor]);

  const loadExtras = useCallback(async () => {
    const [schedRes, smRes, logRes, noticeRes, readRes] = await Promise.all([
      supabase.from('schedules').select('*').gte('date', range.from).lte('date', range.to).order('date').order('start_time'),
      supabase.from('schedule_members').select('*'),
      supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(200),
      supabase
        .from('notices')
        .select('*')
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(20),
      supabase.from('notice_reads').select('*'),
    ]);
    setSchedules((schedRes.data ?? []) as Schedule[]);
    const map: Record<string, string[]> = {};
    for (const r of smRes.data ?? []) (map[r.schedule_id] ??= []).push(r.member_id);
    setAttendees(map);
    setLogs((logRes.data ?? []) as ActivityLog[]);
    setNotices((noticeRes.data ?? []) as Notice[]);
    setNoticeReads((readRes.data ?? []) as NoticeRead[]);
  }, [range.from, range.to]);

  useEffect(() => {
    void loadExtras();
  }, [loadExtras]);

  useEffect(() => {
    const myApps = items.filter((i) => i.app.creator_id === meId);
    if (myApps.length === 0) return setMyComments([]);
    void (async () => {
      const { data } = await supabase
        .from('comments')
        .select('*')
        .eq('resolved', false)
        .in('app_id', myApps.map((a) => a.app.id))
        .order('created_at', { ascending: false })
        .limit(6);
      const titleOf = new Map(items.map((i) => [i.app.id, i.app.title_ko]));
      setMyComments(
        ((data ?? []) as CommentRow[])
          .filter((c) => c.member_id !== meId)
          .map((c) => ({ ...c, app_title: titleOf.get(c.app_id) ?? '' })),
      );
    })();
  }, [items, meId]);

  /* ------------------------------------------------------------ 달력 */
  const entries = useMemo<CalEntry[]>(() => {
    const out: CalEntry[] = [];
    for (const it of items) {
      const d = it.app.due_date;
      if (!d || d < range.from || d > range.to || it.status === 'done') continue;
      out.push({
        id: `due-${it.app.id}`,
        kind: 'due',
        title: `${it.app.title_ko} 제출 마감`,
        date: d,
        href: `/apps/${it.app.id}`,
        who: it.reviewerIds.map((r) => nameOf(r)),
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
        who: (attendees[s.id] ?? []).map((m) => nameOf(m)),
      });
    }
    return out;
  }, [items, schedules, attendees, nameOf, range]);

  const dayEntries = useMemo(
    () => entries.filter((e) => e.date === picked).sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99')),
    [entries, picked],
  );

  /** 달력을 안 눌러도 바로 보이는 '다가오는 일정' */
  const upcoming = useMemo(
    () =>
      entries
        .filter((e) => e.date >= todayStr)
        .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '99').localeCompare(b.time ?? '99'))
        .slice(0, 5),
    [entries, todayStr],
  );

  /* -------------------------------------------------------- 통계 */
  const teamWork = useTeamWork(members, items, logs);
  const untouched = teamWork.reduce((s, w) => s + w.reviewUntouched.length, 0);

  const stats = useMemo(() => {
    const done = items.filter((i) => i.status === 'done').length;
    const fixing = items.filter((i) => i.status === 'fixing').length;
    return { total: items.length, done, fixing, pending: items.length - done - fixing };
  }, [items]);
  const overallPct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  const pieceStats = useMemo(
    () => PIECES.map((p) => ({ ...p, n: items.filter((i) => i.done[p.key]).length, total: items.length })),
    [items],
  );

  /** 최근 14일 활동 수 — 스파크라인용 */
  const activityTrend = useMemo(() => {
    const buckets = new Array(14).fill(0);
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    for (const l of logs) {
      const d = new Date(l.created_at);
      d.setHours(0, 0, 0, 0);
      const diff = Math.round((base.getTime() - d.getTime()) / 86400000);
      if (diff >= 0 && diff < 14) buckets[13 - diff]++;
    }
    return buckets;
  }, [logs]);

  /** 이번 주(일~토) 활동 수 */
  const weekBars = useMemo(() => {
    const vals = new Array(7).fill(0);
    const now = new Date();
    const sun = new Date(now);
    sun.setDate(now.getDate() - now.getDay());
    sun.setHours(0, 0, 0, 0);
    for (const l of logs) {
      const d = new Date(l.created_at);
      const diff = Math.floor((d.getTime() - sun.getTime()) / 86400000);
      if (diff >= 0 && diff < 7) vals[diff]++;
    }
    return vals;
  }, [logs]);

  /** 마감 타임라인 (앞으로 30일) */
  const timeline = useMemo<{ rows: TimelineRow[]; ticks: string[] }>(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const rows: TimelineRow[] = [];
    for (const it of items) {
      const d = it.app.due_date;
      if (!d || it.status === 'done') continue;
      const due = parseDate(d);
      due.setHours(0, 0, 0, 0);
      const days = Math.round((due.getTime() - start.getTime()) / 86400000);
      if (days > TIMELINE_DAYS) continue;
      const end = Math.min(1, Math.max(0.04, days / TIMELINE_DAYS));
      rows.push({
        id: it.app.id,
        label: it.app.title_ko,
        start: 0,
        end: days < 0 ? 0.05 : end,
        color: days < 0 ? '#DC2626' : days <= 3 ? '#F26522' : '#0FB5AB',
        note: `${it.app.title_ko} — ${ddayLabel(d)}`,
        href: `/apps/${it.app.id}`,
      });
    }
    rows.sort((a, b) => a.end - b.end);
    const ticks = ['오늘', '1주', '2주', '3주', '4주'];
    return { rows: rows.slice(0, 8), ticks };
  }, [items]);

  /* --------------------------------------------------------- 공지 */
  const noticeCards = useMemo(() => {
    const isRead = (id: string) => noticeReads.some((r) => r.notice_id === id && r.member_id === meId);
    // 안 읽은 것 먼저, 그다음 고정 → 최신
    const sorted = [...notices].sort((a, b) => {
      const ar = isRead(a.id) ? 1 : 0;
      const br = isRead(b.id) ? 1 : 0;
      if (ar !== br) return ar - br;
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.created_at.localeCompare(a.created_at);
    });
    return {
      list: sorted.slice(0, 3).map((n) => ({ ...n, read: isRead(n.id) })),
      unread: notices.filter((n) => !isRead(n.id)).length,
      total: notices.length,
    };
  }, [notices, noticeReads, meId]);

  /* ------------------------------------------------------- 내 할 일 */
  const myTasks = useMemo(() => {
    const out: { id: string; title: string; sub: string; due: string | null; kind: 'review' | 'fix' }[] = [];
    for (const it of items) {
      // 검증자인데 아직 '검증 완료' 를 안 누른 것
      if (it.reviewerIds.includes(meId) && !it.signedIds.includes(meId)) {
        const found = it.findings.filter((f) => f.member_id === meId).length;
        out.push({
          id: it.app.id,
          title: it.app.title_ko,
          sub: `${it.currentRound?.round_no ?? 1}차 검증${found > 0 ? ` · 내 지적 ${found}` : ''}`,
          due: it.app.due_date,
          kind: 'review',
        });
      }
      // 내가 만든 프로그램에 답 안 한 지적이 있는 것
      if (it.app.creator_id === meId) {
        const need = it.openFindings.filter((f) => f.status === 'open' || f.status === 'recheck').length;
        if (need > 0) {
          out.push({
            id: it.app.id,
            title: it.app.title_ko,
            sub: `답변 대기 ${need}건`,
            due: it.app.due_date,
            kind: 'fix',
          });
        }
      }
    }
    return out.sort((a, b) => (!a.due ? 1 : !b.due ? -1 : a.due < b.due ? -1 : 1));
  }, [items, meId]);

  const dueSoon = useMemo(
    () =>
      items.filter((i) => {
        if (i.status === 'done' || !i.app.due_date) return false;
        const n = Math.round((parseDate(i.app.due_date).getTime() - Date.now()) / 86400000);
        return n <= 7;
      }).length,
    [items],
  );

  const honorific = isAdmin ? '원장님' : '선생님';
  const name = session?.name ?? '';
  const greeting = name.endsWith('원장') || name.endsWith('선생') ? `${name}님` : `${name} ${honorific}`;
  const tomorrow = toISODate(new Date(Date.now() + 86400000));
  const pickedLabel = picked === todayStr ? '오늘' : picked === tomorrow ? '내일' : korDateFull(picked);
  const moveMonth = (d: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + d, 1));

  return (
    <div className="px-4 pb-8 pt-4 lg:px-0 lg:pt-0">
      {/* --------------------------------------------------------- 인사
          PC 에서는 인사·요약을 한 줄로 눕혀 맨 윗줄에 통째로 보이게 한다.
          (두 줄이면 조금만 스크롤해도 반쯤 잘려 보여서 지저분했다) */}
      <div className="mb-4 overflow-hidden rounded-2xl bg-gradient-to-br from-brand-400 via-brand to-brand-600 p-4 lg:flex lg:items-center lg:gap-4 lg:px-5 lg:py-3.5">
        <div className="flex items-center justify-between gap-3 lg:shrink-0">
          <div className="min-w-0">
            <p className="text-[18px] font-black leading-tight text-white lg:text-[19px]">
              안녕하세요 {greeting}
            </p>
            <p className="mt-0.5 text-[12.5px] text-white/75">{korDateFull(todayStr)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2 lg:hidden">
            {session && <Avatar name={session.name} size={40} ring />}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5 lg:mt-0 lg:flex-1 lg:flex-nowrap lg:justify-end">
          <HeroChip label="내 할 일" value={`${myTasks.length}`} />
          <HeroChip label="팀 미착수" value={`${untouched}`} tone={untouched > 0 ? 'warn' : 'ok'} />
          <HeroChip label="7일 내 마감" value={`${dueSoon}`} tone={dueSoon > 0 ? 'warn' : 'ok'} />
          <HeroChip label="검증 완료" value={`${overallPct}%`} />
        </div>

        <button
          onClick={signOut}
          className="hidden shrink-0 text-[12.5px] font-semibold text-white/70 hover:text-white lg:block"
        >
          로그아웃
        </button>
      </div>

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} onRetry={() => void reload()} />
        </div>
      )}

      <div className="lg:grid lg:grid-cols-3 lg:items-start lg:gap-5">
        {/* ======================================================= 본문 */}
        <div className="space-y-4 lg:col-span-2">
          {/* 달력 */}
          <section className="card p-3.5">
            <div className="mb-2.5 flex items-center gap-2">
              <button onClick={() => moveMonth(-1)} aria-label="이전 달" className="tap w-9 rounded-lg bg-neutral-100 text-neutral-400">
                ‹
              </button>
              <h2 className="flex-1 text-center text-[15px] font-black">
                {cursor.getFullYear()}년 {cursor.getMonth() + 1}월
              </h2>
              <button onClick={() => moveMonth(1)} aria-label="다음 달" className="tap w-9 rounded-lg bg-neutral-100 text-neutral-400">
                ›
              </button>
              <Link href="/schedule" className="tap px-2 text-[12.5px] font-bold text-neutral-400">
                전체
              </Link>
            </div>

            {schedules === null ? (
              <Skeleton className="h-64 w-full rounded-xl" />
            ) : (
              <MonthCalendar month={cursor} entries={entries} selected={picked} onSelect={setPicked} />
            )}

            <div className="mt-2.5">
              <CalendarLegend />
            </div>

            <div className="mt-3 border-t border-neutral-200 pt-3">
              <p className="mb-1.5 text-[12.5px] font-bold text-neutral-500">
                {picked === todayStr && dayEntries.length === 0 ? '다가오는 일정' : pickedLabel}
              </p>
              {(picked === todayStr && dayEntries.length === 0 ? upcoming : dayEntries).length === 0 ? (
                <p className="py-2 text-center text-[12.5px] text-neutral-400">예정된 일정이 없어요</p>
              ) : (
                <ul className="space-y-1.5">
                  {(picked === todayStr && dayEntries.length === 0 ? upcoming : dayEntries).map((e) => (
                    <li key={e.id}>
                      <Link href={e.href ?? '/schedule'} className="flex items-start gap-2.5 rounded-lg px-1 py-1.5 hover:bg-neutral-100">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${KIND_META[e.kind].dot}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-semibold text-neutral-800">{e.title}</span>
                          <span className="text-[11.5px] text-neutral-400">
                            {korDate(e.date)}
                            {e.time ? ` ${hhmm(e.time)}` : ''}
                            {e.place ? ` · ${e.place}` : ''}
                            {e.who && e.who.length > 0 ? ` · ${e.who.join(', ')}` : ''}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* 통계 3장 */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard
              icon={<Icon name="checkCircle" size={15} />}
              label="검증 완료"
              value={`${overallPct}%`}
              delta={`${stats.done}/${stats.total}`}
            >
              <ProgressBar value={overallPct} />
            </StatCard>
            <StatCard
              icon={<Icon name="wrench" size={15} />}
              label="수정 필요"
              value={`${stats.fixing}`}
              delta={stats.fixing > 0 ? '확인 필요' : '없음'}
              deltaTone={stats.fixing > 0 ? 'down' : 'up'}
              accentBg="bg-red-500"
            >
              <div className="flex gap-1">
                {[
                  { n: stats.done, c: 'bg-green-500' },
                  { n: stats.pending, c: 'bg-neutral-300' },
                  { n: stats.fixing, c: 'bg-red-500' },
                ].map((s, i) =>
                  s.n > 0 ? (
                    <span key={i} className={`h-1.5 rounded-full ${s.c}`} style={{ flex: s.n }} />
                  ) : null,
                )}
              </div>
            </StatCard>
            <StatCard
              icon={<Icon name="list" size={15} />}
              label="최근 2주 활동"
              value={`${activityTrend.reduce((a, b) => a + b, 0)}`}
              delta="건"
              accentBg="bg-accent"
            >
              <Sparkline data={activityTrend} height={34} />
            </StatCard>
          </div>

          {/* 마감 타임라인 */}
          <section className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-bold">마감 타임라인</h2>
              <span className="text-[11.5px] text-neutral-400">앞으로 4주</span>
            </div>
            {loading ? (
              <Skeleton className="h-32 w-full rounded-xl" />
            ) : (
              <Timeline rows={timeline.rows} ticks={timeline.ticks} onPick={(id) => router.push(`/apps/${id}`)} />
            )}
          </section>

          {/* 공지 — 전체 공지를 홈에서도 훑을 수 있게 */}
          {noticeCards.total > 0 && (
            <section>
              <div className="mb-2.5 flex items-center justify-between">
                <h2 className="text-[15px] font-bold">
                  공지사항{' '}
                  {noticeCards.unread > 0 && <span className="text-brand">{noticeCards.unread}</span>}
                </h2>
                <Link href="/notice" className="text-[12.5px] font-bold text-neutral-400">
                  전체 {noticeCards.total}건 ›
                </Link>
              </div>
              <ul className="space-y-2">
                {noticeCards.list.map((n) => (
                  <li key={n.id}>
                    <Link href="/notice" className="card flex items-start gap-2.5 p-3 transition hover:bg-raised">
                      {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" />}
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {n.pinned && <span className="chip bg-brand-50 text-brand-700">고정</span>}
                          <span
                            className={`text-[13.5px] leading-snug ${
                              n.read ? 'font-semibold text-neutral-600' : 'font-bold text-neutral-900'
                            }`}
                          >
                            {n.title}
                          </span>
                        </span>
                        <span className="mt-0.5 block line-clamp-1 text-[12px] text-neutral-400">
                          {n.body}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] text-neutral-400">{relTime(n.created_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 내 할 일 */}
          <section>
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-[15px] font-bold">
                내 할 일 {myTasks.length > 0 && <span className="text-brand">{myTasks.length}</span>}
              </h2>
              <Link href="/apps" className="text-[12.5px] font-bold text-neutral-400">
                프로그램 ›
              </Link>
            </div>
            {loading ? (
              <CardSkeleton rows={2} />
            ) : myTasks.length === 0 ? (
              <p className="card flex items-center justify-center gap-1.5 px-4 py-3.5 text-[13px] text-neutral-400">
                <Icon name="check" size={14} className="text-green-500" />
                지금 할 일이 없어요
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {myTasks.slice(0, 6).map((t) => (
                  <Link
                    key={`${t.kind}-${t.id}`}
                    href={`/apps/${t.id}`}
                    className="card flex items-center gap-2.5 p-3 transition hover:border-brand-300"
                  >
                    <Icon
                      name={t.kind === 'fix' ? 'wrench' : 'search'}
                      size={16}
                      className={t.kind === 'fix' ? 'text-red-500' : 'text-neutral-400'}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-bold">{t.title}</span>
                      <span className="text-[11.5px] text-neutral-400">{t.sub}</span>
                    </span>
                    {t.due && <span className={`chip shrink-0 ${ddayClass(t.due)}`}>{ddayLabel(t.due)}</span>}
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* 팀 현황 */}
          <section>
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-[15px] font-bold">팀 현황 — 누가 뭘 하고 있나</h2>
              <span className="text-[11.5px] text-neutral-400">미착수 {untouched}건</span>
            </div>
            {loading ? <CardSkeleton rows={3} /> : <TeamBoard work={teamWork} meId={meId} />}
          </section>
        </div>

        {/* ======================================================= 오른쪽 */}
        <div className="mt-4 space-y-4 lg:mt-0">
          {/* 팀 활동 */}
          <section className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-bold">팀 활동</h2>
              {isAdmin && (
                <Link href="/admin?tab=log" className="text-[12px] font-bold text-accent">
                  전체
                </Link>
              )}
            </div>
            {logs.length === 0 ? (
              <p className="py-4 text-center text-[12.5px] text-neutral-400">아직 활동이 없어요.</p>
            ) : (
              <ul className="space-y-3">
                {logs.slice(0, 7).map((l) => (
                  <li key={l.id} className="flex items-start gap-2.5">
                    <Avatar name={nameOf(l.member_id)} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-bold text-neutral-800">{nameOf(l.member_id)}</span>
                      <span className="block truncate text-[11.5px] text-neutral-400">{l.action}</span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-[10.5px] text-neutral-400">
                      {relTime(l.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 주간 활동 */}
          <section className="card p-4">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-[15px] font-bold">이번 주 활동</h2>
              <span className="text-[11.5px] text-neutral-400">
                {weekBars.reduce((a, b) => a + b, 0)}건
              </span>
            </div>
            <WeekBars values={weekBars} labels={WEEK_LABEL} goal={1} />
          </section>

          {/* 구성 채움 정도 */}
          <section className="card p-4">
            <h2 className="mb-2.5 text-[15px] font-bold">프로그램 구성</h2>
            <div className="space-y-2">
              {pieceStats.map((p) => (
                <div key={p.key} className="flex items-center gap-2">
                  <span className="flex w-[58px] shrink-0 items-center gap-1 text-[11.5px] text-neutral-500">
                    <Icon name={p.icon} size={11} className="text-neutral-400" />
                    {p.label}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200">
                    <div
                      className="h-full rounded-full bg-brand"
                      style={{ width: `${p.total ? (p.n / p.total) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="w-11 shrink-0 text-right text-[11px] font-bold tabular-nums text-neutral-500">
                    {p.n}/{p.total}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* 지적사항 */}
          {myComments.length > 0 && (
            <section className="card p-4">
              <h2 className="mb-2.5 text-[15px] font-bold">나를 향한 지적사항</h2>
              <ul className="space-y-2.5">
                {myComments.map((c) => (
                  <li key={c.id}>
                    <Link href={`/apps/${c.app_id}`} className="block rounded-lg p-1 hover:bg-neutral-100">
                      <p className="text-[11.5px] font-bold text-brand">{c.app_title}</p>
                      <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-neutral-700">{c.body}</p>
                      <p className="mt-0.5 text-[11px] text-neutral-400">
                        {nameOf(c.member_id)} · {relTime(c.created_at)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function HeroChip({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  return (
    <span className="flex items-center gap-1.5 rounded-lg bg-black/20 px-2.5 py-1.5 backdrop-blur">
      <span className="text-[11px] text-white/70">{label}</span>
      <span className={`text-[13px] font-black ${tone === 'warn' ? 'text-yellow-900' : 'text-white'}`}>
        {value}
      </span>
    </span>
  );
}
