'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { logActivity } from '@/lib/log';
import { korDate } from '@/lib/format';
import { shiftDate, todayStr } from '@/lib/task';
import { Icon } from '@/components/Icon';
import { ConfirmDialog, EmptyState, ErrorBanner, Sheet } from '@/components/ui';
import type { TaskTemplate, TaskTemplateItem } from '@/lib/types';

/**
 * 체크리스트 관리 — 원장만.
 *
 * 나눠주는 일은 매번 비슷하다. 여기서 한 벌 만들어두면
 * `뿌리기` 에서 기준일만 정해 통째로 배정할 수 있다.
 *
 * 항목마다 **기준일 대비 며칠**(day_offset)을 적어둔다. 기준일이 수업날이면
 * 준비는 -5, -2 처럼 앞에 온다. 음수가 헷갈리지 않게 화면에 날짜를 미리 보여준다.
 */
export function TaskTemplateManager({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { session } = useSession();
  const { members } = useMembers();

  const [templates, setTemplates] = useState<TaskTemplate[] | null>(null);
  const [items, setItems] = useState<TaskTemplateItem[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<TaskTemplate | null>(null);
  const [renameTo, setRenameTo] = useState('');
  const [deleting, setDeleting] = useState<TaskTemplate | null>(null);

  // 새 항목
  const [itTitle, setItTitle] = useState('');
  const [itWho, setItWho] = useState('');
  const [itOffset, setItOffset] = useState('0');

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
    if (open) void load();
  }, [open, load]);

  const mine = items.filter((i) => i.template_id === picked);
  const countOf = (id: string) => items.filter((i) => i.template_id === id).length;
  const current = templates?.find((t) => t.id === picked) ?? null;

  const addTemplate = async () => {
    const name = newName.trim();
    setError('');
    if (!name) return setError('체크리스트 이름을 적어주세요.');
    setBusy(true);
    try {
      const { data, error: e } = await supabase
        .from('task_templates')
        .insert({ name, sort_order: templates?.length ?? 0 })
        .select()
        .single();
      if (e) throw e;
      logActivity(session?.id, `체크리스트 추가 — ${name}`, 'task_templates');
      setNewName('');
      await load();
      setPicked(data.id as string);
      onChanged();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    if (!renaming) return;
    const name = renameTo.trim();
    setError('');
    if (!name) return setError('이름을 적어주세요.');
    setBusy(true);
    try {
      const { error: e } = await supabase.from('task_templates').update({ name }).eq('id', renaming.id);
      if (e) throw e;
      logActivity(session?.id, `체크리스트 이름 변경 — ${renaming.name} → ${name}`, 'task_templates');
      setRenaming(null);
      await load();
      onChanged();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const removeTemplate = async () => {
    if (!deleting) return;
    const { error: e } = await supabase.from('task_templates').delete().eq('id', deleting.id);
    if (e) {
      setError(friendlyError(e, '지우지 못했어요.'));
      setDeleting(null);
      return;
    }
    logActivity(session?.id, `체크리스트 삭제 — ${deleting.name}`, 'task_templates');
    if (picked === deleting.id) setPicked(null);
    setDeleting(null);
    await load();
    onChanged();
  };

  const addItem = async () => {
    if (!picked) return;
    const title = itTitle.trim();
    setError('');
    if (!title) return setError('항목 이름을 적어주세요.');
    const offset = Number(itOffset);
    if (!Number.isInteger(offset)) return setError('며칠인지 숫자로 적어주세요.');
    setBusy(true);
    try {
      const { error: e } = await supabase.from('task_template_items').insert({
        template_id: picked,
        title,
        default_assignee_id: itWho || null,
        day_offset: offset,
        sort_order: mine.length,
      });
      if (e) throw e;
      setItTitle('');
      setItWho('');
      await load();
      onChanged();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const removeItem = async (id: string) => {
    const { error: e } = await supabase.from('task_template_items').delete().eq('id', id);
    if (e) {
      setError(friendlyError(e, '지우지 못했어요.'));
      return;
    }
    await load();
    onChanged();
  };

  const setItemWho = async (id: string, who: string) => {
    setItems((v) => v.map((i) => (i.id === id ? { ...i, default_assignee_id: who || null } : i)));
    const { error: e } = await supabase
      .from('task_template_items')
      .update({ default_assignee_id: who || null })
      .eq('id', id);
    if (e) {
      setError(friendlyError(e, '담당자를 바꾸지 못했어요.'));
      await load();
    }
  };

  /** 기준일이 오늘이라면 며칠이 되는지 — 음수가 헷갈리지 않게 */
  const sample = (offset: number) => korDate(shiftDate(todayStr(), offset));

  return (
    <>
      <Sheet open={open} onClose={onClose} title={current ? current.name : '체크리스트'}>
        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} />
          </div>
        )}

        {/* ---------------------------------------------- 템플릿 고르기 */}
        {!current ? (
          <div className="space-y-3">
            <p className="text-[12.5px] leading-relaxed text-neutral-500">
              매번 비슷하게 나눠주는 일을 한 벌로 묶어둡니다. 한 번 만들어두면
              <b> 기준일만 정해서 통째로 배정</b>할 수 있어요.
            </p>

            <div className="flex gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="수업 하나 준비하기"
                aria-label="새 체크리스트 이름"
                className="field flex-1"
              />
              <button
                onClick={() => void addTemplate()}
                disabled={busy}
                className="btn-primary shrink-0 px-3 text-[13.5px]"
              >
                만들기
              </button>
            </div>

            {templates === null ? (
              <p className="py-6 text-center text-[13px] text-neutral-400">불러오는 중…</p>
            ) : templates.length === 0 ? (
              <EmptyState
                icon="list"
                title="아직 체크리스트가 없어요"
                desc="위 칸에 이름을 적어 첫 체크리스트를 만들어보세요."
              />
            ) : (
              <ul className="space-y-1.5">
                {templates.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-surface px-3">
                    <button onClick={() => setPicked(t.id)} className="tap min-w-0 flex-1 text-left">
                      <span className="block truncate text-[14px] font-semibold text-neutral-800">{t.name}</span>
                      <span className="text-[11.5px] text-neutral-400">항목 {countOf(t.id)}개</span>
                    </button>
                    <button
                      onClick={() => {
                        setRenaming(t);
                        setRenameTo(t.name);
                      }}
                      aria-label={`${t.name} 이름 바꾸기`}
                      className="tap w-9 shrink-0 text-neutral-400"
                    >
                      <Icon name="wrench" size={15} />
                    </button>
                    <button
                      onClick={() => setDeleting(t)}
                      aria-label={`${t.name} 삭제`}
                      className="tap w-9 shrink-0 text-neutral-400"
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          /* ---------------------------------------------- 항목 편집 */
          <div className="space-y-3">
            <button
              onClick={() => setPicked(null)}
              className="-my-2 flex items-center gap-1 py-2 text-[12.5px] font-bold text-neutral-400"
            >
              <span aria-hidden>‹</span> 체크리스트 목록
            </button>

            {mine.length === 0 ? (
              <p className="rounded-xl bg-neutral-100 px-3.5 py-3 text-[12.5px] leading-relaxed text-neutral-500">
                항목을 하나씩 넣어주세요. <b>기준일 대비 며칠</b>을 같이 적어두면
                뿌릴 때 기한이 자동으로 계산됩니다.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {mine.map((it) => (
                  <li key={it.id} className="rounded-xl border border-neutral-200 bg-surface p-2.5">
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 flex-1 text-[14px] font-semibold text-neutral-800">{it.title}</p>
                      <span className="chip shrink-0 bg-neutral-100 text-neutral-500">
                        {it.day_offset === 0 ? '당일' : it.day_offset < 0 ? `${-it.day_offset}일 전` : `${it.day_offset}일 후`}
                      </span>
                      <button
                        onClick={() => void removeItem(it.id)}
                        aria-label={`${it.title} 삭제`}
                        className="-my-1 w-7 shrink-0 py-1 text-neutral-400"
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                    <select
                      value={it.default_assignee_id ?? ''}
                      onChange={(e) => void setItemWho(it.id, e.target.value)}
                      aria-label={`${it.title} 기본 담당자`}
                      className="mt-1.5 h-9 w-full rounded-lg border border-neutral-200 bg-surface px-2 text-[12.5px] text-neutral-600"
                    >
                      <option value="">기본 담당자 없음</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}

            {/* 새 항목 */}
            <div className="rounded-xl border border-dashed border-neutral-300 p-2.5">
              <input
                value={itTitle}
                onChange={(e) => setItTitle(e.target.value)}
                placeholder="재료 주문하기"
                aria-label="새 항목 이름"
                className="field"
              />
              <div className="mt-2 flex gap-2">
                <select
                  value={itWho}
                  onChange={(e) => setItWho(e.target.value)}
                  aria-label="새 항목 기본 담당자"
                  className="field flex-1"
                >
                  <option value="">담당자 없음</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <input
                  value={itOffset}
                  onChange={(e) => setItOffset(e.target.value)}
                  type="number"
                  inputMode="numeric"
                  aria-label="기준일 대비 며칠"
                  className="field w-24 shrink-0"
                />
              </div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-neutral-400">
                숫자는 <b>기준일 대비 며칠</b>이에요. <b>-5 는 5일 전</b>, 0 은 당일.
                {Number.isInteger(Number(itOffset)) && (
                  <> 오늘이 기준일이라면 <b>{sample(Number(itOffset))}</b> 이 됩니다.</>
                )}
              </p>
              <button
                onClick={() => void addItem()}
                disabled={busy}
                className="btn-ghost mt-2 h-10 w-full gap-1 text-[13.5px]"
              >
                <Icon name="plus" size={14} />
                항목 넣기
              </button>
            </div>
          </div>
        )}
      </Sheet>

      {/* 이름 바꾸기 */}
      <Sheet
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title="체크리스트 이름 바꾸기"
        footer={
          <button onClick={() => void rename()} disabled={busy} className="btn-primary w-full">
            {busy ? '저장 중…' : '바꾸기'}
          </button>
        }
      >
        <input
          value={renameTo}
          onChange={(e) => setRenameTo(e.target.value)}
          aria-label="체크리스트 이름"
          className="field"
        />
        <p className="mt-2 text-[12px] leading-relaxed text-neutral-500">
          이름을 바꿔도 <b>이미 뿌린 업무는 그대로</b>예요. 뿌린 순간 사진처럼 굳습니다.
        </p>
      </Sheet>

      <ConfirmDialog
        open={deleting !== null}
        title="이 체크리스트를 지울까요?"
        message={`${deleting?.name} · 항목 ${deleting ? countOf(deleting.id) : 0}개. 이미 뿌려둔 업무는 지워지지 않아요.`}
        onConfirm={() => void removeTemplate()}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
