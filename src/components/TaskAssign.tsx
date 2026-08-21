'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { logActivity } from '@/lib/log';
import { sendPush } from '@/lib/push';
import { korDate } from '@/lib/format';
import { sortTasks, todayStr } from '@/lib/task';
import { Avatar } from '@/components/Brand';
import { Icon } from '@/components/Icon';
import { ErrorBanner, Sheet } from '@/components/ui';
import type { Task } from '@/lib/types';

const NO_OWNER = '담당자 미정';
/** 담당자 미정으로 되돌리기. '' 는 **아직 안 골랐다** 는 뜻이라 따로 둔다 */
const CLEAR = 'none';

/**
 * 업무를 체크해서 한 사람에게 **한꺼번에** 넘긴다. 원장만.
 *
 * 말로 넣기·체크리스트로 뿌리기는 업무를 여러 건 만들어놓고 담당자를 비워두는
 * 일이 흔하다. 그걸 하나씩 [⋯ → 고치기 → 담당자 → 저장] 으로 채우면
 * 5건에 20번을 눌러야 한다 — `주제로 옮기기` 와 똑같은 문제라 똑같이 푼다.
 *
 * 그래서 카드가 아니라 **한 줄짜리 목록**이고, 저장은 `update ... in (...)`
 * **요청 하나**다. 알림도 **사람당 한 통**이다 (뿌리기와 같은 규칙 —
 * 5건 넘겼는데 5통이 오면 그날로 알림을 꺼버린다).
 */
