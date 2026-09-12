'use client';

import Link from 'next/link';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { useDutyCounts } from '@/lib/useDutyCounts';
import { logActivity } from '@/lib/log';
import { PageHeader } from '@/components/PageHeader';
import { Avatar } from '@/components/Brand';
import { Icon } from '@/components/Icon';
import { DutyForm } from '@/components/DutyForm';
import { ROLE_PRINT_PARTS, type RolePrintPart } from '@/lib/print';
import {
  CardSkeleton,
  Collapsible,
  ConfirmDialog,
  EmptyState,
  ErrorBanner,
  Sheet,
  useToast,
} from '@/components/ui';
import {
  buildOrg,
  filterOrg,
  filterRefs,
  groupByPerson,
  groupRefs,
  myDuties,
  nextOrder,
  orgTotals,
  swapOrder,
  type DeptNode,
  type DutyRef,
  type GroupNode,
  ownerOf,
} from '@/lib/org';
import type { Department, Duty, DutyGroup, DutyHelper } from '@/lib/types';

type View = 'dept' | 'person' | 'me';
type TreeDepth = 'departments' | 'groups' | 'duties';

/**
 * 부서업무 — 부서 › 중분류 › 소분류, 그리고 그 역할을 누가 맡나.
 *
 * 업무(/task)와 **축이 다르다.** 저쪽은 *1건 × 담당자 × 기한* 이고 끝나면 지나간다.
 * 이쪽은 기한이 없고 계속 남는 '이 일은 누구 담당' 이다.
 *
 * 보기 세 가지 — 원장은 `부서별`, 강사는 `내 역할` 로 시작한다.
 * (원장은 나누는 쪽이라 자기 역할부터 보면 정작 미정이 안 보인다 — 업무 화면과 같은 판단)
 *
 * **만드는 건 전원, 지우는 건 원장만.**
 *   · 부서·중분류·역할 추가와 수정 → **전원**. 원장만 두면 등록이 밀린다
 *     (`+ 새 앱` 을 전원에게 연 것과 같은 이유). 자기가 맡을 역할은 자기가 집고,
 *     "회계·정산" 같은 칸도 그 일을 하는 사람이 쪼개는 게 빠르다
 *   · **지우기만 원장이다.** 부서를 지우면 그 안의 중분류·역할이 `cascade` 로
 *     통째로 사라진다 — 되돌릴 수 없는 것과 만드는 것은 갈래가 다르다
 *
 * **부서별 트리는 접어 펼치지 않는다.** PC 는 부서·중분류·소분류를 세 칸에
 * 나란히 두고, 폰은 폴더처럼 한 단계씩 들어간다. 항목이 늘어도 페이지 전체가
 * 아래로 길어지지 않는다.
 */
