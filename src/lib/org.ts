import type { Department, Duty, DutyGroup, DutyHelper, MemberPublic } from './types';

/**
 * 부서업무 계산 — 부서 › 중분류 › 소분류 트리와, 그걸 사람 축으로 뒤집은 것.
 *
 * 화면 코드에 계산을 흩어놓지 않는다 (task.ts · cost.ts 와 같은 자리).
 * `scripts/org.test.mjs` 가 이 파일을 지킨다.
 */

/** 소분류 한 줄 + 부담당 */
export interface DutyNode {
  duty: Duty;
  /** 부담당 id. 주담당은 여기서 빠진다 — 같은 사람이 두 번 세어지면 안 된다 */
  helperIds: string[];
}

export interface GroupNode {
  group: DutyGroup;
  duties: DutyNode[];
  /** 주담당이 없는 소분류 수 */
  unassigned: number;
}

export interface DeptNode {
  dept: Department;
  groups: GroupNode[];
  /** 이 부서의 소분류 총 개수 */
  total: number;
  unassigned: number;
}

/**
 * **이 역할을 실제로 맡는 사람.**
 *
 * 주담당(`duties.owner_id`)이 비어 있으면 **그 부서의 팀장**(`departments.head_id`)이
 * 맡는다 — 원장이 부서마다 팀장을 정해뒀으니 역할마다 다시 고르지 않아도 된다.
 * 팀장도 없을 때만 진짜 '미정' 이다.
 */
export function ownerOf(duty: { owner_id: string | null }, deptHeadId: string | null | undefined): string | null {
  return duty.owner_id ?? deptHeadId ?? null;
}

/** 주담당이 따로 지정됐나 (팀장이 자동으로 맡은 것과 구분해서 보여주려고) */
export function isOwnPick(duty: { owner_id: string | null }): boolean {
  return Boolean(duty.owner_id);
}

/** 순서: sort_order → 이름. 원장이 정한 순서를 따르되, 같으면 이름순으로 흔들리지 않게 */
function byOrder<T extends { sort_order: number; name: string }>(a: T, b: T): number {
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ko');
}

/**
 * 세 표를 트리로 묶는다.
 * 부서가 없어진 중분류·중분류가 없어진 소분류는 실릴 자리가 없어 조용히 빠진다
 * (DB 는 cascade 라 실제로 그런 줄이 남지 않는다 — 화면이 죽지 않게 하는 안전장치).
 */
export function buildOrg(
  depts: Department[],
  groups: DutyGroup[],
  duties: Duty[],
  helpers: DutyHelper[],
): DeptNode[] {
  const helpersOf = new Map<string, string[]>();
  for (const h of helpers) {
    const list = helpersOf.get(h.duty_id) ?? [];
    list.push(h.member_id);
    helpersOf.set(h.duty_id, list);
  }

  const dutiesOf = new Map<string, Duty[]>();
  for (const d of duties) {
    const list = dutiesOf.get(d.group_id) ?? [];
    list.push(d);
    dutiesOf.set(d.group_id, list);
  }

  const groupsOf = new Map<string, DutyGroup[]>();
  for (const g of groups) {
    const list = groupsOf.get(g.dept_id) ?? [];
    list.push(g);
    groupsOf.set(g.dept_id, list);
  }

  return [...depts].sort(byOrder).map((dept) => {
    const gs = [...(groupsOf.get(dept.id) ?? [])].sort(byOrder).map((group) => {
      const ds = [...(dutiesOf.get(group.id) ?? [])].sort(byOrder).map((duty) => ({
        duty,
        // 주담당이 부담당 목록에도 들어 있으면 뺀다 — 한 사람이 두 번 세어진다
        helperIds: (helpersOf.get(duty.id) ?? []).filter((m) => m !== duty.owner_id),
      }));
      return {
        group,
        duties: ds,
        // 팀장이 있으면 미정이 아니다 — 그 부서 팀장이 맡는 것으로 본다
        unassigned: ds.filter((d) => !ownerOf(d.duty, dept.head_id)).length,
      };
    });
    return {
      dept,
      groups: gs,
      total: gs.reduce((n, g) => n + g.duties.length, 0),
      unassigned: gs.reduce((n, g) => n + g.unassigned, 0),
    };
  });
}

/** 전체 합계 — 헤더 부제에 그대로 쓴다 */
export function orgTotals(tree: DeptNode[]): { depts: number; duties: number; unassigned: number } {
  return {
    depts: tree.length,
    duties: tree.reduce((n, d) => n + d.total, 0),
    unassigned: tree.reduce((n, d) => n + d.unassigned, 0),
  };
}

/** 사람별 보기에서 한 줄 */
export interface DutyRef {
  duty: Duty;
  deptName: string;
  groupName: string;
}

export interface PersonLoad {
  /** null = 담당자 미정 */
  memberId: string | null;
  name: string;
  /** 주담당인 역할 */
  own: DutyRef[];
  /** 부담당으로 끼어 있는 역할 */
  help: DutyRef[];
}

