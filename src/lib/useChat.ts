'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { useSession } from './session';
import type { Message, RoomSummary } from './types';

/**
 * 대화 — 브라우저 쪽.
 *
 * 대화 표에는 **직접 못 붙는다.** 전부 `/api/chat/*` 를 거치고 신원은 세션 토큰으로
 * 확인한다 (`x-actor-id` 는 브라우저가 지어낼 수 있어서 대화에는 못 쓴다).
 *
 * 새 말이 왔는지는 **두 갈래**로 안다:
 *   1) Supabase Realtime broadcast — 방 id 만 오는 신호(내용은 안 실린다)
 *   2) 5초 폴링 — 실시간이 안 붙어도(키가 없거나 막혀도) 대화는 그대로 굴러간다
 * 하나만 두면 "어제는 됐는데 오늘은 안 온다" 가 된다.
 */

const POLL_MS = 5000;
const TOPIC = 'moalab-chat';

export function useChatToken(): string | null {
  const { session } = useSession();
  return session?.token ?? null;
}

function authFetch(token: string | null, path: string, init?: RequestInit) {
  return fetch(path, {
    ...init,
    headers: { ...(init?.headers ?? {}), 'x-session-token': token ?? '' },
  });
}

/** 서버가 준 한글 문구를 그대로 쓴다 — 여기서 다시 지어내지 않는다 */
async function errorOf(res: Response, fallback: string): Promise<string> {
  const j = await res.json().catch(() => ({}));
  return j?.error ?? fallback;
}

/* -------------------------------------------------------------------- 신호
   방 하나가 아니라 **전체 신호**를 듣는다. 목록 화면도 방 화면도 같은 것을 본다. */

function usePing(onPing: (roomId: string) => void) {
  const cb = useRef(onPing);
  cb.current = onPing;

  useEffect(() => {
    let ch: ReturnType<typeof supabase.channel> | null = null;
    try {
      ch = supabase.channel(TOPIC);
      ch.on('broadcast', { event: 'ping' }, (msg) => {
        const id = (msg?.payload as { roomId?: string } | undefined)?.roomId;
        if (id) cb.current(id);
      }).subscribe();
    } catch {
      /* 실시간이 안 붙어도 폴링이 대신한다 */
    }
    return () => {
      try {
        if (ch) void supabase.removeChannel(ch);
      } catch {
        /* 무시 */
      }
    };
  }, []);
}

/* -------------------------------------------------------------------- 목록 */

export function useRooms() {
  const token = useChatToken();
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token) {
      setRooms([]);
      setError('대화를 쓰려면 다시 로그인해주세요.');
      return;
    }
    try {
      const res = await authFetch(token, '/api/chat/rooms');
      if (!res.ok) {
        setRooms([]);
        setError(await errorOf(res, '대화를 불러오지 못했어요.'));
        return;
      }
      const j = await res.json();
      setRooms(j.rooms ?? []);
      setError('');
    } catch {
      setRooms([]);
      setError('인터넷 연결이 불안정해요. 잠시 후 다시 눌러주세요.');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  usePing(() => void load());

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const openDm = useCallback(
    async (memberId: string): Promise<string | null> => {
      const res = await authFetch(token, '/api/chat/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ memberId }),
      });
      if (!res.ok) {
        setError(await errorOf(res, '대화방을 열지 못했어요.'));
        return null;
      }
      return (await res.json()).roomId ?? null;
    },
    [token],
  );

  return { rooms, error, reload: load, openDm };
}

/* -------------------------------------------------------------------- 한 방 */

export function useRoom(roomId: string) {
  const token = useChatToken();
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const lastReadRef = useRef<string>('');

  const markRead = useCallback(
    async (at: string) => {
      if (!at || at <= lastReadRef.current) return;
      lastReadRef.current = at;
      await authFetch(token, '/api/chat/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomId, at }),
      }).catch(() => null);
    },
    [token, roomId],
  );

  const load = useCallback(async () => {
    if (!token) {
      setMessages([]);
      setError('대화를 쓰려면 다시 로그인해주세요.');
      return;
    }
    try {
      const res = await authFetch(token, `/api/chat/messages?roomId=${encodeURIComponent(roomId)}`);
      if (!res.ok) {
        setMessages([]);
        setError(await errorOf(res, '대화를 불러오지 못했어요.'));
        return;
      }
      const j = await res.json();
      const list = (j.messages ?? []) as Message[];
      setMessages(list);
      setMemberIds(j.memberIds ?? []);
      setError('');
      // 이 방을 보고 있으면 곧 읽은 것이다
      const last = list[list.length - 1];
      if (last) void markRead(last.created_at);
    } catch {
      setMessages([]);
      setError('인터넷 연결이 불안정해요. 잠시 후 다시 눌러주세요.');
    }
  }, [token, roomId, markRead]);

  useEffect(() => {
    void load();
  }, [load]);

  usePing((id) => {
    if (id === roomId) void load();
  });

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const send = useCallback(
    async (body: string, imagePath?: string | null): Promise<boolean> => {
      setSending(true);
      try {
        const res = await authFetch(token, '/api/chat/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ roomId, body, imagePath: imagePath ?? null }),
        });
        if (!res.ok) {
          setError(await errorOf(res, '말을 못 보냈어요. 다시 눌러주세요.'));
          return false;
        }
        setError('');
        await load();
        return true;
      } catch {
        setError('인터넷 연결이 불안정해요. 잠시 후 다시 눌러주세요.');
        return false;
      } finally {
        setSending(false);
      }
    },
    [token, roomId, load],
  );

  /** 사진은 브라우저에서 줄인 뒤 서버로 보낸다 (버킷이 비공개라 직접 못 올린다) */
  const upload = useCallback(
    async (file: Blob): Promise<string | null> => {
      const form = new FormData();
      form.append('roomId', roomId);
      form.append('file', file);
      const res = await authFetch(token, '/api/chat/photo', { method: 'POST', body: form });
      if (!res.ok) {
        setError(await errorOf(res, '사진을 못 올렸어요.'));
        return null;
      }
      return (await res.json()).path ?? null;
    },
    [token, roomId],
  );

  return { messages, memberIds, error, sending, reload: load, send, upload, markRead };
}

/** 사진 한 장의 서명 URL — 방 멤버에게만 나온다 */
export function usePhoto(path: string | null): string | null {
  const token = useChatToken();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!path) return setUrl(null);
    let live = true;
    void (async () => {
      const res = await authFetch(token, `/api/chat/photo?path=${encodeURIComponent(path)}`).catch(() => null);
      if (!live || !res?.ok) return;
      const j = await res.json().catch(() => ({}));
      if (live) setUrl(j.url ?? null);
    })();
    return () => {
      live = false;
    };
  }, [path, token]);

  return url;
}
