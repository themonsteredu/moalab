import { TASK_STATES, type Task, type TaskState } from './types';

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
