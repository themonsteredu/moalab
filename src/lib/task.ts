import { TASK_STATES, type Task, type TaskState, type TaskTemplateItem } from './types';

/* ------------------------------------------------------------------ 이름표 */

export function taskStateLabel(s: TaskState | string): string {
  return TASK_STATES.find((x) => x.value === s)?.label ?? '할 일';
}

/* -------------------------------------------------------------------- 날짜
   기한은 'YYYY-MM-DD' 문자열 그대로 비교한다. 지출(expense.ts)이 달을 문자열로
   다루는 것과 같은 이유다 — Date 로 왔다갔다 하면 시간대 때문에 하루씩 샌다. */

/** 브라우저 기준 오늘. **화면에서만** 쓴다 (사용자 폰은 한국 시간이다). */
export function todayStr(): string {
  return localDateStr(new Date());
}

export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 한국 날짜. **서버에서 쓴다.**
 *
 * 서버의 '오늘' 은 한국 날짜가 아니다 (Vercel 은 UTC 로 돈다).
 * 그냥 `new Date().toISOString().slice(0,10)` 을 쓰면 한국 시간 아침 9시 전까지는
 * 어제 날짜가 나와서 **기한 알림이 하루씩 밀린다.**
 */
export function kstDateStr(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' 에서 며칠 뒤(음수면 앞). 월·연 경계와 윤년은 Date 가 알아서 넘긴다. */
export function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const base = new Date(y, (m ?? 1) - 1, d ?? 1);
  base.setDate(base.getDate() + days);
  return localDateStr(base);
}

/* -------------------------------------------------------------------- 정렬
   목록에서 위에 와야 하는 순서 = 지금 급한 순서다.
     지난 것 → 남은 것(가까운 순) → 기한 없는 것 → 완료
   완료를 섞어두면 다 끝난 일이 목록을 채워서 할 일이 안 보인다
   (프로그램 목록의 '검증 완료 보관함' 과 같은 판단). */

/** 아직 살아있는 업무인가 */
export function isOpenTask(t: Task): boolean {
  return t.state !== 'done';
}

/** 기한을 넘겼나 — 완료된 것은 넘겼다고 세지 않는다 */
export function isOverdue(t: Task, today: string): boolean {
  return isOpenTask(t) && !!t.due_date && t.due_date < today;
}

function rank(t: Task, today: string): number {
  if (t.state === 'done') return 3;
  if (!t.due_date) return 2;
  return t.due_date < today ? 0 : 1;
}

export function sortTasks(tasks: Task[], today: string): Task[] {
  return [...tasks].sort((a, b) => {
    const ra = rank(a, today);
    const rb = rank(b, today);
    if (ra !== rb) return ra - rb;
    // 지난 것끼리는 더 오래 지난 것이 위로, 남은 것끼리는 더 가까운 것이 위로 — 둘 다 오름차순이다
    if (a.due_date !== b.due_date) {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date < b.due_date ? -1 : 1;
    }
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.created_at < b.created_at ? -1 : 1;
  });
}

/* -------------------------------------------------------------------- 묶기 */

export interface TaskBuckets {
  overdue: Task[];
  today: Task[];
  soon: Task[];
  later: Task[];
  done: Task[];
}

/**
 * 화면에 머리글을 달아 묶는다. `soon` 은 오늘 다음날부터 7일 안.
 * 기한이 없는 것은 `later` 맨 뒤로 간다 — 없앨 게 아니라 미룰 것이기 때문이다.
 */
export function taskBuckets(tasks: Task[], today: string): TaskBuckets {
  const out: TaskBuckets = { overdue: [], today: [], soon: [], later: [], done: [] };
  const weekEnd = shiftDate(today, 7);
  for (const t of sortTasks(tasks, today)) {
    if (t.state === 'done') out.done.push(t);
    else if (!t.due_date) out.later.push(t);
    else if (t.due_date < today) out.overdue.push(t);
    else if (t.due_date === today) out.today.push(t);
    else if (t.due_date <= weekEnd) out.soon.push(t);
    else out.later.push(t);
  }
  return out;
}

export interface TaskBatch {
  id: string;
  title: string;
  tasks: Task[];
  done: number;
  total: number;
  /** 묶음 안에서 가장 급한 기한 (완료된 건 빼고) */
  nextDue: string | null;
}

