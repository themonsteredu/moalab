'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { logActivity } from '@/lib/log';
import { uploadMany } from '@/lib/upload';
import { sendPush } from '@/lib/push';
import { relTime, korDateFull } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { PushToggle } from '@/components/PushToggle';
import { Avatar } from '@/components/Brand';
import { Icon } from '@/components/Icon';
import { CardSkeleton, ConfirmDialog, EmptyState, ErrorBanner, Sheet, useToast } from '@/components/ui';
import type { Notice, NoticeFile, NoticeRead } from '@/lib/types';

/** 확장자별 색 라벨 — 이모지보다 뭐가 들었는지 바로 보인다 */
const EXT_COLOR: Record<string, string> = {
  pdf: 'bg-red-100 text-red-700',
  hwp: 'bg-blue-100 text-blue-700',
  hwpx: 'bg-blue-100 text-blue-700',
  doc: 'bg-blue-100 text-blue-700',
  docx: 'bg-blue-100 text-blue-700',
  ppt: 'bg-orange-100 text-orange-700',
  pptx: 'bg-orange-100 text-orange-700',
  xls: 'bg-green-100 text-green-800',
  xlsx: 'bg-green-100 text-green-800',
  zip: 'bg-neutral-200 text-neutral-600',
};

function extOf(name: string): string {
  return (name.split('.').pop() ?? '').toLowerCase();
}

