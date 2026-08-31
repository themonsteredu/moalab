import { COLLAB_PRIORITIES, COLLAB_STATES, type CollabRequest, type Department } from './types';

/**
 * 부서 간 협업 요청 계산.
 *
 * 화면 코드에 계산을 흩어놓지 않는다 (task.ts · org.ts 와 같은 자리).
 * `scripts/collab.test.mjs` 가 이 파일을 지킨다.
 *
 * **업무(task.ts)와 축이 다르다.** 저쪽은 *내 할 일이 언제까지인가* 라
 * 급한 순 한 줄이면 됐다. 이쪽은 *우리 부서가 받은 것 / 우리가 보낸 것* 이라
 * **편지함**이 기본 축이다.
 */

/* -------------------------------------------------------------------- 이름표 */

export function collabStatusLabel(s: string): string {
  return COLLAB_STATES.find((x) => x.value === s)?.label ?? '요청';
}

export function collabPriorityLabel(p: string): string {
  return COLLAB_PRIORITIES.find((x) => x.value === p)?.label ?? '보통';
}

/* -------------------------------------------------------------------- 흐름
   영업마케팅 → 기획개발 → 생산운영 → 인사관리, 경영지원은 전 부서 지원.
   순서는 DB(departments.flow_order)에 있다 — 조직이 바뀌면 데이터만 고친다. */

/**
 * 이 부서 다음에 일이 넘어가는 부서.
 *
 * **막지 않고 먼저 보여주기만 한다.** 실제로는 어느 부서로든 보낼 수 있어야 한다 —
 * 흐름은 보통 그렇다는 것이지 규칙이 아니다.
 * 지원 부서(경영지원)는 흐름 밖이라 다음 단계가 없다.
 */
export function nextInFlow(depts: Department[], fromDeptId: string): Department | null {
  const from = depts.find((d) => d.id === fromDeptId);
  if (!from || from.is_support || from.flow_order == null) return null;
  const after = depts
    .filter((d) => !d.is_support && d.flow_order != null && d.flow_order > from.flow_order!)
    .sort((a, b) => a.flow_order! - b.flow_order!);
  return after[0] ?? null;
}

/**
 * 받는 곳 고르는 순서 — **다음 단계가 맨 위**, 그다음 흐름 순, 지원 부서는 뒤.
 * 자기 부서는 아예 뺀다 (DB 제약도 같은 것을 막는다).
 */
export function targetOrder(depts: Department[], fromDeptId: string): Department[] {
  const next = nextInFlow(depts, fromDeptId);
  return depts
    .filter((d) => d.id !== fromDeptId)
    .sort((a, b) => {
      if (next && a.id === next.id) return -1;
      if (next && b.id === next.id) return 1;
      // 지원 부서는 흐름 밖이라 뒤로
      if (a.is_support !== b.is_support) return a.is_support ? 1 : -1;
      const ao = a.flow_order ?? 9999;
      const bo = b.flow_order ?? 9999;
      return ao - bo || a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ko');
    });
}

/* -------------------------------------------------------------------- 정렬
   급한 순서 = 아직 안 끝난 것 → 급함 먼저 → 기한 가까운 순.
   완료를 섞어두면 끝난 요청이 편지함을 채워서 답할 것이 안 보인다
   (업무 목록·검증 완료 보관함과 같은 판단). */

export function isOpenRequest(r: CollabRequest): boolean {
  return r.status !== 'done';
}

/** 기한을 넘겼나 — 완료된 것은 넘겼다고 세지 않는다 */
export function isLate(r: CollabRequest, today: string): boolean {
  return isOpenRequest(r) && !!r.due_date && r.due_date < today;
}

const PRIORITY_RANK: Record<string, number> = { high: 0, normal: 1, low: 2 };

export function sortRequests(list: CollabRequest[], today: string): CollabRequest[] {
  return [...list].sort((a, b) => {
    // 1) 끝난 것은 늘 맨 아래
    const ad = a.status === 'done' ? 1 : 0;
    const bd = b.status === 'done' ? 1 : 0;
    if (ad !== bd) return ad - bd;

    // 2) 기한 지난 것이 맨 위 (오래 지난 것부터)
    const al = isLate(a, today) ? 0 : 1;
    const bl = isLate(b, today) ? 0 : 1;
    if (al !== bl) return al - bl;

    // 3) 급한 것 먼저
    const ap = PRIORITY_RANK[a.priority] ?? 1;
    const bp = PRIORITY_RANK[b.priority] ?? 1;
    if (ap !== bp) return ap - bp;

    // 4) 기한 가까운 순. 기한 없는 것은 뒤로
    if (a.due_date !== b.due_date) {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date < b.due_date ? -1 : 1;
    }
    // 5) 마지막은 새 것부터 — 방금 온 요청이 위에 있어야 눈에 띈다
    return a.created_at < b.created_at ? 1 : -1;
  });
}

/* ------------------------------------------------------------------ 편지함 */

export interface CollabBox {
  /** 우리 부서가 받은 것 */
  received: CollabRequest[];
  /** 우리 부서가 보낸 것 */
  sent: CollabRequest[];
}

/**
 * 내 부서 기준으로 받은 것 / 보낸 것을 가른다.
 *
 * `myDeptIds` 가 비어 있으면(= 어느 부서에도 안 묶인 사람) **둘 다 빈 목록**이다.
 * 지금 담당자가 0명이라 이 경우가 흔하다 — 화면에서 그 사실을 알려줘야 한다.
 */
export function inbox(list: CollabRequest[], myDeptIds: string[], today: string): CollabBox {
  const mine = new Set(myDeptIds);
  return {
    received: sortRequests(list.filter((r) => mine.has(r.to_dept_id)), today),
    sent: sortRequests(list.filter((r) => mine.has(r.from_dept_id)), today),
  };
}

/** 부서별 받은 요청 수 — 아직 안 끝난 것만 센다 */
export function pendingByDept(list: CollabRequest[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of list) {
    if (!isOpenRequest(r)) continue;
    m.set(r.to_dept_id, (m.get(r.to_dept_id) ?? 0) + 1);
  }
  return m;
}

/* ------------------------------------------------------------------- 사람
   "이 요청을 누가 받아야 하나" — 받는 부서의 팀장이다.
   팀장이 없으면 **아무도 못 움직이는 상태**가 되면 안 되니 그때는 전원이다. */

/** 받는 쪽에서 상태를 바꿀 수 있는 사람인가 */
export function canRespond(
  r: CollabRequest,
  depts: Department[],
  meId: string,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true;
  const to = depts.find((d) => d.id === r.to_dept_id);
  if (!to) return false;
  // 팀장이 지정돼 있으면 팀장만. 없으면 막지 않는다 (아무도 못 누르면 요청이 멈춘다)
  return to.head_id ? to.head_id === meId : true;
}

/**
 * 알림을 받을 사람 — 받는 부서 팀장.
 * 팀장이 없으면 **원장에게** 보낸다. 아무에게도 안 가면 요청이 그냥 묻힌다.
 */
export function notifyTargets(
  r: Pick<CollabRequest, 'to_dept_id'>,
  depts: Department[],
  adminIds: string[],
): string[] {
  const to = depts.find((d) => d.id === r.to_dept_id);
  if (to?.head_id) return [to.head_id];
  return adminIds;
}

/** 알림 문구 — 잠금화면에서 한 줄로 읽힌다 */
export function notifyBody(fromName: string, project: string | null, due: string | null): string {
  const head = project ? `${fromName} → ${project}` : fromName;
  return due ? `${head} · ${due}까지` : head;
}
