'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { logActivity } from '@/lib/log';
import { sendPush } from '@/lib/push';
import { ddayClass, ddayLabel, korDate } from '@/lib/format';
import {
  groupByBatch,
  groupByPerson,
  isOverdue,
  loadByMember,
  postponed,
  taskBuckets,
  todayStr,
  unassigned,
  type TaskBatch,
  type TaskBuckets,
} from '@/lib/task';
import { TaskTemplateManager } from '@/components/TaskTemplateManager';
import { TaskSpread } from '@/components/TaskSpread';
import { TaskDictate } from '@/components/TaskDictate';
import { TaskAssign } from '@/components/TaskAssign';
import { PageHeader } from '@/components/PageHeader';
import { Avatar } from '@/components/Brand';
import { Icon } from '@/components/Icon';
import { CardSkeleton, ConfirmDialog, EmptyState, ErrorBanner, Sheet, useToast } from '@/components/ui';
import { TASK_STATES, type Task, type TaskState } from '@/lib/types';

type View = 'me' | 'team';

/**
 * 같은 목록을 어떻게 묶어서 볼지.
 *
 * `due`  급한 순 — *언제까지* 가 궁금할 때 (기한 지남 → 오늘 → 이번 주 → 나중에)
 * `who`  사람별 — *누가 뭘 맡았나* 가 궁금할 때. 원장이 실제로 하는 일은 나누는
 *        것이라, 나눈 결과가 사람 단위로 보여야 한다. 담당자 미정이 늘 맨 위다.
 */
type GroupBy = 'due' | 'who';

interface AppLite {
  id: string;
  title_ko: string;
}

const BUCKETS: { key: keyof TaskBuckets; label: string; tone: string }[] = [
  { key: 'overdue', label: '기한 지남', tone: 'text-red-700' },
  { key: 'today', label: '오늘', tone: 'text-orange-700' },
  { key: 'soon', label: '이번 주', tone: 'text-neutral-600' },
  { key: 'later', label: '나중에', tone: 'text-neutral-500' },
];

/**
 * 업무 — 원장이 쪼개서 나눠주고, 각자 자기 것을 끝낸다.
 *
 * 강사는 '내 업무'만 본다. 원장은 '사람별'로 누가 밀렸는지 한 판으로 본다.
 * 상태는 담당자가 직접 누른다 (프로그램 상태처럼 계산할 하위 데이터가 없다).
 */
