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
import { CalendarLegend, KIND_META, MonthCalendar, type CalEntry } from '@/components/MonthCalendar';
import { TeamBoard, useTeamWork } from '@/components/TeamBoard';
import { ddayClass, ddayLabel, hhmm, korDateFull, logTime, relTime, today, toISODate } from '@/lib/format';

export default function HomePage() {
  const { session, isAdmin, signOut } = useSession();
  const { items, loading, error, reload } = useAppsOverview();
  const { nameOf, members } = useMembers();

  const todayStr = today();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [picked, setPicked] = useState(todayStr);

  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [attendees, setAttendees] = useState<Record<string, string[]>>({});
  const [myComments, setMyComments] = useState<(CommentRow & { app_title: string })[] | null>(null);
  const [logs, setLogs] = useState<ActivityLog[]>([]);

  const meId = session?.id ?? '';

  /** 달력에 보이는 달 전체 (앞뒤 주 포함) */
  const range = useMemo(() => {
    const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    from.setDate(from.getDate() - 7);
    const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    to.setDate(to.getDate() + 7);
    return { from: toISODate(from), to: toISODate(to) };
  }, [cursor]);

  const loadExtras = useCallback(async () => {
    const [schedRes, smRes, logRes] = await Promise.all([
      supabase.from('schedules').select('*').gte('date', range.from).lte('date', range.to).order('date').order('start_time'),
      supabase.from('schedule_members').select('*'),
      supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(200),
    ]);
    setSchedules((schedRes.data ?? []) as Schedule[]);
    const map: Record<string, string[]> = {};
    for (const r of smRes.data ?? []) (map[r.schedule_id] ??= []).push(r.member_id);
    setAttendees(map);
    setLogs((logRes.data ?? []) as ActivityLog[]);
  }, [range.from, range.to]);

  useEffect(() => {
    void loadExtras();
  }, [loadExtras]);

  useEffect(() => {
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

  /* ------------------------------------------------------- 달력 항목 */
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

  /* ----------------------------------------------------------- 팀 */
  const teamWork = useTeamWork(members, items, logs);

  /* --------------------------------------------------------- 현황 */
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

  /* ---------------------------------------------------- 내 할 일 */
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
            sub: `${it.currentRound?.round_no ?? 1}차 검증 · ${passed}/${CHECK_ITEMS.length}`,
            due: it.app.due_date,
            kind: 'review',
          });
        }
      }
      if (it.app.creator_id === meId && it.status === 'fixing') {
        out.push({ id: it.app.id, title: it.app.title_ko, sub: '수정 필요', due: it.app.due_date, kind: 'fix' });
      }
    }
    return out.sort((a, b) => (!a.due ? 1 : !b.due ? -1 : a.due < b.due ? -1 : 1));
  }, [items, meId]);

  const overdue = useMemo(
    () => items.filter((i) => i.status !== 'done' && i.app.due_date && i.app.due_date < todayStr),
    [items, todayStr],
  );

  const honorific = isAdmin ? '원장님' : '선생님';
  const name = session?.name ?? '';
  const greeting = name.endsWith('원장') || name.endsWith('선생') ? `${name}님` : `${name} ${honorific}`;
  const tomorrow = toISODate(new Date(Date.now() + 86400000));
  const pickedLabel = picked === todayStr ? '오늘' : picked === tomorrow ? '내일' : korDateFull(picked);

  const moveMonth = (d: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + d, 1));

  return (
    <>
      <header className="bg-white px-4 pb-3 pt-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {session && <Avatar name={session.name} size={36} />}
            <div>
              <p className="text-[17px] font-black leading-tight">안녕하세요 {greeting}</p>
              <p className="text-[12px] text-neutral-500">{korDateFull(todayStr)}</p>
            </div>
          </div>
          <button onClick={signOut} className="tap shrink-0 text-[12.5px] font-semibold text-neutral-400">
            로그아웃
          </button>
        </div>
      </header>

      <div className="space-y-5 px-4 pb-8 pt-3">
        {error && <ErrorBanner message={error} onRetry={() => void reload()} />}

        {/* ------------------------------------------------------ 달력 */}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <button
              onClick={() => moveMonth(-1)}
              aria-label="이전 달"
              className="tap w-9 rounded-lg border border-neutral-200 bg-white text-neutral-400"
            >
              ‹
            </button>
            <h2 className="flex-1 text-center text-[15px] font-black">
              {cursor.getFullYear()}년 {cursor.getMonth() + 1}월
            </h2>
            <button
              onClick={() => moveMonth(1)}
              aria-label="다음 달"
              className="tap w-9 rounded-lg border border-neutral-200 bg-white text-neutral-400"
            >
              ›
            </button>
            <Link href="/schedule" className="tap px-2 text-[12.5px] font-bold text-neutral-400">
              전체
            </Link>
          </div>

          {schedules === null ? (
            <Skeleton className="h-64 w-full rounded-2xl" />
          ) : (
            <MonthCalendar month={cursor} entries={entries} selected={picked} onSelect={setPicked} />
          )}

          <div className="mt-2">
            <CalendarLegend />
          </div>

          {/* 고른 날짜의 일정 */}
          <div className="mt-2.5">
            <p className="mb-1.5 text-[12.5px] font-bold text-neutral-500">{pickedLabel}</p>
            {dayEntries.length === 0 ? (
              <p className="card px-4 py-3 text-center text-[12.5px] text-neutral-400">일정 없음</p>
            ) : (
              <div className="card divide-y divide-neutral-100">
                {dayEntries.map((e) => (
                  <Link
                    key={e.id}
                    href={e.href ?? '/schedule'}
                    className="flex items-start gap-2.5 px-3.5 py-2.5 active:bg-neutral-50"
                  >
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${KIND_META[e.kind].dot}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold text-neutral-800">{e.title}</span>
                      <span className="text-[11.5px] text-neutral-500">
                        {hhmm(e.time)}
                        {e.place ? ` · ${e.place}` : ''}
                        {e.who && e.who.length > 0 ? ` · ${e.who.join(', ')}` : ''}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* -------------------------------------------------- 팀 현황 */}
        <section>
          <SectionTitle
            right={
              <span className="text-[11.5px] text-neutral-400">
                미착수 {teamWork.reduce((s, w) => s + w.reviewUntouched.length, 0)}건
              </span>
            }
          >
            팀 현황 — 누가 뭘 하고 있나
          </SectionTitle>
          {loading ? <CardSkeleton rows={3} /> : <TeamBoard work={teamWork} meId={meId} />}
        </section>

        {/* -------------------------------------------------- 내 할 일 */}
        <section>
          <SectionTitle
            right={
              <Link href="/apps" className="text-[12.5px] font-bold text-neutral-400">
                프로그램 ›
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
            <div className="space-y-2">
              {myTasks.map((t) => (
                <Link
                  key={`${t.kind}-${t.id}`}
                  href={`/apps/${t.id}`}
                  className="card flex items-center gap-2.5 p-3 active:bg-neutral-50"
                >
                  <Icon
                    name={t.kind === 'fix' ? 'wrench' : 'search'}
                    size={16}
                    className={t.kind === 'fix' ? 'text-red-500' : 'text-neutral-400'}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-bold">{t.title}</span>
                    <span className="text-[12px] text-neutral-500">{t.sub}</span>
                  </span>
                  {t.due && <span className={`chip shrink-0 ${ddayClass(t.due)}`}>{ddayLabel(t.due)}</span>}
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* -------------------------------------------------- 전체 현황 */}
        <section>
          <SectionTitle>전체 현황</SectionTitle>
          <div className="card p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[13px] text-neutral-500">검증 완료</span>
              <span className="text-[20px] font-black leading-none text-brand">{overallPct}%</span>
            </div>
            <ProgressBar value={overallPct} />
            <div className="mt-3 grid grid-cols-4 gap-1.5">
              <Tile n={stats.total} label="전체" />
              <Tile n={stats.done} label="완료" tone="green" />
              <Tile n={stats.fixing} label="수정 필요" tone="red" />
              <Tile n={stats.pending} label="진행 중" />
            </div>
            <div className="mt-3 border-t border-neutral-100 pt-2.5">
              <p className="mb-1.5 text-[11.5px] font-bold text-neutral-400">프로그램 구성 채움 정도</p>
              <div className="space-y-1">
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

        {/* 있을 때만 그린다 */}
        {myComments && myComments.length > 0 && (
          <section>
            <SectionTitle>나를 향한 지적사항</SectionTitle>
            <div className="space-y-2">
              {myComments.map((c) => (
                <Link key={c.id} href={`/apps/${c.app_id}`} className="card block p-3 active:bg-neutral-50">
                  <p className="text-[11.5px] font-bold text-brand">{c.app_title}</p>
                  <p className="mt-0.5 line-clamp-2 text-[13.5px] leading-relaxed text-neutral-700">{c.body}</p>
                  <p className="mt-1 text-[11.5px] text-neutral-400">
                    {nameOf(c.member_id)} · {relTime(c.created_at)}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {isAdmin && overdue.length > 0 && (
          <section>
            <SectionTitle>
              지연 항목 <span className="text-red-600">{overdue.length}</span>
            </SectionTitle>
            <div className="card divide-y divide-neutral-100">
              {overdue.map((it) => (
                <Link
                  key={it.app.id}
                  href={`/apps/${it.app.id}`}
                  className="flex items-center justify-between px-4 py-2.5 active:bg-neutral-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold">{it.app.title_ko}</span>
                    <span className="text-[11.5px] text-neutral-500">제작 {nameOf(it.app.creator_id)}</span>
                  </span>
                  <span className={`chip shrink-0 ${ddayClass(it.app.due_date)}`}>{ddayLabel(it.app.due_date)}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {isAdmin && logs.length > 0 && (
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
            <div className="card px-4 py-3">
              <ul className="space-y-1.5">
                {logs.slice(0, 5).map((l) => (
                  <li key={l.id} className="text-[12.5px] leading-relaxed text-neutral-600">
                    <span className="text-neutral-400">{logTime(l.created_at)}</span>{' '}
                    <b className="text-neutral-800">{nameOf(l.member_id)}</b> — {l.action}
                  </li>
                ))}
              </ul>
            </div>
          </section>
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
