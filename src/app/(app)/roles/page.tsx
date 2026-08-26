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
  myDuties,
  nextOrder,
  orgTotals,
  swapOrder,
  type DeptNode,
  type DutyRef,
  type GroupNode,
} from '@/lib/org';
import type { Department, Duty, DutyGroup, DutyHelper } from '@/lib/types';

type View = 'dept' | 'person' | 'me';

/**
 * 역할분장 — 부서 › 중분류 › 소분류, 그리고 그 역할을 누가 맡나.
 *
 * 업무(/task)와 **축이 다르다.** 저쪽은 *1건 × 담당자 × 기한* 이고 끝나면 지나간다.
 * 이쪽은 기한이 없고 계속 남는 '이 일은 누구 담당' 이다.
 *
 * 보기 세 가지 — 원장은 `부서별`, 강사는 `내 역할` 로 시작한다.
 * (원장은 나누는 쪽이라 자기 역할부터 보면 정작 미정이 안 보인다 — 업무 화면과 같은 판단)
 *
 * 고치는 건 **원장만.** 한 사람이 누르면 모두의 역할표가 바뀌는 것이라
 * 프로그램 보관·주제 관리와 같은 갈래다.
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
  const [view, setView] = useState<View>(isAdmin ? 'dept' : 'me');
  const [q, setQ] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);

  /** 역할 시트 */
  const [editing, setEditing] = useState<{ duty: Duty | null; groupId: string; label: string } | null>(null);
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
      setError(friendlyError(e, '역할분장을 불러오지 못했어요.'));
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

  /** 검색 + '담당자 미정만' 을 차례로 건다 */
  const shown = useMemo(() => {
    let t = filterOrg(tree, q);
    if (onlyOpen) {
      t = t
        .map((d) => {
          const gs = d.groups
            .map((g) => {
              const ds = g.duties.filter((n) => !n.duty.owner_id);
              return ds.length ? { ...g, duties: ds, unassigned: ds.length } : null;
            })
            .filter((g): g is GroupNode => g !== null);
          return gs.length
            ? { ...d, groups: gs, total: gs.reduce((n, g) => n + g.duties.length, 0), unassigned: gs.length && d.unassigned }
            : null;
        })
        .filter((d): d is DeptNode => d !== null);
    }
    return t;
  }, [tree, q, onlyOpen]);

  const people = useMemo(() => groupByPerson(tree, members), [tree, members]);
  const mine = useMemo(() => myDuties(tree, session?.id), [tree, session]);

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

  const dutyRow = (node: { duty: Duty; helperIds: string[] }, label: string) => {
    const owner = node.duty.owner_id;
    return (
      <li key={node.duty.id}>
        <button
          onClick={() => isAdmin && setEditing({ duty: node.duty, groupId: node.duty.group_id, label })}
          disabled={!isAdmin}
          className="flex min-h-[44px] w-full items-center gap-2 py-1.5 text-left disabled:cursor-default"
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
              {node.helperIds.length > 0 && (
                <span className="chip bg-neutral-100 text-neutral-500">+{node.helperIds.length}</span>
              )}
            </span>
          ) : (
            <span className="chip shrink-0 bg-red-100 text-red-700">미정</span>
          )}
          {isAdmin && <Icon name="chevronDown" size={13} className="shrink-0 -rotate-90 text-neutral-300" />}
        </button>
      </li>
    );
  };

  /** tone 이 없으면 칩을 안 그린다 — '담당자 미정' 칸에서 '주담당' 이라고 하면 말이 안 된다 */
  const refRow = (r: DutyRef, tone?: 'own' | 'help') => (
    <li key={`${tone ?? 'x'}-${r.duty.id}`} className="flex items-start gap-2 py-1.5">
      {tone && (
        <span
          className={`chip mt-0.5 shrink-0 ${
            tone === 'own' ? 'bg-brand-50 text-brand-700' : 'bg-neutral-100 text-neutral-500'
          }`}
        >
          {tone === 'own' ? '주담당' : '부담당'}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold text-neutral-800">{r.duty.name}</span>
        <span className="block truncate text-[11.5px] text-neutral-400">
          {r.deptName} › {r.groupName}
        </span>
      </span>
    </li>
  );

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
        title="역할분장"
        subtitle={
          depts === null
            ? '불러오는 중…'
            : `부서 ${totals.depts} · 역할 ${totals.duties}${totals.unassigned ? ` · 미정 ${totals.unassigned}` : ''}`
        }
        right={
          isAdmin ? (
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
          ) : undefined
        }
      />

      <div className="px-4 pb-8 pt-3 lg:px-0">
        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} onRetry={() => void load()} />
          </div>
        )}

        <div className="mb-2.5 flex gap-1.5">
          {views.map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              aria-pressed={view === v.key}
              className={`tap flex-1 rounded-xl border text-[13px] font-bold transition ${
                view === v.key ? 'border-brand bg-brand text-white' : 'border-neutral-200 bg-surface text-neutral-500'
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
                : '원장님이 부서를 만들면 여기 보여요.'
            }
          />
        ) : view === 'me' ? (
          /* ------------------------------------------------------ 내 역할 */
          mine.own.length + mine.help.length === 0 ? (
            <EmptyState icon="users" title="아직 맡은 역할이 없어요" desc="원장님이 정하면 여기 보여요." />
          ) : (
            <section className="card p-3.5">
              <h2 className="mb-1 text-[14px] font-bold">
                주담당 {mine.own.length} · 부담당 {mine.help.length}
              </h2>
              <ul className="divide-y divide-neutral-100">
                {mine.own.map((r) => refRow(r, 'own'))}
                {mine.help.map((r) => refRow(r, 'help'))}
              </ul>
            </section>
          )
        ) : view === 'person' ? (
          /* ------------------------------------------------------ 사람별 */
          <div className="space-y-2.5 lg:grid lg:grid-cols-2 lg:gap-2.5 lg:space-y-0">
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
                    <ul className="divide-y divide-neutral-100">
                      {p.own.map((r) => refRow(r, p.memberId === null ? undefined : 'own'))}
                      {p.help.map((r) => refRow(r, 'help'))}
                    </ul>
                  )}
                </Collapsible>
              </section>
            ))}
          </div>
        ) : (
          /* ------------------------------------------------------ 부서별 */
          <>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="역할·부서 이름으로 찾기"
              aria-label="역할 검색"
              className="field mb-2"
            />
            {totals.unassigned > 0 && (
              <button
                onClick={() => setOnlyOpen((v) => !v)}
                aria-pressed={onlyOpen}
                className={`tap mb-2.5 w-full rounded-xl border text-[13px] font-bold transition ${
                  onlyOpen ? 'border-red-300 bg-red-100 text-red-700' : 'border-neutral-200 bg-surface text-neutral-500'
                }`}
              >
                담당자 미정 {totals.unassigned}건{onlyOpen ? ' — 전체 보기' : '만 보기'}
              </button>
            )}

            {shown.length === 0 ? (
              <EmptyState icon="search" title="찾는 역할이 없어요" desc="다른 말로 찾아보세요." />
            ) : (
              <div className="space-y-2.5">
                {shown.map((d) => (
                  <section key={d.dept.id} className="card p-3.5">
                    <Collapsible
                      id={`roles.dept.${d.dept.id}`}
                      title={d.dept.name}
                      /* 검색·미정 필터가 걸리면 저절로 펼친다 — 접힌 채로 0건처럼 보이면 안 된다 */
                      defaultOpen={Boolean(q.trim()) || onlyOpen}
                      badge={
                        <span className="flex items-center gap-1">
                          <span className="chip bg-neutral-100 text-neutral-500">역할 {d.total}</span>
                          {d.unassigned > 0 && (
                            <span className="chip bg-red-100 text-red-700">미정 {d.unassigned}</span>
                          )}
                        </span>
                      }
                      right={
                        isAdmin ? (
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
                        ) : undefined
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
                        <div className="space-y-3">
                          {d.groups.map((g) => (
                            <div key={g.group.id}>
                              <div className="mb-1 flex items-center gap-1.5">
                                <p className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-neutral-500">
                                  {g.group.name}
                                </p>
                                {g.unassigned > 0 && (
                                  <span className="chip shrink-0 bg-red-100 text-red-700">미정 {g.unassigned}</span>
                                )}
                                {isAdmin && (
                                  <button
                                    onClick={() => {
                                      setGroupSheet({ group: g.group, deptId: d.dept.id, deptName: d.dept.name });
                                      setNameDraft(g.group.name);
                                      setSheetErr('');
                                    }}
                                    aria-label={`${g.group.name} 고치기`}
                                    className="tap -my-3 w-8 shrink-0 text-neutral-300"
                                  >
                                    <Icon name="dots" size={14} />
                                  </button>
                                )}
                              </div>
                              <ul className="divide-y divide-neutral-100 border-t border-neutral-100">
                                {g.duties.map((n) => dutyRow(n, `${d.dept.name} › ${g.group.name}`))}
                              </ul>
                              {isAdmin && (
                                <button
                                  onClick={() =>
                                    setEditing({
                                      duty: null,
                                      groupId: g.group.id,
                                      label: `${d.dept.name} › ${g.group.name}`,
                                    })
                                  }
                                  className="-my-3 flex min-h-[44px] items-center gap-1 text-[12.5px] font-bold text-brand"
                                >
                                  <Icon name="plus" size={13} />
                                  역할 추가
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {isAdmin && (
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
                      )}
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
        duty={editing?.duty ?? null}
        members={members}
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
                      ? 'border-brand bg-brand text-white'
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

      {toast.node}
    </div>
  );
}
