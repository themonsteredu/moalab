'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { uploadMany } from '@/lib/upload';
import { logActivity } from '@/lib/log';
import { ConfirmDialog, ErrorBanner, Skeleton } from '@/components/ui';
import { relTime } from '@/lib/format';
import type { CommentFile, CommentRow } from '@/lib/types';

interface Item extends CommentRow {
  files: CommentFile[];
}

/**
 * 앱별 댓글 스레드.
 * 강사가 폰에서 오류를 만났을 때 스크린샷을 그 자리에서 올리는 게 핵심이라
 * 파일 선택은 카메라롤 바로 열리는 기본 input(accept=image/*, multiple)을 쓴다.
 */
export function CommentThread({ appId, appSlug }: { appId: string; appSlug: string }) {
  const { session } = useSession();
  const [items, setItems] = useState<Item[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [cRes, mRes] = await Promise.all([
      supabase.from('comments').select('*').eq('app_id', appId).order('created_at', { ascending: false }),
      supabase.from('members_public').select('id,name'),
    ]);
    const comments = (cRes.data ?? []) as CommentRow[];
    setNames(Object.fromEntries((mRes.data ?? []).map((m) => [m.id, m.name])));

    let filesByComment = new Map<string, CommentFile[]>();
    if (comments.length > 0) {
      const { data } = await supabase
        .from('comment_files')
        .select('*')
        .in('comment_id', comments.map((c) => c.id));
      for (const f of (data ?? []) as CommentFile[]) {
        const list = filesByComment.get(f.comment_id) ?? [];
        list.push(f);
        filesByComment.set(f.comment_id, list);
      }
    }
    setItems(comments.map((c) => ({ ...c, files: filesByComment.get(c.id) ?? [] })));
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    setError('');
    if (!body.trim() && files.length === 0) {
      setError('내용을 적거나 사진을 골라주세요.');
      return;
    }
    setBusy(true);
    try {
      const { data: comment, error: insErr } = await supabase
        .from('comments')
        .insert({ app_id: appId, member_id: session?.id ?? null, body: body.trim() || '(사진)' })
        .select()
        .single();
      if (insErr) throw insErr;

      if (files.length > 0) {
        setProgress(`사진 올리는 중… 0/${files.length}`);
        const uploaded = await uploadMany('moalab-comment-files', files, `app-${appId}`, (d, t) =>
          setProgress(`사진 올리는 중… ${d}/${t}`),
        );
        const { error: fErr } = await supabase.from('comment_files').insert(
          uploaded.map((u) => ({ comment_id: comment.id, file_url: u.url, file_name: u.name })),
        );
        if (fErr) throw fErr;
      }

      logActivity(session?.id, `${appSlug} 댓글 작성`, `app:${appId}`);
      setBody('');
      setFiles([]);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e) {
      setError(friendlyError(e, '댓글을 올리지 못했어요. 다시 눌러주세요.'));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const toggleResolved = async (c: Item) => {
    const next = !c.resolved;
    setItems((v) => v?.map((x) => (x.id === c.id ? { ...x, resolved: next } : x)) ?? null);
    const { error: e } = await supabase.from('comments').update({ resolved: next }).eq('id', c.id);
    if (e) {
      setError(friendlyError(e, '상태를 바꾸지 못했어요. 다시 눌러주세요.'));
      await load();
      return;
    }
    logActivity(session?.id, `${appSlug} 댓글 ${next ? '해결 처리' : '해결 취소'}`, `app:${appId}`);
  };

  const remove = async (id: string) => {
    setDeleting(null);
    const { error: e } = await supabase.from('comments').delete().eq('id', id);
    if (e) {
      setError(friendlyError(e, '삭제하지 못했어요. 다시 눌러주세요.'));
      return;
    }
    await load();
  };

  const open = items?.filter((c) => !c.resolved) ?? [];
  const resolved = items?.filter((c) => c.resolved) ?? [];

  return (
    <section>
      {/* 입력 */}
      <div className="card p-3.5">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="어디가 어떻게 이상한지 적어주세요. 사진이 있으면 훨씬 빨라요."
          className="field resize-none"
          aria-label="댓글 내용"
        />

        {files.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {files.map((f, i) => (
              <span key={i} className="flex items-center gap-1.5 rounded-lg bg-neutral-100 px-2.5 py-1.5">
                <span className="max-w-[140px] truncate text-[12px] text-neutral-600">{f.name}</span>
                <button
                  onClick={() => setFiles((v) => v.filter((_, j) => j !== i))}
                  aria-label={`${f.name} 빼기`}
                  className="text-[13px] text-neutral-400"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        {error && (
          <div className="mt-2.5">
            <ErrorBanner message={error} />
          </div>
        )}
        {progress && <p className="mt-2 text-[12.5px] text-neutral-500">{progress}</p>}

        <div className="mt-2.5 flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="hidden"
            id="comment-files"
          />
          <label htmlFor="comment-files" className="btn-ghost flex-1 cursor-pointer">
            📷 사진 첨부
          </label>
          <button onClick={submit} disabled={busy} className="btn-primary flex-1">
            {busy ? '올리는 중…' : '올리기'}
          </button>
        </div>
      </div>

      {/* 목록 */}
      <div className="mt-4 space-y-2.5">
        {items === null ? (
          <>
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-[13.5px] text-neutral-400">아직 댓글이 없어요.</p>
        ) : (
          <>
            {open.map((c) => (
              <CommentCard
                key={c.id}
                c={c}
                name={names[c.member_id ?? ''] ?? '알 수 없음'}
                mine={c.member_id === session?.id}
                onToggle={() => toggleResolved(c)}
                onDelete={() => setDeleting(c.id)}
                onView={setViewer}
              />
            ))}

            {resolved.length > 0 && (
              <>
                <p className="pt-3 text-[12px] font-bold text-neutral-400">
                  해결됨 {resolved.length}건
                </p>
                {resolved.map((c) => (
                  <CommentCard
                    key={c.id}
                    c={c}
                    name={names[c.member_id ?? ''] ?? '알 수 없음'}
                    mine={c.member_id === session?.id}
                    onToggle={() => toggleResolved(c)}
                    onDelete={() => setDeleting(c.id)}
                    onView={setViewer}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="댓글을 지울까요?"
        message="사진도 함께 목록에서 사라져요."
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove(deleting)}
      />

      {viewer && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setViewer(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={viewer} alt="첨부 사진" className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </section>
  );
}

function CommentCard({
  c,
  name,
  mine,
  onToggle,
  onDelete,
  onView,
}: {
  c: Item;
  name: string;
  mine: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onView: (url: string) => void;
}) {
  return (
    <div className={`card p-3.5 ${c.resolved ? 'bg-neutral-50 opacity-70' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13.5px] font-bold text-neutral-700">
          {name}
          <span className="ml-1.5 text-[11.5px] font-normal text-neutral-400">{relTime(c.created_at)}</span>
        </p>
        {c.resolved && <span className="chip bg-neutral-200 text-neutral-600">해결됨</span>}
      </div>

      <p className={`mt-1.5 whitespace-pre-wrap text-[14px] leading-relaxed ${c.resolved ? 'text-neutral-500' : 'text-neutral-800'}`}>
        {c.body}
      </p>

      {c.files.length > 0 && (
        <div className="mt-2.5 grid grid-cols-3 gap-1.5">
          {c.files.map((f) => (
            <button
              key={f.id}
              onClick={() => onView(f.file_url)}
              className="aspect-square overflow-hidden rounded-lg bg-neutral-100"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.file_url} alt={f.file_name ?? '첨부'} loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      <div className="mt-2.5 flex gap-2">
        <button
          onClick={onToggle}
          className={`h-9 flex-1 rounded-lg border text-[13px] font-bold transition ${
            c.resolved
              ? 'border-neutral-300 bg-white text-neutral-500'
              : 'border-green-600 bg-green-600 text-white'
          }`}
        >
          {c.resolved ? '해결 취소' : '해결됨으로 표시'}
        </button>
        {mine && (
          <button onClick={onDelete} className="h-9 rounded-lg border border-neutral-300 px-3 text-[13px] text-neutral-500">
            삭제
          </button>
        )}
      </div>
    </div>
  );
}