export default function RolesPage() {
  const { session, isAdmin } = useSession();
  const { members, nameOf } = useMembers();
  const toast = useToast();

  const [depts, setDepts] = useState<Department[] | null>(null);
  const [groups, setGroups] = useState<DutyGroup[]>([]);
  const [duties, setDuties] = useState<Duty[]>([]);
  const [helpers, setHelpers] = useState<DutyHelper[]>([]);
  const [error, setError] = useState('');
  /* 원장은 나누는 쪽이라 `부서별`, 강사는 `내 역할` 로 시작한다.
     다만 **맡은 역할이 하나도 없으면 강사도 `전체` 로 연다** — 안 그러면 다섯 명
     전원이 빈 화면부터 본다 (업무 화면에서 원장이 빈 '내 업무' 로 시작하던 것과 같다).
     역할이 생긴 뒤로는 원래대로 `내 역할` 이다. */
  const [view, setView] = useState<View>(isAdmin ? 'dept' : 'me');
  const [viewPinned, setViewPinned] = useState(false);
  /** 부서별 트리는 개수 합계를 펼쳐 보이지 않는다. 원장 첫 화면에서 모든 표의 줄·파일을
      통째로 읽던 두 요청을 없애고, 사람별·내 부서에서만 필요할 때 읽는다. */
  const counts = useDutyCounts(view !== 'dept');
  /** 인쇄 고르기 — 기본은 전부 넣는다 */
  const [printOpen, setPrintOpen] = useState(false);
  const [printParts, setPrintParts] = useState<RolePrintPart[]>(
    ROLE_PRINT_PARTS.map((p) => p.key),
  );
  const [q, setQ] = useState('');
  /**
   * 부서별 보기는 아코디언을 없애고 폴더 탐색기처럼 움직인다.
   * PC 는 세 단계를 나란히, 폰은 한 단계씩 화면을 바꾼다.
   */
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [treeDepth, setTreeDepth] = useState<TreeDepth>('departments');

  /** 역할 시트 */
  /* 부서·중분류 이름을 같이 들고 다닌다 — `DutyFiles` 가 드라이브 폴더
     (`업무분장/{부서}/{중분류}`)를 정하는 데 쓴다. 예전엔 label 을 `›` 로 쪼개
     알아냈는데, 이름에 `›` 가 들어가면 그대로 어긋난다 */
  const [editing, setEditing] = useState<{
    duty: Duty | null;
    groupId: string;
    label: string;
    deptName: string;
    groupName: string;
  } | null>(null);
  /** 부서·중분류 시트 */
  const [deptSheet, setDeptSheet] = useState<Department | 'new' | null>(null);
  const [groupSheet, setGroupSheet] = useState<{ group: DutyGroup | null; deptId: string; deptName: string } | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [headDraft, setHeadDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [sheetErr, setSheetErr] = useState('');
  const [confirmDel, setConfirmDel] = useState<{ kind: 'dept' | 'group'; id: string; name: string; n: number } | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [dRes, gRes, tRes, hRes] = await Promise.all([
        supabase.from('departments').select('*'),
        supabase.from('duty_groups').select('*'),
        supabase.from('duties').select('*'),
        supabase.from('duty_helpers').select('*'),
      ]);
      if (dRes.error) throw dRes.error;
      setDepts((dRes.data ?? []) as Department[]);
      setGroups((gRes.data ?? []) as DutyGroup[]);
      setDuties((tRes.data ?? []) as Duty[]);
      setHelpers((hRes.data ?? []) as DutyHelper[]);
    } catch (e) {
      setError(friendlyError(e, '부서업무를 불러오지 못했어요.'));
      setDepts([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tree = useMemo(
    () => buildOrg(depts ?? [], groups, duties, helpers),
    [depts, groups, duties, helpers],
  );
  const totals = useMemo(() => orgTotals(tree), [tree]);

  /** 트리에는 검색만 건다 */
  const shown = useMemo(() => filterOrg(tree, q), [tree, q]);

  /** 검색으로 현재 선택이 사라지거나 첫 진입한 경우, 화면에 있는 첫 갈래를 고른다. */
  const selectedDept = useMemo(
    () => shown.find((d) => d.dept.id === selectedDeptId) ?? shown[0] ?? null,
    [shown, selectedDeptId],
  );
  const selectedGroup = useMemo(
    () =>
      selectedDept?.groups.find((g) => g.group.id === selectedGroupId) ??
      selectedDept?.groups[0] ??
      null,
    [selectedDept, selectedGroupId],
  );

  useEffect(() => {
    if (!selectedDept) return;
    if (selectedDept.dept.id !== selectedDeptId) setSelectedDeptId(selectedDept.dept.id);
    if (selectedGroup && selectedGroup.group.id !== selectedGroupId) {
      setSelectedGroupId(selectedGroup.group.id);
    }
  }, [selectedDept, selectedGroup, selectedDeptId, selectedGroupId]);

  const chooseDept = (d: DeptNode, nextDepth: TreeDepth = 'groups') => {
    setSelectedDeptId(d.dept.id);
    setSelectedGroupId(d.groups[0]?.group.id ?? '');
    setTreeDepth(nextDepth);
  };

  const chooseGroup = (g: GroupNode, nextDepth: TreeDepth = 'duties') => {
    setSelectedGroupId(g.group.id);
    setTreeDepth(nextDepth);
  };


  /** 검색이 걸린 동안에는 트리를 강제로 펼친다 — 접힌 채로 0건처럼 보이면 안 된다 */
  const forceOpen = Boolean(q.trim());

  const people = useMemo(() => groupByPerson(tree, members), [tree, members]);
  const mine = useMemo(() => myDuties(tree, session?.id), [tree, session]);
  /** `내 부서` 에도 검색이 걸린다 — 중분류를 접어두기 시작하면서 필요해졌다 */
  const mineShown = useMemo(
    () => ({ own: filterRefs(mine.own, q), help: filterRefs(mine.help, q) }),
    [mine, q],
  );

  /* 강사가 맡은 역할이 0개면 '전체' 로 연다. 손으로 탭을 한 번 누른 뒤에는(viewPinned)
     다시 안 건드린다 — 고른 걸 되돌려버리면 그게 더 답답하다 */
  useEffect(() => {
    if (isAdmin || viewPinned || depts === null) return;
    if (mine.own.length + mine.help.length === 0) setView('dept');
  }, [isAdmin, viewPinned, depts, mine]);

  const pickView = (v: View) => {
    setViewPinned(true);
    setView(v);
  };

  /* ------------------------------------------------------------ 저장 */

  const saveDept = async () => {
    const name = nameDraft.trim();
    setSheetErr('');
    if (!name) {
      setSheetErr('부서 이름을 적어주세요.');
      return;
    }
    setBusy(true);
    try {
      if (deptSheet === 'new') {
        const { error: e } = await supabase
          .from('departments')
          .insert({ name, head_id: headDraft || null, sort_order: nextOrder(depts ?? []) });
        if (e) throw e;
        logActivity(session?.id, `부서 추가 — ${name}`, 'org');
      } else if (deptSheet) {
        const { error: e } = await supabase
          .from('departments')
          .update({ name, head_id: headDraft || null })
          .eq('id', deptSheet.id);
        if (e) throw e;
        logActivity(session?.id, `부서 수정 — ${name}`, 'org');
      }
      setDeptSheet(null);
      toast.show('저장했어요.');
      await load();
    } catch (e) {
      setSheetErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const saveGroup = async () => {
    const name = nameDraft.trim();
    setSheetErr('');
    if (!groupSheet) return;
    if (!name) {
      setSheetErr('중분류 이름을 적어주세요.');
      return;
    }
    setBusy(true);
    try {
      if (groupSheet.group) {
        const { error: e } = await supabase.from('duty_groups').update({ name }).eq('id', groupSheet.group.id);
        if (e) throw e;
      } else {
        const sib = groups.filter((g) => g.dept_id === groupSheet.deptId);
        const { error: e } = await supabase
          .from('duty_groups')
          .insert({ dept_id: groupSheet.deptId, name, sort_order: nextOrder(sib) });
        if (e) throw e;
      }
      logActivity(session?.id, `중분류 ${groupSheet.group ? '수정' : '추가'} — ${groupSheet.deptName} › ${name}`, 'org');
      setGroupSheet(null);
      toast.show('저장했어요.');
      await load();
    } catch (e) {
      setSheetErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  /** 위/아래 한 칸 — 바뀐 두 줄만 쓴다 */
  const move = async (
    table: 'departments' | 'duty_groups',
    items: { id: string; name: string; sort_order: number }[],
    id: string,
    dir: -1 | 1,
  ) => {
    const rows = swapOrder(items, id, dir);
    if (rows.length === 0) return;
    for (const r of rows) {
      const { error: e } = await supabase.from(table).update({ sort_order: r.sort_order }).eq('id', r.id);
      if (e) {
        setError(friendlyError(e, '순서를 바꾸지 못했어요.'));
        return;
      }
    }
    await load();
  };

  const removeNode = async () => {
    if (!confirmDel) return;
    const { kind, id, name } = confirmDel;
    setConfirmDel(null);
    const { error: e } = await supabase.from(kind === 'dept' ? 'departments' : 'duty_groups').delete().eq('id', id);
    if (e) {
      setError(friendlyError(e, '지우지 못했어요.'));
      return;
    }
    logActivity(session?.id, `${kind === 'dept' ? '부서' : '중분류'} 삭제 — ${name}`, 'org');
    setDeptSheet(null);
    setGroupSheet(null);
    toast.show('지웠어요.');
    await load();
  };

  /* ------------------------------------------------------------ 화면 */

  const dutyRow = (node: { duty: Duty; helperIds: string[] }, deptHeadId?: string | null) => {
    /* 주담당이 없으면 **그 부서 팀장**이 맡는다 — 원장이 부서마다 팀장을 정해뒀으니
       역할 63개마다 다시 고르게 하지 않는다. 팀장도 없을 때만 '미정' 이다 */
    const owner = ownerOf(node.duty, deptHeadId);
    const inherited = !node.duty.owner_id && !!owner;
    return (
      <li key={node.duty.id} className="flex items-center gap-1">
        {/* **누르면 그 역할 한 장으로 간다** — 목록·자료·바로가기가 거기 다 있다.
            예전엔 고치기 시트가 열렸는데, 시트는 이름·설명을 바꾸는 자리라
            *일을 하는 자리* 로는 좁았다 (원장: "리스트 업하고 관리하는 페이지").
            이름 고치기는 그 페이지 오른쪽 위 렌치에 있다 */}
        <Link
          href={`/roles/${node.duty.id}`}
          className="flex min-h-[44px] w-full items-center gap-2 py-1.5 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-semibold text-neutral-800">{node.duty.name}</span>
            {node.duty.note && (
              <span className="block truncate text-[11.5px] text-neutral-400">{node.duty.note}</span>
            )}
          </span>
          {owner ? (
            <span className="flex shrink-0 items-center gap-1">
              <Avatar name={nameOf(owner)} size={20} />
              <span className="text-[12px] font-bold text-neutral-600">{nameOf(owner)}</span>
              {inherited && <span className="chip bg-neutral-100 text-neutral-500">팀장</span>}
              {node.helperIds.length > 0 && (
                <span className="chip bg-neutral-100 text-neutral-500">+{node.helperIds.length}</span>
              )}
            </span>
          ) : (
            <span className="chip shrink-0 bg-red-100 text-red-700">미정</span>
          )}
          <Icon name="chevronDown" size={13} className="shrink-0 -rotate-90 text-neutral-300" />
        </Link>
        {node.duty.link && (
          <Link
            href={node.duty.link}
            aria-label={`${node.duty.name} — 이 일로 바로 가기`}
            className="tap -my-3 flex min-h-[44px] w-9 shrink-0 items-center justify-center text-brand"
          >
            <Icon name="external" size={14} />
          </Link>
        )}
      </li>
    );
  };

  /**
   * `내 역할`·`사람별` 목록의 한 줄.
   *
   * tone 이 없으면 칩을 안 그린다 — '담당자 미정' 칸에서 '주담당' 이라고 하면 말이 안 된다.
   *
   * ⚠️ **누를 수 있어야 한다.** 예전엔 그냥 글자만 그려서, `내 역할` 에서 자기 역할을
   * 보고도 **자료를 올릴 방법이 없었다** — 올리려면 `전체` 트리로 넘어가 부서·중분류를
   * 펼쳐 그 역할을 다시 찾아야 했다. 원장이 바로 여기서 막혔다.
   * 지금은 트리에서 누르는 것과 **같은 곳**(`/roles/[dutyId]`)으로 간다.
   */
  const refRow = (r: DutyRef, tone?: 'own' | 'help') => (
    <li key={`${tone ?? 'x'}-${r.duty.id}`} className="flex items-center gap-1">
      <Link
        href={`/roles/${r.duty.id}`}
        className="flex min-h-[44px] w-full items-center gap-2 py-1.5 text-left"
      >
        {tone && (
          <span
            className={`chip shrink-0 ${
              tone === 'own' ? 'bg-brand-50 text-brand-700' : 'bg-neutral-100 text-neutral-500'
            }`}
          >
            {tone === 'own' ? '주담당' : '부담당'}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold text-neutral-800">{r.duty.name}</span>
          {r.duty.note && (
            <span className="block truncate text-[11.5px] text-neutral-400">{r.duty.note}</span>
          )}
        </span>
        {/* 어디에 일이 쌓였는지 — 있을 때만 그린다. `0줄` 을 28줄에 붙이면 자리만 먹는다 */}
        {(counts.rows[r.duty.id] ?? 0) > 0 && (
          <span className="chip shrink-0 bg-neutral-100 text-neutral-500">{counts.rows[r.duty.id]}줄</span>
        )}
        {(counts.files[r.duty.id] ?? 0) > 0 && (
          <span className="chip shrink-0 bg-neutral-100 text-neutral-500">자료 {counts.files[r.duty.id]}</span>
        )}
        <Icon name="chevronDown" size={13} className="shrink-0 -rotate-90 text-neutral-300" />
      </Link>
      {/* 바로가기는 **바깥**이다 — button 안에 a 를 넣으면 안 되는 중첩이 된다 */}
      {r.duty.link && (
        <Link
          href={r.duty.link}
          aria-label={`${r.duty.name} — 이 일로 바로 가기`}
          className="tap -my-3 flex min-h-[44px] w-9 shrink-0 items-center justify-center text-brand"
        >
          <Icon name="external" size={14} />
        </Link>
      )}
    </li>
  );

  /**
   * 역할 목록을 **부서 › 중분류로 묶어** 그린다.
   *
   * 예전엔 줄마다 `영업마케팅부 › 홍보` 가 그대로 붙어서, 역할이 13개면 같은 글자가
   * 13번 찍혔다 — 정작 역할 이름이 안 읽힌다. 머리글에 한 번만 적는다.
   */
  /**
   * @param collapse **중분류별로 접는다** — `내 부서` 용.
   *   원장의 영업마케팅부는 역할 28개다. 펼쳐 늘어놓으니 PC 에서도 두 화면(1904px)이라
   *   *"되게 일하기 불편"* 이 됐다. 접힌 머리글에 역할 수·줄·자료 합계를 실어
   *   **펼치지 않고도 어디에 일이 있는지** 보이게 한다 (프로그램 목록의 주제 트리와
   *   같은 판단). 검색이 걸리면 저절로 펼친다 (`forceOpen`).
   *   한 부서뿐이라 머리글은 부서를 빼고 중분류 이름만 적는다.
   */
  const refList = (own: DutyRef[], help: DutyRef[], showTone = true, collapse = false) => {
    const ownIds = new Set(own.map((r) => r.duty.id));
    const groupsOf = groupRefs([...own, ...help]);
    if (collapse) {
      return (
        <div className="divide-y divide-neutral-100">
          {groupsOf.map((g) => {
            const lines = g.items.reduce((n, r) => n + (counts.rows[r.duty.id] ?? 0), 0);
            const files = g.items.reduce((n, r) => n + (counts.files[r.duty.id] ?? 0), 0);
            return (
              <div key={g.path} className="py-1 first:pt-0 last:pb-0">
                <Collapsible
                  id={`roles.me.${g.path}`}
                  dense
                  title={g.groupName}
                  forceOpen={forceOpen}
                  badge={
                    <>
                      <span className="chip bg-neutral-100 text-neutral-500">역할 {g.items.length}</span>
                      {lines > 0 && <span className="chip bg-neutral-100 text-neutral-500">{lines}줄</span>}
                      {files > 0 && <span className="chip bg-neutral-100 text-neutral-500">자료 {files}</span>}
                    </>
                  }
                >
                  <ul className="border-l border-neutral-200 pl-2.5">
                    {g.items.map((r) => refRow(r, undefined))}
                  </ul>
                </Collapsible>
              </div>
            );
          })}
        </div>
      );
    }
    return (
      <div className="divide-y divide-neutral-100">
        {groupsOf.map((g) => (
          <div key={g.path} className="py-2 first:pt-0 last:pb-0">
            <p className="mb-0.5 text-[11px] font-bold tracking-wide text-neutral-400">{g.path}</p>
            <ul>
              {g.items.map((r) =>
                refRow(r, showTone ? (ownIds.has(r.duty.id) ? 'own' : 'help') : undefined),
              )}
            </ul>
          </div>
        ))}
      </div>
    );
  };

  const views: { key: View; label: string }[] = isAdmin
    ? [
        { key: 'dept', label: '부서별' },
        { key: 'person', label: '사람별' },
        { key: 'me', label: '내 부서' },
      ]
    : [
        { key: 'me', label: '내 부서' },
        { key: 'dept', label: '전체' },
      ];

  return (
    <div>
      <PageHeader
        title="부서업무"
        subtitle={
          depts === null
            ? '불러오는 중…'
            : `부서 ${totals.depts} · 역할 ${totals.duties}`
        }
        /* 부서 만들기도 전원에게. 원장만 두면 "이런 칸이 필요한데요" 를 말로 전하고
           기다려야 한다 — 등록이 밀리는 그 문제가 층만 바뀌어 그대로 생긴다 */
        right={
          <span className="flex items-center gap-1.5">
            <button
              onClick={() => setPrintOpen(true)}
              aria-label="부서업무 인쇄"
              className="btn-ghost h-10 w-10 px-0"
            >
              <Icon name="printer" size={16} />
            </button>
            <button
              onClick={() => {
                setDeptSheet('new');
                setNameDraft('');
                setHeadDraft('');
                setSheetErr('');
              }}
              className="btn-primary px-3 text-[13.5px]"
            >
              <Icon name="plus" size={15} />
              부서
            </button>
          </span>
        }
      />

      <div className="px-4 pb-8 pt-3 lg:px-0">
        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} onRetry={() => void load()} />
          </div>
        )}

        {/* PC 에서 끝까지 늘리지 않는다 — 버튼 하나가 500px 이 되면 '막대기가 쩌끝까지 간다' */}
        <div className="mb-2.5 flex gap-1.5 lg:max-w-lg">
          {views.map((v) => (
            <button
              key={v.key}
              onClick={() => pickView(v.key)}
              aria-pressed={view === v.key}
              className={`tap flex-1 rounded-xl border text-[13px] font-bold transition ${
                view === v.key ? 'pick-on' : 'border-neutral-200 bg-surface text-neutral-500'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        {depts === null ? (
          <CardSkeleton rows={3} />
        ) : totals.depts === 0 ? (
          <EmptyState
            icon="users"
            title="부서가 아직 없어요"
            desc={
              isAdmin
                ? '오른쪽 위 + 부서로 만들거나, supabase/seed-org.sql 을 한 번 실행하면 예시가 채워져요.'
                : '오른쪽 위 “+ 부서” 로 만들 수 있어요.'
            }
          />
        ) : view === 'me' ? (
          /* ------------------------------------------------------ 내 역할 */
          mine.own.length + mine.help.length === 0 ? (
            <EmptyState
              icon="users"
              title="아직 맡은 역할이 없어요"
              /* 예전엔 "역할을 눌러 내 이름을 넣으면" 만 적혀 있어서, **이미 있는 역할을
                 맡으라는 말**로만 읽혔다. 새로 만들 수도 있다는 걸 같이 적는다 */
              desc="위 '전체' 에서 역할을 눌러 주담당에 내 이름을 넣으면 여기 모여요. 없는 역할은 '+ 역할 추가' 로 직접 만들어도 됩니다."
            />
          ) : (
            <section className="card p-3.5 lg:max-w-3xl">
              {/* `주담당 28 · 부담당 0` 이라고 적혀 있었다 — 역할에 사람을 안 붙이기로 한 뒤로
                  '주담당' 은 팀장 자동 배정일 뿐이라 아무 뜻이 없다. 줄마다 붙던 칩도 같이 뺐다 */}
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-[14px] font-bold">역할 {mine.own.length + mine.help.length}</h2>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="역할 이름으로 찾기"
                  aria-label="내 부서 역할 검색"
                  className="field ml-auto max-w-[220px] text-[13px]"
                />
              </div>
              {mineShown.own.length + mineShown.help.length === 0 ? (
                <EmptyState icon="search" title="찾는 역할이 없어요" desc="다른 말로 찾아보세요." />
              ) : (
                refList(mineShown.own, mineShown.help, false, true)
              )}
            </section>
          )
        ) : view === 'person' ? (
          /* ------------------------------------------------------ 사람별 */
          <div className="space-y-2.5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-2.5 lg:space-y-0">
            {people.map((p) => (
              <section key={p.memberId ?? 'none'} className="card p-3.5">
                <Collapsible
                  id={`roles.person.${p.memberId ?? 'none'}`}
                  title={p.name}
                  badge={
                    p.memberId === null ? (
                      <span className="chip bg-red-100 text-red-700">{p.own.length}건</span>
                    ) : p.own.length + p.help.length === 0 ? (
                      <span className="chip bg-neutral-100 text-neutral-400">없음</span>
                    ) : (
                      <span className="chip bg-neutral-100 text-neutral-500">
                        주 {p.own.length}
                        {p.help.length > 0 && ` · 부 ${p.help.length}`}
                      </span>
                    )
                  }
                >
                  {p.own.length + p.help.length === 0 ? (
                    <p className="text-[12.5px] text-neutral-400">아직 맡은 역할이 없어요.</p>
                  ) : (
                    refList(p.own, p.help, p.memberId !== null)
                  )}
                </Collapsible>
              </section>
            ))}
          </div>
        ) : (
          /* ------------------------------------------------------ 부서별 */
          <>
            {/* 폰은 두 줄, PC 는 한 줄 — 두 줄로 두면 화면 폭만 먹고 목록이 밀린다 */}
            <div className="mb-2.5 lg:flex lg:items-center lg:gap-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="역할·부서 이름으로 찾기"
                aria-label="역할 검색"
                className="field mb-2 lg:mb-0 lg:flex-1"
              />
              </div>

            {shown.length === 0 || !selectedDept ? (
              <EmptyState icon="search" title="찾는 역할이 없어요" desc="다른 말로 찾아보세요." />
            ) : (
              <>
                {/* PC: 세 단계가 같은 높이 안에서 옆으로 이동한다. 아래로 펼치지 않는다. */}
                <div className="hidden overflow-hidden rounded-2xl border border-neutral-200 bg-surface shadow-sm lg:grid lg:grid-cols-[0.8fr_1fr_1.35fr]">
                  <section className="flex min-h-[520px] flex-col border-r border-neutral-200">
                    <div className="border-b border-neutral-100 px-4 py-3">
                      <h2 className="text-[14px] font-bold">부서</h2>
                    </div>
                    <div className="max-h-[calc(100vh-250px)] flex-1 overflow-y-auto p-2">
                      {shown.map((d) => (
                        <button
                          key={d.dept.id}
                          onClick={() => chooseDept(d, 'groups')}
                          className={`mb-1 flex min-h-[52px] w-full items-center gap-2 rounded-xl px-3 text-left transition ${
                            selectedDept.dept.id === d.dept.id
                              ? 'bg-brand-50 text-brand-800'
                              : 'text-neutral-700 hover:bg-raised'
                          }`}
                        >
                          <Icon name="tree" size={16} className="shrink-0" />
                          <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold">{d.dept.name}</span>
                          <span className="chip shrink-0 bg-neutral-100 text-neutral-500">{d.total}</span>
                          <Icon name="chevronDown" size={12} className="-rotate-90 text-neutral-300" />
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="flex min-h-[520px] flex-col border-r border-neutral-200">
                    <div className="flex items-center border-b border-neutral-100 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <h2 className="truncate text-[14px] font-bold">{selectedDept.dept.name}</h2>
                      </div>
                      <button
                        onClick={() => {
                          setDeptSheet(selectedDept.dept);
                          setNameDraft(selectedDept.dept.name);
                          setHeadDraft(selectedDept.dept.head_id ?? '');
                          setSheetErr('');
                        }}
                        aria-label={`${selectedDept.dept.name} 고치기`}
                        className="tap w-9 shrink-0 text-neutral-400"
                      >
                        <Icon name="dots" size={16} />
                      </button>
                    </div>
                    {selectedDept.dept.head_id && (
                      <p className="flex items-center gap-1.5 border-b border-neutral-100 px-4 py-2 text-[12px] text-neutral-500">
                        <Avatar name={nameOf(selectedDept.dept.head_id)} size={18} />
                        부서장 {nameOf(selectedDept.dept.head_id)}
                      </p>
                    )}
                    <div className="max-h-[calc(100vh-300px)] flex-1 overflow-y-auto p-2">
                      {selectedDept.groups.length === 0 ? (
                        <p className="p-3 text-[12.5px] text-neutral-400">중분류가 아직 없어요.</p>
                      ) : (
                        selectedDept.groups.map((g) => (
                          <div key={g.group.id} className="mb-1 flex items-center gap-1">
                            <button
                              onClick={() => chooseGroup(g, 'duties')}
                              className={`flex min-h-[52px] min-w-0 flex-1 items-center gap-2 rounded-xl px-3 text-left transition ${
                                selectedGroup?.group.id === g.group.id
                                  ? 'bg-brand-50 text-brand-800'
                                  : 'text-neutral-700 hover:bg-raised'
                              }`}
                            >
                              <Icon name="list" size={15} />
                              <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold">{g.group.name}</span>
                              <span className="chip shrink-0 bg-neutral-100 text-neutral-500">{g.duties.length}</span>
                              <Icon name="chevronDown" size={12} className="-rotate-90 text-neutral-300" />
                            </button>
                            <button
                              onClick={() => {
                                setGroupSheet({ group: g.group, deptId: selectedDept.dept.id, deptName: selectedDept.dept.name });
                                setNameDraft(g.group.name);
                                setSheetErr('');
                              }}
                              aria-label={`${g.group.name} 고치기`}
                              className="tap w-8 shrink-0 text-neutral-300"
                            >
                              <Icon name="dots" size={14} />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                    <button
                      onClick={() => {
                        setGroupSheet({ group: null, deptId: selectedDept.dept.id, deptName: selectedDept.dept.name });
                        setNameDraft('');
                        setSheetErr('');
                      }}
                      className="m-3 flex min-h-[44px] items-center justify-center gap-1 rounded-xl border border-dashed border-neutral-300 text-[12.5px] font-bold text-neutral-500"
                    >
                      <Icon name="plus" size={13} />
                      중분류 추가
                    </button>
                  </section>

                  <section className="flex min-h-[520px] flex-col">
                    <div className="border-b border-neutral-100 px-4 py-3">
                      <h2 className="truncate text-[14px] font-bold">
                        {selectedGroup?.group.name ?? '중분류를 선택하세요'}
                      </h2>
                    </div>
                    <div className="max-h-[calc(100vh-250px)] flex-1 overflow-y-auto px-4 py-2">
                      {!selectedGroup ? (
                        <p className="py-3 text-[12.5px] text-neutral-400">왼쪽에서 중분류를 선택하세요.</p>
                      ) : selectedGroup.duties.length === 0 ? (
                        <p className="py-3 text-[12.5px] text-neutral-400">역할이 아직 없어요.</p>
                      ) : (
                        <ul className="divide-y divide-neutral-100">
                          {selectedGroup.duties.map((n) => dutyRow(n, selectedDept.dept.head_id))}
                        </ul>
                      )}
                    </div>
                    {selectedGroup && (
                      <button
                        onClick={() =>
                          setEditing({
                            duty: null,
                            groupId: selectedGroup.group.id,
                            label: `${selectedDept.dept.name} › ${selectedGroup.group.name}`,
                            deptName: selectedDept.dept.name,
                            groupName: selectedGroup.group.name,
                          })
                        }
                        className="m-3 flex min-h-[44px] items-center justify-center gap-1 rounded-xl border border-dashed border-neutral-300 text-[12.5px] font-bold text-brand"
                      >
                        <Icon name="plus" size={13} />
                        역할 추가
                      </button>
                    )}
                  </section>
                </div>

                {/* 폰: 한 화면에는 한 단계만. 위에서 아래로 펼치지 않고 다음 화면으로 간다. */}
                <section className="card overflow-hidden lg:hidden">
                  <nav aria-label="현재 업무 위치" className="flex min-h-[44px] items-center gap-1 overflow-x-auto border-b border-neutral-100 px-3">
                    <button onClick={() => setTreeDepth('departments')} className="shrink-0 text-[12px] font-bold text-brand">
                      부서
                    </button>
                    {treeDepth !== 'departments' && (
                      <>
                        <Icon name="chevronDown" size={11} className="-rotate-90 text-neutral-300" />
                        <button onClick={() => setTreeDepth('groups')} className="shrink-0 text-[12px] font-bold text-brand">
                          {selectedDept.dept.name}
                        </button>
                      </>
                    )}
                    {treeDepth === 'duties' && selectedGroup && (
                      <>
                        <Icon name="chevronDown" size={11} className="-rotate-90 text-neutral-300" />
                        <span className="shrink-0 text-[12px] font-bold text-neutral-600">{selectedGroup.group.name}</span>
                      </>
                    )}
                  </nav>

                  {treeDepth === 'departments' && (
                    <div className="divide-y divide-neutral-100 px-3 py-1">
                      {shown.map((d) => (
                        <button key={d.dept.id} onClick={() => chooseDept(d)} className="flex min-h-[56px] w-full items-center gap-2 text-left">
                          <span className="rounded-xl bg-brand-50 p-2 text-brand"><Icon name="tree" size={16} /></span>
                          <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-neutral-800">{d.dept.name}</span>
                          <span className="chip bg-neutral-100 text-neutral-500">역할 {d.total}</span>
                          <Icon name="chevronDown" size={13} className="-rotate-90 text-neutral-300" />
                        </button>
                      ))}
                    </div>
                  )}

                  {treeDepth === 'groups' && (
                    <div>
                      <div className="flex items-center border-b border-neutral-100 px-3 py-2">
                        <span className="min-w-0 flex-1 text-[13px] font-bold text-neutral-600">{selectedDept.dept.name}</span>
                        <button
                          onClick={() => {
                            setDeptSheet(selectedDept.dept);
                            setNameDraft(selectedDept.dept.name);
                            setHeadDraft(selectedDept.dept.head_id ?? '');
                            setSheetErr('');
                          }}
                          aria-label={`${selectedDept.dept.name} 고치기`}
                          className="tap w-9 text-neutral-400"
                        ><Icon name="dots" size={16} /></button>
                      </div>
                      <div className="divide-y divide-neutral-100 px-3 py-1">
                        {selectedDept.groups.map((g) => (
                          <div key={g.group.id} className="flex items-center gap-1">
                            <button onClick={() => chooseGroup(g)} className="flex min-h-[56px] min-w-0 flex-1 items-center gap-2 text-left">
                              <span className="rounded-xl bg-raised p-2 text-neutral-500"><Icon name="list" size={16} /></span>
                              <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-neutral-800">{g.group.name}</span>
                              <span className="chip bg-neutral-100 text-neutral-500">{g.duties.length}</span>
                              <Icon name="chevronDown" size={13} className="-rotate-90 text-neutral-300" />
                            </button>
                            <button
                              onClick={() => {
                                setGroupSheet({ group: g.group, deptId: selectedDept.dept.id, deptName: selectedDept.dept.name });
                                setNameDraft(g.group.name);
                                setSheetErr('');
                              }}
                              aria-label={`${g.group.name} 고치기`}
                              className="tap w-8 shrink-0 text-neutral-300"
                            ><Icon name="dots" size={14} /></button>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => {
                          setGroupSheet({ group: null, deptId: selectedDept.dept.id, deptName: selectedDept.dept.name });
                          setNameDraft('');
                          setSheetErr('');
                        }}
                        className="m-3 flex min-h-[44px] items-center justify-center gap-1 rounded-xl border border-dashed border-neutral-300 text-[12.5px] font-bold text-neutral-500"
                      ><Icon name="plus" size={13} />중분류 추가</button>
                    </div>
                  )}

                  {treeDepth === 'duties' && selectedGroup && (
                    <div>
                      <ul className="divide-y divide-neutral-100 px-3 py-1">
                        {selectedGroup.duties.map((n) => dutyRow(n, selectedDept.dept.head_id))}
                      </ul>
                      <button
                        onClick={() =>
                          setEditing({
                            duty: null,
                            groupId: selectedGroup.group.id,
                            label: `${selectedDept.dept.name} › ${selectedGroup.group.name}`,
                            deptName: selectedDept.dept.name,
                            groupName: selectedGroup.group.name,
                          })
                        }
                        className="m-3 flex min-h-[44px] items-center justify-center gap-1 rounded-xl border border-dashed border-neutral-300 text-[12.5px] font-bold text-brand"
                      ><Icon name="plus" size={13} />역할 추가</button>
                    </div>
                  )}
                </section>
              </>
            )}
          </>
        )}
      </div>

      {/* 역할(소분류) 시트 */}
      <DutyForm
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        groupId={editing?.groupId ?? ''}
        groupLabel={editing?.label ?? ''}
        deptName={editing?.deptName}
        groupName={editing?.groupName}
        duty={editing?.duty ?? null}
        canDelete={isAdmin}
        onSaved={() => {
          void load();
          void counts.reload();
        }}
      />

      {/* 부서 시트 */}
      <Sheet
        open={Boolean(deptSheet)}
        onClose={() => setDeptSheet(null)}
        title={deptSheet === 'new' ? '부서 추가' : '부서 고치기'}
        footer={
          <button onClick={() => void saveDept()} disabled={busy} className="btn-primary w-full">
            {busy ? '저장 중…' : '저장'}
          </button>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="dept-name">
              부서 이름
            </label>
            <input
              id="dept-name"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              className="field"
              placeholder="예) 기획개발부"
            />
          </div>

          <div>
            <p className="label">부서장</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setHeadDraft('')}
                aria-pressed={headDraft === ''}
                className={`tap rounded-full border px-3.5 text-[14px] font-semibold transition ${
                  headDraft === ''
                    ? 'border-neutral-400 bg-neutral-100 text-neutral-700'
                    : 'border-neutral-300 bg-surface text-neutral-400'
                }`}
              >
                없음
              </button>
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setHeadDraft(m.id)}
                  aria-pressed={headDraft === m.id}
                  className={`tap gap-1.5 rounded-full border px-3 text-[14px] font-semibold transition ${
                    headDraft === m.id
                      ? 'pick-on'
                      : 'border-neutral-300 bg-surface text-neutral-600'
                  }`}
                >
                  <Avatar name={m.name} size={20} />
                  {m.name}
                </button>
              ))}
            </div>
          </div>

          {sheetErr && <ErrorBanner message={sheetErr} />}

          {deptSheet && deptSheet !== 'new' && (
            <div className="space-y-2 border-t border-neutral-200 pt-3">
              <div className="flex gap-2">
                <button
                  onClick={() => void move('departments', depts ?? [], deptSheet.id, -1)}
                  className="tap flex-1 gap-1 rounded-xl border border-neutral-300 text-[13px] font-bold text-neutral-600"
                >
                  <Icon name="chevronDown" size={13} className="rotate-180" />위로
                </button>
                <button
                  onClick={() => void move('departments', depts ?? [], deptSheet.id, 1)}
                  className="tap flex-1 gap-1 rounded-xl border border-neutral-300 text-[13px] font-bold text-neutral-600"
                >
                  <Icon name="chevronDown" size={13} />
                  아래로
                </button>
              </div>
              {/* ⚠️ 지우기만 원장이다. 고치기 시트를 전원에게 열었으니 여기서 다시 막는다 —
                  부서를 지우면 그 안의 중분류·역할이 cascade 로 통째로 사라진다 */}
              {isAdmin && (
                <button
                  onClick={() =>
                    setConfirmDel({
                      kind: 'dept',
                      id: deptSheet.id,
                      name: deptSheet.name,
                      n: tree.find((t) => t.dept.id === deptSheet.id)?.total ?? 0,
                    })
                  }
                  className="tap w-full gap-1.5 rounded-xl border border-neutral-300 text-[13.5px] font-bold text-neutral-500"
                >
                  <Icon name="trash" size={14} />이 부서 지우기
                </button>
              )}
            </div>
          )}
        </div>
      </Sheet>

      {/* 중분류 시트 */}
      <Sheet
        open={Boolean(groupSheet)}
        onClose={() => setGroupSheet(null)}
        title={groupSheet?.group ? '중분류 고치기' : '중분류 추가'}
        footer={
          <button onClick={() => void saveGroup()} disabled={busy} className="btn-primary w-full">
            {busy ? '저장 중…' : '저장'}
          </button>
        }
      >
        <div className="space-y-3">
          <p className="rounded-lg bg-raised px-3 py-2 text-[12.5px] font-semibold text-neutral-500">
            {groupSheet?.deptName}
          </p>
          <div>
            <label className="label" htmlFor="group-name">
              중분류 이름
            </label>
            <input
              id="group-name"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              className="field"
              placeholder="예) 학교·기관 영업"
            />
          </div>

          {sheetErr && <ErrorBanner message={sheetErr} />}

          {groupSheet?.group && (
            <div className="space-y-2 border-t border-neutral-200 pt-3">
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    void move(
                      'duty_groups',
                      groups.filter((g) => g.dept_id === groupSheet.deptId),
                      groupSheet.group!.id,
                      -1,
                    )
                  }
                  className="tap flex-1 gap-1 rounded-xl border border-neutral-300 text-[13px] font-bold text-neutral-600"
                >
                  <Icon name="chevronDown" size={13} className="rotate-180" />위로
                </button>
                <button
                  onClick={() =>
                    void move(
                      'duty_groups',
                      groups.filter((g) => g.dept_id === groupSheet.deptId),
                      groupSheet.group!.id,
                      1,
                    )
                  }
                  className="tap flex-1 gap-1 rounded-xl border border-neutral-300 text-[13px] font-bold text-neutral-600"
                >
                  <Icon name="chevronDown" size={13} />
                  아래로
                </button>
              </div>
              {isAdmin && (
                <button
                  onClick={() =>
                    setConfirmDel({
                      kind: 'group',
                      id: groupSheet.group!.id,
                      name: groupSheet.group!.name,
                      n: duties.filter((t) => t.group_id === groupSheet.group!.id).length,
                    })
                  }
                  className="tap w-full gap-1.5 rounded-xl border border-neutral-300 text-[13.5px] font-bold text-neutral-500"
                >
                  <Icon name="trash" size={14} />이 중분류 지우기
                </button>
              )}
            </div>
          )}
        </div>
      </Sheet>

      <ConfirmDialog
        open={Boolean(confirmDel)}
        title={confirmDel?.kind === 'dept' ? '이 부서를 지울까요?' : '이 중분류를 지울까요?'}
        message={
          confirmDel
            ? `${confirmDel.name} — 안에 있는 역할 ${confirmDel.n}개도 같이 사라져요.`
            : ''
        }
        onCancel={() => setConfirmDel(null)}
        onConfirm={() => void removeNode()}
      />

      {/* ---------------------------------------------------------- 인쇄 고르기
          부서 5 · 역할 48 이면 한 장에 안 들어간다. 무엇을 넣을지 고르게 한다
          (프로그램 인쇄·지출결의서 인쇄와 같은 방식) */}
      <Sheet open={printOpen} onClose={() => setPrintOpen(false)} title="부서업무 인쇄">
        <div className="space-y-3">
          <ul className="overflow-hidden rounded-xl border border-neutral-200">
            {ROLE_PRINT_PARTS.map((part, i) => {
              const on = printParts.includes(part.key);
              return (
                <li key={part.key} className={i > 0 ? 'border-t border-neutral-100' : ''}>
                  <button
                    onClick={() =>
                      setPrintParts((v) =>
                        v.includes(part.key) ? v.filter((x) => x !== part.key) : [...v, part.key],
                      )
                    }
                    aria-pressed={on}
                    className={`flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2 text-left transition ${
                      on ? 'bg-brand-50' : ''
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                        on ? 'border-brand bg-brand text-white' : 'border-neutral-300'
                      }`}
                    >
                      {on && <Icon name="check" size={12} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1 text-[13.5px] font-semibold text-neutral-800">
                      {part.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <p className="text-[11.5px] leading-relaxed text-neutral-400">
            {totals.unassigned > 0 && `담당자 미정이 ${totals.unassigned}건 있습니다.`}
          </p>

          <a
            href={`/print/roles?parts=${printParts.join(',')}`}
            target="_blank"
            rel="noreferrer"
            onClick={() => setPrintOpen(false)}
            aria-disabled={printParts.length === 0}
            className={`btn-primary flex w-full ${printParts.length === 0 ? 'pointer-events-none opacity-40' : ''}`}
          >
            <Icon name="printer" size={15} />
            인쇄 화면 열기
          </a>
        </div>
      </Sheet>

      {toast.node}
    </div>
  );
}