/**
 * 트리를 사람 축으로 뒤집는다.
 *
 * · **담당자 미정이 늘 맨 위다** — 그게 채워야 할 것이다 (업무 사람별 보기와 같은 규칙)
 * · **역할 0건인 사람도 그린다.** 업무에서는 0건인 사람 칸을 안 그렸는데
 *   여기서는 반대다 — 아무것도 안 맡은 사람이 있다는 것 자체가 봐야 할 정보다
 * · 사람 순서는 멤버 목록 순서를 그대로 따른다 (원장이 정한 sort_order)
 */
export function groupByPerson(tree: DeptNode[], members: MemberPublic[]): PersonLoad[] {
  const own = new Map<string, DutyRef[]>();
  const help = new Map<string, DutyRef[]>();
  const unassigned: DutyRef[] = [];

  for (const d of tree) {
    for (const g of d.groups) {
      for (const node of g.duties) {
        const ref: DutyRef = { duty: node.duty, deptName: d.dept.name, groupName: g.group.name };
        // 주담당이 없으면 그 부서 팀장이 맡는다 (ownerOf 와 같은 규칙)
        const holder = ownerOf(node.duty, d.dept.head_id);
        if (holder) {
          const list = own.get(holder) ?? [];
          list.push(ref);
          own.set(holder, list);
        } else {
          unassigned.push(ref);
        }
        for (const m of node.helperIds) {
          const list = help.get(m) ?? [];
          list.push(ref);
          help.set(m, list);
        }
      }
    }
  }

  const rows: PersonLoad[] = [];
  // 미정이 맨 위 — 0건이면 아예 안 그린다 (다 채워졌는데 빈 칸이 남으면 안 된다)
  if (unassigned.length > 0) {
    rows.push({ memberId: null, name: '담당자 미정', own: unassigned, help: [] });
  }
  for (const m of members) {
    rows.push({
      memberId: m.id,
      name: m.name,
      own: own.get(m.id) ?? [],
      help: help.get(m.id) ?? [],
    });
  }
  return rows;
}

/** 내가 맡은 것만 (주담당 + 부담당). 강사 기본 화면이 이걸 쓴다 */
export function myDuties(tree: DeptNode[], memberId: string | null | undefined): {
  own: DutyRef[];
  help: DutyRef[];
} {
  if (!memberId) return { own: [], help: [] };
  const own: DutyRef[] = [];
  const help: DutyRef[] = [];
  for (const d of tree) {
    for (const g of d.groups) {
      for (const node of g.duties) {
        const ref: DutyRef = { duty: node.duty, deptName: d.dept.name, groupName: g.group.name };
        if (node.duty.owner_id === memberId) own.push(ref);
        else if (node.helperIds.includes(memberId)) help.push(ref);
      }
    }
  }
  return { own, help };
}

/** 검색 — 부서·중분류·소분류·설명 어디에 걸려도 남긴다 */
export function filterOrg(tree: DeptNode[], q: string): DeptNode[] {
  const s = q.trim().toLowerCase();
  if (!s) return tree;
  const hit = (v: string | null | undefined) => Boolean(v && v.toLowerCase().includes(s));

  return tree
    .map((d) => {
      // 부서 이름이 걸리면 그 부서는 통째로 남긴다
      if (hit(d.dept.name)) return d;
      const groups = d.groups
        .map((g) => {
          if (hit(g.group.name)) return g;
          const duties = g.duties.filter((n) => hit(n.duty.name) || hit(n.duty.note));
          return duties.length ? { ...g, duties, unassigned: duties.filter((n) => !n.duty.owner_id).length } : null;
        })
        .filter((g): g is GroupNode => g !== null);
      if (!groups.length) return null;
      return {
        ...d,
        groups,
        total: groups.reduce((n, g) => n + g.duties.length, 0),
        unassigned: groups.reduce((n, g) => n + g.unassigned, 0),
      };
    })
    .filter((d): d is DeptNode => d !== null);
}

/** 다음 sort_order — 새로 추가하면 맨 뒤로 간다 */
export function nextOrder(items: { sort_order: number }[]): number {
  return items.reduce((max, i) => Math.max(max, i.sort_order), 0) + 1;
}

/**
 * 순서 바꾸기 — 위/아래 한 칸.
 * 바뀐 두 줄만 돌려준다 (요청을 두 줄로 끝낸다).
 */
export function swapOrder<T extends { id: string; sort_order: number; name: string }>(
  items: T[],
  id: string,
  dir: -1 | 1,
): { id: string; sort_order: number }[] {
  const sorted = [...items].sort(byOrder);
  const i = sorted.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sorted.length) return [];
  // sort_order 가 같은 값이면 swap 이 아무 일도 안 한다 — 자리 기준으로 다시 매긴다
  return [
    { id: sorted[i].id, sort_order: j },
    { id: sorted[j].id, sort_order: i },
  ];
}
