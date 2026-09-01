'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { logActivity } from '@/lib/log';
import { buildOrg, type DutyRef } from '@/lib/org';
import { isOverdue, sortTasks, todayStr } from '@/lib/task';
import { buildEntries, filterEntries, scheduleKindLabel, sortEntries } from '@/lib/schedule';
import { collabPriorityLabel, sortRequests } from '@/lib/collab';
import { korDate, ddayLabel, ddayClass, hhmm, relTime, toISODate } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { Icon } from '@/components/Icon';
import { DutyForm } from '@/components/DutyForm';
import { Collapsible, EmptyState, ErrorBanner, Sheet, CardSkeleton, useToast } from '@/components/ui';
import type {
  AppRow,
  CollabRequest,
  Department,
  Duty,
  DutyGroup,
  DutyHelper,
  Schedule,
  Task,
} from '@/lib/types';

/**
 * 내 업무 — **한 사람의 하루가 한 화면에.**
 *
 * 원장이 이렇게 말했다: *"나의 업무만 보고 그 안에서 자유롭게 기획 자료 올리고,
 * 일정 관리하고."* 그때까지 내 할 일은 `업무`, 내 역할은 `부서업무`, 내 일정은
 * `일정` 이라 **같은 사람의 하루가 세 화면에 흩어져** 있었다.
 *
 * **새 표를 하나도 만들지 않았다.** 이미 있는 데이터를 사람 축으로 다시 묶을
 * 뿐이다 — `/verify` 가 새 표 없이 만들어진 것과 같은 방식이다.
 *
 * 순서는 급한 것부터다: 할 일 → 역할(자료 올리기) → 일정 → 받은 요청 → 올린 자료.
 * **기본으로 펼치는 건 `내 할 일` 하나**다 (홈과 같은 규칙 — 나머지는 머리글
 * 배지로 충분하다).
 */

interface FileRow {
  id: string;
  file_name: string;
  file_url: string;
  created_at: string;
  where: string;
  href: string;
}