function sizeText(n: number | null): string {
  if (!n) return '';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

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
  const [files, setFiles] = useState<NoticeFile[]>([]);
  const [reads, setReads] = useState<NoticeRead[]>([]);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [q, setQ] = useState('');
  const [viewer, setViewer] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Notice | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [picked, setPicked] = useState<File[]>([]);
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [dropFileIds, setDropFileIds] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

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
        const ids = list.map((n) => n.id);
        const [rRes, fRes] = await Promise.all([
          supabase.from('notice_reads').select('*').in('notice_id', ids),
          supabase.from('notice_files').select('*').in('notice_id', ids).order('sort_order'),
        ]);
        setReads((rRes.data ?? []) as NoticeRead[]);
        setFiles((fRes.data ?? []) as NoticeFile[]);
      } else {
        setReads([]);
        setFiles([]);
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
  const filesOf = useCallback(
    (noticeId: string) => files.filter((f) => f.notice_id === noticeId && !dropFileIds.includes(f.id)),
    [files, dropFileIds],
  );

  const iRead = useCallback(
    (n: Notice) => Boolean(session && reads.some((r) => r.notice_id === n.id && r.member_id === session.id)),
    [reads, session],
  );

  const unreadCount = useMemo(
    () => (notices ?? []).filter((n) => !iRead(n)).length,
    [notices, iRead],
  );

  /** 전체 공지를 훑을 수 있게 — 검색 + 안 읽은 것만 */
  const shown = useMemo(() => {
    let list = notices ?? [];
    if (onlyUnread) list = list.filter((n) => !iRead(n));
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter(
        (n) => n.title.toLowerCase().includes(needle) || n.body.toLowerCase().includes(needle),
      );
    }
    return list;
  }, [notices, onlyUnread, q, iRead]);

  /** 펼쳐서 읽으면 읽음으로 남긴다 (읽었다는 사실은 되돌릴 게 없어서 자동으로 둔다) */
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
    setPicked([]);
    setDropFileIds([]);
    setFormErr('');
    setFormOpen(true);
  };

  const startEdit = (n: Notice) => {
    setEditing(n);
    setTitle(n.title);
    setBody(n.body);
    setPinned(n.pinned);
    setPicked([]);
    setDropFileIds([]);
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

    // 1) 글 저장. 새 공지는 저장되자마자 '고치기' 로 바꿔둔다 —
    //    아래 첨부 단계에서 실패했을 때 다시 누르면 공지가 두 개 생기던 버그를 막는다.
    let target = editing;
    try {
      if (target) {
        const { error: e } = await supabase
          .from('notices')
          .update({ title: title.trim(), body: body.trim(), pinned })
          .eq('id', target.id);
        if (e) throw e;
        logActivity(session?.id, `공지 수정 — ${title.trim()}`, `notice:${target.id}`);
      } else {
        const { data, error: e } = await supabase
          .from('notices')
          .insert({ title: title.trim(), body: body.trim(), pinned, member_id: session?.id ?? null })
          .select()
          .single();
        if (e) throw e;
        target = data as Notice;
        setEditing(target);
        logActivity(session?.id, `공지 작성 — ${title.trim()}`, `notice:${target.id}`);
      }
    } catch (e) {
      setBusy(false);
      setFormErr(friendlyError(e));
      return;
    }

    // 2) 첨부. 여기서 실패해도 글은 이미 저장됐으니 그 사실을 분명히 알려준다.
    try {
      if (dropFileIds.length > 0) {
        const { error: dErr } = await supabase.from('notice_files').delete().in('id', dropFileIds);
        if (dErr) throw dErr;
        setDropFileIds([]);
      }

      if (picked.length > 0) {
        setProgress(`첨부 올리는 중… 0/${picked.length}`);
        const base = filesOf(target.id).length;
        const uploaded = await uploadMany('moalab-notices', picked, `notice-${target.id}`, (d, t) =>
          setProgress(`첨부 올리는 중… ${d}/${t}`),
        );
        const { error: fErr } = await supabase.from('notice_files').insert(
          uploaded.map((u, i) => ({
            notice_id: target!.id,
            file_url: u.url,
            file_name: u.name,
            file_size: u.size,
            is_image: picked[i].type.startsWith('image/'),
            sort_order: base + i,
          })),
        );
        if (fErr) throw fErr;
        // 올라간 건 목록에서 뺀다 — 다시 눌렀을 때 두 번 올라가지 않게
        setPicked([]);
      }
    } catch (e) {
      setBusy(false);
      setProgress('');
      setFormErr(`공지는 저장됐어요. 첨부만 못 올렸어요 — ${friendlyError(e, '다시 눌러주세요.')}`);
      await load();
      return;
    }

    /* 3) 새 공지였으면 전원에게 알린다 (쓴 사람 빼고).
          공지는 이미 저장됐으니 결과를 기다려도 잃을 게 없다 — 대신 **정말 갔는지**를
          그대로 적어준다. 예전엔 발송과 무관하게 '알림도 보냈어요' 가 항상 떠서,
          키가 없거나 아무도 알림을 안 켰을 때도 갔다고 믿게 했다 */
    const isNew = !editing;
    let pushNote = '';
    if (isNew) {
      const res = await sendPush({
        title: `새 공지 — ${title.trim()}`,
        body: body.trim(),
        url: '/notice',
        tag: `notice-${target.id}`,
        fromId: session?.id ?? null,
      });
      pushNote = res?.skipped
        ? ' 알림은 아직 못 보내요 — 서버 설정을 확인해주세요.'
        : res && res.sent > 0
          ? ` ${res.sent}명에게 알림도 갔어요.`
          : ' 알림 받는 사람이 아직 없어요 (홈에서 알림 켜기).';
    }

    setBusy(false);
    setProgress('');
    setFormOpen(false);
    toast.show(isNew ? `공지를 올렸어요.${pushNote}` : '저장했어요.');
    await load();
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
        <div className="mb-3">
          <PushToggle />
        </div>

        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} onRetry={() => void load()} />
          </div>
        )}

        {/* 전체를 훑을 수 있게 — 검색 + 안 읽은 것만 */}
        {(notices?.length ?? 0) > 0 && (
          <div className="mb-3 flex gap-2">
            <div className="relative flex-1">
              <Icon
                name="search"
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
              />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="공지 검색"
                aria-label="공지 검색"
                className="field pl-9"
              />
            </div>
            <button
              onClick={() => setOnlyUnread((v) => !v)}
              aria-pressed={onlyUnread}
              className={`tap shrink-0 rounded-xl border px-3 text-[13px] font-bold transition ${
                onlyUnread
                  ? 'border-brand bg-brand text-white'
                  : 'border-neutral-200 bg-surface text-neutral-500'
              }`}
            >
              안 읽은 것만
            </button>
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
        ) : shown.length === 0 ? (
          <EmptyState
            icon="search"
            title="해당하는 공지가 없어요"
            desc={onlyUnread ? '안 읽은 공지가 없어요.' : '검색어를 바꿔보세요.'}
          />
        ) : (
          <>
            <p className="mb-2 text-[11.5px] text-neutral-400">
              전체 {notices.length}건 중 {shown.length}건
            </p>
            <ul className="space-y-2.5">
              {shown.map((n) => {
                const readers = readersOf(n.id);
                const mineRead = iRead(n);
                const open = openId === n.id;
                const unread = members.filter((m) => !readers.includes(m.id));
                const att = filesOf(n.id);

                return (
                  <li key={n.id} className="card overflow-hidden">
                    <button
                      onClick={() => void openNotice(n)}
                      aria-expanded={open}
                      className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left"
                    >
                      {!mineRead && (
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-label="안 읽음" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {n.pinned && <span className="chip bg-brand-50 text-brand-700">고정</span>}
                          <span
                            className={`text-[14.5px] leading-snug ${
                              mineRead ? 'font-semibold text-neutral-600' : 'font-bold text-neutral-900'
                            }`}
                          >
                            {n.title}
                          </span>
                          {att.length > 0 && (
                            <span className="flex items-center gap-0.5 text-[11px] font-bold text-neutral-400">
                              <Icon name="clip" size={11} />
                              {att.length}
                            </span>
                          )}
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
                        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-neutral-800">
                          {n.body}
                        </p>

                        {/* 사진은 바로 보이게, 문서는 내려받기로 */}
                        {att.filter((f) => f.is_image).length > 0 && (
                          <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                            {att
                              .filter((f) => f.is_image)
                              .map((f) => (
                                <button
                                  key={f.id}
                                  type="button"
                                  onClick={() => setViewer(f.file_url)}
                                  className="aspect-square overflow-hidden rounded-lg bg-neutral-100"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={f.file_url}
                                    alt={f.file_name}
                                    loading="lazy"
                                    className="h-full w-full object-cover"
                                  />
                                </button>
                              ))}
                          </div>
                        )}

                        {att.filter((f) => !f.is_image).length > 0 && (
                          <ul className="mt-2.5 space-y-1.5">
                            {att
                              .filter((f) => !f.is_image)
                              .map((f) => {
                                const ext = extOf(f.file_name);
                                return (
                                  <li key={f.id}>
                                    <a
                                      href={f.file_url}
                                      download={f.file_name}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="flex items-center gap-2 rounded-lg border border-neutral-200 px-2.5 py-2"
                                    >
                                      <span
                                        className={`chip shrink-0 ${EXT_COLOR[ext] ?? 'bg-neutral-200 text-neutral-600'}`}
                                      >
                                        {ext.toUpperCase() || 'FILE'}
                                      </span>
                                      <span className="min-w-0 flex-1 truncate text-[13px] text-neutral-700">
                                        {f.file_name}
                                      </span>
                                      <span className="shrink-0 text-[11px] text-neutral-400">
                                        {sizeText(f.file_size)}
                                      </span>
                                      <Icon name="download" size={14} className="shrink-0 text-neutral-400" />
                                    </a>
                                  </li>
                                );
                              })}
                          </ul>
                        )}

                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          <span className="text-[11.5px] font-bold text-neutral-400">읽음</span>
                          {readers.length === 0 ? (
                            <span className="text-[11.5px] text-neutral-400">아직 없어요</span>
                          ) : (
                            members
                              .filter((m) => readers.includes(m.id))
                              .map((m) => (
                                <span
                                  key={m.id}
                                  className="flex items-center gap-1 rounded-full bg-green-50 py-0.5 pl-0.5 pr-2"
                                >
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
          </>
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
              rows={6}
              className="field resize-none"
              placeholder="강사들이 읽고 바로 움직일 수 있게 적어주세요."
            />
          </div>

          {/* 첨부 — 사진도 문서도 */}
          <div>
            <p className="label">첨부 (사진 · 한글 · PDF 등)</p>
            {editing && filesOf(editing.id).length > 0 && (
              <ul className="mb-2 space-y-1.5">
                {filesOf(editing.id).map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center gap-2 rounded-lg border border-neutral-200 px-2.5 py-1.5"
                  >
                    <span className="chip shrink-0 bg-neutral-200 text-neutral-600">
                      {f.is_image ? 'IMG' : (extOf(f.file_name).toUpperCase() || 'FILE')}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-neutral-600">{f.file_name}</span>
                    <button
                      type="button"
                      onClick={() => setDropFileIds((v) => [...v, f.id])}
                      aria-label={`${f.file_name} 빼기`}
                      className="shrink-0 text-neutral-400"
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <input
              ref={fileRef}
              id="notice-files"
              type="file"
              multiple
              onChange={(e) => setPicked((v) => [...v, ...Array.from(e.target.files ?? [])])}
              className="hidden"
            />
            <label
              htmlFor="notice-files"
              className="tap w-full cursor-pointer gap-1.5 rounded-xl border border-dashed border-neutral-300 text-[14px] font-semibold text-neutral-500"
            >
              <Icon name="clip" size={15} />
              파일 · 사진 고르기
            </label>

            {picked.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {picked.map((f, i) => (
                  <span key={i} className="flex items-center gap-1.5 rounded-lg bg-neutral-100 px-2.5 py-1.5">
                    <span className="max-w-[150px] truncate text-[12px] text-neutral-600">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => setPicked((v) => v.filter((_, j) => j !== i))}
                      aria-label={`${f.name} 빼기`}
                      className="text-neutral-400"
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </span>
                ))}
              </div>
            )}
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
          {progress && <p className="text-[12.5px] text-neutral-500">{progress}</p>}

          <button onClick={() => void save()} disabled={busy} className="btn-primary w-full">
            {busy ? '저장 중…' : editing ? '저장' : '공지 올리고 알림 보내기'}
          </button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="공지를 지울까요?"
        message="첨부와 읽음 기록도 함께 사라져요."
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

      {toast.node}
    </div>
  );
}
