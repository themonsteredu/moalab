'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { logActivity } from '@/lib/log';
import { sendPush } from '@/lib/push';
import { hhmm, korDate, korDateFull, toISODate, today } from '@/lib/format';
import {
  SCHEDULE_KINDS,
  buildEntries,
  classLine,
  classLoad,
  classTitle,
  filterEntries,
  inMonth,
  scheduleKindLabel,
  type CalendarEntry,
  type ScopeMode,
} from '@/lib/schedule';
import { PageHeader } from '@/components/PageHeader';
import { CalendarLegend, KIND_META, MonthCalendar } from '@/components/MonthCalendar';
import { Collapsible, ConfirmDialog, ErrorBanner, MultiPicker, Sheet, Skeleton, useToast } from '@/components/ui';
import type {
  AppRow,
  CollabRequest,
  Department,
  Duty,
  DutyHelper,
  Schedule,
  ScheduleKind,
} from '@/lib/types';

/**
 * 일정 — 출강·회의·기타 + **저절로 생기는 마감**.
 *
 * 마감은 여기서 넣지 않는다. 프로그램 제출 기한(`apps.due_date`)과
 * 부서 협업 요청 기한(`collab_requests.due_date`)에서 달력이 스스로 만들어낸다.
 * 계산은 전부 `src/lib/schedule.ts` 에 있고 `scripts/schedule.test.mjs` 가 지킨다.
 */

const SCOPES: { value: ScopeMode; label: string }[] = [
  { value: 'mine', label: '내 일정' },
  { value: 'dept', label: '부서별' },
  { value: 'all', label: '전체' },
];