/**
 * 한 번에 뿌린 묶음끼리 모은다. 묶음이 없는 낱개 업무는 여기 안 들어온다
 * (낱개까지 가짜 묶음으로 만들면 묶음 목록이 낱개로 뒤덮인다).
 */
export function groupByBatch(tasks: Task[], today: string): TaskBatch[] {
  const map = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.batch_id) continue;
    const list = map.get(t.batch_id) ?? [];
    list.push(t);
    map.set(t.batch_id, list);
  }
  const out: TaskBatch[] = [];
  for (const [id, list] of map) {
    const sorted = sortTasks(list, today);
    const open = sorted.filter(isOpenTask).filter((t) => t.due_date);
    out.push({
      id,
      title: sorted[0]?.batch_title ?? '이름 없는 묶음',
      tasks: sorted,
      done: sorted.filter((t) => t.state === 'done').length,
      total: sorted.length,
      nextDue: open[0]?.due_date ?? null,
    });
  }
  // 안 끝난 묶음이 위로, 그다음 급한 기한 순
  return out.sort((a, b) => {
    const aDone = a.done === a.total;
    const bDone = b.done === b.total;
    if (aDone !== bDone) return aDone ? 1 : -1;
    if (a.nextDue !== b.nextDue) {
      if (!a.nextDue) return 1;
      if (!b.nextDue) return -1;
      return a.nextDue < b.nextDue ? -1 : 1;
    }
    return a.title < b.title ? -1 : 1;
  });
}

/** 사람별로 안 끝난 업무 수 · 기한 지난 수 — 원장 화면의 '누가 밀렸나' */
export interface TaskLoad {
  memberId: string;
  open: number;
  overdue: number;
  doing: number;
}

export function loadByMember(tasks: Task[], memberIds: string[], today: string): TaskLoad[] {
  return memberIds.map((memberId) => {
    const mine = tasks.filter((t) => t.assignee_id === memberId);
    return {
      memberId,
      open: mine.filter(isOpenTask).length,
      overdue: mine.filter((t) => isOverdue(t, today)).length,
      doing: mine.filter((t) => t.state === 'doing').length,
    };
  });
}

/** 담당자가 아직 안 정해진 업무 — 원장이 제일 먼저 채워야 할 것 */
export function unassigned(tasks: Task[]): Task[] {
  return tasks.filter((t) => isOpenTask(t) && !t.assignee_id);
}

/* ---------------------------------------------------------------- 뿌리기
   나눠주는 일은 매번 비슷하다. 템플릿을 한 번 만들어두고 기준일만 정해서 통째로 뿌린다.
   기한은 기준일 ± N일로 계산된다 (수업일이 기준이면 준비는 -5, -2 처럼 앞에 온다).

   뿌린 업무는 그 순간 **사진처럼 굳는다** — 나중에 템플릿을 고쳐도 안 바뀐다.
   그래서 tasks 에 template_id 를 두지 않는다. 지난달에 끝낸 일이 슬그머니
   달라지면 기록이 아니게 된다. */

export interface NewTask {
  title: string;
  detail: string | null;
  assignee_id: string | null;
  due_date: string | null;
  app_id: string | null;
  batch_id: string;
  batch_title: string;
  sort_order: number;
}

/**
 * 템플릿 항목을 기준일에 얹어 업무 목록을 만든다. **저장하지 않는다** —
 * 화면이 이걸 미리보기로 보여주고, 사람이 확인한 뒤에 한 번에 넣는다.
 *
 * `overrides` 는 항목 id → 담당자. 미리보기에서 담당자를 바꾼 것만 담긴다.
 * 값이 빈 문자열이면 '담당자 미정' 으로 일부러 비운 것이다 (기본값으로 되돌리지 않는다).
 */
export function applyTemplate(
  items: TaskTemplateItem[],
  anchor: string,
  overrides: Record<string, string>,
  batch: { id: string; title: string; appId?: string | null },
): NewTask[] {
  return [...items]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((it, i) => ({
      title: it.title,
      detail: it.detail,
      assignee_id:
        it.id in overrides ? overrides[it.id] || null : (it.default_assignee_id ?? null),
      due_date: anchor ? shiftDate(anchor, it.day_offset) : null,
      app_id: batch.appId ?? null,
      batch_id: batch.id,
      batch_title: batch.title,
      sort_order: i,
    }));
}

