'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { logActivity } from '@/lib/log';
import { sendPush } from '@/lib/push';
import { ddayClass, ddayLabel, korDate } from '@/lib/format';
import { todayStr } from '@/lib/task';
import {
  canRespond,
  inbox,
  isLate,
  nextInFlow,
  notifyBody,
  notifyTargets,
  sortRequests,
  targetOrder,
} from '@/lib/collab';
import { PageHeader } from '@/components/PageHeader';
import { Avatar } from '@/components/Brand';
import { Icon } from '@/components/Icon';
import { CardSkeleton, ConfirmDialog, EmptyState, ErrorBanner, Sheet, useToast } from '@/components/ui';
import {
  COLLAB_PRIORITIES,
  COLLAB_STATES,
  type CollabComment,
  type CollabPriority,
  type CollabRequest,
  type CollabStatus,
  type Department,
  type Duty,
  type DutyHelper,
} from '@/lib/types';

type Box = 'received' | 'sent' | 'all';

/**
 * 부서 협업 — 부서가 부서에게 요청/지시를 보내고, 받은 쪽이 상태를 바꾼다.
 *
 * **업무(/task)와 축이 다르다.** 저쪽은 *1건 × 담당자 1명 × 기한* 이라
 * 급한 순 한 줄이면 됐다. 이쪽은 받는 쪽이 사람이 아니라 팀이고,
 * 받아들일지 말지가 상대에게 있어서 **편지함(받은 것/보낸 것)** 이 기본 축이다.
 *
 * 내 부서는 **역할분장에서 파생한다** — 팀장이거나, 그 부서 역할의 주담당·부담당이면
 * 그 부서 사람이다. 새 소속 표를 만들지 않는다 (`/verify` 가 새 표 없이 만들어진 것과
 * 같은 방식). 대신 **역할이 하나도 없으면 어느 부서에도 안 묶인다** — 지금 담당자가
 * 0명이라 흔한 경우라서, 그때 무엇을 해야 하는지 화면에서 알려준다.
 *
 * 계산은 전부 `src/lib/collab.ts` 에 있고 `scripts/collab.test.mjs` 가 지킨다.
 */