export default function TaskPage() {
  const { session, isAdmin } = useSession();
  const { members } = useMembers();
  const toast = useToast();

  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [apps, setApps] = useState<AppLite[]>([]);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>('me');
  /* 고른 보기를 기기에 기억한다 — 원장은 거의 늘 '사람별' 로 본다 */
  const [groupBy, setGroupBy] = useState<GroupBy>('due');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [appId, setAppId] = useState('');
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Task | null>(null);

  // 체크리스트 (원장만)
  const [tplOpen, setTplOpen] = useState(false);
  const [spreadOpen, setSpreadOpen] = useState(false);
  const [openBatch, setOpenBatch] = useState<TaskBatch | null>(null);
  const [pushDays, setPushDays] = useState('7');
  const [killBatch, setKillBatch] = useState<TaskBatch | null>(null);
  const [dictateOpen, setDictateOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const meId = session?.id ?? '';
  const today = todayStr();

  const load = useCallback(async () => {
    setError('');
    try {
      const [tRes, aRes] = await Promise.all([
        supabase.from('tasks').select('*'),
        supabase.from('apps').select('id,title_ko').eq('archived', false).order('title_ko'),
      ]);
      if (tRes.error) throw tRes.error;
      setTasks((tRes.data ?? []) as Task[]);
      setApps((aRes.data ?? []) as AppLite[]);
    } catch (e) {
      setError(friendlyError(e, '업무를 불러오지 못했어요.'));
      setTasks([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const saved = localStorage.getItem('moalab.task.group');
    if (saved === 'who' || saved === 'due') setGroupBy(saved);
  }, []);

  /* 원장은 나눠주는 쪽이라 자기 '내 업무' 가 비어 있는 날이 많다. 그런데 거기서
     시작하면 담당자 미정 5건이 있어도 **빈 화면**을 보게 된다 (홈에서 원장은
     전체 현황부터 보는 것과 같은 판단). 강사는 토글 자체가 없어 늘 '내 업무' 다. */
  useEffect(() => {
    if (isAdmin) setView('team');
  }, [isAdmin]);

  const pickGroup = (g: GroupBy) => {
    setGroupBy(g);
    localStorage.setItem('moalab.task.group', g);
  };

  // tasks ?? [] 를 그대로 쓰면 매 렌더마다 새 배열이라 아래 useMemo 가 전부 헛돈다
  const all = useMemo(() => tasks ?? [], [tasks]);
  const mine = useMemo(() => all.filter((t) => t.assignee_id === meId), [all, meId]);
  const myOpen = mine.filter((t) => t.state !== 'done').length;
  const myLate = mine.filter((t) => isOverdue(t, today)).length;
  const noOwner = useMemo(() => unassigned(all), [all]);
  const loads = useMemo(
    () => loadByMember(all, members.map((m) => m.id), today),
    [all, members, today],
  );
  const batches = useMemo(() => groupByBatch(all, today), [all, today]);

  const nameOf = useCallback(
    (id: string | null) => (id ? (members.find((m) => m.id === id)?.name ?? '(없는 멤버)') : '담당자 미정'),
    [members],
  );
  const appTitle = useCallback(
    (id: string | null) => (id ? (apps.find((a) => a.id === id)?.title_ko ?? '') : ''),
    [apps],
  );

  /** 원장이 아니면 남의 업무는 못 고친다. 내 업무·내가 만든 업무는 고칠 수 있다 */
  const canEdit = (t: Task) => isAdmin || t.created_by === meId || t.assignee_id === meId;

  /* ------------------------------------------------------------ 상태 토글 */

  const setState = async (t: Task, state: TaskState) => {
    if (t.state === state) return;
    const before = tasks;
    const now = new Date().toISOString();
    // 눌러서 바로 반영 — 상태 하나짜리 토글이라 저장 버튼을 따로 두면 오히려 헷갈린다
    setTasks((v) =>
      (v ?? []).map((x) =>
        x.id === t.id ? { ...x, state, done_at: state === 'done' ? now : null, updated_at: now } : x,
      ),
    );

    const { error: e } = await supabase
      .from('tasks')
      .update({ state, done_at: state === 'done' ? now : null, updated_at: now })
      .eq('id', t.id);
    if (e) {
      setTasks(before);
      setError(friendlyError(e, '상태를 바꾸지 못했어요.'));
      return;
    }
    const label = TASK_STATES.find((s) => s.value === state)?.label ?? state;
    logActivity(session?.id, `업무 ${t.title} — ${label}`, `task:${t.id}`);
  };

  /* ---------------------------------------------------------------- 폼 */

  const startNew = () => {
    setEditing(null);
    setTitle('');
    setDetail('');
    // 강사가 만들면 보통 자기 일이다. 원장은 나눠주는 쪽이라 비워둔다
    setAssignee(isAdmin ? '' : meId);
    setDue('');
    setAppId('');
    setFormErr('');
    setFormOpen(true);
  };

  const startEdit = (t: Task) => {
    setEditing(t);
    setTitle(t.title);
    setDetail(t.detail ?? '');
    setAssignee(t.assignee_id ?? '');
    setDue(t.due_date ?? '');
    setAppId(t.app_id ?? '');
    setFormErr('');
    setFormOpen(true);
  };

  const save = async () => {
    setFormErr('');
    const name = title.trim();
    if (!name) return setFormErr('무엇을 할 일인지 적어주세요.');

    setBusy(true);
    try {
      const payload = {
        title: name,
        detail: detail.trim() || null,
        assignee_id: assignee || null,
        due_date: due || null,
        app_id: appId || null,
        updated_at: new Date().toISOString(),
      };

      if (editing) {
        const { error: e } = await supabase.from('tasks').update(payload).eq('id', editing.id);
        if (e) throw e;
        logActivity(session?.id, `업무 수정 — ${name}`, `task:${editing.id}`);
        // 담당자가 바뀌었을 때만 알린다 (제목만 고쳤는데 울리면 성가시다)
        if (assignee && assignee !== editing.assignee_id) notifyAssigned(editing.id, name, assignee, due);
        toast.show('고쳤어요.');
      } else {
        const { data, error: e } = await supabase
          .from('tasks')
          .insert({ ...payload, created_by: meId || null })
          .select()
          .single();
        if (e) throw e;
        logActivity(session?.id, `업무 등록 — ${name}`, `task:${data.id}`);
        if (assignee) notifyAssigned(data.id as string, name, assignee, due);
        toast.show('업무를 만들었어요.');
      }
      setFormOpen(false);
      await load();
    } catch (e) {
      setFormErr(friendlyError(e, '저장이 안 됐어요. 다시 눌러주세요.'));
    } finally {
      setBusy(false);
    }
  };

  /** 배정받은 사람에게만 울린다. 자기 자신에게 배정하면 fromId 로 걸러진다 */
  const notifyAssigned = (id: string, name: string, memberId: string, dueDate: string) => {
    sendPush({
      title: '새 업무가 왔어요',
      body: dueDate ? `${name} — ${korDate(dueDate)}까지` : name,
      url: '/task',
      tag: `task-${id}`,
      memberIds: [memberId],
      fromId: meId || undefined,
    });
  };

  /* ------------------------------------------------------------ 묶음 조작
     한 번에 뿌린 것은 한 번에 물릴 수 있어야 한다. 잘못 뿌렸을 때
     여덟 번 지우게 하면 그게 더 큰 사고가 된다. */

  /** 묶음 전체를 N일 미룬다. 기한이 없거나 끝난 줄은 건드리지 않는다 */
  const postponeBatch = async (b: TaskBatch, days: number) => {
    const moves = postponed(b.tasks, days);
    if (moves.length === 0) {
      toast.show('미룰 기한이 없어요.');
      return;
    }
    const now = new Date().toISOString();
    for (const m of moves) {
      const { error: e } = await supabase
        .from('tasks')
        .update({ due_date: m.due_date, updated_at: now })
        .eq('id', m.id);
      if (e) {
        setError(friendlyError(e, '기한을 미루지 못했어요.'));
        await load();
        return;
      }
    }
    logActivity(session?.id, `묶음 ${days}일 미룸 — ${b.title}`, 'tasks');
    setOpenBatch(null);
    toast.show(`${moves.length}건을 ${days}일 미뤘어요.`);
    await load();
  };

  const removeBatch = async () => {
    if (!killBatch) return;
    const { error: e } = await supabase.from('tasks').delete().eq('batch_id', killBatch.id);
    if (e) {
      setError(friendlyError(e, '묶음을 지우지 못했어요.'));
      setKillBatch(null);
      return;
    }
    logActivity(session?.id, `묶음 삭제 — ${killBatch.title} (${killBatch.total}건)`, 'tasks');
    const n = killBatch.total;
    setKillBatch(null);
    setOpenBatch(null);
    toast.show(`${n}건을 지웠어요.`);
    await load();
  };

  const remove = async () => {
    if (!deleting) return;
    const { error: e } = await supabase.from('tasks').delete().eq('id', deleting.id);
    if (e) {
      setError(friendlyError(e, '지우지 못했어요.'));
      setDeleting(null);
      return;
    }
    logActivity(session?.id, `업무 삭제 — ${deleting.title}`, `task:${deleting.id}`);
    setDeleting(null);
    toast.show('지웠어요.');
    await load();
  };

  /* -------------------------------------------------------------- 렌더 */

  const listed = view === 'me' ? mine : all;
  const buckets = taskBuckets(listed, today);
  const hasAny = listed.length > 0;
  /* '내 업무' 는 전부 내 것이라 사람별로 나눌 게 없다 — 그럴 땐 급한 순만 쓴다 */
  const grouping: GroupBy = view === 'me' ? 'due' : groupBy;
  const people = groupByPerson(
    listed.filter((t) => t.state !== 'done'),
    members.map((m) => m.id),
    today,
  );

  return (
    <div>
      <PageHeader
        title="업무"
        subtitle={
          tasks === null
            ? '불러오는 중…'
            : view === 'me'
              ? `내 업무 ${myOpen}건${myLate > 0 ? ` · 기한 지남 ${myLate}` : ''}`
              : `전체 ${all.filter((t) => t.state !== 'done').length}건${noOwner.length > 0 ? ` · 담당자 미정 ${noOwner.length}` : ''}`
        }
        /* 아이콘만 있는 버튼을 헤더에 늘어놓으면 뭔지 알 수 없고, 부제까지 잘린다.
           나머지는 아래 '만들기' 줄로 내려 라벨을 붙였다 */
        right={
          <button onClick={startNew} className="btn-primary px-3 text-[13.5px]">
            <Icon name="plus" size={15} />
            업무 추가
          </button>
        }
      />

      <div className="px-4 pb-8 pt-3 lg:px-0">
        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} onRetry={() => void load()} />
          </div>
        )}

        {isAdmin && (
          <div className="mb-3 flex gap-1.5">
            {(['me', 'team'] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`tap flex-1 rounded-xl border text-[13px] font-bold transition ${
                  view === v ? 'pick-on' : 'border-neutral-200 bg-surface text-neutral-500'
                }`}
              >
                {v === 'me' ? '내 업무' : '전체'}
              </button>
            ))}
          </div>
        )}

        {/* 원장이 나눠주는 세 가지 길. 아이콘만 두면 뭔지 몰라서 라벨을 붙였다 */}
        {isAdmin && (
          <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
            {/* 나눠주기가 맨 앞이다 — 만드는 것보다 나누는 걸 더 자주 한다 */}
            <button
              onClick={() => setAssignOpen(true)}
              className={`tap shrink-0 gap-1.5 rounded-full border px-3.5 text-[13px] font-bold ${
                noOwner.length > 0
                  ? 'border-brand bg-brand-50 text-brand'
                  : 'border-neutral-300 bg-surface text-neutral-600'
              }`}
            >
              <Icon name="user" size={13} />
              나눠주기
              {noOwner.length > 0 && <span className="chip bg-brand text-white">{noOwner.length}</span>}
            </button>
            <button
              onClick={() => setDictateOpen(true)}
              className="tap shrink-0 gap-1.5 rounded-full border border-neutral-300 bg-surface px-3.5 text-[13px] font-bold text-neutral-600"
            >
              <Icon name="megaphone" size={13} />
              말로 넣기
            </button>
            <button
              onClick={() => setSpreadOpen(true)}
              className="tap shrink-0 gap-1.5 rounded-full border border-neutral-300 bg-surface px-3.5 text-[13px] font-bold text-neutral-600"
            >
              <Icon name="list" size={13} />
              체크리스트로 뿌리기
            </button>
            <button
              onClick={() => setTplOpen(true)}
              className="tap shrink-0 gap-1.5 rounded-full border border-neutral-300 bg-surface px-3.5 text-[13px] font-bold text-neutral-400"
            >
              <Icon name="wrench" size={13} />
              체크리스트 관리
            </button>
          </div>
        )}

        {/* 원장 전용 — 누가 얼마나 들고 있나.
            '사람별' 로 보고 있을 땐 **안 그린다.** 바로 아래에 같은 것이 사람 단위로
            펼쳐져 있어서, 같은 숫자를 두 번 읽게 하고 300px 을 그냥 먹는다 */}
        {isAdmin && view === 'team' && grouping === 'due' && tasks !== null && all.length > 0 && (
          <section className="card mb-3 p-3">
            <p className="mb-2 text-[12px] font-bold text-neutral-400">사람별 남은 업무</p>
            <ul className="space-y-1.5">
              {loads.map((l) => {
                const m = members.find((x) => x.id === l.memberId);
                if (!m) return null;
                return (
                  <li key={l.memberId} className="flex items-center gap-2">
                    <Avatar name={m.name} size={20} />
                    <span className="w-14 shrink-0 truncate text-[12.5px] font-semibold text-neutral-600">
                      {m.name}
                    </span>
                    <span className="flex-1 text-[12.5px] text-neutral-500">
                      {l.open === 0 ? '없어요' : `${l.open}건${l.doing > 0 ? ` · 하는 중 ${l.doing}` : ''}`}
                    </span>
                    {l.overdue > 0 && (
                      <span className="chip shrink-0 bg-red-100 text-red-700">지남 {l.overdue}</span>
                    )}
                  </li>
                );
              })}
            </ul>
            {noOwner.length > 0 && (
              /* 짚어만 주고 끝내면 원장이 다시 찾아 헤맨다 — 여기서 바로 나눌 수 있게 */
              <button
                onClick={() => setAssignOpen(true)}
                className="-mb-1 mt-2 flex min-h-[44px] w-full items-center gap-1.5 border-t border-neutral-200 pt-2 text-left text-[12.5px] font-semibold text-brand"
              >
                담당자를 아직 안 정한 업무가 {noOwner.length}건 있어요.
                <span className="ml-auto shrink-0 text-[12px] text-neutral-400">나눠주기 →</span>
              </button>
            )}
          </section>
        )}

        {/* 묶음 — 체크리스트로 뿌린 것이 있을 때만 그린다 (빈 섹션은 안 그린다) */}
        {view === 'team' && batches.length > 0 && (
          <section className="card mb-3 p-3">
            <p className="mb-2 text-[12px] font-bold text-neutral-400">묶음</p>
            <ul className="space-y-1">
              {batches.map((b) => (
                <li key={b.id}>
                  <button
                    onClick={() => setOpenBatch(b)}
                    className="tap flex w-full items-center gap-2 text-left text-[13px]"
                  >
                    <span className="min-w-0 flex-1 truncate font-semibold text-neutral-700">{b.title}</span>
                    {b.nextDue && (
                      <span className={`chip shrink-0 ${ddayClass(b.nextDue)}`}>{ddayLabel(b.nextDue)}</span>
                    )}
                    <span
                      className={`chip shrink-0 ${b.done === b.total ? 'bg-green-100 text-green-800' : 'bg-neutral-100 text-neutral-500'}`}
                    >
                      {b.done}/{b.total}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {tasks === null ? (
          <CardSkeleton rows={4} />
        ) : !hasAny ? (
          <EmptyState
            icon="list"
            title={view === 'me' ? '지금 맡은 업무가 없어요' : '등록된 업무가 없어요'}
            desc="오른쪽 위 “업무 추가” 로 할 일을 하나 만들어보세요. 담당자와 기한을 같이 정하면 그 사람에게 알림이 갑니다."
          />
        ) : (
          <div className="space-y-4">
            {/* 급한 순 ↔ 사람별. '내 업무' 는 전부 내 것이라 고를 게 없어서 안 그린다 */}
            {view === 'team' && (
              <div className="-mt-0.5 flex items-center gap-1.5">
                {(
                  [
                    ['due', '급한 순'],
                    ['who', '사람별'],
                  ] as [GroupBy, string][]
                ).map(([g, label]) => (
                  <button
                    key={g}
                    onClick={() => pickGroup(g)}
                    aria-pressed={groupBy === g}
                    className={`-my-2 flex min-h-[44px] items-center rounded-full px-3 text-[12.5px] font-bold transition ${
                      groupBy === g ? 'bg-neutral-100 text-neutral-700' : 'text-neutral-400'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {grouping === 'who'
              ? /* 사람별 — PC 는 두 칸으로 깐다. 다섯 사람을 세로로 쌓으면
                   화면 두세 개가 되는데, 옆으로 놓으면 한 화면에서 판이 보인다 */
                people.length > 0 && (
                  <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
                    {people.map((g) => {
                      const m = g.memberId ? members.find((x) => x.id === g.memberId) : null;
                      const who = g.memberId === null ? '담당자 미정' : (m?.name ?? '(없는 멤버)');
                      return (
                        <section key={g.memberId ?? 'none'}>
                          <div className="mb-1.5 flex items-center gap-1.5">
                            {m ? (
                              <Avatar name={m.name} size={20} />
                            ) : (
                              <Icon
                                name="user"
                                size={14}
                                className={g.memberId === null ? 'text-brand' : 'text-neutral-300'}
                              />
                            )}
                            <span
                              className={`text-[13px] font-bold ${
                                g.memberId === null ? 'text-brand' : 'text-neutral-700'
                              }`}
                            >
                              {who}
                            </span>
                            <span className="text-[12px] text-neutral-400">{g.open}건</span>
                            {g.overdue > 0 && (
                              <span className="chip bg-red-100 text-red-700">지남 {g.overdue}</span>
                            )}
                            {/* 미정 묶음에서 바로 나눌 수 있게 — 여기가 제일 손이 가는 자리다 */}
                            {isAdmin && g.memberId === null && (
                              <button
                                onClick={() => setAssignOpen(true)}
                                className="-my-3 ml-auto flex min-h-[44px] shrink-0 items-center text-[12px] font-bold text-brand"
                              >
                                나눠주기 →
                              </button>
                            )}
                          </div>
                          <ul className="space-y-2">
                            {g.tasks.map((t) => (
                              <TaskCard
                                key={t.id}
                                task={t}
                                who={who}
                                showWho={false}
                                appName={appTitle(t.app_id)}
                                canEdit={canEdit(t)}
                                onState={(s) => void setState(t, s)}
                                onEdit={() => startEdit(t)}
                              />
                            ))}
                          </ul>
                        </section>
                      );
                    })}
                  </div>
                )
              : BUCKETS.map(({ key, label, tone }) => {
                  const list = buckets[key];
                  // 빈 묶음은 아예 그리지 않는다 — "없어요" 카드가 쌓이면 스크롤만 길어진다
                  if (list.length === 0) return null;
                  return (
                    <section key={key}>
                      <p className={`mb-1.5 text-[12px] font-bold ${tone}`}>
                        {label} {list.length}
                      </p>
                      <ul className="space-y-2">
                        {list.map((t) => (
                          <TaskCard
                            key={t.id}
                            task={t}
                            who={nameOf(t.assignee_id)}
                            showWho={view === 'team' || t.assignee_id !== meId}
                            appName={appTitle(t.app_id)}
                            canEdit={canEdit(t)}
                            onState={(s) => void setState(t, s)}
                            onEdit={() => startEdit(t)}
                          />
                        ))}
                      </ul>
                    </section>
                  );
                })}

            {/* 끝난 것은 접어둔다 — 다 끝난 일이 목록을 채우면 할 일이 안 보인다 */}
            {buckets.done.length > 0 && (
              <details className="rounded-xl border border-neutral-200 bg-surface">
                <summary className="tap cursor-pointer list-none px-3.5 text-[13px] font-bold text-neutral-500">
                  끝낸 업무 {buckets.done.length}건
                </summary>
                <ul className="space-y-2 px-3 pb-3">
                  {buckets.done.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      who={nameOf(t.assignee_id)}
                      showWho={view === 'team' || t.assignee_id !== meId}
                      appName={appTitle(t.app_id)}
                      canEdit={canEdit(t)}
                      onState={(s) => void setState(t, s)}
                      onEdit={() => startEdit(t)}
                    />
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      {/* ----------------------------------------------------- 등록 / 수정 */}
      <Sheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? '업무 고치기' : '업무 추가'}
        footer={
          <button onClick={() => void save()} disabled={busy} className="btn-primary w-full">
            {busy ? '저장 중…' : editing ? '고치기' : '만들기'}
          </button>
        }
      >
        <div className="space-y-4">
          {formErr && <ErrorBanner message={formErr} />}

          <div>
            <label className="label" htmlFor="task-title">
              무엇을 할 일인가요
            </label>
            <input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="A초 제안서 초안 쓰기"
              className="field"
            />
          </div>

          <div>
            <span className="label">담당자</span>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setAssignee(m.id === assignee ? '' : m.id)}
                  className={`tap rounded-full border px-3.5 text-[14px] font-semibold transition ${
                    assignee === m.id
                      ? 'pick-on'
                      : 'border-neutral-300 bg-surface text-neutral-600'
                  }`}
                >
                  {m.name}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11.5px] text-neutral-400">
              한 명만 고릅니다. 여럿이 할 일이면 사람마다 한 줄씩 만드세요 — 다 같이 할 일은 아무도 안 합니다.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="task-due">
              기한
            </label>
            <input
              id="task-due"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="field"
            />
          </div>

          <div>
            <label className="label" htmlFor="task-app">
              딸린 프로그램 — 없어도 돼요
            </label>
            <select
              id="task-app"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              className="field"
            >
              <option value="">없음</option>
              {apps.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title_ko}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="task-detail">
              자세히 — 없어도 돼요
            </label>
            <textarea
              id="task-detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={3}
              placeholder="어디까지 하면 끝난 건지 적어두면 다시 물어볼 일이 없어요."
              className="field resize-none"
            />
          </div>

          {/* 삭제는 여기 있다 — 카드마다 버튼을 깔 만큼 자주 쓰는 게 아니다 */}
          {editing && (
            <button
              onClick={() => {
                const t = editing;
                setFormOpen(false);
                setDeleting(t);
              }}
              className="btn-ghost w-full text-red-700"
            >
              이 업무 지우기
            </button>
          )}
        </div>
      </Sheet>

      {/* -------------------------------------------------------- 묶음 다루기 */}
      <Sheet open={openBatch !== null} onClose={() => setOpenBatch(null)} title={openBatch?.title ?? '묶음'}>
        {openBatch && (
          <div className="space-y-4">
            <p className="text-[13px] text-neutral-500">
              {openBatch.total}건 중 <b className="text-neutral-800">{openBatch.done}건</b> 끝났어요.
              {openBatch.nextDue && <> 다음 기한은 {korDate(openBatch.nextDue)}.</>}
            </p>

            <ul className="space-y-1">
              {openBatch.tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-[13px]">
                  <span className="w-14 shrink-0 truncate text-[11.5px] text-neutral-400">
                    {nameOf(t.assignee_id)}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate ${t.state === 'done' ? 'text-neutral-400 line-through' : 'text-neutral-700'}`}
                  >
                    {t.title}
                  </span>
                  {t.due_date && t.state !== 'done' && (
                    <span className={`chip shrink-0 ${ddayClass(t.due_date)}`}>{ddayLabel(t.due_date)}</span>
                  )}
                </li>
              ))}
            </ul>

            {/* 통째로 미루기 — 학교 일정이 밀리면 묶음 전체가 같이 밀린다 */}
            <div className="rounded-xl bg-neutral-100 px-3.5 py-3">
              <p className="label">기한을 통째로 미루기</p>
              <div className="flex gap-2">
                <input
                  value={pushDays}
                  onChange={(e) => setPushDays(e.target.value)}
                  type="number"
                  inputMode="numeric"
                  aria-label="며칠 미룰지"
                  className="field w-24 shrink-0"
                />
                <button
                  onClick={() => void postponeBatch(openBatch, Number(pushDays))}
                  disabled={!Number.isInteger(Number(pushDays)) || Number(pushDays) === 0}
                  className="btn-ghost h-11 flex-1 text-[13.5px]"
                >
                  {Number(pushDays) < 0 ? `${-Number(pushDays)}일 당기기` : `${pushDays}일 미루기`}
                </button>
              </div>
              <p className="mt-1.5 text-[11.5px] text-neutral-400">
                끝난 업무와 기한 없는 업무는 그대로 둡니다.
              </p>
            </div>

            <button onClick={() => setKillBatch(openBatch)} className="btn-ghost w-full text-red-700">
              이 묶음 {openBatch.total}건 통째로 지우기
            </button>
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={killBatch !== null}
        title="묶음을 통째로 지울까요?"
        message={`${killBatch?.title} · ${killBatch?.total}건이 한꺼번에 지워져요. 되돌릴 수 없어요.`}
        onConfirm={() => void removeBatch()}
        onCancel={() => setKillBatch(null)}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="이 업무를 지울까요?"
        message={deleting?.title}
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />

      <TaskTemplateManager open={tplOpen} onClose={() => setTplOpen(false)} onChanged={() => void load()} />

      <TaskDictate
        open={dictateOpen}
        onClose={() => setDictateOpen(false)}
        onMade={(n, t) => {
          toast.show(`${t} — ${n}건을 만들었어요.`);
          setView('team');
          void load();
        }}
      />

      <TaskSpread
        open={spreadOpen}
        onClose={() => setSpreadOpen(false)}
        onSpread={(n, t) => {
          toast.show(`${t} — ${n}건을 만들었어요.`);
          setView('team');
          void load();
        }}
      />

      <TaskAssign
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        tasks={all}
        onAssigned={(n, who) => {
          toast.show(`${n}건을 ${who} 에게 넘겼어요.`);
          setView('team');
          pickGroup('who');
          void load();
        }}
      />

      {toast.node}
    </div>
  );
}

/* ------------------------------------------------------------------ 카드 */

function TaskCard({
  task,
  who,
  showWho,
  appName,
  canEdit,
  onState,
  onEdit,
}: {
  task: Task;
  who: string;
  showWho: boolean;
  appName: string;
  canEdit: boolean;
  onState: (s: TaskState) => void;
  onEdit: () => void;
}) {
  const dday = ddayLabel(task.due_date);
  const done = task.state === 'done';

  /* 끝난 업무에 3버튼을 그대로 두면 두 칸이 아무 의미가 없다 — 되돌리기 하나면 된다 */
  const states = done ? (
    canEdit && (
      <button
        onClick={() => onState('todo')}
        className="tap w-full rounded-lg border border-neutral-200 bg-surface text-[12.5px] font-bold text-neutral-400"
      >
        되돌리기
      </button>
    )
  ) : (
    <div className="flex gap-1.5" role="group" aria-label={`${task.title} 상태`}>
      {TASK_STATES.map((s) => {
        const on = task.state === s.value;
        return (
          <button
            key={s.value}
            onClick={() => onState(s.value)}
            disabled={!canEdit}
            aria-pressed={on}
            aria-label={`${task.title} ${s.label}`}
            /* 44px — 세 개가 나란히 있어서 잘못 누르기 쉽고, 잘못 누르면 바로 저장된다 */
            className={`h-11 flex-1 rounded-lg border text-[12.5px] font-bold transition disabled:opacity-40 ${
              on ? s.on : 'border-neutral-200 bg-surface text-neutral-400'
            }`}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );

  /* PC 에서는 상태 버튼을 제목 **오른쪽**에 붙인다.
     아래로 깔면 버튼 하나가 400px 까지 늘어나고 카드가 137px 이 되는데,
     그런 카드가 다섯 장 쌓이면 회색 벽이 된다. 폰(375px)은 그대로 아래에 —
     옆에 붙이면 제목이 뭉개진다. 갈림길은 `lg:` 하나뿐이다. */
  return (
    <li className="card p-3 lg:flex lg:items-center lg:gap-3">
      <div className="min-w-0 lg:flex-1">
        <div className="flex items-start gap-2">
          <p
            className={`min-w-0 flex-1 text-[14.5px] font-semibold ${done ? 'text-neutral-400 line-through' : 'text-neutral-800'}`}
          >
            {task.title}
          </p>
          {dday && !done && <span className={`chip shrink-0 ${ddayClass(task.due_date)}`}>{dday}</span>}
          {/* 고치기·삭제를 카드마다 한 줄씩 깔면 자리만 먹는다. 자주 쓰는 것도 아니다 */}
          {canEdit && (
            <button
              onClick={onEdit}
              aria-label={`${task.title} 고치기`}
              className="-my-2 -mr-1 flex h-11 w-8 shrink-0 items-center justify-center text-neutral-300 lg:hidden"
            >
              <Icon name="dots" size={16} />
            </button>
          )}
        </div>

        {task.detail && (
          <p className="mt-1 text-[12.5px] leading-relaxed text-neutral-500">{task.detail}</p>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-neutral-400">
          {showWho && (
            <span className={task.assignee_id ? '' : 'text-brand'}>
              <Icon name="user" size={11} className="mr-0.5" />
              {who}
            </span>
          )}
          {task.due_date && <span>{korDate(task.due_date)}</span>}
          {appName && (
            <Link href={`/apps/${task.app_id}`} className="font-semibold text-brand">
              {appName}
            </Link>
          )}
          {task.batch_title && <span>{task.batch_title}</span>}
        </div>
      </div>

      <div className="mt-2 lg:mt-0 lg:w-[264px] lg:shrink-0">{states}</div>

      {canEdit && (
        <button
          onClick={onEdit}
          aria-label={`${task.title} 고치기`}
          className="hidden shrink-0 text-neutral-300 lg:flex lg:h-11 lg:w-7 lg:items-center lg:justify-center"
        >
          <Icon name="dots" size={16} />
        </button>
      )}
    </li>
  );
}
