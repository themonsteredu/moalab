'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { PIECES, useAppsOverview } from '@/lib/useAppsOverview';
import type {
  ActivityLog,
  CollabRequest,
  CommentRow,
  Notice,
  NoticeRead,
  Schedule,
  Task,
} from '@/lib/types';
import { CardSkeleton, Collapsible, ErrorBanner, ProgressBar, Skeleton } from '@/components/ui';
import { Avatar } from '@/components/Brand';
import { Icon } from '@/components/Icon';
import { CalendarLegend, KIND_META, MonthCalendar, type CalEntry } from '@/components/MonthCalendar';
import { TeamBoard, useTeamWork } from '@/components/TeamBoard';
import { PushToggle } from '@/components/PushToggle';
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
  /** 내가 맡은 안 끝난 업무 — '내 할 일' 에 합류한다 */
  const [myOpen, setMyOpen] = useState<Task[]>([]);
  /** 우리 부서가 받은 협업 요청 — 같은 자리에 합류한다 (부서협업 화면까지 가야만 보이면 놓친다) */
  const [myCollab, setMyCollab] = useState<CollabRequest[]>([]);
  const [deptNames, setDeptNames] = useState<Record<string, string>>({});
  /** 완료 표시가 실패했을 때만 쓰는 자리 (화면 전체 에러와 섞지 않는다) */
  const [actionErr, setActionErr] = useState('');

  const meId = session?.id ?? '';

  const range = useMemo(() => {
    const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    from.setDate(from.getDate() - 7);
    const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    to.setDate(to.getDate() + 7);
    return { from: toISODate(from), to: toISODate(to) };
  }, [cursor]);

  const loadExtras = useCallback(async () => {
    const [schedRes, smRes, logRes, noticeRes, readRes, taskRes, collabRes, deptRes, grpRes, dutyRes, helperRes] =
      await Promise.all([
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
      // 내 업무만. 홈에서는 남의 업무를 볼 일이 없다
      meId
        ? supabase.from('tasks').select('*').eq('assignee_id', meId).neq('state', 'done')
        : Promise.resolve({ data: [] }),
      // 협업 요청은 아직 안 끝난 것만. 내 부서 것인지는 아래에서 가른다
      supabase.from('collab_requests').select('*').neq('status', 'done'),
      supabase.from('departments').select('id,name,head_id'),
      supabase.from('duty_groups').select('id,dept_id'),
      supabase.from('duties').select('id,group_id,owner_id'),
      supabase.from('duty_helpers').select('*'),
    ]);
    setSchedules((schedRes.data ?? []) as Schedule[]);
    const map: Record<string, string[]> = {};
    for (const r of smRes.data ?? []) (map[r.schedule_id] ??= []).push(r.member_id);
    setAttendees(map);
    setLogs((logRes.data ?? []) as ActivityLog[]);
    setNotices((noticeRes.data ?? []) as Notice[]);
    setNoticeReads((readRes.data ?? []) as NoticeRead[]);
    setMyOpen((taskRes.data ?? []) as Task[]);

    /* 내 부서를 부서업무에서 파생한다 — 팀장이거나 그 부서 역할의 주담당·부담당이면
       그 부서 사람이다 (부서협업 화면과 같은 규칙). 새 소속 표를 만들지 않는다 */
    const deps = (deptRes.data ?? []) as { id: string; name: string; head_id: string | null }[];
    const grps = (grpRes.data ?? []) as { id: string; dept_id: string }[];
    const dts = (dutyRes.data ?? []) as { id: string; group_id: string; owner_id: string | null }[];
    const hlp = (helperRes.data ?? []) as { duty_id: string; member_id: string }[];

    setDeptNames(Object.fromEntries(deps.map((d) => [d.id, d.name])));

    const groupOf = new Map(grps.map((g) => [g.id, g.dept_id]));
    const myGroups = new Set(dts.filter((d) => d.owner_id === meId).map((d) => d.group_id));
    for (const h of hlp) {
      if (h.member_id !== meId) continue;
      const duty = dts.find((d) => d.id === h.duty_id);
      if (duty) myGroups.add(duty.group_id);
    }
    const myDepts = new Set<string>(deps.filter((d) => d.head_id === meId).map((d) => d.id));
    for (const g of myGroups) {
      const dep = groupOf.get(g);
      if (dep) myDepts.add(dep);
    }
    setMyCollab(((collabRes.data ?? []) as CollabRequest[]).filter((r) => myDepts.has(r.to_dept_id)));
  }, [range.from, range.to, meId]);

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

  const collabFromName = useCallback((id: string) => deptNames[id] ?? '다른 부서', [deptNames]);

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
    /* 우리 부서가 받은 협업 요청의 기한도 마감이다 — 같은 날짜를 두 곳에 적게 하지 않는다
       (일정 화면과 같은 규칙, src/lib/schedule.ts 참고) */
    for (const r of myCollab) {
      if (!r.due_date || r.status === 'done' || r.due_date < range.from || r.due_date > range.to) continue;
      out.push({
        id: `due-collab-${r.id}`,
        kind: 'due',
        title: `${r.project ? `${r.project} — ` : ''}협업 기한`,
        date: r.due_date,
        href: '/collab',
        who: [collabFromName(r.from_dept_id)],
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
  }, [items, schedules, attendees, nameOf, range, myCollab, collabFromName]);

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
    // 다시확인 = 답변은 달렸고 검증자가 다시 봐야 하는 것. 수정 필요와 섞지 않는다
    const recheck = items.filter((i) => i.status === 'recheck').length;
    return { total: items.length, done, fixing, recheck, pending: items.length - done - fixing - recheck };
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
  /** 내 업무 중 안 끝난 것 · 기한 지난 것 · 오늘 것 — 히어로 칩에 쓴다 */
  const myStat = useMemo(() => {
    const open = myOpen.filter((t) => t.state !== 'done');
    return {
      open: open.length,
      late: open.filter((t) => t.due_date && t.due_date < todayStr).length,
      today: open.filter((t) => t.due_date === todayStr).length,
    };
  }, [myOpen, todayStr]);

  /** 홈에서 바로 완료 표시 — 가장 흔한 동작이라 업무 화면까지 안 가게 한다.
      한 번 더 누르면 되돌아간다 (되돌리기 버튼을 따로 두지 않아도 되게) */
  const toggleTask = async (id: string) => {
    const cur = myOpen.find((t) => t.id === id);
    if (!cur) return;
    const next = cur.state === 'done' ? 'todo' : 'done';
    const at = new Date().toISOString();
    const before = myOpen;
    setActionErr('');
    setMyOpen((v) =>
      v.map((t) => (t.id === id ? { ...t, state: next, done_at: next === 'done' ? at : null } : t)),
    );
    const { error: e } = await supabase
      .from('tasks')
      .update({ state: next, done_at: next === 'done' ? at : null, updated_at: at })
      .eq('id', id);
    if (e) {
      setMyOpen(before);
      setActionErr(friendlyError(e, '상태를 바꾸지 못했어요.'));
    }
  };


  const myTasks = useMemo(() => {
    /* href 를 줄마다 들고 다닌다 — 예전엔 카드가 `/apps/${id}` 로 하드코딩돼 있어서
       프로그램이 아닌 할 일(업무)을 여기 못 얹었다 */
    const out: {
      id: string;
      title: string;
      sub: string;
      due: string | null;
      kind: 'review' | 'fix' | 'task' | 'collab';
      href: string;
      done?: boolean;
    }[] = [];

    // 나눠받은 업무가 먼저다 — 누가 시킨 일이라 기한이 진짜다
    for (const t of myOpen) {
      out.push({
        id: t.id,
        title: t.title,
        // '할 일' 은 모든 줄에 똑같이 붙어서 정보가 아니다. 다른 게 있을 때만 적는다
        sub: [t.state === 'doing' ? '하는 중' : '', t.batch_title].filter(Boolean).join(' · '),
        due: t.due_date,
        kind: 'task',
        href: '/task',
        done: t.state === 'done',
      });
    }

    /* 우리 부서가 받은 협업 요청 — 업무 다음이다. 남이 우리 팀에 맡긴 일이라
       내 할 일과 같은 무게로 봐야 한다 (부서협업 화면까지 들어가야만 보이면 놓친다) */
    for (const r of myCollab) {
      out.push({
        id: `collab-${r.id}`,
        title: r.project || r.body.slice(0, 40),
        sub: [collabFromName(r.from_dept_id), r.status === 'doing' ? '진행중' : ''].filter(Boolean).join(' · '),
        due: r.due_date,
        kind: 'collab',
        href: '/collab',
      });
    }

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
          href: `/apps/${it.app.id}`,
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
            href: `/apps/${it.app.id}`,
          });
        }
      }
    }
    return out.sort((a, b) => (!a.due ? 1 : !b.due ? -1 : a.due < b.due ? -1 : 1));
  }, [items, meId, myOpen, myCollab, collabFromName]);

  /** 히어로 칩과 섹션 배지가 같은 걸 세게 한다 — 나란히 놓고 숫자가 다르면 버그로 보인다 */
  const openTaskCount = myTasks.filter((t) => !t.done).length;

  const dueSoon = useMemo(
    () =>
      items.filter((i) => {
        if (i.status === 'done' || !i.app.due_date) return false;
        const n = Math.round((parseDate(i.app.due_date).getTime() - Date.now()) / 86400000);
        return n <= 7;
      }).length,
    [items],
  );

  // 직함은 붙이지 않는다 — 이름 + 님
  const name = session?.name ?? '';
  const greeting = `${name}님`;
  const tomorrow = toISODate(new Date(Date.now() + 86400000));
  const pickedLabel = picked === todayStr ? '오늘' : picked === tomorrow ? '내일' : korDateFull(picked);
  const moveMonth = (d: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + d, 1));

  return (
    <div className="px-4 pb-8 pt-4 lg:px-0 lg:pt-0">
      {/* --------------------------------------------------------- 인사
          PC 에서는 인사·요약을 한 줄로 눕혀 맨 윗줄에 통째로 보이게 한다.
          (두 줄이면 조금만 스크롤해도 반쯤 잘려 보여서 지저분했다) */}
      <div className="card mb-4 overflow-hidden p-4 lg:flex lg:items-center lg:gap-4 lg:px-5 lg:py-3.5">
        <div className="flex items-center justify-between gap-3 lg:shrink-0">
          <div className="min-w-0">
            <p className="text-[17px] font-bold leading-tight text-neutral-900 lg:text-[18px]">
              안녕하세요 {greeting}
            </p>
            <p className="mt-0.5 text-[12.5px] text-neutral-500">{korDateFull(todayStr)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2 lg:hidden">
            {session && <Avatar name={session.name} size={40} ring />}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5 lg:mt-0 lg:flex-1 lg:flex-nowrap lg:justify-end">
          {/* 칩은 역할에 따라 다르다. 강사에게 '팀 미착수' 를 보여주면 볼 이유도 없고
              할 수 있는 것도 없다 — 서로 감시하는 느낌만 준다.
              그리고 4개는 375px 에서 두 줄로 접히므로 셋씩만 둔다
              (검증 완료 % 는 '전체 현황' 머리글 배지에 이미 있다) */}
          <HeroChip label="내 할 일" value={`${openTaskCount}`} />
          {isAdmin ? (
            <>
              <HeroChip label="팀 미착수" value={`${untouched}`} tone={untouched > 0 ? 'warn' : 'ok'} />
              <HeroChip label="7일 내 마감" value={`${dueSoon}`} tone={dueSoon > 0 ? 'warn' : 'ok'} />
            </>
          ) : (
            <>
              <HeroChip label="기한 지남" value={`${myStat.late}`} tone={myStat.late > 0 ? 'warn' : 'ok'} />
              <HeroChip label="오늘" value={`${myStat.today}`} tone={myStat.today > 0 ? 'warn' : 'ok'} />
            </>
          )}
        </div>

        <button
          onClick={signOut}
          className="hidden shrink-0 text-[12.5px] font-semibold text-neutral-500 hover:text-neutral-800 lg:block"
        >
          로그아웃
        </button>
      </div>

      {/* 알림 — 강사도 여기서 켠다 (관리 화면은 원장만 들어갈 수 있다).
          이미 켠 사람에게는 한 줄로 접힌다 */}
      <div className="mb-4">
        <PushToggle />
      </div>

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} onRetry={() => void reload()} />
        </div>
      )}

      {actionErr && (
        <div className="mb-4">
          <ErrorBanner message={actionErr} />
        </div>
      )}

      <div className="lg:grid lg:grid-cols-3 lg:items-start lg:gap-5">
        {/* ======================================================= 본문 */}
        {/* 순서를 역할에 따라 바꾼다 (CLAUDE.md 1번 원칙).
            강사는 '내 할 일' 부터, 원장은 '전체 현황·일정' 부터.
            내용은 그대로 두고 order-* 만 다르게 주므로 분기는 이 숫자들뿐이다. */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          {/* 달력 + 마감 타임라인 — **한 섹션이다.**
              둘 다 "언제" 를 보는 것인데 따로 접어두니 머리글만 두 줄(96px)이었다.
              접힌 머리글 넷이 히어로와 '내 할 일' 사이를 막고 있던 게
              원장 홈에서 할 일이 545px 아래에 있던 이유다. */}
          <Collapsible
            id="home-cal"
            title="일정 · 마감"
            className={isAdmin ? 'order-1' : 'order-3'}
            badge={
              upcoming.length > 0 || timeline.rows.length > 0 ? (
                <span className="chip bg-neutral-100 text-neutral-500">
                  {upcoming.length > 0 ? `일정 ${upcoming.length}` : ''}
                  {upcoming.length > 0 && timeline.rows.length > 0 ? ' · ' : ''}
                  {timeline.rows.length > 0 ? `마감 ${timeline.rows.length}` : ''}
                </span>
              ) : undefined
            }
            right={
              <Link href="/schedule" className="-my-3 flex min-h-[44px] items-center text-[12.5px] font-bold text-neutral-400">
                전체 ›
              </Link>
            }
          >
          <div className="card p-3.5">
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
          </div>

          {/* 마감 타임라인 — 앞으로 4주. 달력과 같은 '언제' 라 여기 붙였다 */}
          {timeline.rows.length > 0 && (
            <div className="card mt-3 p-4">
              <div className="mb-2 flex items-baseline gap-2">
                <h3 className="text-[12.5px] font-bold text-neutral-500">마감 타임라인</h3>
                <span className="text-[11.5px] text-neutral-400">앞으로 4주 · {timeline.rows.length}건</span>
              </div>
              {loading ? (
                <Skeleton className="h-32 w-full rounded-xl" />
              ) : (
                <Timeline rows={timeline.rows} ticks={timeline.ticks} onPick={(id) => router.push(`/apps/${id}`)} />
              )}
            </div>
          )}
          </Collapsible>

          {/* 통계 3장 + 팀 현황 — **한 섹션이다.** 둘 다 '지금 어떤가' 를 보는 것인데
              따로 접어두니 머리글만 두 줄이었다. 팀 현황은 원장에게만 그린다 —
              강사가 남의 미착수를 봐도 할 수 있는 게 없고 감시처럼 느껴진다 */}
          <Collapsible
            id="home-stats"
            title="전체 현황"
            className={isAdmin ? 'order-2' : 'order-4'}
            badge={
              <span className="flex items-center gap-1">
                <span className="chip bg-neutral-100 text-neutral-500">검증 완료 {overallPct}%</span>
                {isAdmin && untouched > 0 && (
                  <span className="chip bg-amber-100 text-amber-800">팀 미착수 {untouched}</span>
                )}
              </span>
            }
          >
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
              /* '다시확인' 이 몇 건인지도 여기서 보여준다 — 수정 필요와 다른 일이다 */
              delta={stats.recheck > 0 ? `다시확인 ${stats.recheck}` : stats.fixing > 0 ? '확인 필요' : '없음'}
              deltaTone={stats.fixing > 0 || stats.recheck > 0 ? 'down' : 'up'}
              accentBg="bg-red-500"
            >
              <div className="flex gap-1">
                {[
                  { n: stats.done, c: 'bg-green-500' },
                  { n: stats.pending, c: 'bg-neutral-300' },
                  { n: stats.recheck, c: 'bg-amber-500' },
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

          {isAdmin && (
            <div className="mt-3">
              <h3 className="mb-1.5 text-[12.5px] font-bold text-neutral-500">누가 뭘 하고 있나</h3>
              {loading ? <CardSkeleton rows={3} /> : <TeamBoard work={teamWork} meId={meId} />}
            </div>
          )}
          </Collapsible>

          {/* 공지 — 전체 공지를 홈에서도 훑을 수 있게 */}
          {noticeCards.total > 0 && (
            <Collapsible
              id="home-notice"
              title="공지사항"
              className={isAdmin ? 'order-4' : 'order-2'}
              badge={
                noticeCards.unread > 0 ? (
                  <span className="chip bg-brand-50 text-brand-700">안 읽음 {noticeCards.unread}</span>
                ) : undefined
              }
              right={
                <Link href="/notice" className="-my-3 flex min-h-[44px] items-center text-[12.5px] font-bold text-neutral-400">
                  전체 {noticeCards.total}건 ›
                </Link>
              }
            >
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
            </Collapsible>
          )}

          {/* 내 할 일 — 홈에서 유일하게 기본으로 펼쳐두는 것.
              폰 첫 화면에서 "오늘 뭘 해야 하나" 가 끝나야 한다 */}
          <Collapsible
            id="home-mytasks"
            title="내 할 일"
            defaultOpen
            className={isAdmin ? 'order-5' : 'order-1'}
            badge={
              myStat.open > 0 || myTasks.length > 0 ? (
                <span className="chip bg-brand-50 text-brand-700">{openTaskCount}</span>
              ) : undefined
            }
            right={
              <Link href="/task" className="-my-3 flex min-h-[44px] items-center text-[12.5px] font-bold text-neutral-400">
                업무 ›
              </Link>
            }
          >
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
                  <div
                    key={`${t.kind}-${t.id}`}
                    className="card flex items-center gap-1 p-3 transition hover:border-brand-300"
                  >
                    {/* 업무는 여기서 바로 끝낸다 — 홈에서 제일 흔한 동작인데
                        예전엔 업무 화면까지 들어갔다 나와야 했다.
                        한 번 더 누르면 되돌아가므로 잘못 눌러도 안전하다 */}
                    {t.kind === 'task' ? (
                      <button
                        onClick={() => void toggleTask(t.id)}
                        aria-pressed={t.done}
                        aria-label={`${t.title} ${t.done ? '되돌리기' : '완료'}`}
                        className="-my-2 -ml-1 flex h-11 w-9 shrink-0 items-center justify-center py-2"
                      >
                        <span
                          className={`flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 transition ${
                            t.done ? 'border-green-500 bg-green-500 text-white' : 'border-neutral-300'
                          }`}
                        >
                          {t.done && <Icon name="check" size={13} strokeWidth={3} />}
                        </span>
                      </button>
                    ) : (
                      <span className="flex w-9 shrink-0 justify-center">
                        <Icon
                          name={t.kind === 'fix' ? 'wrench' : t.kind === 'collab' ? 'users' : 'search'}
                          size={16}
                          className={
                            t.kind === 'fix'
                              ? 'text-red-500'
                              : t.kind === 'collab'
                                ? 'text-brand'
                                : 'text-neutral-400'
                          }
                        />
                      </span>
                    )}
                    <Link href={t.href} className="-my-2 flex min-h-[44px] min-w-0 flex-1 flex-col justify-center py-2">
                      <span
                        className={`block truncate text-[14px] font-bold ${
                          t.done ? 'text-neutral-400 line-through' : ''
                        }`}
                      >
                        {t.title}
                      </span>
                      {t.sub && <span className="text-[11.5px] text-neutral-400">{t.sub}</span>}
                    </Link>
                    {t.due && !t.done && (
                      <span className={`chip shrink-0 ${ddayClass(t.due)}`}>{ddayLabel(t.due)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {myTasks.length > 6 && (
              <Link
                href="/task"
                className="mt-2 flex min-h-[44px] items-center justify-center rounded-xl border border-dashed border-neutral-300 text-[12.5px] font-bold text-neutral-500"
              >
                {myTasks.length - 6}건 더 보기 ›
              </Link>
            )}
          </Collapsible>

        </div>

        {/* ======================================================= 오른쪽 */}
        {/* PC 전용 오른쪽 묶음. 폰에서는 감춘다 —
            아래로 483px 이 더 붙어서 정작 내 할 일·팀 현황이 저 밑으로 밀렸다.
            (활동 로그는 관리 화면에, 프로그램 구성은 /apps 카드 배지에 그대로 있다) */}
        <div className="hidden space-y-4 lg:mt-0 lg:block">
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
    <span className="flex items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1.5">
      <span className="text-[11px] text-neutral-500">{label}</span>
      <span className={`text-[13px] font-bold ${tone === 'warn' ? 'text-amber-700' : 'text-neutral-900'}`}>
        {value}
      </span>
    </span>
  );
}
