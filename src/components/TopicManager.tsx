'use client';

import { useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { logActivity } from '@/lib/log';
import { Icon } from '@/components/Icon';
import { ConfirmDialog, ErrorBanner, Sheet } from '@/components/ui';
import type { Topic } from '@/lib/types';

/**
 * 주제 관리 — 여기서 한 번 만들면 프로그램 폼에서는 고르기만 한다.
 *
 * 이름을 고치면 그 주제를 쓰는 프로그램 전부에 한 번에 반영된다 (FK 로 이어져 있다).
 * 주제를 지워도 프로그램은 지워지지 않고 '주제 없음' 으로 돌아간다.
 */
export function TopicManager({
  open,
  onClose,
  topics,
  countOf,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  topics: Topic[];
  /** 그 주제를 쓰는 프로그램 수 — 지울 때 경고에 쓴다 */
  countOf: (topicId: string) => number;
  onChanged: () => void;
}) {
  const { session } = useSession();
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deleting, setDeleting] = useState<Topic | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const name = newName.trim();
    setError('');
    if (!name) {
      setError('주제 이름을 적어주세요.');
      return;
    }
    if (topics.some((t) => t.name === name)) {
      setError('이미 있는 주제예요.');
      return;
    }
    setBusy(true);
    try {
      const { error: e } = await supabase
        .from('topics')
        .insert({ name, sort_order: topics.length });
      if (e) throw e;
      logActivity(session?.id, `주제 추가 — ${name}`, 'topics');
      setNewName('');
      onChanged();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const rename = async (t: Topic) => {
    const name = editName.trim();
    setError('');
    if (!name) {
      setError('주제 이름을 적어주세요.');
      return;
    }
    if (name === t.name) {
      setEditingId(null);
      return;
    }
    if (topics.some((x) => x.name === name)) {
      setError('이미 있는 주제예요.');
      return;
    }
    setBusy(true);
    try {
      const { error: e } = await supabase.from('topics').update({ name }).eq('id', t.id);
      if (e) throw e;
      logActivity(session?.id, `주제 이름 변경 — ${t.name} → ${name}`, 'topics');
      setEditingId(null);
      onChanged();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  /** 위/아래로 한 칸. 두 줄의 sort_order 를 맞바꾼다 */
  const move = async (index: number, dir: -1 | 1) => {
    const a = topics[index];
    const b = topics[index + dir];
    if (!a || !b) return;
    setError('');
    setBusy(true);
    try {
      // sort_order 가 같을 수도 있어서(초기 0) 인덱스로 다시 매긴다
      const reordered = [...topics];
      reordered[index] = b;
      reordered[index + dir] = a;
      for (let i = 0; i < reordered.length; i++) {
        const { error: e } = await supabase
          .from('topics')
          .update({ sort_order: i })
          .eq('id', reordered[i].id);
        if (e) throw e;
      }
      onChanged();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t: Topic) => {
    setDeleting(null);
    setBusy(true);
    try {
      const { error: e } = await supabase.from('topics').delete().eq('id', t.id);
      if (e) throw e;
      logActivity(session?.id, `주제 삭제 — ${t.name}`, 'topics');
      onChanged();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} title="주제 관리">
        <div className="space-y-3">
          <p className="text-[13px] leading-relaxed text-neutral-500">
            여기서 만든 주제를 프로그램에서 골라 쓰면 돼요.
            <br />
            이름을 고치면 그 주제를 쓰는 프로그램 전부에 한 번에 반영돼요.
          </p>

          {/* 새 주제 */}
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void add()}
              placeholder="예) AI 문화"
              aria-label="새 주제 이름"
              className="field flex-1"
            />
            <button onClick={() => void add()} disabled={busy} className="btn-primary shrink-0 px-3.5 text-[14px]">
              <Icon name="plus" size={15} />
              추가
            </button>
          </div>

          {error && <ErrorBanner message={error} />}

          {/* 목록 */}
          {topics.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-300 py-6 text-center text-[13px] text-neutral-400">
              아직 주제가 없어요. 위에서 하나 만들어보세요.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {topics.map((t, i) => {
                const n = countOf(t.id);
                const editing = editingId === t.id;
                return (
                  <li key={t.id} className="rounded-xl border border-neutral-200 p-2">
                    {editing ? (
                      <div className="flex gap-2">
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && void rename(t)}
                          autoFocus
                          aria-label="주제 이름"
                          className="field flex-1"
                        />
                        <button
                          onClick={() => void rename(t)}
                          disabled={busy}
                          className="btn-primary shrink-0 px-3 text-[13px]"
                        >
                          저장
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="shrink-0 px-2 text-[13px] text-neutral-400"
                        >
                          취소
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        {/* 순서 */}
                        <span className="flex shrink-0 flex-col">
                          <button
                            onClick={() => void move(i, -1)}
                            disabled={i === 0 || busy}
                            aria-label={`${t.name} 위로`}
                            className="px-1 text-neutral-400 disabled:opacity-25"
                          >
                            <Icon name="chevronDown" size={13} className="rotate-180" />
                          </button>
                          <button
                            onClick={() => void move(i, 1)}
                            disabled={i === topics.length - 1 || busy}
                            aria-label={`${t.name} 아래로`}
                            className="px-1 text-neutral-400 disabled:opacity-25"
                          >
                            <Icon name="chevronDown" size={13} />
                          </button>
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-bold text-neutral-900">{t.name}</span>
                          <span className="text-[11.5px] text-neutral-400">프로그램 {n}개</span>
                        </span>

                        <button
                          onClick={() => {
                            setEditingId(t.id);
                            setEditName(t.name);
                            setError('');
                          }}
                          className="tap shrink-0 px-2.5 text-[13px] font-bold text-neutral-500"
                        >
                          이름
                        </button>
                        <button
                          onClick={() => setDeleting(t)}
                          aria-label={`${t.name} 삭제`}
                          className="tap shrink-0 px-2 text-neutral-400"
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Sheet>

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`'${deleting?.name}' 주제를 지울까요?`}
        message={
          deleting && countOf(deleting.id) > 0
            ? `이 주제를 쓰는 프로그램 ${countOf(deleting.id)}개는 지워지지 않고 '주제 없음' 으로 돌아가요.`
            : '프로그램은 지워지지 않아요.'
        }
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && void remove(deleting)}
      />
    </>
  );
}
