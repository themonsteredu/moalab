'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { useRoom, usePhoto } from '@/lib/useChat';
import { groupMessages } from '@/lib/chat';
import { resizeImage } from '@/lib/image';
import { hhmm, korDate } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { ErrorBanner, Skeleton, useToast } from '@/components/ui';
import type { Message } from '@/lib/types';

/**
 * 한 대화방.
 *
 * 남의 방 id 를 주소창에 넣어도 서버가 403 을 준다 — 격리는 화면이 아니라
 * `/api/chat/*` 에서 한다 (`chatServer.isMember`).
 */
export default function ChatRoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const params = useSearchParams();
  const { session } = useSession();
  const { nameOf } = useMembers();
  const toast = useToast();
  const meId = session?.id ?? '';

  const { messages, error, sending, reload, send, upload } = useRoom(roomId);
  const [text, setText] = useState('');
  const [busyPhoto, setBusyPhoto] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* 부서협업에서 '이 건으로 대화하기' 로 들어오면 첫 마디를 미리 채워둔다.
     보내지는 않는다 — 자동으로 나가면 잘못 눌렀을 때 되돌릴 수가 없다 */
  useEffect(() => {
    const draft = params.get('draft');
    if (draft) setText(draft);
  }, [params]);

  // 새 말이 오면 맨 아래로. 대화는 마지막 줄이 지금이다
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages?.length]);

  const grouped = useMemo(() => groupMessages(messages ?? []), [messages]);

  const submit = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setText('');
    const ok = await send(body);
    if (!ok) setText(body); // 실패하면 쓴 글을 돌려준다 — 다시 타이핑하게 하지 않는다
  };

  const pickPhoto = async (file: File) => {
    setBusyPhoto(true);
    try {
      const { blob } = await resizeImage(file);
      const path = await upload(blob);
      if (path) await send('', path);
    } catch {
      toast.show('사진을 못 올렸어요.');
    } finally {
      setBusyPhoto(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <>
      <PageHeader title="대화" back="/chat" />

      <div className="flex flex-col px-4 pb-4 pt-3 lg:max-w-2xl">
        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} onRetry={() => void reload()} />
          </div>
        )}

        {messages === null ? (
          <Skeleton className="h-64 w-full rounded-2xl" />
        ) : messages.length === 0 ? (
          <p className="card px-4 py-10 text-center text-[13px] text-neutral-400">
            아직 아무 말도 없어요. 첫 마디를 남겨보세요.
          </p>
        ) : (
          <div className="space-y-1">
            {grouped.map(({ msg, head, tail, daybreak }) => (
              <div key={msg.id}>
                {daybreak && (
                  <p className="my-3 text-center text-[11.5px] font-bold text-neutral-400">
                    {korDate(msg.created_at.slice(0, 10))}
                  </p>
                )}
                <Bubble msg={msg} mine={msg.member_id === meId} head={head} tail={tail} nameOf={nameOf} />
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* 쓰는 줄 — 하단 탭 위에 붙인다 */}
      <div className="sticky bottom-16 z-20 border-t border-neutral-200 bg-surface/95 px-4 py-2 backdrop-blur lg:bottom-0 lg:max-w-2xl">
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pickPhoto(f);
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busyPhoto}
            aria-label="사진 보내기"
            className="tap w-11 shrink-0 rounded-xl border border-neutral-300 bg-surface text-[18px] text-neutral-500"
          >
            {busyPhoto ? '…' : '+'}
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // 폰에서는 엔터가 줄바꿈이어야 한다. PC 에서만 엔터로 보낸다
              if (e.key === 'Enter' && !e.shiftKey && window.innerWidth >= 1024) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={1}
            placeholder="할 말을 적어주세요"
            className="field max-h-28 min-h-[44px] flex-1 resize-none py-2.5"
          />
          <button
            onClick={() => void submit()}
            disabled={!text.trim() || sending}
            className="btn-primary h-11 shrink-0 px-4 text-[14px]"
          >
            보내기
          </button>
        </div>
      </div>

      {toast.node}
    </>
  );
}

/* ------------------------------------------------------------------ 한 마디 */

function Bubble({
  msg,
  mine,
  head,
  tail,
  nameOf,
}: {
  msg: Message;
  mine: boolean;
  head: boolean;
  tail: boolean;
  nameOf: (id: string | null | undefined) => string;
}) {
  return (
    <div className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      {/* 이름표는 잇달아 쓴 첫 줄에만 — 줄마다 붙이면 폰 화면의 절반이 이름이 된다 */}
      {head && !mine && (
        <p className="mb-0.5 ml-1 text-[11.5px] font-bold text-neutral-500">{nameOf(msg.member_id)}</p>
      )}
      <div className={`flex max-w-[85%] items-end gap-1.5 ${mine ? 'flex-row-reverse' : ''}`}>
        <div
          className={`min-w-0 rounded-2xl px-3 py-2 text-[14px] leading-relaxed ${
            mine ? 'bg-brand text-white' : 'bg-neutral-100 text-neutral-900'
          }`}
        >
          {msg.image_path && <Photo path={msg.image_path} />}
          {msg.body && <p className="whitespace-pre-wrap break-words">{msg.body}</p>}
        </div>
        {tail && <span className="shrink-0 text-[10.5px] text-neutral-400">{hhmm(msg.created_at.slice(11, 16))}</span>}
      </div>
    </div>
  );
}

/** 사진은 공개 URL 이 아니다 — 방 멤버에게만 서명 URL 이 내려온다 */
function Photo({ path }: { path: string }) {
  const url = usePhoto(path);
  if (!url) return <Skeleton className="h-40 w-48 rounded-xl" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="보낸 사진" className="mb-1 max-h-64 rounded-xl object-contain" />
  );
}