export default function SchedulePage() {
  const { session } = useSession();
  const { members, nameOf } = useMembers();
  const toast = useToast();
  const meId = session?.id ?? '';

  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [picked, setPicked] = useState<string>(today());

  const [apps, setApps] = useState<AppRow[]>([]);
  const [reviewers, setReviewers] = useState<Record<string, string[]>>({});
  const [collabs, setCollabs] = useState<CollabRequest[]>([]);
  const [depts, setDepts] = useState<Department[]>([]);
  const [groups, setGroups] = useState<{ id: string; dept_id: string }[]>([]);
  const [duties, setDuties] = useState<Duty[]>([]);
  const [helpers, setHelpers] = useState<DutyHelper[]>([]);
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [attendees, setAttendees] = useState<Record<string, string[]>>({});
  const [error, setError] = useState('');

  /** 내 일정 / 부서별 / 전체 — 고른 것은 기기에 기억한다 */
  const [scope, setScope] = useState<ScopeMode>('mine');
  const [deptPick, setDeptPick] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [deleting, setDeleting] = useState<Schedule | null>(null);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem('moalab.schedule.scope');
      if (v === 'mine' || v === 'dept' || v === 'all') setScope(v);
    } catch {
      /* 무시 */
    }
  }, []);

  const pickScope = (v: ScopeMode) => {
    setScope(v);
    try {
      window.localStorage.setItem('moalab.schedule.scope', v);
    } catch {
      /* 무시 */
    }
  };

  const load = useCallback(async () => {
    setError('');
    try {
      const [aRes, arRes, sRes, smRes, cRes, dRes, gRes, uRes, hRes] = await Promise.all([
        supabase.from('apps').select('*').eq('archived', false),
        supabase.from('app_reviewers').select('*'),
        supabase.from('schedules').select('*').order('date').order('start_time'),
        supabase.from('schedule_members').select('*'),
        supabase.from('collab_requests').select('*'),
        supabase.from('departments').select('*').order('sort_order').order('name'),
        supabase.from('duty_groups').select('id,dept_id'),
        supabase.from('duties').select('*'),
        supabase.from('duty_helpers').select('*'),
      ]);
      if (sRes.error) throw sRes.error;
      setApps((aRes.data ?? []) as AppRow[]);
      setSchedules((sRes.data ?? []) as Schedule[]);
      setCollabs((cRes.data ?? []) as CollabRequest[]);
      setDepts((dRes.data ?? []) as Department[]);
      setGroups((gRes.data ?? []) as { id: string; dept_id: string }[]);
      setDuties((uRes.data ?? []) as Duty[]);
      setHelpers((hRes.data ?? []) as DutyHelper[]);

      const rv: Record<string, string[]> = {};
      for (const r of arRes.data ?? []) (rv[r.app_id] ??= []).push(r.member_id);
      setReviewers(rv);

      const map: Record<string, string[]> = {};
      for (const r of smRes.data ?? []) (map[r.schedule_id] ??= []).push(r.member_id);
      setAttendees(map);
    } catch (e) {
      setSchedules([]);
      setError(friendlyError(e, '일정을 불러오지 못했어요. 다시 시도해주세요.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* -------------------------------------------------------- 부서 · 소속 */

  const deptOfGroup = useMemo(() => new Map(groups.map((g) => [g.id, g.dept_id])), [groups]);

  /** 부서 → 그 부서 사람들. 팀장이거나 그 부서 역할의 주담당·부담당이면 그 부서 사람이다
      (부서협업·홈과 같은 규칙 — 새 소속 표를 만들지 않는다) */
  const membersOfDept = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (dept: string, who: string) => {
      const s = m.get(dept) ?? new Set<string>();
      s.add(who);
      m.set(dept, s);
    };
    for (const d of depts) if (d.head_id) add(d.id, d.head_id);
    for (const u of duties) {
      const dep = deptOfGroup.get(u.group_id);
      if (!dep) continue;
      if (u.owner_id) add(dep, u.owner_id);
      for (const h of helpers) if (h.duty_id === u.id) add(dep, h.member_id);
    }
    return m;
  }, [depts, duties, helpers, deptOfGroup]);

  const myDeptIds = useMemo(
    () => depts.filter((d) => membersOfDept.get(d.id)?.has(meId)).map((d) => d.id),
    [depts, membersOfDept, meId],
  );

  const deptName = useCallback(
    (id: string) => depts.find((d) => d.id === id)?.name ?? '',
    [depts],
  );
  const appTitle = useCallback(
    (id: string) => apps.find((a) => a.id === id)?.title_ko ?? '',
    [apps],
  );

  /* ------------------------------------------------------------ 항목 */

  const all = useMemo(
    () =>
      buildEntries({
        apps,
        reviewers,
        collabs,
        deptName,
        schedules: schedules ?? [],
        attendees,
        appTitle,
      }),
    [apps, reviewers, collabs, deptName, schedules, attendees, appTitle],
  );

  const entries = useMemo(() => {
    if (scope === 'all') return all;
    if (scope === 'mine') return filterEntries(all, 'mine', { memberIds: [meId], deptIds: myDeptIds });
    const chosen = deptPick || depts[0]?.id || '';
    return filterEntries(all, 'dept', {
      memberIds: [...(membersOfDept.get(chosen) ?? [])],
      deptIds: chosen ? [chosen] : [],
    });
  }, [all, scope, meId, myDeptIds, deptPick, depts, membersOfDept]);

  const dayEntries = useMemo(() => entries.filter((e) => e.date === picked), [entries, picked]);
  const month = useMemo(
    () => `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`,
    [cursor],
  );

  /** 이번 달 출강 정산 — 강사별 회 / 타임 */
  const load1 = useMemo(
    () => classLoad(schedules ?? [], attendees, month),
    [schedules, attendees, month],
  );
  const monthClasses = useMemo(
    () => (schedules ?? []).filter((s) => s.kind === 'class' && inMonth(s.date, month)).length,
    [schedules, month],
  );

  const todayStr = today();
  const moveMonth = (delta: number) =>
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));

  const goToday = () => {
    const d = new Date();
    setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
    setPicked(toISODate(d));
  };

  const removeSchedule = async () => {
    if (!deleting) return;
    const t = deleting;
    setDeleting(null);
    const { error: e } = await supabase.from('schedules').delete().eq('id', t.id);
    if (e) return setError(friendlyError(e));
    logActivity(session?.id, `일정 삭제 — ${t.title}`, null);
    toast.show('지웠어요.');
    await load();
  };

  const scheduleOf = (e: CalendarEntry) =>
    e.scheduleId ? ((schedules ?? []).find((s) => s.id === e.scheduleId) ?? null) : null;

  return (
    <>
      <PageHeader
        title="일정"
        right={
          <button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="btn-primary h-10 px-3.5 text-[14px]"
          >
            + 일정
          </button>
        }
      />

      <div className="px-4 pb-8 pt-3 lg:max-w-3xl">
        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} onRetry={() => void load()} />
          </div>
        )}

        {/* 달 이동 */}
        <div className="mb-2.5 flex items-center gap-2">
          <button onClick={() => moveMonth(-1)} aria-label="이전 달" className="tap w-11 rounded-xl border border-neutral-300 bg-surface text-neutral-500">
            ‹
          </button>
          <p className="flex-1 text-center text-[16px] font-black">
            {cursor.getFullYear()}년 {cursor.getMonth() + 1}월
          </p>
          <button onClick={() => moveMonth(1)} aria-label="다음 달" className="tap w-11 rounded-xl border border-neutral-300 bg-surface text-neutral-500">
            ›
          </button>
          <button onClick={goToday} className="tap rounded-xl border border-neutral-300 bg-surface px-3 text-[13px] font-bold text-neutral-600">
            오늘
          </button>
        </div>

        {/* 누구 일정을 볼까 */}
        <div className="mb-2.5 flex gap-1.5 rounded-xl bg-neutral-200/60 p-1">
          {SCOPES.map((s) => (
            <button
              key={s.value}
              onClick={() => pickScope(s.value)}
              aria-pressed={scope === s.value}
              className={`tap flex-1 rounded-lg text-[14px] font-bold transition ${
                scope === s.value ? 'bg-surface text-neutral-900 shadow-sm' : 'text-neutral-500'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* 부서 고르기 — 부서별일 때만. 한 줄 가로 스크롤 (여러 줄로 깔면 달력이 밀린다) */}
        {scope === 'dept' && (
          <div className="-mx-4 mb-2.5 overflow-x-auto px-4">
            <div className="flex gap-1.5">
              {depts.length === 0 ? (
                <Link
                  href="/roles"
                  className="tap flex shrink-0 items-center rounded-full border border-neutral-300 bg-surface px-3.5 text-[13px] font-semibold text-neutral-500"
                >
                  부서가 아직 없어요 — 역할분장에서 만들기 ›
                </Link>
              ) : (
                depts.map((d) => {
                  const on = (deptPick || depts[0]?.id) === d.id;
                  return (
                    <button
                      key={d.id}
                      onClick={() => setDeptPick(d.id)}
                      aria-pressed={on}
                      className={`tap shrink-0 rounded-full border px-3.5 text-[13px] font-semibold transition ${
                        on ? 'pick-on' : 'border-neutral-300 bg-surface text-neutral-600'
                      }`}
                    >
                      {d.name}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {scope === 'mine' && myDeptIds.length === 0 && (
          <div className="mb-2.5 flex items-center gap-2">
            <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-neutral-400">
              아직 어느 부서에도 안 묶여 있어요. 역할을 맡으면 그 부서의 협업 기한도 여기 같이 보여요.
            </p>
            <Link
              href="/roles"
              className="-my-3 flex min-h-[44px] shrink-0 items-center text-[12px] font-bold text-brand"
            >
              역할분장 ›
            </Link>
          </div>
        )}

        <div className="mb-2.5">
          <CalendarLegend />
        </div>

        {/* 달력 */}
        {schedules === null ? (
          <Skeleton className="h-72 w-full rounded-2xl" />
        ) : (
          <MonthCalendar month={cursor} entries={entries} selected={picked} onSelect={setPicked} />
        )}

        {/* 고른 날 */}
        <div className="mt-4">
          <p className="mb-2.5 text-[15px] font-bold">
            {korDateFull(picked)}
            {picked === todayStr && <span className="ml-1.5 text-[12px] font-bold text-brand">오늘</span>}
          </p>

          {dayEntries.length === 0 ? (
            <p className="card px-4 py-8 text-center text-[13px] text-neutral-400">이 날은 일정이 없어요.</p>
          ) : (
            <div className="space-y-2.5">
              {dayEntries.map((e) => (
                <EntryCard
                  key={e.id}
                  entry={e}
                  nameOf={nameOf}
                  onEdit={() => {
                    const s = scheduleOf(e);
                    if (!s) return;
                    setEditing(s);
                    setFormOpen(true);
                  }}
                  onDelete={() => {
                    const s = scheduleOf(e);
                    if (s) setDeleting(s);
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* 이번 달 출강 — 정산의 기준이라 강사별로 모아준다.
            접어두는 게 기본이다 (달력이 이 화면의 주인공이다) */}
        {monthClasses > 0 && (
          <Collapsible
            id="schedule-load"
            className="mt-4"
            title={`${cursor.getMonth() + 1}월 출강 정산`}
            badge={
              <span className="text-[11.5px] font-bold text-neutral-400">
                출강 {monthClasses}건 · 강사 {load1.length}명
              </span>
            }
          >
            <div className="card divide-y divide-neutral-200 p-0">
              {load1.map((l) => (
                <div key={l.memberId} className="flex items-center gap-2 px-3.5 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-[14px] font-bold">{nameOf(l.memberId)}</span>
                  {l.missing > 0 && (
                    <span className="chip bg-red-100 text-red-700">타임 수 없음 {l.missing}</span>
                  )}
                  <span className="text-[13px] text-neutral-500">{l.classes}회</span>
                  <span className="w-16 text-right text-[15px] font-black text-neutral-900">{l.periods}타임</span>
                </div>
              ))}
            </div>
            {load1.some((l) => l.missing > 0) && (
              <p className="mt-2 px-1 text-[11.5px] leading-relaxed text-neutral-400">
                타임 수를 안 적은 출강은 합계에서 빠져 있어요. 그 일정을 열어 <b>강의 타임 수</b>를 채우면 반영됩니다.
              </p>
            )}
          </Collapsible>
        )}
      </div>

      <ScheduleForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        defaultDate={picked}
        editing={editing}
        members={members}
        apps={apps}
        attendees={editing ? (attendees[editing.id] ?? []) : []}
        onSaved={(msg) => {
          toast.show(msg);
          void load();
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`'${deleting?.title ?? ''}' 일정을 지울까요?`}
        onCancel={() => setDeleting(null)}
        onConfirm={removeSchedule}
      />

      {toast.node}
    </>
  );
}

/* ------------------------------------------------------------------- 한 건 */

function EntryCard({
  entry: e,
  nameOf,
  onEdit,
  onDelete,
}: {
  entry: CalendarEntry;
  nameOf: (id: string) => string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const meta = KIND_META[e.kind];
  const timeLine = [
    e.time ? `${hhmm(e.time)}${e.endTime ? `–${hhmm(e.endTime)}` : ''}` : '',
    e.place ?? '',
  ]
    .filter(Boolean)
    .join(' · ');
  const detail = e.kind === 'class' ? classLine({ school: e.school ?? null, headcount: e.headcount ?? null, periods: e.periods ?? null }, e.program) : '';

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-[15px] font-bold leading-snug">{e.title}</p>
        <span className={`chip shrink-0 ${meta.chip}`}>{meta.label}</span>
      </div>
      {detail && <p className="mt-1 text-[12.5px] text-neutral-600">{detail}</p>}
      {timeLine && <p className="mt-1 text-[12.5px] text-neutral-500">{timeLine}</p>}
      {e.who.length > 0 && (
        <p className="mt-1 text-[12.5px] text-neutral-500">
          {e.kind === 'class' ? '담당' : '참석'} {e.who.map((m) => nameOf(m)).join(', ')}
        </p>
      )}
      {e.memo && (
        <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-600">{e.memo}</p>
      )}
    </>
  );

  // 마감은 여기서 못 고친다 — 원래 자리(프로그램·부서협업)에서 고쳐야 한 곳만 남는다
  if (e.kind === 'due') {
    return (
      <Link href={e.href ?? '/'} className="card block p-3.5 active:bg-neutral-50">
        {body}
        <p className="mt-1.5 text-[11.5px] text-neutral-400">
          {e.href?.startsWith('/apps') ? '프로그램에서 고칠 수 있어요 ›' : '부서협업에서 고칠 수 있어요 ›'}
        </p>
      </Link>
    );
  }

  return (
    <div className="card p-3.5">
      {body}
      <div className="mt-2.5 flex gap-2">
        <button onClick={onEdit} className="tap flex-1 rounded-lg border border-neutral-300 text-[13px] font-semibold text-neutral-600">
          수정
        </button>
        <button onClick={onDelete} className="tap rounded-lg border border-neutral-300 px-3 text-[13px] text-neutral-500">
          삭제
        </button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- 일정 추가/수정 */

function ScheduleForm({
  open,
  onClose,
  onSaved,
  defaultDate,
  editing,
  members,
  apps,
  attendees,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (msg: string) => void;
  defaultDate: string;
  editing: Schedule | null;
  members: { id: string; name: string }[];
  apps: AppRow[];
  attendees: string[];
}) {
  const { session } = useSession();
  const [kind, setKind] = useState<ScheduleKind>('class');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [place, setPlace] = useState('');
  const [memo, setMemo] = useState('');
  const [people, setPeople] = useState<string[]>([]);
  const [school, setSchool] = useState('');
  const [appId, setAppId] = useState('');
  const [headcount, setHeadcount] = useState('');
  const [periods, setPeriods] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    if (editing) {
      setKind(editing.kind);
      setTitle(editing.title);
      setDate(editing.date);
      setTime(hhmm(editing.start_time));
      setEndTime(hhmm(editing.end_time));
      setPlace(editing.place ?? '');
      setMemo(editing.memo ?? '');
      setPeople(attendees);
      setSchool(editing.school ?? '');
      setAppId(editing.app_id ?? '');
      setHeadcount(editing.headcount == null ? '' : String(editing.headcount));
      setPeriods(editing.periods == null ? '' : String(editing.periods));
    } else {
      setKind('class');
      setTitle('');
      setDate(defaultDate);
      setTime('');
      setEndTime('');
      setPlace('');
      setMemo('');
      setPeople(session?.id ? [session.id] : []);
      setSchool('');
      setAppId('');
      setHeadcount('');
      setPeriods('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, defaultDate]);

  const isClass = kind === 'class';
  const programName = apps.find((a) => a.id === appId)?.title_ko ?? '';
  /** 출강 제목은 사람이 짓지 않는다 — 학교 · 프로그램으로 만든다 */
  const finalTitle = isClass ? classTitle(school, programName) : title.trim();

  const num = (v: string): number | null => {
    const n = Number(v.replace(/[^0-9]/g, ''));
    return v.trim() === '' || !isFinite(n) ? null : n;
  };

  const save = async () => {
    setError('');
    if (isClass && !school.trim()) return setError('학교(기관) 이름을 입력해주세요.');
    if (!isClass && !title.trim()) return setError('제목을 입력해주세요.');
    if (!date) return setError('날짜를 골라주세요.');
    if (time && endTime && endTime < time) return setError('끝나는 시간이 시작 시간보다 빨라요.');

    setBusy(true);
    try {
      const payload = {
        kind,
        title: finalTitle,
        date,
        start_time: time || null,
        end_time: endTime || null,
        place: place.trim() || null,
        memo: memo.trim() || null,
        app_id: isClass ? appId || null : null,
        school: isClass ? school.trim() || null : null,
        headcount: isClass ? num(headcount) : null,
        periods: isClass ? num(periods) : null,
      };

      let id: string;
      if (editing) {
        const { error: e } = await supabase.from('schedules').update(payload).eq('id', editing.id);
        if (e) throw e;
        id = editing.id;
        await supabase.from('schedule_members').delete().eq('schedule_id', id);
      } else {
        const { data, error: e } = await supabase.from('schedules').insert(payload).select().single();
        if (e) throw e;
        id = data.id;
      }

      if (people.length > 0) {
        const { error: e } = await supabase
          .from('schedule_members')
          .insert(people.map((member_id) => ({ schedule_id: id, member_id })));
        if (e) throw e;
      }

      logActivity(
        session?.id,
        `${editing ? '일정 수정' : '일정 추가'} — ${scheduleKindLabel(kind)} ${finalTitle}`,
        `schedule:${id}`,
      );

      /* 출강은 **담당 강사에게만** 알린다. 고칠 때는 이번에 새로 들어온 사람에게만 —
         시간 하나 고쳤다고 전원에게 다시 울리면 그날로 알림을 꺼버린다
         (업무 배정이 '담당자가 바뀌었을 때만' 울리는 것과 같은 규칙) */
      let sent = 0;
      if (isClass) {
        const fresh = editing ? people.filter((p) => !attendees.includes(p)) : people;
        const targets = fresh.filter((p) => p !== session?.id);
        if (targets.length > 0) {
          const line = classLine(
            { school: school.trim() || null, headcount: num(headcount), periods: num(periods) },
            programName,
          );
          const res = await sendPush({
            title: '출강 일정이 잡혔어요',
            body: `${korDate(date)}${time ? ` ${time}` : ''} · ${line}`,
            url: '/schedule',
            tag: `schedule-${id}`,
            memberIds: targets,
            fromId: session?.id ?? null,
          });
          sent = res?.sent ?? 0;
        }
      }

      onSaved(sent > 0 ? `저장했어요. ${sent}명에게 알림도 갔어요.` : '저장했어요.');
      onClose();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? '일정 수정' : '새 일정'}
      footer={
        <button onClick={save} disabled={busy} className="btn-primary w-full">
          {busy ? '저장 중…' : '저장'}
        </button>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}

        <div>
          <span className="label">종류</span>
          <div className="flex gap-2">
            {SCHEDULE_KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                onClick={() => setKind(k.value)}
                aria-pressed={kind === k.value}
                className={`tap flex-1 rounded-xl border text-[14px] font-semibold transition ${
                  kind === k.value
                    ? 'pick-on'
                    : 'border-neutral-300 bg-surface text-neutral-600'
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-neutral-400">
            마감은 여기서 안 넣어요. 프로그램 제출 기한과 부서협업 요청 기한이 달력에 저절로 표시돼요.
          </p>
        </div>

        {isClass ? (
          <>
            <div>
              <label className="label" htmlFor="sc-school">
                학교 · 기관
              </label>
              <input
                id="sc-school"
                value={school}
                onChange={(e) => setSchool(e.target.value)}
                placeholder="모아초등학교"
                className="field"
              />
            </div>
            <div>
              <label className="label" htmlFor="sc-app">
                프로그램
              </label>
              <select id="sc-app" value={appId} onChange={(e) => setAppId(e.target.value)} className="field">
                <option value="">— 안 고름 —</option>
                {apps.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title_ko}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[11.5px] text-neutral-400">
                제목은 <b>{classTitle(school, programName)}</b> 로 저장돼요.
              </p>
            </div>
          </>
        ) : (
          <div>
            <label className="label" htmlFor="sc-title">
              제목
            </label>
            <input
              id="sc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={kind === 'meeting' ? '주간 회의' : '재료 주문'}
              className="field"
            />
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label" htmlFor="sc-date">
              날짜
            </label>
            <input id="sc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field" />
          </div>
          <div>
            <label className="label" htmlFor="sc-time">
              시작
            </label>
            <input id="sc-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="field" />
          </div>
          <div>
            <label className="label" htmlFor="sc-end">
              종료
            </label>
            <input id="sc-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="field" />
          </div>
        </div>

        {isClass && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="sc-head">
                인원수
              </label>
              <input
                id="sc-head"
                inputMode="numeric"
                value={headcount}
                onChange={(e) => setHeadcount(e.target.value)}
                placeholder="24"
                className="field"
              />
            </div>
            <div>
              <label className="label" htmlFor="sc-periods">
                강의 타임 수
              </label>
              <input
                id="sc-periods"
                inputMode="numeric"
                value={periods}
                onChange={(e) => setPeriods(e.target.value)}
                placeholder="2"
                className="field"
              />
              <p className="mt-1.5 text-[11.5px] text-neutral-400">정산 기준이에요.</p>
            </div>
          </div>
        )}

        <div>
          <label className="label" htmlFor="sc-place">
            장소
          </label>
          <input
            id="sc-place"
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            placeholder={isClass ? '3층 과학실' : '사무실'}
            className="field"
          />
        </div>

        <div>
          <span className="label">{isClass ? '담당 강사' : '참석자'}</span>
          <MultiPicker options={members} selected={people} onChange={setPeople} />
          {isClass && (
            <p className="mt-2 text-[11.5px] text-neutral-400">
              고른 강사에게 알림이 가요. (나 자신에게는 안 갑니다)
            </p>
          )}
        </div>

        <div>
          <label className="label" htmlFor="sc-memo">
            메모
          </label>
          <textarea
            id="sc-memo"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={3}
            placeholder="준비물, 주차 안내 등"
            className="field resize-none"
          />
        </div>
      </div>
    </Sheet>
  );
}