export default function MyWorkPage() {
  const { session, isAdmin } = useSession();
  const meId = session?.id ?? '';
  const toast = useToast();

  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [tree, setTree] = useState<ReturnType<typeof buildOrg>>([]);
  const [myDeptIds, setMyDeptIds] = useState<string[]>([]);
  const [collabs, setCollabs] = useState<CollabRequest[]>([]);
  const [deptNames, setDeptNames] = useState<Record<string, string>>({});
  const [entries, setEntries] = useState<ReturnType<typeof buildEntries>>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  /** 역할별 자료 개수 — 줄에 배지로 보여준다 (내 것만이 아니라 그 역할에 쌓인 전부) */
  const [fileCount, setFileCount] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const [actionErr, setActionErr] = useState('');

  /* 역할 시트 */
  const [openDuty, setOpenDuty] = useState<DutyRef | null>(null);
  /* 새 업무 시트 — 담당자는 늘 나다. 남에게 나눠주는 건 원장의 `업무배분` 화면이 한다 */
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDue, setNewDue] = useState('');
  const [saving, setSaving] = useState(false);

  const today = todayStr();
  /** 이번 주 = 오늘부터 7일. 그 뒤 것까지 실으면 '이번 주' 가 아니다 */
  const weekEnd = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return toISODate(d);
  }, []);

  const load = useCallback(async () => {
    if (!meId) return;
    setError('');
    try {
      const [taskRes, deptRes, grpRes, dutyRes, helperRes, collabRes, schedRes, smRes, appRes, revRes, dfRes, pfRes, dcRes] =
        await Promise.all([
          supabase.from('tasks').select('*').eq('assignee_id', meId),
          supabase.from('departments').select('*').order('sort_order'),
          supabase.from('duty_groups').select('*').order('sort_order'),
          supabase.from('duties').select('*').order('sort_order'),
          supabase.from('duty_helpers').select('*'),
          supabase.from('collab_requests').select('*').neq('status', 'done'),
          supabase.from('schedules').select('*').gte('date', today).lte('date', weekEnd),
          supabase.from('schedule_members').select('*'),
          supabase.from('apps').select('*').not('due_date', 'is', null),
          supabase.from('app_reviewers').select('*'),
          supabase
            .from('duty_files')
            .select('*')
            .eq('member_id', meId)
            .order('created_at', { ascending: false })
            .limit(10),
          supabase
            .from('plan_files')
            .select('*')
            .eq('member_id', meId)
            .order('created_at', { ascending: false })
            .limit(10),
          supabase.from('duty_files').select('duty_id'),
        ]);

      setTasks((taskRes.data ?? []) as Task[]);

      /* ---- 부서업무 트리 + 내 부서 ------------------------------------- */
      const depts = (deptRes.data ?? []) as Department[];
      const groups = (grpRes.data ?? []) as DutyGroup[];
      const duties = (dutyRes.data ?? []) as Duty[];
      const helpers = (helperRes.data ?? []) as DutyHelper[];
      const built = buildOrg(depts, groups, duties, helpers);
      setTree(built);
      setDeptNames(Object.fromEntries(depts.map((d) => [d.id, d.name])));

      /* **내 부서 = 내가 팀장인 부서.**
         역할에 사람을 안 붙이기로 했으니(부서의 역할은 그 부서 팀장이 도맡는다)
         소속도 팀장으로만 정해진다. 예전엔 주담당·부담당으로도 파생했는데,
         그러면 한 사람이 여러 부서에 걸쳐 **이 화면이 5화면(4148px)까지 늘어났다.**
         새 소속 표는 여전히 안 만든다 — `departments.head_id` 를 그대로 쓴다 */
      const mine = new Set(depts.filter((d) => d.head_id === meId).map((d) => d.id));
      const myDepts = [...mine];
      setMyDeptIds(myDepts);

      const counted: Record<string, number> = {};
      for (const r of (dcRes.data ?? []) as { duty_id: string }[]) {
        counted[r.duty_id] = (counted[r.duty_id] ?? 0) + 1;
      }
      setFileCount(counted);

      /* ---- 받은 요청 --------------------------------------------------- */
      const reqs = (collabRes.data ?? []) as CollabRequest[];
      /* **받은 것만이 아니라 보낸 것도** 싣는다 — 역할에 사람을 안 붙이기로 한 대신
         "누구와 협업 중인지" 가 보여야 한다고 정했다. 보낸 쪽이 안 보이면 재촉도 못 한다 */
      setCollabs(reqs.filter((r) => mine.has(r.to_dept_id) || mine.has(r.from_dept_id)));

      /* ---- 이번 주 일정 (일정 화면과 같은 계산을 쓴다) ------------------- */
      const apps = (appRes.data ?? []) as AppRow[];
      const reviewers: Record<string, string[]> = {};
      for (const r of (revRes.data ?? []) as { app_id: string; member_id: string }[]) {
        (reviewers[r.app_id] ??= []).push(r.member_id);
      }
      const attendees: Record<string, string[]> = {};
      for (const r of (smRes.data ?? []) as { schedule_id: string; member_id: string }[]) {
        (attendees[r.schedule_id] ??= []).push(r.member_id);
      }
      const nameOf = Object.fromEntries(depts.map((d) => [d.id, d.name]));
      const titleOf = Object.fromEntries(apps.map((a) => [a.id, a.title_ko]));
      const all = buildEntries({
        apps,
        reviewers,
        collabs: reqs,
        deptName: (id) => nameOf[id] ?? '부서',
        schedules: (schedRes.data ?? []) as Schedule[],
        attendees,
        appTitle: (id) => titleOf[id] ?? '',
      });
      const mineOnly = filterEntries(all, 'mine', { memberIds: [meId], deptIds: myDepts });
      setEntries(sortEntries(mineOnly.filter((e) => e.date >= today && e.date <= weekEnd)));

      /* ---- 내가 올린 자료 ---------------------------------------------- */
      const dutyName = new Map(duties.map((d) => [d.id, d.name]));
      const out: FileRow[] = [];
      for (const f of (dfRes.data ?? []) as {
        id: string;
        duty_id: string;
        file_name: string;
        file_url: string;
        created_at: string;
      }[]) {
        out.push({
          id: `duty-${f.id}`,
          file_name: f.file_name,
          file_url: f.file_url,
          created_at: f.created_at,
          where: dutyName.get(f.duty_id) ?? '역할',
          href: '/roles',
        });
      }
      for (const f of (pfRes.data ?? []) as {
        id: string;
        app_id: string;
        file_name: string;
        file_url: string;
        created_at: string;
      }[]) {
        out.push({
          id: `plan-${f.id}`,
          file_name: f.file_name,
          file_url: f.file_url,
          created_at: f.created_at,
          where: titleOf[f.app_id] ?? '프로그램',
          href: `/apps/${f.app_id}`,
        });
      }
      out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      setFiles(out.slice(0, 8));
    } catch (e) {
      setError(friendlyError(e, '내 업무를 불러오지 못했어요.'));
      setTasks([]);
    }
  }, [meId, today, weekEnd]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ------------------------------------------------------------ 할 일 */

  const openTasks = useMemo(
    () => sortTasks((tasks ?? []).filter((t) => t.state !== 'done'), today),
    [tasks, today],
  );
  const doneTasks = useMemo(() => (tasks ?? []).filter((t) => t.state === 'done'), [tasks]);

  const stat = useMemo(
    () => ({
      open: openTasks.length,
      late: openTasks.filter((t) => isOverdue(t, today)).length,
      today: openTasks.filter((t) => t.due_date === today).length,
    }),
    [openTasks, today],
  );

  /** 동그라미를 눌러 그 자리에서 완료. 한 번 더 누르면 되돌아간다 (홈과 같은 동작) */
  const toggleTask = async (id: string) => {
    const cur = (tasks ?? []).find((t) => t.id === id);
    if (!cur) return;
    const next = cur.state === 'done' ? 'todo' : 'done';
    const at = new Date().toISOString();
    const before = tasks;
    setActionErr('');
    setTasks((v) =>
      (v ?? []).map((t) => (t.id === id ? { ...t, state: next, done_at: next === 'done' ? at : null } : t)),
    );
    const { error: e } = await supabase
      .from('tasks')
      .update({ state: next, done_at: next === 'done' ? at : null, updated_at: at })
      .eq('id', id);
    if (e) {
      setTasks(before);
      setActionErr(friendlyError(e, '상태를 바꾸지 못했어요.'));
    }
  };

  const addTask = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setSaving(true);
    setActionErr('');
    try {
      const { data, error: e } = await supabase
        .from('tasks')
        .insert({
          title,
          assignee_id: meId,
          due_date: newDue || null,
          state: 'todo',
          created_by: meId,
        })
        .select()
        .single();
      if (e) throw e;
      logActivity(meId, `업무 등록 — ${title}`, `task:${data.id}`);
      // 내가 나에게 준 일이라 알림은 안 보낸다 — 방금 만든 사람에게 울릴 이유가 없다
      setAddOpen(false);
      setNewTitle('');
      setNewDue('');
      toast.show('업무를 만들었어요.');
      await load();
    } catch (e) {
      setActionErr(friendlyError(e, '업무를 만들지 못했어요.'));
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------------------------------------------ 역할 */

  /** 내 부서의 트리 — 이 화면의 주인공이다 (역할은 부서가 도맡는다) */
  const myDepts = useMemo(
    () => tree.filter((d) => myDeptIds.includes(d.dept.id)),
    [tree, myDeptIds],
  );


  const sortedCollabs = useMemo(() => sortRequests(collabs, today), [collabs, today]);

  if (!session) return null;

  const chip = (label: string, n: number, tone: 'plain' | 'late' | 'today') => (
    <span
      className={`flex-1 rounded-xl border px-2.5 py-2 text-center ${
        n === 0
          ? 'border-neutral-200 bg-surface'
          : tone === 'late'
            ? 'border-red-200 bg-red-50'
            : tone === 'today'
              ? 'border-amber-200 bg-amber-50'
              : 'border-neutral-200 bg-surface'
      }`}
    >
      <span
        className={`block text-[19px] font-black leading-tight ${
          n === 0 ? 'text-neutral-300' : tone === 'late' ? 'text-red-600' : tone === 'today' ? 'text-amber-700' : ''
        }`}
      >
        {n}
      </span>
      <span className="block text-[11px] font-bold text-neutral-500">{label}</span>
    </span>
  );

  const taskRow = (t: Task) => {
    const done = t.state === 'done';
    return (
      <li key={t.id} className="flex items-start gap-2.5 py-2">
        <button
          onClick={() => void toggleTask(t.id)}
          aria-label={done ? '되돌리기' : '완료로 표시'}
          className="tap -my-2 flex w-7 shrink-0 items-center justify-center"
        >
          <span
            className={`grid h-5 w-5 place-items-center rounded-full border-2 transition ${
              done ? 'border-brand bg-brand text-white' : 'border-neutral-300'
            }`}
          >
            {done && <Icon name="check" size={11} strokeWidth={3} />}
          </span>
        </button>
        <span className="min-w-0 flex-1">
          <span className={`block text-[14px] font-bold leading-snug ${done ? 'text-neutral-400 line-through' : ''}`}>
            {t.title}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-neutral-400">
            {t.state === 'doing' && <b className="text-amber-700">하는 중</b>}
            {t.batch_title && <span>{t.batch_title}</span>}
            {t.due_date && (
              <span className={ddayClass(t.due_date)}>
                {korDate(t.due_date)} {ddayLabel(t.due_date)}
              </span>
            )}
          </span>
        </span>
      </li>
    );
  };

  return (
    <div>
      <PageHeader
        title="내 업무"
        subtitle={`${session.name} · ${korDate(today)}`}
        right={
          <button onClick={() => setAddOpen(true)} className="btn-primary h-9 px-3 text-[13px]">
            + 업무
          </button>
        }
      />

      <div className="mx-auto max-w-3xl px-4 py-3.5">
        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} onRetry={() => void load()} />
          </div>
        )}
        {actionErr && (
          <div className="mb-3">
            <ErrorBanner message={actionErr} />
          </div>
        )}

        {tasks === null ? (
          <CardSkeleton rows={3} />
        ) : (
          <div className="flex flex-col gap-2.5">
            {/* 셋만 둔다 — 375px 에서 네 개는 두 줄로 접힌다 (홈 히어로와 같은 규칙) */}
            <div className="flex gap-2">
              {chip('내 할 일', stat.open, 'plain')}
              {chip('기한 지남', stat.late, 'late')}
              {chip('오늘', stat.today, 'today')}
            </div>

            {/* ------------------------------------------------------ 내 부서 */}
            {/* 원장이 말한 구조: *"내 업무를 클릭하면 내 부서의 일을 체계적으로 할 수
                있는 구조가 펼쳐지면 좋겠음"*. 그래서 접지 않고 **펼친 채로** 그린다 —
                중분류 › 역할이 바로 보이고, 역할을 누르면 그 자리에서 자료를 올린다.

                역할에는 **사람을 안 붙인다.** 부서의 역할은 그 부서 팀장이 도맡고,
                손이 더 필요하면 부서협업으로 요청한다 (누구와 협업 중인지는 아래
                `주고받는 일` 에 보인다) */}
            {myDepts.length === 0 ? (
              <section className="card p-3.5">
                <h2 className="text-[14px] font-bold">내 부서</h2>
                <p className="mt-1 text-[12.5px] leading-relaxed text-neutral-400">
                  아직 어느 부서에도 안 묶여 있어요. 원장님이 부서 <b className="text-neutral-500">팀장</b>으로
                  넣어주면 그 부서의 일이 여기 펼쳐집니다.
                </p>
                <Link href="/roles" className="tap -mb-3 mt-1 inline-flex min-h-[44px] items-center text-[12.5px] font-bold text-brand">
                  부서업무 보기 ›
                </Link>
              </section>
            ) : (
              myDepts.map((d) => (
                <section key={d.dept.id} className="card p-3.5">
                  <div className="mb-1.5 flex items-baseline gap-2">
                    <h2 className="text-[15px] font-bold">{d.dept.name}</h2>
                    <span className="text-[11.5px] text-neutral-400">역할 {d.total}</span>
                    <Link
                      href="/roles"
                      className="tap -my-3 ml-auto flex min-h-[44px] items-center px-1 text-[12px] font-bold text-neutral-400"
                    >
                      전체 ›
                    </Link>
                  </div>
                  <p className="mb-2 text-[12px] leading-relaxed text-neutral-400">
                    역할을 누르면 <b className="text-neutral-500">그 자리에서 자료를 올려요.</b> 올린 파일은
                    구글 드라이브 <code className="text-neutral-500">업무분장/{d.dept.name}</code> 에도 들어갑니다.
                  </p>

                  <div className="divide-y divide-neutral-100">
                    {d.groups.map((g) => (
                      <div key={g.group.id} className="py-2 first:pt-0 last:pb-0">
                        <p className="mb-0.5 text-[11px] font-bold tracking-wide text-neutral-400">
                          {g.group.name}
                        </p>
                        <ul>
                          {g.duties.map((n) => {
                            const ref: DutyRef = {
                              duty: n.duty,
                              deptName: d.dept.name,
                              groupName: g.group.name,
                            };
                            const files = fileCount[n.duty.id] ?? 0;
                            return (
                              <li key={n.duty.id} className="flex items-center gap-1">
                                <button
                                  onClick={() => setOpenDuty(ref)}
                                  className="tap flex min-h-[44px] flex-1 items-center gap-2 py-1.5 text-left"
                                >
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[14px] font-bold">{n.duty.name}</span>
                                    {n.duty.note && (
                                      <span className="block truncate text-[11.5px] text-neutral-400">
                                        {n.duty.note}
                                      </span>
                                    )}
                                  </span>
                                  {/* 자료가 있으면 개수를, 없으면 아무것도 안 그린다 —
                                      '0개' 를 63줄에 붙이면 자리만 먹는다 */}
                                  {files > 0 && (
                                    <span className="chip shrink-0 bg-neutral-100 text-neutral-500">
                                      자료 {files}
                                    </span>
                                  )}
                                  <Icon
                                    name="chevronDown"
                                    size={14}
                                    className="-rotate-90 shrink-0 text-neutral-300"
                                  />
                                </button>
                                {/* 바로가기는 버튼 밖 — button 안에 a 를 넣으면 안 되는 중첩이다 */}
                                {n.duty.link && (
                                  <Link
                                    href={n.duty.link}
                                    aria-label={`${n.duty.name} — 이 일로 바로 가기`}
                                    className="tap -my-3 flex min-h-[44px] w-9 shrink-0 items-center justify-center text-brand"
                                  >
                                    <Icon name="external" size={14} />
                                  </Link>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              ))
            )}

            {/* ---------------------------------------------------- 내 할 일 */}
            <Collapsible
              id="mywork.tasks"
              title="내 할 일"
              defaultOpen
              badge={
                stat.open > 0 ? (
                  <span className="chip bg-neutral-100 text-neutral-600">{stat.open}건</span>
                ) : null
              }
            >
              {openTasks.length === 0 ? (
                <EmptyState
                  icon="check"
                  title="맡은 일을 다 끝냈어요"
                  desc="새로 할 일이 생기면 위 `+ 업무` 로 적어두세요."
                />
              ) : (
                <ul className="divide-y divide-neutral-100">{openTasks.map(taskRow)}</ul>
              )}

              {doneTasks.length > 0 && (
                <details className="mt-2 border-t border-neutral-100 pt-2">
                  <summary className="tap -my-2 cursor-pointer py-2 text-[12.5px] font-bold text-neutral-400">
                    끝낸 업무 {doneTasks.length}건
                  </summary>
                  <ul className="divide-y divide-neutral-100">{doneTasks.slice(0, 20).map(taskRow)}</ul>
                </details>
              )}
            </Collapsible>

            {/* ---------------------------------------------------- 이번 주 일정 */}
            <Collapsible
              id="mywork.schedule"
              title="이번 주 일정"
              badge={
                entries.length > 0 ? (
                  <span className="chip bg-neutral-100 text-neutral-600">{entries.length}건</span>
                ) : null
              }
              right={
                <Link href="/schedule" className="tap -my-3 px-1 text-[12px] font-bold text-neutral-400">
                  달력 ›
                </Link>
              }
            >
              {entries.length === 0 ? (
                <EmptyState icon="calendar" title="이번 주는 잡힌 일정이 없어요" />
              ) : (
                <ul className="divide-y divide-neutral-100">
                  {entries.map((e) => (
                    <li key={e.id} className="flex items-start gap-2.5 py-2">
                      <span className="w-[46px] shrink-0 pt-0.5 text-[11.5px] font-bold text-neutral-400">
                        {korDate(e.date)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-bold leading-snug">{e.title}</span>
                        <span className="mt-0.5 block text-[11.5px] text-neutral-400">
                          {e.kind === 'due' ? '마감' : scheduleKindLabel(e.kind)}
                          {e.time ? ` · ${hhmm(e.time)}` : ''}
                          {e.school ? ` · ${e.school}` : ''}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Collapsible>

            {/* ----------------------------------------------------- 받은 요청 */}
            {(sortedCollabs.length > 0 || myDeptIds.length > 0) && (
              <Collapsible
                id="mywork.collab"
                title="주고받는 일"
                badge={
                  sortedCollabs.length > 0 ? (
                    <span className="chip bg-neutral-100 text-neutral-600">{sortedCollabs.length}건</span>
                  ) : null
                }
                right={
                  <Link href="/collab" className="tap -my-3 px-1 text-[12px] font-bold text-neutral-400">
                    전체 ›
                  </Link>
                }
              >
                {sortedCollabs.length === 0 ? (
                  <EmptyState icon="users" title="지금 주고받는 일이 없어요" />
                ) : (
                  <ul className="divide-y divide-neutral-100">
                    {sortedCollabs.map((r) => (
                      <li key={r.id}>
                        <Link href="/collab" className="tap flex items-start gap-2.5 py-2">
                          <span className="min-w-0 flex-1">
                            <span className="block text-[14px] font-bold leading-snug">
                              {r.project || r.body.slice(0, 40)}
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-neutral-400">
                              {/* 누구와 하는 일인지 — 받은 것이면 보낸 부서, 보낸 것이면 받는 부서 */}
                              {myDeptIds.includes(r.to_dept_id) ? (
                                <span>
                                  <b className="text-neutral-500">{deptNames[r.from_dept_id] ?? '부서'}</b> 에서 받음
                                </span>
                              ) : (
                                <span>
                                  <b className="text-neutral-500">{deptNames[r.to_dept_id] ?? '부서'}</b> 에 보냄
                                </span>
                              )}
                              <span>{collabPriorityLabel(r.priority)}</span>
                              {r.due_date && (
                                <span className={ddayClass(r.due_date)}>
                                  {korDate(r.due_date)} {ddayLabel(r.due_date)}
                                </span>
                              )}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Collapsible>
            )}

            {/* -------------------------------------------------- 내가 올린 자료 */}
            {files.length > 0 && (
              <Collapsible
                id="mywork.files"
                title="내가 올린 자료"
                badge={<span className="chip bg-neutral-100 text-neutral-600">{files.length}개</span>}
              >
                <ul className="divide-y divide-neutral-100">
                  {files.map((f) => (
                    <li key={f.id} className="flex items-center gap-2.5 py-2">
                      <Icon name="clip" size={14} className="shrink-0 text-neutral-300" />
                      <span className="min-w-0 flex-1">
                        <a
                          href={f.file_url}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate text-[13.5px] font-bold text-neutral-700 underline"
                        >
                          {f.file_name}
                        </a>
                        <span className="block truncate text-[11.5px] text-neutral-400">
                          {f.where} · {relTime(f.created_at)}
                        </span>
                      </span>
                      <Link
                        href={f.href}
                        className="tap -my-3 shrink-0 px-1 text-[11.5px] font-bold text-neutral-400"
                      >
                        열기 ›
                      </Link>
                    </li>
                  ))}
                </ul>
              </Collapsible>
            )}

            {isAdmin && (
              /* 문장 안에 링크를 그냥 두면 탭 면이 19px 이다. 패딩으로 키우고
                 마진으로 되돌려 **줄 높이는 그대로** 둔다 (일정 화면과 같은 처리) */
              <div className="flex items-center gap-2 px-1">
                <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-neutral-400">
                  남에게 나눠주는 것은 업무배분에서 해요.
                </p>
                <Link
                  href="/task"
                  className="-my-3 flex min-h-[44px] shrink-0 items-center text-[12px] font-bold text-brand"
                >
                  업무배분 ›
                </Link>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 역할 시트 — 부서업무 화면과 **같은 컴포넌트**다. 두 벌이 되면 내용이 갈라진다 */}
      {openDuty && (
        <DutyForm
          open
          onClose={() => setOpenDuty(null)}
          groupId={openDuty.duty.group_id}
          groupLabel={`${openDuty.deptName} › ${openDuty.groupName}`}
          deptName={openDuty.deptName}
          groupName={openDuty.groupName}
          duty={openDuty.duty}
          canDelete={isAdmin}
          onSaved={() => {
            setOpenDuty(null);
            void load();
          }}
        />
      )}

      {/* 새 업무 — 담당자는 늘 나다 */}
      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="새 업무">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[12.5px] font-bold text-neutral-500">무엇을 하나요</label>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="예) 광주중 제안서 초안 쓰기"
              className="field"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-[12.5px] font-bold text-neutral-500">언제까지 (선택)</label>
            <input type="date" value={newDue} onChange={(e) => setNewDue(e.target.value)} className="field" />
          </div>
          <p className="text-[12px] text-neutral-400">담당자는 {session.name} 님으로 들어갑니다.</p>
          <button
            onClick={() => void addTask()}
            disabled={saving || !newTitle.trim()}
            className="btn-primary w-full text-[15px]"
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </Sheet>

      {toast.node}
    </div>
  );
}