export function TaskAssign({
  open,
  onClose,
  tasks,
  onAssigned,
}: {
  open: boolean;
  onClose: () => void;
  tasks: Task[];
  onAssigned: (count: number, who: string) => void;
}) {
  const { session } = useSession();
  const { members } = useMembers();
  const [checked, setChecked] = useState<string[]>([]);
  /**
   * 누구에게 넘길지. `''` = 아직 안 고름 / `CLEAR` = 담당자 미정으로 되돌리기.
   *
   * **처음부터 사람이 하나 골라져 있으면 안 된다.** 목록 맨 위는 원장 자신이라,
   * 5건을 체크하고 옆의 넘기기를 그냥 누르면 전부 자기한테 오고 **알림까지 나간다.**
   * 여러 건이 한 번에 움직이는 동작이라 되돌리는 것도 여러 번이다.
   */
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const today = todayStr();

  // 열 때마다 초기화 — 지난번 선택이 남아 있으면 엉뚱한 걸 넘긴다
  useEffect(() => {
    if (open) {
      setChecked([]);
      setError('');
      setTarget('');
    }
  }, [open, members]);

  /** 지금 사람별로 묶어서 보여준다. **담당자 미정부터** — 그게 채워야 할 것이다 */
  const groups = useMemo(() => {
    const live = tasks.filter((t) => t.state !== 'done');
    const nameOf = (id: string | null) =>
      id ? (members.find((m) => m.id === id)?.name ?? '(없는 멤버)') : NO_OWNER;

    const m = new Map<string, Task[]>();
    for (const t of live) {
      const who = nameOf(t.assignee_id);
      const list = m.get(who) ?? [];
      list.push(t);
      m.set(who, list);
    }
    const order = new Map(members.map((x, i) => [x.name, i]));
    return [...m.entries()]
      .map(([name, list]) => ({ name, list: sortTasks(list, today) }))
      .sort((a, b) => {
        if (a.name === NO_OWNER) return -1;
        if (b.name === NO_OWNER) return 1;
        return (order.get(a.name) ?? 9999) - (order.get(b.name) ?? 9999);
      });
  }, [tasks, members, today]);

  const toggle = (id: string) =>
    setChecked((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));

  const toggleGroup = (list: Task[]) => {
    const ids = list.map((t) => t.id);
    const allOn = ids.every((id) => checked.includes(id));
    setChecked((v) => (allOn ? v.filter((x) => !ids.includes(x)) : [...new Set([...v, ...ids])]));
  };

  const targetName = target === CLEAR ? NO_OWNER : (members.find((m) => m.id === target)?.name ?? '');

  const assign = async () => {
    setError('');
    if (checked.length === 0) {
      setError('넘길 업무를 골라주세요.');
      return;
    }
    if (!target) {
      setError('누구에게 넘길지 골라주세요.');
      return;
    }
    setBusy(true);
    try {
      // 여러 건을 한 번에 — 20건도 요청 하나로 끝난다
      const { error: e } = await supabase
        .from('tasks')
        .update({ assignee_id: target === CLEAR ? null : target, updated_at: new Date().toISOString() })
        .in('id', checked);
      if (e) throw e;

      logActivity(session?.id, `업무 배정 — ${checked.length}건을 ${targetName} 에게`, 'tasks');

      // 사람당 한 통. 담당자 미정으로 되돌릴 때는 보낼 곳이 없다
      if (target !== CLEAR) {
        const picked = tasks.filter((t) => checked.includes(t.id));
        const first = picked[0];
        const nextDue = picked
          .map((t) => t.due_date)
          .filter((d): d is string => !!d)
          .sort()[0];
        sendPush({
          title: picked.length === 1 ? '새 업무가 왔어요' : `새 업무 ${picked.length}건이 왔어요`,
          body:
            (picked.length === 1 ? first.title : `${first.title} 외 ${picked.length - 1}건`) +
            (nextDue ? ` — ${korDate(nextDue)}까지` : ''),
          url: '/task',
          tag: 'task-assign',
          memberIds: [target],
          fromId: session?.id,
        });
      }

      onAssigned(checked.length, targetName);
      onClose();
    } catch (e) {
      setError(friendlyError(e, '넘기지 못했어요. 다시 눌러주세요.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="업무 나눠주기"
      footer={
        <div className="space-y-2">
          {error && <ErrorBanner message={error} />}
          <div className="flex items-center gap-2">
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-label="누구에게 넘길지"
              className="field flex-1"
            >
              <option value="">누구에게 넘길까요</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
              <option value={CLEAR}>{NO_OWNER} 으로 되돌리기</option>
            </select>
            <button
              onClick={() => void assign()}
              disabled={busy || checked.length === 0 || !target}
              className="btn-primary shrink-0 px-4"
            >
              {busy ? '넘기는 중…' : `${checked.length}건 넘기기`}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] leading-relaxed text-neutral-500">
          넘길 업무를 체크하고, 아래에서 사람을 골라 <b>넘기기</b> 를 누르세요. 알림은{' '}
          <b>사람당 한 통</b>만 갑니다.
        </p>

        {groups.length === 0 ? (
          <p className="rounded-xl bg-neutral-50 px-3 py-4 text-center text-[13px] text-neutral-400">
            나눠줄 업무가 없어요.
          </p>
        ) : (
          groups.map((g) => {
            const ids = g.list.map((t) => t.id);
            const allOn = ids.every((id) => checked.includes(id));
            return (
              <div key={g.name}>
                <button
                  onClick={() => toggleGroup(g.list)}
                  /* 패딩으로 44px 을 만들고 마진으로 되돌린다 — 손가락은 닿고 줄 높이는 그대로 */
                  className="-my-3 flex min-h-[44px] w-full items-center gap-1.5 py-3 text-left"
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      allOn ? 'border-brand bg-brand text-white' : 'border-neutral-300'
                    }`}
                  >
                    {allOn && <Icon name="check" size={10} strokeWidth={3.5} />}
                  </span>
                  <span
                    className={`text-[12px] font-bold ${
                      g.name === NO_OWNER ? 'text-red-600' : 'text-neutral-500'
                    }`}
                  >
                    {g.name} {g.list.length}건
                  </span>
                  <span className="text-[11px] text-neutral-400">· 묶음 전체 선택</span>
                </button>

                <ul className="mt-2 overflow-hidden rounded-xl border border-neutral-200">
                  {g.list.map((t, i) => {
                    const on = checked.includes(t.id);
                    return (
                      <li key={t.id} className={i > 0 ? 'border-t border-neutral-100' : ''}>
                        <button
                          onClick={() => toggle(t.id)}
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
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-semibold text-neutral-900">
                              {t.title}
                            </span>
                            <span className="block truncate text-[11px] text-neutral-400">
                              {t.due_date ? korDate(t.due_date) : '기한 없음'}
                              {t.batch_title ? ` · ${t.batch_title}` : ''}
                            </span>
                          </span>
                          {g.name !== NO_OWNER && <Avatar name={g.name} size={20} />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
      </div>
    </Sheet>
  );
}
