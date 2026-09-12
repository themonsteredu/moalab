'use client';

import { useEffect, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { logActivity } from '@/lib/log';
import { sendPush } from '@/lib/push';
import { korDate } from '@/lib/format';
import { spreadNotices, todayStr } from '@/lib/task';
import type { NewTask } from '@/lib/task';
import type { ParsedTask } from '@/lib/taskParse';
import { Icon } from '@/components/Icon';
import { ErrorBanner, Sheet } from '@/components/ui';

/**
 * 말로 던진 지시를 업무로 — **원장만.**
 *
 * 음성인식은 앱이 하지 않는다. **폰 키보드의 마이크**를 그대로 쓴다 —
 * 아이폰·안드로이드 둘 다 확실하고, 잘못 들었을 때 그 자리에서 고칠 수 있다.
 * (앱 안에 마이크 버튼을 넣으면 아이폰 홈 화면 앱에서 막히는 경우가 있다)
 *
 * 쪼갠 결과는 **저장하지 않고 미리보기로만** 보여준다. 확인하고 고친 뒤에 넣는다.
 */
export function TaskDictate({
  open,
  onClose,
  onMade,
}: {
  open: boolean;
  onClose: () => void;
  onMade: (count: number, title: string) => void;
}) {
  const { session } = useSession();
  const { members, nameOf } = useMembers();

  const [text, setText] = useState('');
  const [rows, setRows] = useState<ParsedTask[] | null>(null);
  const [batchTitle, setBatchTitle] = useState('');
  const [error, setError] = useState('');
  const [parsing, setParsing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setText('');
    setRows(null);
    setBatchTitle(`말로 넣기 — ${korDate(todayStr())}`);
    setError('');
  }, [open]);

  const parse = async () => {
    setError('');
    if (!text.trim()) return setError('무슨 일을 시킬지 말하거나 적어주세요.');
    setParsing(true);
    try {
      const res = await fetch('/api/task/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-actor-id': session?.id ?? '' },
        body: JSON.stringify({ text: text.trim() }),
      });
      const data = (await res.json()) as { tasks?: ParsedTask[]; error?: string };
      if (!res.ok || !data.tasks) throw new Error(data.error ?? '정리하지 못했어요.');
      setRows(data.tasks);
    } catch (e) {
      setError(e instanceof Error ? e.message : '정리하지 못했어요. 다시 눌러주세요.');
    } finally {
      setParsing(false);
    }
  };

  const patch = (i: number, part: Partial<ParsedTask>) =>
    setRows((v) => (v ?? []).map((r, x) => (x === i ? { ...r, ...part } : r)));

  const drop = (i: number) => setRows((v) => (v ?? []).filter((_, x) => x !== i));

  const save = async () => {
    if (!rows || rows.length === 0) return;
    setError('');
    setBusy(true);
    try {
      const title = batchTitle.trim();
      const batchId = title ? crypto.randomUUID() : null;
      const payload: (NewTask & { created_by: string | null })[] = rows.map((r, i) => ({
        title: r.title,
        detail: r.detail,
        assignee_id: r.assignee_id,
        due_date: r.due_date,
        app_id: null,
        batch_id: batchId as string,
        batch_title: title,
        sort_order: i,
        created_by: session?.id ?? null,
      }));

      const { error: e } = await supabase.from('tasks').insert(payload);
      if (e) throw e;

      logActivity(session?.id, `말로 업무 ${payload.length}건 등록`, 'tasks');

      // 사람당 한 통 — 뿌리기와 같은 규칙이다
      for (const n of spreadNotices(payload)) {
        sendPush({
          title: `업무 ${n.count}건이 배정됐어요`,
          body: n.firstDue ? `가장 빠른 기한 ${korDate(n.firstDue)}` : (title || '새 업무'),
          url: '/task',
          tag: batchId ? `batch-${batchId}` : `dictate-${n.memberId}`,
          memberIds: [n.memberId],
          fromId: session?.id,
        });
      }

      onMade(payload.length, title || '말로 넣은 업무');
      onClose();
    } catch (e) {
      setError(friendlyError(e, '저장이 안 됐어요. 다시 눌러주세요.'));
    } finally {
      setBusy(false);
    }
  };

  const notices = rows
    ? spreadNotices(
        rows.map((r, i) => ({
          title: r.title,
          detail: r.detail,
          assignee_id: r.assignee_id,
          due_date: r.due_date,
          app_id: null,
          batch_id: 'preview',
          batch_title: '',
          sort_order: i,
        })),
      )
    : [];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="말로 업무 넣기"
      footer={
        rows === null ? (
          <button onClick={() => void parse()} disabled={parsing} className="btn-primary w-full">
            {parsing ? '정리하는 중…' : '업무로 쪼개기'}
          </button>
        ) : (
          <button onClick={() => void save()} disabled={busy || rows.length === 0} className="btn-primary w-full">
            {busy ? '만드는 중…' : `${rows.length}건 만들기`}
          </button>
        )
      }
    >
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}

        {rows === null ? (
          <>
            <div>
              <label className="label" htmlFor="dic-text">
                무엇을 시킬지 말해주세요
              </label>
              <textarea
                id="dic-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={7}
                placeholder="이서은은 다음 주 화요일까지 A초 제안서 초안 쓰고, 주은서는 금요일까지 제과제빵 재료 주문해줘. 강지연은 샘플 작품 사진 찍어서 올려주고."
                className="field resize-none leading-relaxed"
              />
              <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-400">
                <b>폰 키보드의 마이크</b>를 눌러 말해도 돼요. 잘못 들은 건 여기서 고치면 됩니다.
              </p>
            </div>
          </>
        ) : (
          <>
            <button
              onClick={() => setRows(null)}
              className="-my-2 flex items-center gap-1 py-2 text-[12.5px] font-bold text-neutral-400"
            >
              <span aria-hidden>‹</span> 다시 말하기
            </button>

            <div>
              <label className="label" htmlFor="dic-batch">
                묶음 이름 — 비우면 낱개로 들어가요
              </label>
              <input
                id="dic-batch"
                value={batchTitle}
                onChange={(e) => setBatchTitle(e.target.value)}
                className="field"
              />
              <p className="mt-1 text-[11.5px] text-neutral-400">
                이름을 두면 나중에 <b>묶음 통째로 지우거나 미룰 수 있어요.</b>
              </p>
            </div>

            <div>
              <p className="label">이렇게 알아들었어요 — 고쳐도 됩니다</p>
              <ul className="space-y-2">
                {rows.map((r, i) => (
                  <li key={i} className="rounded-xl border border-neutral-200 bg-surface p-2.5">
                    <div className="flex items-start gap-2">
                      <input
                        value={r.title}
                        onChange={(e) => patch(i, { title: e.target.value })}
                        aria-label={`${i + 1}번째 업무 제목`}
                        className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[14px] font-semibold text-neutral-800 outline-none"
                      />
                      <button
                        onClick={() => drop(i)}
                        aria-label={`${r.title} 빼기`}
                        className="-my-1 w-7 shrink-0 py-1 text-neutral-400"
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                    {r.detail && (
                      <p className="mt-1 text-[12px] leading-relaxed text-neutral-500">{r.detail}</p>
                    )}
                    <div className="mt-1.5 flex gap-2">
                      <select
                        value={r.assignee_id ?? ''}
                        onChange={(e) => patch(i, { assignee_id: e.target.value || null })}
                        aria-label={`${r.title} 담당자`}
                        className={`h-9 min-w-0 flex-1 rounded-lg border bg-surface px-2 text-[12.5px] ${
                          r.assignee_id ? 'border-neutral-200 text-neutral-700' : 'border-brand text-brand'
                        }`}
                      >
                        <option value="">담당자 미정</option>
                        {members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="date"
                        value={r.due_date ?? ''}
                        onChange={(e) => patch(i, { due_date: e.target.value || null })}
                        aria-label={`${r.title} 기한`}
                        className="h-9 w-[9.5rem] shrink-0 rounded-lg border border-neutral-200 bg-surface px-2 text-[12.5px] text-neutral-700"
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl bg-neutral-100 px-3.5 py-3">
              <p className="text-[12.5px] font-bold text-neutral-600">
                <Icon name="megaphone" size={12} className="mr-1" />
                알림은 사람당 한 통씩, 모두 {notices.length}통 갑니다
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-neutral-500">
                {notices.length > 0
                  ? notices.map((n) => `${nameOf(n.memberId)} ${n.count}건`).join(' · ')
                  : '담당자를 정하면 그 사람에게 알림이 갑니다.'}
              </p>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
