'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { logActivity } from '@/lib/log';
import { relTime, korDateFull } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { Avatar } from '@/components/Brand';
import { Icon } from '@/components/Icon';
import { CardSkeleton, ConfirmDialog, EmptyState, ErrorBanner, Sheet, useToast } from '@/components/ui';
import type { Notice, NoticeRead } from '@/lib/types';

/**
 * 공지사항.
 * 카톡으로 공지하면 "봤다"가 안 남아서 매번 다시 물어봐야 했다.
 * 여기서는 펼쳐 읽으면 읽음으로 남고, 원장은 누가 아직 안 봤는지 바로 본다.
 */
export default function NoticePage() {
  const { session, isAdmin } = useSession();
  const { members } = useMembers();
  const toast = useToast();

  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [reads, setReads] = useState<NoticeRead[]>([]);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Notice | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const { data, error: e } = await supabase
        .from('notices')
        .select('*')
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false });
      if (e) throw e;
      const list = (data ?? []) as Notice[];
      setNotices(list);

      if (list.length > 0) {
        const { data: r } = await supabase
          .from('notice_reads')
          .select('*')
          .in('notice_id', list.map((n) => n.id));
        setReads((r ?? []) as NoticeRead[]);
      } else {
        setReads([]);
      }
    } catch (e) {
      setError(friendlyError(e, '공지를 불러오지 못했어요.'));
      setNotices([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const readersOf = useCallback(
    (noticeId: string) => reads.filter((r) => r.notice_id === noticeId).map((r) => r.member_id),
    [reads],
  );

  const unreadCount = useMemo(() => {
    if (!notices || !session) return 0;
    return notices.filter((n) => !reads.some((r) => r.notice_id === n.id && r.member_id === session.id)).length;
  }, [notices, reads, session]);

  /** 펼쳐서 읽으면 읽음으로 남긴다 (읽었다는 사실 자체는 되돌릴 게 없어서 자동으로 둔다) */
  const openNotice = async (n: Notice) => {
    const next = openId === n.id ? null : n.id;
    setOpenId(next);
    if (next === null || !session) return;
    if (reads.some((r) => r.notice_id === n.id && r.member_id === session.id)) return;

    setReads((v) => [...v, { notice_id: n.id, member_id: session.id, read_at: new Date().toISOString() }]);
    const { error: e } = await supabase
      .from('notice_reads')
      .upsert({ notice_id: n.id, member_id: session.id }, { onConflict: 'notice_id,member_id' });
    if (e) await load();
  };

  const startNew = () => {
    setEditing(null);
    setTitle('');
    setBody('');
    setPinned(false);
    setFormErr('');
    setFormOpen(true);
  };

  const startEdit = (n: Notice) => {
    setEditing(n);
    setTitle(n.title);
    setBody(n.body);
    setPinned(n.pinned);
    setFormErr('');
    setFormOpen(true);
  };

  const save = async () => {
    setFormErr('');
    if (!title.trim()) {
      setFormErr('제목을 적어주세요.');
      return;
    }
    if (!body.trim()) {
      setFormErr('내용을 적어주세요.');
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        const { error: e } = await supabase
          .from('notices')
          .update({ title: title.trim(), body: body.trim(), pinned })
          .eq('id', editing.id);
        if (e) throw e;
        logActivity(session?.id, `공지 수정 — ${title.trim()}`, `notice:${editing.id}`);
      } else {
        const { data, error: e } = await supabase
          .from('notices')
          .insert({ title: title.trim(), body: body.trim(), pinned, member_id: session?.id ?? null })
          .select()
          .single();
        if (e) throw e;
        logActivity(session?.id, `공지 작성 — ${title.trim()}`, `notice:${data.id}`);
      }
      setFormOpen(false);
      toast.show('저장했어요.');
      await load();
    } catch (e) {
      setFormErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setDeleting(null);
    const { error: e } = await supabase.from('notices').delete().eq('id', id);
    if (e) {
      setError(friendlyError(e, '지우지 못했어요.'));
      return;
    }
    toast.show('지웠어요.');
    await load();
  };

  return (
    <div>
      <PageHeader
        title="공지사항"
        subtitle={unreadCount > 0 ? `안 읽은 공지 ${unreadCount}건` : '모두 읽었어요'}
        right={
          isAdmin ? (
            <button onClick={startNew} className="btn-primary px-3 text-[13.5px]">
              <Icon name="plus" size={15} />
              공지 쓰기
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

        {notices === null ? (
          <CardSkeleton rows={3} />
        ) : notices.length === 0 ? (
          <EmptyState
            icon="megaphone"
            title="아직 공지가 없어요"
            desc={isAdmin ? '오른쪽 위 공지 쓰기로 첫 공지를 올려보세요.' : '새 공지가 올라오면 여기 보여요.'}
          />
        ) : (
          <ul className="space-y-2.5">
            {notices.map((n) => {
              const readers = readersOf(n.id);
              const iRead = session ? readers.includes(session.id) : false;
              const open = openId === n.id;
              const unread = members.filter((m) => !readers.includes(m.id));

              return (
                <li key={n.id} className="card overflow-hidden">
                  <button
                    onClick={() => void openNotice(n)}
                    aria-expanded={open}
                    className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left"
                  >
                    {!iRead && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-label="안 읽음" />}
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {n.pinned && <span className="chip bg-brand-50 text-brand-700">고정</span>}
                        <span className={`text-[14.5px] leading-snug ${iRead ? 'font-semibold text-neutral-600' : 'font-bold text-neutral-900'}`}>
                          {n.title}
                        </span>
                      </span>
                      <span className="mt-1 block text-[11.5px] text-neutral-400">
                        {korDateFull(n.created_at.slice(0, 10))} · 읽음 {readers.length}/{members.length}
                      </span>
                    </span>
                    <Icon
                      name="chevronDown"
                      size={14}
                      className={`mt-1 shrink-0 text-neutral-300 transition-transform ${open ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {open && (
                    <div className="border-t border-neutral-100 px-3.5 py-3">
                      <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-neutral-800">{n.body}</p>

                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <span className="text-[11.5px] font-bold text-neutral-400">읽음</span>
                        {readers.length === 0 ? (
                          <span className="text-[11.5px] text-neutral-400">아직 없어요</span>
                        ) : (
                          members
                            .filter((m) => readers.includes(m.id))
                            .map((m) => (
                              <span key={m.id} className="flex items-center gap-1 rounded-full bg-green-50 py-0.5 pl-0.5 pr-2">
                                <Avatar name={m.name} size={18} />
                                <span className="text-[11.5px] font-semibold text-green-800">{m.name}</span>
                              </span>
                            ))
                        )}
                      </div>

                      {unread.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className="text-[11.5px] font-bold text-neutral-400">아직</span>
                          {unread.map((m) => (
                            <span key={m.id} className="chip bg-neutral-100 text-neutral-500">
                              {m.name}
                            </span>
                          ))}
                        </div>
                      )}

                      <p className="mt-2.5 text-[11.5px] text-neutral-400">
                        {n.member_id ? `${members.find((m) => m.id === n.member_id)?.name ?? '-'} · ` : ''}
                        {relTime(n.created_at)}
                      </p>

                      {isAdmin && (
                        <div className="mt-2.5 flex gap-2">
                          <button onClick={() => startEdit(n)} className="btn-ghost h-9 flex-1 text-[13px]">
                            고치기
                          </button>
                          <button
                            onClick={() => setDeleting(n.id)}
                            className="h-9 rounded-xl border border-neutral-300 px-3 text-[13px] text-neutral-500"
                          >
                            삭제
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Sheet open={formOpen} onClose={() => setFormOpen(false)} title={editing ? '공지 고치기' : '공지 쓰기'}>
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="notice-title">
              제목
            </label>
            <input
              id="notice-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="field"
              placeholder="예) 8월 셋째 주 학교 일정 변경"
            />
          </div>
          <div>
            <label className="label" htmlFor="notice-body">
              내용
            </label>
            <textarea
              id="notice-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={7}
              className="field resize-none"
              placeholder="강사들이 읽고 바로 움직일 수 있게 적어주세요."
            />
          </div>
          <button
            type="button"
            onClick={() => setPinned((v) => !v)}
            aria-pressed={pinned}
            className={`tap w-full gap-1.5 rounded-xl border text-[14px] font-bold transition ${
              pinned ? 'border-brand bg-brand-50 text-brand-700' : 'border-neutral-300 bg-surface text-neutral-500'
            }`}
          >
            <Icon name="target" size={15} />
            맨 위에 고정
          </button>

          {formErr && <ErrorBanner message={formErr} />}

          <button onClick={save} disabled={busy} className="btn-primary w-full">
            {busy ? '저장 중…' : '저장'}
          </button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="공지를 지울까요?"
        message="읽음 기록도 함께 사라져요."
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove(deleting)}
      />
    </div>
  );
}