/**
 * 뿌린 뒤 누구에게 몇 통을 보낼지.
 *
 * **사람당 한 통이다.** 8건을 뿌렸는데 8통이 가면 그날로 알림을 꺼버린다.
 * 담당자가 없는 줄은 보낼 곳이 없으니 빠진다.
 */
export interface SpreadNotice {
  memberId: string;
  count: number;
  /** 그 사람 몫 중 가장 빠른 기한 */
  firstDue: string | null;
}

export function spreadNotices(tasks: NewTask[]): SpreadNotice[] {
  const map = new Map<string, string[]>();
  for (const t of tasks) {
    if (!t.assignee_id) continue;
    const list = map.get(t.assignee_id) ?? [];
    if (t.due_date) list.push(t.due_date);
    map.set(t.assignee_id, list);
  }
  return [...map]
    .map(([memberId, dues]) => ({
      memberId,
      count: tasks.filter((t) => t.assignee_id === memberId).length,
      firstDue: dues.length > 0 ? [...dues].sort()[0] : null,
    }))
    .sort((a, b) => (a.memberId < b.memberId ? -1 : 1));
}

/**
 * 묶음 전체를 N일 미룬다. 기한이 없는 줄은 미룰 것도 없어서 건드리지 않는다.
 * 끝난 업무도 그대로 둔다 — 지나간 기록의 날짜를 바꿀 이유가 없다.
 */
export function postponed(tasks: Task[], days: number): { id: string; due_date: string }[] {
  return tasks
    .filter((t) => t.due_date && isOpenTask(t))
    .map((t) => ({ id: t.id, due_date: shiftDate(t.due_date as string, days) }));
}

/* ------------------------------------------------------------- 기한 알림
   매일 아침 한 번, 오늘·내일 마감을 **담당자별로 묶어 그 사람에게만** 보낸다.

   Vercel 무료 플랜은 cron 이 하루 1회라 "전날 저녁 + 당일 아침" 두 번을 못 쓴다.
   그래서 아침 한 통에 '오늘 마감 N건 · 내일 마감 M건' 을 같이 담는다 —
   통수도 줄어서 이쪽이 오히려 낫다.

   ※ 여기 쓰는 '오늘' 은 반드시 kstDateStr() 로 만든 한국 날짜여야 한다. */

export interface RemindGroup {
  memberId: string;
  today: Task[];
  tomorrow: Task[];
}

/**
 * 알림을 보낼 대상을 사람별로 묶는다.
 *
 * 빼는 것:
 *   · 끝난 업무 (지나간 일로 울릴 이유가 없다)
 *   · 담당자 없는 업무 (보낼 곳이 없다)
 *   · 오늘 이미 보낸 업무 (`reminded_on`) — cron 이 두 번 돌아도 한 통이다
 */
export function remindTargets(tasks: Task[], today: string, tomorrow: string): RemindGroup[] {
  const map = new Map<string, RemindGroup>();
  for (const t of tasks) {
    if (t.state === 'done' || !t.assignee_id || !t.due_date) continue;
    if (t.reminded_on === today) continue;
    const when = t.due_date === today ? 'today' : t.due_date === tomorrow ? 'tomorrow' : null;
    if (!when) continue;
    const g = map.get(t.assignee_id) ?? { memberId: t.assignee_id, today: [], tomorrow: [] };
    g[when].push(t);
    map.set(t.assignee_id, g);
  }
  return [...map.values()].sort((a, b) => (a.memberId < b.memberId ? -1 : 1));
}

/** 잠금화면에서 한눈에 보이는 제목 — 오늘 것이 있으면 오늘을 앞세운다 */
export function remindTitle(g: RemindGroup): string {
  return g.today.length > 0 ? `오늘 마감 ${g.today.length}건` : `내일 마감 ${g.tomorrow.length}건`;
}

/** 본문 — 몇 건인지와 첫 업무 이름 */
export function remindBody(g: RemindGroup): string {
  const parts: string[] = [];
  if (g.today.length > 0) parts.push(`오늘 ${g.today.length}건`);
  if (g.tomorrow.length > 0) parts.push(`내일 ${g.tomorrow.length}건`);
  const all = [...g.today, ...g.tomorrow];
  const rest = all.length - 1;
  return `${parts.join(' · ')} — ${all[0]?.title ?? ''}${rest > 0 ? ` 외 ${rest}건` : ''}`;
}
