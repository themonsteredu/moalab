'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { logActivity } from '@/lib/log';
import { sendPush } from '@/lib/push';
import { ddayClass, ddayLabel, korDate } from '@/lib/format';
import { applyTemplate, spreadNotices, todayStr } from '@/lib/task';
import { Icon } from '@/components/Icon';
import { EmptyState, ErrorBanner, Sheet } from '@/components/ui';
import type { TaskTemplate, TaskTemplateItem } from '@/lib/types';

/**
 * 체크리스트를 기준일에 얹어 통째로 뿌린다.
 *
 * **저장 전에 반드시 미리보기를 거친다.** 여러 건이 한꺼번에 생기는 동작이라
 * 잘못 뿌리면 지우는 것도 여러 번이고, 엉뚱한 사람에게 알림까지 간다.
 * 알림은 **사람당 한 통**으로 묶는다 (8건 뿌렸는데 8통이 오면 그날로 알림을 꺼버린다).
 */
export function TaskSpread({
  open,
  onClose,
  onSpread,
}: {
  open: boolean;
  onClose: () => void;
  onSpread: (count: number, title: string) => void;
}) {
  const { session } = useSession();
  const { members, nameOf } = useMembers();

  const [templates, setTemplates] = useState<TaskTemplate[] | null>(null);
  const [items, setItems] = useState<TaskTemplateItem[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [anchor, setAnchor] = useState('');
  const [batchTitle, setBatchTitle] = useState('');
  /** 미리보기에서 손댄 담당자만 담긴다 (항목 id → 멤버 id, 빈 문자열이면 일부러 비운 것) */
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [titleTouched, setTitleTouched] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [tRes, iRes] = await Promise.all([
        supabase.from('task_templates').select('*').order('sort_order').order('created_at'),
        supabase.from('task_template_items').select('*').order('sort_order'),
      ]);
      if (tRes.error) throw tRes.error;
      setTemplates((tRes.data ?? []) as TaskTemplate[]);
      setItems((iRes.data ?? []) as TaskTemplateItem[]);
    } catch (e) {
      setError(friendlyError(e, '체크리스트를 불러오지 못했어요.'));
      setTemplates([]);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
    setTemplateId('');
    setAnchor(todayStr());
    setBatchTitle('');
    setOverrides({});
    setTitleTouched(false);
    setError('');
  }, [open, load]);

  const template = templates?.find((t) => t.id === templateId) ?? null;
  /* applyTemplate 이 sort_order 로 다시 정렬하므로, 미리보기에서 항목 id 를 짚으려면
     같은 기준으로 정렬해둬야 한다. 안 그러면 sort_order 가 겹칠 때 줄이 어긋난다 */
  const mine = useMemo(
    () =>
      items
        .filter((i) => i.template_id === templateId)
        .sort((a, b) => a.sort_order - b.sort_order),
    [items, templateId],
  );

  // 묶음 이름은 자동으로 지어주되, 손대면 그때부터 사람 것이다
  useEffect(() => {
    if (titleTouched) return;
    setBatchTitle(template && anchor ? `${template.name} — ${korDate(anchor)}` : '');
  }, [template, anchor, titleTouched]);

  /** 미리보기 — 아직 저장하지 않은 목록 */
  const preview = useMemo(
    () =>
      mine.length > 0
        ? applyTemplate(mine, anchor, overrides, { id: 'preview', title: batchTitle })
        : [],
    [mine, anchor, overrides, batchTitle],
  );

  const notices = useMemo(() => spreadNotices(preview), [preview]);
  const noOwner = preview.filter((t) => !t.assignee_id).length;

  const spread = async () => {
    setError('');
    if (!template) return setError('체크리스트를 골라주세요.');
    if (mine.length === 0) return setError('이 체크리스트에는 항목이 없어요.');
    const title = batchTitle.trim() || template.name;

    setBusy(true);
    try {
      const batchId = crypto.randomUUID();
      const rows = applyTemplate(mine, anchor, overrides, { id: batchId, title }).map((t) => ({
        ...t,
        created_by: session?.id ?? null,
      }));

      // 요청 하나로 전부 넣는다 — 중간에 반만 들어가는 일이 없다
      const { error: e } = await supabase.from('tasks').insert(rows);
      if (e) throw e;

      logActivity(session?.id, `업무 ${rows.length}건 뿌림 — ${title}`, 'tasks');

      // 사람당 한 통
      for (const n of spreadNotices(rows)) {
        sendPush({
          title: `업무 ${n.count}건이 배정됐어요`,
          body: n.firstDue ? `${title} · 가장 빠른 기한 ${korDate(n.firstDue)}` : title,
          url: '/task',
          tag: `batch-${batchId}`,
          memberIds: [n.memberId],
          fromId: session?.id,
        });
      }

      onSpread(rows.length, title);
      onClose();
    } catch (e) {
      setError(friendlyError(e, '뿌리지 못했어요. 다시 눌러주세요.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="체크리스트로 뿌리기"
      footer={
        <button
          onClick={() => void spread()}
          disabled={busy || preview.length === 0}
          className="btn-primary w-full"
        >
          {busy ? '만드는 중…' : preview.length === 0 ? '체크리스트를 골라주세요' : `${preview.length}건 만들기`}
        </button>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}

        {templates !== null && templates.length === 0 ? (
          <EmptyState
            icon="list"
            title="체크리스트가 아직 없어요"
            desc="먼저 “체크리스트” 에서 한 벌 만들어두면, 여기서 기준일만 정해 통째로 뿌릴 수 있어요."
          />
        ) : (
          <>
            <div>
              <label className="label" htmlFor="sp-tpl">
                무엇을 뿌릴까요
              </label>
              <select
                id="sp-tpl"
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  setOverrides({});
                }}
                className="field"
              >
                <option value="">고르세요</option>
                {templates?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({items.filter((i) => i.template_id === t.id).length}개)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="sp-anchor">
                기준일 — 보통 수업 날짜
              </label>
              <input
                id="sp-anchor"
                type="date"
                value={anchor}
                onChange={(e) => setAnchor(e.target.value)}
                className="field"
              />
              <p className="mt-1 text-[11.5px] text-neutral-400">
                항목마다 적어둔 <b>며칠 전/후</b>가 이 날짜에 더해져 기한이 됩니다.
              </p>
            </div>

            <div>
              <label className="label" htmlFor="sp-title">
                묶음 이름
              </label>
              <input
                id="sp-title"
                value={batchTitle}
                onChange={(e) => {
                  setBatchTitle(e.target.value);
                  setTitleTouched(true);
                }}
                placeholder="8월 25일 A초 준비"
                className="field"
              />
            </div>

            {/* ------------------------------------------------ 미리보기 */}
            {preview.length > 0 && (
              <div>
                <p className="label">이렇게 만들어져요 — 담당자는 여기서 바꿀 수 있어요</p>
                <ul className="space-y-1.5">
                  {preview.map((t, i) => {
                    const it = mine[i];
                    return (
                      <li key={it.id} className="rounded-xl border border-neutral-200 bg-surface p-2.5">
                        <div className="flex items-start gap-2">
                          <p className="min-w-0 flex-1 text-[14px] font-semibold text-neutral-800">{t.title}</p>
                          {t.due_date && (
                            <span className={`chip shrink-0 ${ddayClass(t.due_date)}`}>{ddayLabel(t.due_date)}</span>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <select
                            value={t.assignee_id ?? ''}
                            onChange={(e) => setOverrides((v) => ({ ...v, [it.id]: e.target.value }))}
                            aria-label={`${t.title} 담당자`}
                            className={`h-9 flex-1 rounded-lg border bg-surface px-2 text-[12.5px] ${
                              t.assignee_id ? 'border-neutral-200 text-neutral-700' : 'border-brand text-brand'
                            }`}
                          >
                            <option value="">담당자 미정</option>
                            {members.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                          <span className="shrink-0 text-[11.5px] text-neutral-400">
                            {t.due_date ? korDate(t.due_date) : '기한 없음'}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                <div className="mt-2.5 rounded-xl bg-neutral-100 px-3.5 py-3">
                  <p className="text-[12.5px] font-bold text-neutral-600">
                    <Icon name="megaphone" size={12} className="mr-1" />
                    알림은 사람당 한 통씩, 모두 {notices.length}통 갑니다
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-neutral-500">
                    {notices.length > 0
                      ? notices.map((n) => `${nameOf(n.memberId)} ${n.count}건`).join(' · ')
                      : '담당자를 정하면 그 사람에게 알림이 갑니다.'}
                  </p>
                  {noOwner > 0 && (
                    <p className="mt-1.5 text-[12px] font-semibold text-brand">
                      담당자 미정 {noOwner}건 — 이대로 만들어도 되고, 나중에 정해도 돼요.
                    </p>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
