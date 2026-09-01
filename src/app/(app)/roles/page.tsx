'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
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
 * **트리는 두 단계가 다 접힌다.** 부서만 접으면 부서 하나를 열었을 때
 * 소분류가 전부 쏟아져서(1499px) 세로 스크롤이 감당이 안 됐다.
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
  /** 인쇄 고르기 — 기본은 전부 넣는다 */
  const [printOpen, setPrintOpen] = useState(false);
  const [printParts, setPrintParts] = useState<RolePrintPart[]>(
    ROLE_PRINT_PARTS.map((p) => p.key),
  );
  const [q, setQ] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);

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

  /**
   * 담당자 미정은 **트리가 아니라 평평한 목록**으로 보여준다.
   * 트리로 그리면 부서·중분류를 전부 펼쳐야 해서 15건 보는 데 3.6화면(2949px)이었다.
   * 채우는 게 목적인 화면이라 헤집을 이유가 없다 — 한 줄에 한 건씩 눌러서 채운다.
   */
  const openList = useMemo(
    () =>
      shown.flatMap((d) =>
        d.groups.flatMap((g) =>
          g.duties
            .filter((n) => !n.duty.owner_id)
            .map((n) => ({ duty: n.duty, deptName: d.dept.name, groupName: g.group.name })),
        ),
      ),
    [shown],
  );

  /** 검색이 걸린 동안에는 트리를 강제로 펼친다 — 접힌 채로 0건처럼 보이면 안 된다 */
  const forceOpen = Boolean(q.trim());

  const people = useMemo(() => groupByPerson(tree, members), [tree, members]);
  const mine = useMemo(() => myDuties(tree, session?.id), [tree, session]);

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

  const dutyRow = (
    node: { duty: Duty; helperIds: string[] },
    deptName: string,
    groupName: string,
    deptHeadId?: string | null,
  ) => {
    const label = `${deptName} › ${groupName}`;
    /* 주담당이 없으면 **그 부서 팀장**이 맡는다 — 원장이 부서마다 팀장을 정해뒀으니
       역할 63개마다 다시 고르게 하지 않는다. 팀장도 없을 때만 '미정' 이다 */
    const owner = ownerOf(node.duty, deptHeadId);
    const inherited = !node.duty.owner_id && !!owner;
    return (
      <li key={node.duty.id}>
        {/* 누구나 누를 수 있다 — 담당자를 정하는 건 '내가 이거 할게요' 이기도 하다
            (검증자 참여를 본인이 누르게 연 것과 같은 갈래) */}
        <button
          onClick={() => setEditing({ duty: node.duty, groupId: node.duty.group_id, label, deptName, groupName })}
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
        </button>
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
   * 누르면 트리에서 누르는 것과 **같은 시트**가 열린다.
   */
  const refRow = (r: DutyRef, tone?: 'own' | 'help') => (
    <li key={`${tone ?? 'x'}-${r.duty.id}`}>
      <button
        onClick={() =>
          setEditing({
            duty: r.duty,
            groupId: r.duty.group_id,
            label: `${r.deptName} › ${r.groupName}`,
            deptName: r.deptName,
            groupName: r.groupName,
          })
        }
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
        <Icon name="chevronDown" size={13} className="shrink-0 -rotate-90 text-neutral-300" />
      </button>
    </li>
  );

  /**
   * 역할 목록을 **부서 › 중분류로 묶어** 그린다.
   *
   * 예전엔 줄마다 `영업마케팅부 › 홍보` 가 그대로 붙어서, 역할이 13개면 같은 글자가
   * 13번 찍혔다 — 정작 역할 이름이 안 읽힌다. 머리글에 한 번만 적는다.
   */
  const refList = (own: DutyRef[], help: DutyRef[], showTone = true) => {
    const ownIds = new Set(own.map((r) => r.duty.id));
    return (
      <div className="divide-y divide-neutral-100">
        {groupRefs([...own, ...help]).map((g) => (
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
        { key: 'me', label: '내 역할' },
      ]
    : [
        { key: 'me', label: '내 역할' },
        { key: 'dept', label: '전체' },
      ];

  return (
    <div>
      <PageHeader
        title="부서업무"
        subtitle={
          depts === null
            ? '불러오는 중…'
            : `부서 ${totals.depts} · 역할 ${totals.duties}${totals.unassigned ? ` · 미정 ${totals.unassigned}` : ''}`
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
              <h2 className="mb-1 text-[14px] font-bold">
                주담당 {mine.own.length} · 부담당 {mine.help.length}
              </h2>
              {refList(mine.own, mine.help)}
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
              {totals.unassigned > 0 && (
                <button
                  onClick={() => setOnlyOpen((v) => !v)}
                  aria-pressed={onlyOpen}
                  className={`tap w-full shrink-0 rounded-xl border px-4 text-[13px] font-bold transition lg:w-auto ${
                    onlyOpen
                      ? 'border-red-300 bg-red-100 text-red-700'
                      : 'border-neutral-200 bg-surface text-neutral-500'
                  }`}
                >
                  담당자 미정 {totals.unassigned}건{onlyOpen ? ' — 전체 보기' : '만 보기'}
                </button>
              )}
            </div>

            {onlyOpen ? (
              openList.length === 0 ? (
                <EmptyState icon="check" title="담당자가 다 정해졌어요" desc="비어 있는 역할이 없습니다." />
              ) : (
                <ul className="card divide-y divide-neutral-100 px-3.5 lg:max-w-3xl">
                  {openList.map((r) => (
                    <li key={r.duty.id}>
                      <button
                        onClick={() =>
                          setEditing({
                            duty: r.duty,
                            groupId: r.duty.group_id,
                            label: `${r.deptName} › ${r.groupName}`,
                            deptName: r.deptName,
                            groupName: r.groupName,
                          })
                        }
                        className="flex min-h-[44px] w-full items-center gap-2 py-2 text-left"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-semibold text-neutral-800">
                            {r.duty.name}
                          </span>
                          <span className="block truncate text-[11.5px] text-neutral-400">
                            {r.deptName} › {r.groupName}
                          </span>
                        </span>
                        <span className="chip shrink-0 bg-red-100 text-red-700">미정</span>
                        <Icon name="chevronDown" size={13} className="shrink-0 -rotate-90 text-neutral-300" />
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : shown.length === 0 ? (
              <EmptyState icon="search" title="찾는 역할이 없어요" desc="다른 말로 찾아보세요." />
            ) : (
              /* PC 는 두 칸으로 흘린다 (grid 가 아니라 columns) —
                 grid 로 깔면 펼친 부서 옆이 통째로 비어 화면이 덜 만든 것처럼 보인다 */
              <div className="space-y-2.5 lg:columns-2 lg:gap-2.5 lg:space-y-0">
                {shown.map((d) => (
                  <section key={d.dept.id} className="card mb-2.5 break-inside-avoid p-3.5 lg:mb-2.5">
                    <Collapsible
                      id={`roles.dept.${d.dept.id}`}
                      title={d.dept.name}
                      /* 검색·미정 필터가 걸리면 저절로 펼친다 — 접힌 채로 0건처럼 보이면 안 된다.
                         defaultOpen 으로는 안 된다 (첫 값만 잡는다) — Collapsible 의 forceOpen 참고 */
                      forceOpen={forceOpen}
                      badge={
                        <span className="flex items-center gap-1">
                          <span className="chip bg-neutral-100 text-neutral-500">역할 {d.total}</span>
                          {d.unassigned > 0 && (
                            <span className="chip bg-red-100 text-red-700">미정 {d.unassigned}</span>
                          )}
                        </span>
                      }
                      right={
                        <button
                          onClick={() => {
                            setDeptSheet(d.dept);
                            setNameDraft(d.dept.name);
                            setHeadDraft(d.dept.head_id ?? '');
                            setSheetErr('');
                          }}
                          aria-label={`${d.dept.name} 고치기`}
                          className="tap w-9 shrink-0 text-neutral-400"
                        >
                          <Icon name="dots" size={16} />
                        </button>
                      }
                    >
                      {d.dept.head_id && (
                        <p className="mb-2 flex items-center gap-1.5 text-[12px] text-neutral-500">
                          <Avatar name={nameOf(d.dept.head_id)} size={18} />
                          부서장 {nameOf(d.dept.head_id)}
                        </p>
                      )}

                      {d.groups.length === 0 ? (
                        <p className="text-[12.5px] text-neutral-400">중분류가 아직 없어요.</p>
                      ) : (
                        /* 왼쪽 선으로 트리의 세로줄을 그린다 — 들여쓰기가 없으면
                           중분류가 부서와 같은 층으로 읽힌다 (높이는 안 늘어난다) */
                        <div className="space-y-1.5 border-l border-neutral-200 pl-2.5">
                          {d.groups.map((g) => (
                            <Collapsible
                              key={g.group.id}
                              id={`roles.group.${g.group.id}`}
                              dense
                              title={g.group.name}
                              forceOpen={forceOpen}
                              /* 중분류가 하나뿐이면 열어둔다 — 누를 게 없는 단계를 만들지 않는다 */
                              defaultOpen={d.groups.length === 1}
                              badge={
                                <span className="flex shrink-0 items-center gap-1">
                                  <span className="chip bg-neutral-100 text-neutral-500">{g.duties.length}</span>
                                  {g.unassigned > 0 && (
                                    <span className="chip bg-red-100 text-red-700">미정 {g.unassigned}</span>
                                  )}
                                </span>
                              }
                              right={
                                <button
                                  onClick={() => {
                                    setGroupSheet({ group: g.group, deptId: d.dept.id, deptName: d.dept.name });
                                    setNameDraft(g.group.name);
                                    setSheetErr('');
                                  }}
                                  aria-label={`${g.group.name} 고치기`}
                                  className="tap w-8 shrink-0 text-neutral-300"
                                >
                                  <Icon name="dots" size={14} />
                                </button>
                              }
                            >
                              <ul className="divide-y divide-neutral-100 border-t border-neutral-100">
                                {g.duties.map((n) => dutyRow(n, d.dept.name, g.group.name, d.dept.head_id))}
                              </ul>
                              {/* 역할 추가는 전원에게 — 자기가 맡을 일은 자기가 적는 게 빠르다 */}
                              <button
                                onClick={() =>
                                  setEditing({
                                    duty: null,
                                    groupId: g.group.id,
                                    label: `${d.dept.name} › ${g.group.name}`,
                                    deptName: d.dept.name,
                                    groupName: g.group.name,
                                  })
                                }
                                className="-my-3 flex min-h-[44px] items-center gap-1 text-[12.5px] font-bold text-brand"
                              >
                                <Icon name="plus" size={13} />
                                역할 추가
                              </button>
                            </Collapsible>
                          ))}
                        </div>
                      )}

                      {/* 중분류 추가도 전원에게 — 일하는 사람이 칸을 쪼개는 게 빠르다 */}
                      <button
                        onClick={() => {
                          setGroupSheet({ group: null, deptId: d.dept.id, deptName: d.dept.name });
                          setNameDraft('');
                          setSheetErr('');
                        }}
                        className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-1 rounded-xl border border-dashed border-neutral-300 text-[12.5px] font-bold text-neutral-500"
                      >
                        <Icon name="plus" size={13} />
                        중분류 추가
                      </button>

                    </Collapsible>
                  </section>
                ))}
              </div>
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
        members={members}
        canDelete={isAdmin}
        onSaved={() => void load()}
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
          <p className="text-[13px] leading-relaxed text-neutral-500">
            넣을 것을 고르고 <b>인쇄 화면 열기</b> 를 누르세요. 새 창에서 열립니다.
          </p>

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
            <b>사람별</b> 은 한 사람이 한 쪽입니다 — 뽑아서 그대로 건네라고 그렇게 했어요.
            {totals.unassigned > 0 && ` 지금 담당자 미정이 ${totals.unassigned}건 있습니다.`}
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