export default function CollabPage() {
  const { session, isAdmin } = useSession();
  const router = useRouter();
  const { members, nameOf } = useMembers();
  const toast = useToast();

  const [depts, setDepts] = useState<Department[] | null>(null);
  const [duties, setDuties] = useState<Duty[]>([]);
  const [helpers, setHelpers] = useState<DutyHelper[]>([]);
  const [groups, setGroups] = useState<{ id: string; dept_id: string }[]>([]);
  const [list, setList] = useState<CollabRequest[]>([]);
  const [error, setError] = useState('');

  /* 원장은 `전체` 로 시작한다. 총괄하는 쪽이라 자기 부서 받은함이 비어 있는 날이 많은데,
     거기서 시작하면 다른 부서에 요청이 쌓여 있어도 **빈 화면**을 본다
     (업무 화면에서 원장이 빈 '내 업무' 로 시작하던 것과 같은 판단) */
  const [box, setBox] = useState<Box>('received');
  useEffect(() => {
    if (isAdmin) setBox('all');
  }, [isAdmin]);
  const [statusFilter, setStatusFilter] = useState<CollabStatus | 'open'>('open');

  // 새 요청 폼
  const [formOpen, setFormOpen] = useState(false);
  const [fromDept, setFromDept] = useState('');
  const [toDept, setToDept] = useState('');
  const [project, setProject] = useState('');
  const [body, setBody] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<CollabPriority>('normal');
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);

  // 상세
  const [open, setOpen] = useState<CollabRequest | null>(null);
  const [comments, setComments] = useState<CollabComment[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [killing, setKilling] = useState<CollabRequest | null>(null);

  const meId = session?.id ?? '';
  const today = todayStr();

  const load = useCallback(async () => {
    setError('');
    try {
      const [d, g, u, h, r] = await Promise.all([
        supabase.from('departments').select('*').order('sort_order').order('name'),
        supabase.from('duty_groups').select('id,dept_id'),
        supabase.from('duties').select('*'),
        supabase.from('duty_helpers').select('*'),
        supabase.from('collab_requests').select('*'),
      ]);
      if (r.error) throw r.error;
      setDepts((d.data ?? []) as Department[]);
      setGroups((g.data ?? []) as { id: string; dept_id: string }[]);
      setDuties((u.data ?? []) as Duty[]);
      setHelpers((h.data ?? []) as DutyHelper[]);
      setList((r.data ?? []) as CollabRequest[]);
    } catch (e) {
      setError(friendlyError(e, '협업 요청을 불러오지 못했어요.'));
      setDepts([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const deptList = useMemo(() => depts ?? [], [depts]);

  /** 역할 → 부서 되짚기용 */
  const deptOfGroup = useMemo(() => new Map(groups.map((g) => [g.id, g.dept_id])), [groups]);

  /**
   * 내 부서 — 팀장이거나, 그 부서 역할의 주담당·부담당이면 그 부서 사람이다.
   * 새 소속 표를 만들지 않고 역할분장에서 파생한다.
   */
  const myDeptIds = useMemo(() => {
    const s = new Set<string>();
    for (const d of deptList) if (d.head_id === meId) s.add(d.id);
    const mine = new Set(duties.filter((x) => x.owner_id === meId).map((x) => x.group_id));
    for (const hp of helpers) {
      if (hp.member_id !== meId) continue;
      const duty = duties.find((x) => x.id === hp.duty_id);
      if (duty) mine.add(duty.group_id);
    }
    for (const gid of mine) {
      const dep = deptOfGroup.get(gid);
      if (dep) s.add(dep);
    }
    return [...s];
  }, [deptList, duties, helpers, deptOfGroup, meId]);

  const boxes = useMemo(() => inbox(list, myDeptIds, today), [list, myDeptIds, today]);

  const shown = useMemo(() => {
    const base =
      box === 'received' ? boxes.received : box === 'sent' ? boxes.sent : sortRequests(list, today);
    if (statusFilter === 'open') return base.filter((r) => r.status !== 'done');
    return base.filter((r) => r.status === statusFilter);
  }, [box, boxes, list, statusFilter, today]);

  const deptName = useCallback(
    (id: string) => deptList.find((d) => d.id === id)?.name ?? '(없는 부서)',
    [deptList],
  );
  const adminIds = useMemo(() => members.filter((m) => m.role === 'admin').map((m) => m.id), [members]);

  /* ------------------------------------------------------------ 새 요청 */

  const startNew = () => {
    const from = myDeptIds[0] ?? deptList[0]?.id ?? '';
    setFromDept(from);
    // 흐름상 다음 부서를 먼저 고른 상태로 — 막지는 않는다
    setToDept(nextInFlow(deptList, from)?.id ?? '');
    setProject('');
    setBody('');
    setDue('');
    setPriority('normal');
    setFormErr('');
    setFormOpen(true);
  };

  const save = async () => {
    setFormErr('');
    if (!fromDept) return setFormErr('보내는 부서를 골라주세요.');
    if (!toDept) return setFormErr('받는 부서를 골라주세요.');
    if (fromDept === toDept) return setFormErr('같은 부서끼리는 보낼 수 없어요.');
    if (!body.trim()) return setFormErr('무엇을 부탁하는지 적어주세요.');

    setBusy(true);
    try {
      const { data, error: e } = await supabase
        .from('collab_requests')
        .insert({
          from_dept_id: fromDept,
          to_dept_id: toDept,
          project: project.trim() || null,
          body: body.trim(),
          due_date: due || null,
          priority,
          created_by: meId || null,
        })
        .select()
        .single();
      if (e) throw e;

      logActivity(session?.id, `협업 요청 — ${deptName(fromDept)} → ${deptName(toDept)}`, `collab:${data.id}`);

      /* 받는 부서 팀장에게. 팀장이 없으면 원장에게 — 아무에게도 안 가면 요청이 묻힌다 */
      const targets = notifyTargets({ to_dept_id: toDept }, deptList, adminIds);
      if (targets.length > 0) {
        sendPush({
          title: `${deptName(toDept)}에 협업 요청이 왔어요`,
          body: notifyBody(deptName(fromDept), project.trim() || null, due ? korDate(due) : null),
          url: '/collab',
          tag: `collab-${data.id}`,
          memberIds: targets,
          fromId: meId || undefined,
        });
      }

      setFormOpen(false);
      toast.show(
        targets.length > 0 ? '요청을 보냈어요. 알림도 갔어요.' : '요청을 보냈어요.',
      );
      await load();
    } catch (e) {
      setFormErr(friendlyError(e, '보내지 못했어요. 다시 눌러주세요.'));
    } finally {
      setBusy(false);
    }
  };

  /* -------------------------------------------------------------- 상태 */

  const setStatus = async (r: CollabRequest, status: CollabStatus) => {
    if (r.status === status) return;
    const before = list;
    const now = new Date().toISOString();
    const patch = {
      status,
      accepted_by: status === 'requested' ? null : (r.accepted_by ?? meId ?? null),
      done_at: status === 'done' ? now : null,
      updated_at: now,
    };
    setList((v) => v.map((x) => (x.id === r.id ? { ...x, ...patch } : x)));
    setOpen((v) => (v && v.id === r.id ? { ...v, ...patch } : v));

    const { error: e } = await supabase.from('collab_requests').update(patch).eq('id', r.id);
    if (e) {
      setList(before);
      setError(friendlyError(e, '상태를 바꾸지 못했어요.'));
      return;
    }
    const label = COLLAB_STATES.find((s) => s.value === status)?.label ?? status;
    logActivity(session?.id, `협업 요청 ${label} — ${deptName(r.to_dept_id)}`, `collab:${r.id}`);

    /* 보낸 쪽이 결과를 알아야 한다 — 보낸 부서 팀장(없으면 원장)에게 */
    const back = notifyTargets({ to_dept_id: r.from_dept_id }, deptList, adminIds);
    if (back.length > 0) {
      sendPush({
        title: `${deptName(r.to_dept_id)} — ${label}`,
        body: r.project ? r.project : r.body.slice(0, 40),
        url: '/collab',
        tag: `collab-${r.id}`,
        memberIds: back,
        fromId: meId || undefined,
      });
    }
  };

  /* ------------------------------------------------------------- 코멘트 */

  const openDetail = async (r: CollabRequest) => {
    setOpen(r);
    setCommentDraft('');
    setComments([]);
    const { data } = await supabase
      .from('collab_comments')
      .select('*')
      .eq('request_id', r.id)
      .order('created_at');
    setComments((data ?? []) as CollabComment[]);
  };

  const addComment = async () => {
    if (!open || !commentDraft.trim()) return;
    const text = commentDraft.trim();
    setCommentDraft('');
    const { data, error: e } = await supabase
      .from('collab_comments')
      .insert({ request_id: open.id, member_id: meId || null, body: text })
      .select()
      .single();
    if (e) {
      setCommentDraft(text);
      setError(friendlyError(e, '코멘트를 남기지 못했어요.'));
      return;
    }
    setComments((v) => [...v, data as CollabComment]);

    /* 상대 부서 팀장에게 한 통 — 내가 받는 쪽이면 보낸 쪽에, 보낸 쪽이면 받는 쪽에 */
    const otherDept = myDeptIds.includes(open.to_dept_id) ? open.from_dept_id : open.to_dept_id;
    const targets = notifyTargets({ to_dept_id: otherDept }, deptList, adminIds);
    if (targets.length > 0) {
      sendPush({
        title: '협업 요청에 새 코멘트',
        body: text.slice(0, 60),
        url: '/collab',
        tag: `collab-${open.id}`,
        memberIds: targets,
        fromId: meId || undefined,
      });
    }
  };

  /** 이 건으로 대화하기 — 1:1 방을 열고 첫 마디를 미리 채운 채로 넘어간다 */
  const talkTo = async (memberId: string, draft: string) => {
    const res = await fetch('/api/chat/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-session-token': session?.token ?? '' },
      body: JSON.stringify({ memberId }),
    }).catch(() => null);
    if (!res?.ok) {
      const j = await res?.json().catch(() => ({}));
      setError(j?.error ?? '대화방을 열지 못했어요. 다시 로그인해보세요.');
      return;
    }
    const { roomId } = await res.json();
    router.push(`/chat/${roomId}?draft=${encodeURIComponent(draft)}`);
  };

  const remove = async () => {
    if (!killing) return;
    const { error: e } = await supabase.from('collab_requests').delete().eq('id', killing.id);
    if (e) {
      setError(friendlyError(e, '지우지 못했어요.'));
      setKilling(null);
      return;
    }
    logActivity(session?.id, `협업 요청 삭제 — ${deptName(killing.to_dept_id)}`, 'collab');
    setKilling(null);
    setOpen(null);
    toast.show('지웠어요.');
    await load();
  };

  /* -------------------------------------------------------------- 렌더 */

  const openCount = boxes.received.filter((r) => r.status !== 'done').length;
  const lateCount = boxes.received.filter((r) => isLate(r, today)).length;
  const noDept = myDeptIds.length === 0;

  return (
    <div>
      <PageHeader
        title="부서협업"
        subtitle={
          depts === null
            ? '불러오는 중…'
            : noDept
              ? '아직 소속 부서가 없어요'
              : `받은 요청 ${openCount}건${lateCount > 0 ? ` · 기한 지남 ${lateCount}` : ''}`
        }
        right={
          <button onClick={startNew} className="btn-primary px-3 text-[13.5px]">
            <Icon name="plus" size={15} />
            요청
          </button>
        }
      />

      <div className="px-4 pb-8 pt-3 lg:px-0">
        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} onRetry={() => void load()} />
          </div>
        )}

        {/* 소속이 없으면 받은함이 늘 비어 있다. 왜 그런지, 무엇을 해야 하는지 적어준다 —
            지금 역할 담당자가 0명이라 다섯 분 모두 이 상태다 */}
        {depts !== null && noDept && (
          <div className="card mb-3 border-brand/30 bg-brand-50 p-3.5">
            <p className="text-[13px] font-bold text-brand-700">아직 어느 부서에도 안 묶여 있어요</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-neutral-600">
              <b>역할분장</b> 에서 역할의 담당자로 내 이름을 넣거나, 원장님이 부서 <b>팀장</b> 으로
              지정하면 그 부서 사람이 됩니다. 그때부터 받은 요청이 여기 모여요.
            </p>
          </div>
        )}

        {/* 받은 것 / 보낸 것 — 이 화면의 기본 축이다 */}
        <div className="mb-2.5 flex gap-1.5">
          {(
            [
              ['received', '받은 요청'],
              ['sent', '보낸 요청'],
              ...(isAdmin ? ([['all', '전체']] as [Box, string][]) : []),
            ] as [Box, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setBox(v)}
              aria-pressed={box === v}
              className={`tap flex-1 rounded-xl border text-[13px] font-bold transition ${
                box === v ? 'pick-on' : 'border-neutral-200 bg-surface text-neutral-500'
              }`}
            >
              {label}
              {v === 'received' && openCount > 0 && (
                <span className={`ml-1 ${box === v ? 'text-white/80' : 'text-brand'}`}>{openCount}</span>
              )}
            </button>
          ))}
        </div>

        {/* 상태 — 한 줄 가로 스크롤 (여러 줄로 깔면 목록이 밀린다) */}
        <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
          <Chip on={statusFilter === 'open'} onClick={() => setStatusFilter('open')}>
            진행 중인 것
          </Chip>
          {COLLAB_STATES.map((s) => (
            <Chip key={s.value} on={statusFilter === s.value} onClick={() => setStatusFilter(s.value)}>
              {s.label}
            </Chip>
          ))}
        </div>

        {depts === null ? (
          <CardSkeleton rows={3} />
        ) : shown.length === 0 ? (
          <EmptyState
            icon="megaphone"
            title={
              box === 'received' ? '받은 요청이 없어요' : box === 'sent' ? '보낸 요청이 없어요' : '요청이 없어요'
            }
            desc={
              box === 'sent'
                ? '오른쪽 위 “요청” 으로 다른 부서에 일을 부탁해보세요. 예: 영업마케팅부 → 기획개발부 “○○중 3학년 4차시, 9/20까지 교안 필요”'
                : '다른 부서가 우리 부서에 요청을 보내면 여기 모입니다.'
            }
          />
        ) : (
          <ul className="space-y-2">
            {shown.map((r) => (
              <RequestCard
                key={r.id}
                r={r}
                fromName={deptName(r.from_dept_id)}
                toName={deptName(r.to_dept_id)}
                today={today}
                canAct={canRespond(r, deptList, meId, isAdmin)}
                onState={(s) => void setStatus(r, s)}
                onOpen={() => void openDetail(r)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* --------------------------------------------------------- 새 요청 */}
      <Sheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="협업 요청 보내기"
        footer={
          <button onClick={() => void save()} disabled={busy} className="btn-primary w-full">
            {busy ? '보내는 중…' : '보내기'}
          </button>
        }
      >
        <div className="space-y-4">
          {formErr && <ErrorBanner message={formErr} />}

          <div>
            <span className="label">보내는 부서</span>
            <div className="flex flex-wrap gap-2">
              {deptList.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    setFromDept(d.id);
                    if (toDept === d.id) setToDept(nextInFlow(deptList, d.id)?.id ?? '');
                  }}
                  className={`tap rounded-full border px-3.5 text-[13.5px] font-semibold transition ${
                    fromDept === d.id
                      ? 'pick-on'
                      : 'border-neutral-300 bg-surface text-neutral-600'
                  }`}
                >
                  {d.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="label">받는 부서</span>
            <div className="flex flex-wrap gap-2">
              {targetOrder(deptList, fromDept).map((d, i) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setToDept(d.id)}
                  className={`tap rounded-full border px-3.5 text-[13.5px] font-semibold transition ${
                    toDept === d.id
                      ? 'pick-on'
                      : 'border-neutral-300 bg-surface text-neutral-600'
                  }`}
                >
                  {d.name}
                  {/* 흐름상 다음 부서를 짚어준다 — 고르는 걸 막지는 않는다 */}
                  {i === 0 && nextInFlow(deptList, fromDept)?.id === d.id && (
                    <span className={`ml-1 text-[11px] ${toDept === d.id ? 'text-white/75' : 'text-brand'}`}>
                      다음 단계
                    </span>
                  )}
                </button>
              ))}
            </div>
            {(() => {
              const to = deptList.find((d) => d.id === toDept);
              if (!to) return null;
              return to.head_id ? (
                <p className="mt-1.5 text-[11.5px] text-neutral-400">
                  팀장 {nameOf(to.head_id)} 님에게 알림이 갑니다.
                </p>
              ) : (
                <p className="mt-1.5 text-[11.5px] text-brand">
                  이 부서에 팀장이 없어서 <b>원장님</b> 에게 알림이 갑니다. (역할분장에서 팀장을 정할 수 있어요)
                </p>
              );
            })()}
          </div>

          <div>
            <label className="label" htmlFor="collab-project">
              프로젝트명 — 없어도 돼요
            </label>
            <input
              id="collab-project"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="○○중 3학년 4차시"
              className="field"
            />
          </div>

          <div>
            <label className="label" htmlFor="collab-body">
              무엇을 부탁하나요
            </label>
            <textarea
              id="collab-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder="계약 확정됐습니다. 9/20까지 교안이 필요해요."
              className="field"
            />
          </div>

          <div>
            <label className="label" htmlFor="collab-due">
              기한
            </label>
            <input
              id="collab-due"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="field"
            />
          </div>

          <div>
            <span className="label">중요도</span>
            <div className="flex gap-2">
              {COLLAB_PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPriority(p.value)}
                  className={`tap flex-1 rounded-xl border text-[13.5px] font-semibold transition ${
                    priority === p.value
                      ? 'pick-on'
                      : 'border-neutral-300 bg-surface text-neutral-600'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Sheet>

      {/* ----------------------------------------------------------- 상세 */}
      <Sheet open={Boolean(open)} onClose={() => setOpen(null)} title="협업 요청">
        {open && (
          <div className="space-y-4">
            <div className="card p-3.5">
              <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-bold text-neutral-500">
                {deptName(open.from_dept_id)}
                <Icon name="chevronDown" size={12} className="-rotate-90 text-neutral-300" />
                {deptName(open.to_dept_id)}
              </p>
              {open.project && (
                <p className="mt-1.5 text-[15px] font-bold text-neutral-900">{open.project}</p>
              )}
              <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-neutral-700">
                {open.body}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-neutral-400">
                <span className={`chip ${COLLAB_PRIORITIES.find((p) => p.value === open.priority)?.chip}`}>
                  {COLLAB_PRIORITIES.find((p) => p.value === open.priority)?.label}
                </span>
                {open.due_date && (
                  <span className={`chip ${ddayClass(open.due_date)}`}>{ddayLabel(open.due_date)}</span>
                )}
                {open.due_date && <span>{korDate(open.due_date)}까지</span>}
                {open.created_by && <span>보낸 사람 {nameOf(open.created_by)}</span>}
              </div>
            </div>

            {/* ①→③ — 이 건으로 바로 대화하기.
                상대 부서 **팀장과 1:1** 을 연다. 상대 부서 단톡방은 내가 멤버가 아니라
                열어도 말을 못 넣는다. 첫 마디는 미리 채워만 두고 보내지 않는다 —
                자동으로 나가면 잘못 눌렀을 때 되돌릴 수가 없다 */}
            {(() => {
              const otherDept = myDeptIds.includes(open.to_dept_id) ? open.from_dept_id : open.to_dept_id;
              const head = deptList.find((d) => d.id === otherDept)?.head_id;
              if (!head || head === meId) return null;
              const draft = `[${open.project || deptName(open.to_dept_id)}] `;
              return (
                <button
                  onClick={() => void talkTo(head, draft)}
                  className="tap w-full rounded-xl border border-brand bg-brand-50 text-[14px] font-bold text-brand-700"
                >
                  {nameOf(head)}님과 이 건으로 대화하기
                </button>
              );
            })()}

            {canRespond(open, deptList, meId, isAdmin) ? (
              <div>
                <span className="label">상태 바꾸기</span>
                <div className="flex gap-1.5">
                  {COLLAB_STATES.map((s) => {
                    const on = open.status === s.value;
                    return (
                      <button
                        key={s.value}
                        onClick={() => void setStatus(open, s.value)}
                        aria-pressed={on}
                        className={`h-11 flex-1 rounded-lg border text-[12.5px] font-bold transition ${
                          on ? s.on : 'border-neutral-200 bg-surface text-neutral-400'
                        }`}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="rounded-xl bg-neutral-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-neutral-500">
                받는 부서 팀장{' '}
                {(() => {
                  const to = deptList.find((d) => d.id === open.to_dept_id);
                  return to?.head_id ? `(${nameOf(to.head_id)})` : '';
                })()}{' '}
                또는 원장님이 상태를 바꿉니다. 코멘트는 누구나 남길 수 있어요.
              </p>
            )}

            <div>
              <span className="label">코멘트</span>
              {comments.length === 0 ? (
                <p className="py-2 text-[12.5px] text-neutral-400">아직 오간 말이 없어요.</p>
              ) : (
                <ul className="space-y-2">
                  {comments.map((c) => (
                    <li key={c.id} className="flex gap-2">
                      <Avatar name={nameOf(c.member_id)} size={24} />
                      <div className="min-w-0 flex-1 rounded-xl bg-neutral-50 px-3 py-2">
                        <p className="text-[11.5px] font-bold text-neutral-500">
                          {nameOf(c.member_id)}
                          <span className="ml-1.5 font-normal text-neutral-400">
                            {korDate(c.created_at.slice(0, 10))}
                          </span>
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-700">
                          {c.body}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-2 flex items-end gap-2">
                <textarea
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  rows={2}
                  placeholder="확인했습니다. 금요일까지 초안 드릴게요."
                  aria-label="코멘트"
                  className="field min-w-0 flex-1"
                />
                <button
                  onClick={() => void addComment()}
                  disabled={!commentDraft.trim()}
                  className="btn-primary h-11 shrink-0 px-4 text-[13.5px]"
                >
                  남기기
                </button>
              </div>
            </div>

            {/* 지우기는 보낸 사람이나 원장만 — 남이 받은 요청을 없애면 안 된다 */}
            {(isAdmin || open.created_by === meId) && (
              <button
                onClick={() => setKilling(open)}
                className="tap w-full gap-1.5 rounded-xl border border-neutral-300 text-[13px] font-bold text-neutral-500"
              >
                <Icon name="trash" size={14} />이 요청 지우기
              </button>
            )}
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={Boolean(killing)}
        title="이 요청을 지울까요?"
        message="오간 코멘트도 같이 사라져요."
        onCancel={() => setKilling(null)}
        onConfirm={() => void remove()}
      />

      {toast.node}
    </div>
  );
}

/* ------------------------------------------------------------------ 조각 */

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`tap shrink-0 rounded-full border px-3.5 text-[12.5px] font-bold transition ${
        on ? 'pick-on' : 'border-neutral-300 bg-surface text-neutral-500'
      }`}
    >
      {children}
    </button>
  );
}

function RequestCard({
  r,
  fromName,
  toName,
  today,
  canAct,
  onState,
  onOpen,
}: {
  r: CollabRequest;
  fromName: string;
  toName: string;
  today: string;
  canAct: boolean;
  onState: (s: CollabStatus) => void;
  onOpen: () => void;
}) {
  const done = r.status === 'done';
  const late = isLate(r, today);
  const pr = COLLAB_PRIORITIES.find((p) => p.value === r.priority);

  return (
    <li className="card p-3">
      {/* 카드 전체가 상세로 들어가는 문이다 — 폰에서 작은 링크를 찾게 하지 않는다 */}
      <button onClick={onOpen} className="w-full text-left">
        <p className="flex flex-wrap items-center gap-1 text-[11.5px] font-bold text-neutral-400">
          {fromName}
          <Icon name="chevronDown" size={11} className="-rotate-90 text-neutral-300" />
          {toName}
          {r.priority !== 'normal' && <span className={`chip ml-0.5 ${pr?.chip}`}>{pr?.label}</span>}
        </p>
        <p
          className={`mt-1 text-[14.5px] font-semibold ${done ? 'text-neutral-400 line-through' : 'text-neutral-800'}`}
        >
          {r.project || r.body.slice(0, 40)}
        </p>
        {r.project && (
          <p className="mt-0.5 truncate text-[12.5px] text-neutral-500">{r.body}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-neutral-400">
          {r.due_date && !done && (
            <span className={`chip ${late ? 'bg-red-100 text-red-700' : ddayClass(r.due_date)}`}>
              {ddayLabel(r.due_date)}
            </span>
          )}
          {r.due_date && <span>{korDate(r.due_date)}까지</span>}
        </div>
      </button>

      {/* 상태 3버튼 — 업무 카드와 같은 모양이라 새로 배울 게 없다.
          받는 쪽 팀장·원장만 눌린다 (팀장이 없으면 막지 않는다) */}
      <div className="mt-2 flex gap-1.5" role="group" aria-label={`${r.project || '요청'} 상태`}>
        {COLLAB_STATES.map((s) => {
          const on = r.status === s.value;
          return (
            <button
              key={s.value}
              onClick={() => onState(s.value)}
              disabled={!canAct}
              aria-pressed={on}
              aria-label={`${r.project || '요청'} ${s.label}`}
              className={`h-11 flex-1 rounded-lg border text-[12.5px] font-bold transition disabled:opacity-40 ${
                on ? s.on : 'border-neutral-200 bg-surface text-neutral-400'
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </li>
  );
}
