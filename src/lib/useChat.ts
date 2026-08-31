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
 *   2) 폴링 — 실시간이 안 붙어도(키가 없거나 막혀도) 대화는 그대로 굴러간다
 * 하나만 두면 "어제는 됐는데 오늘은 안 온다" 가 된다.
 *
 * ⚠️ **폴링은 반드시 '그 뒤로 새로 온 것만' 물어야 한다.**
 * 예전엔 몇 초마다 60줄을 통째로 다시 받아 말풍선을 전부 다시 그렸다.
 * 지금은 `?after=` 로 새 줄만 받고, 없으면 화면을 아예 안 건드린다.
 */

/** 방 안 — 새 줄만 받으므로 자주 물어도 싸다 */
const POLL_ROOM_MS = 3000;
/** 목록 — 뱃지용이라 덜 자주. 이쪽이 더 무겁다 */
const POLL_ROOMS_MS = 6000;
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
  /* 전체방·부서방 맞추기(ensureRooms)는 **화면에 들어올 때 한 번만** 한다.
     폴링마다 하면 6초마다 부서·역할 표를 네 개씩 다시 읽는다 — 대화가 느려진 진짜 이유였다.
     역할이 바뀌어 새 부서방이 생기는 건 다음에 대화 화면에 들어올 때 따라온다
     (원래 문서에 적어둔 동작 그대로다). */
  const synced = useRef(false);

  const load = useCallback(async () => {
    if (!token) {
      setRooms([]);
      setError('대화를 쓰려면 다시 로그인해주세요.');
      return;
    }
    try {
      const sync = !synced.current;
      synced.current = true;
      const res = await authFetch(token, `/api/chat/rooms${sync ? '?sync=1' : ''}`);
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
    }, POLL_ROOMS_MS);
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
  const { session } = useSession();
  const meId = session?.id ?? '';
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  /** 보내는 중인지 — 폴링이 그 사이에 끼면 같은 말이 두 번 보인다 */
  const sendingRef = useRef(false);
  const lastReadRef = useRef<string>('');
  /** 서버가 확인해준 마지막 줄의 시각. 폴링은 **이 뒤로만** 물어본다.
      아직 안 올라간 내 말(임시 줄)의 시각을 쓰면 안 된다 — 폰 시계가 서버보다
      앞서 있으면 그 사이에 온 남의 말을 영영 건너뛴다 */
  const afterRef = useRef<string>('');

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

  /**
   * `first` 면 통째로, 아니면 **그 뒤로 새로 온 것만** 받는다.
   * 새 줄이 없으면 `setMessages` 를 아예 안 불러서 말풍선을 다시 그리지 않는다.
   */
  const load = useCallback(
    async (first = false) => {
      if (!token) {
        setMessages([]);
        setError('대화를 쓰려면 다시 로그인해주세요.');
        return;
      }
      const after = first ? '' : afterRef.current;
      if (!first && sendingRef.current) return; // 보내는 중에는 끼어들지 않는다
      try {
        const res = await authFetch(
          token,
          `/api/chat/messages?roomId=${encodeURIComponent(roomId)}${after ? `&after=${encodeURIComponent(after)}` : ''}`,
        );
        if (!res.ok) {
          // 새로고침(폴링)이 잠깐 실패한 것 때문에 보고 있던 대화를 지우지 않는다
          if (first) setMessages([]);
          setError(await errorOf(res, '대화를 불러오지 못했어요.'));
          return;
        }
        const j = await res.json();
        const fresh = (j.messages ?? []) as Message[];
        setError('');
        if (j.memberIds) setMemberIds(j.memberIds);

        if (after && fresh.length === 0) return; // 바뀐 게 없으면 화면을 안 건드린다

        const last = fresh[fresh.length - 1];
        if (last) afterRef.current = last.created_at;

        setMessages((prev) => {
          if (!after || prev === null) return fresh;
          // 임시 줄(아직 안 올라간 내 말)은 남기고, 같은 id 는 서버 것으로 갈아끼운다
          const ids = new Set(fresh.map((m) => m.id));
          return [...prev.filter((m) => !ids.has(m.id)), ...fresh];
        });
        if (last) void markRead(last.created_at);
      } catch {
        if (first) setMessages([]);
        setError('인터넷 연결이 불안정해요. 잠시 후 다시 눌러주세요.');
      }
    },
    [token, roomId, markRead],
  );

  // 방이 바뀌면 처음부터 다시
  useEffect(() => {
    afterRef.current = '';
    lastReadRef.current = '';
    setMessages(null);
    void load(true);
  }, [load]);

  usePing((id) => {
    if (id === roomId) void load();
  });

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_ROOM_MS);
    return () => clearInterval(t);
  }, [load]);

  /**
   * 한 마디 보내기 — **화면에 먼저 띄우고 서버에 보낸다.**
   *
   * 예전엔 보낸 뒤 `load()` 로 60줄을 통째로 다시 받을 때까지 기다렸다.
   * 폰에서 왕복 두 번(보내기 → 다시 받기)을 기다리는 동안 아무것도 안 보여서
   * *"느리다"* 가 됐다. 지금은 누르는 즉시 말풍선이 뜨고, 서버가 준 진짜 줄로
   * 조용히 갈아끼운다. 실패하면 그 줄을 도로 걷어낸다.
   */
  const send = useCallback(
    async (body: string, imagePath?: string | null): Promise<boolean> => {
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const temp: Message = {
        id: tempId,
        room_id: roomId,
        member_id: meId,
        body: body || null,
        image_path: imagePath ?? null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...(prev ?? []), temp]);
      sendingRef.current = true;
      setSending(true);
      try {
        const res = await authFetch(token, '/api/chat/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ roomId, body, imagePath: imagePath ?? null }),
        });
        if (!res.ok) {
          setMessages((prev) => (prev ?? []).filter((m) => m.id !== tempId));
          setError(await errorOf(res, '말을 못 보냈어요. 다시 눌러주세요.'));
          return false;
        }
        const saved = (await res.json()).message as Message | undefined;
        setError('');
        if (saved) {
          /* 서버가 준 진짜 줄로 갈아끼운다 (시각·id 가 여기서 맞춰진다).
             폴링이 한발 먼저 같은 줄을 받아왔을 수도 있으니 그것부터 걷어낸다 */
          setMessages((prev) =>
            (prev ?? []).filter((m) => m.id !== saved.id).map((m) => (m.id === tempId ? saved : m)),
          );
          if (saved.created_at > afterRef.current) afterRef.current = saved.created_at;
          lastReadRef.current = saved.created_at; // 보낸 사람은 그 줄까지 읽은 것이다
        }
        return true;
      } catch {
        setMessages((prev) => (prev ?? []).filter((m) => m.id !== tempId));
        setError('인터넷 연결이 불안정해요. 잠시 후 다시 눌러주세요.');
        return false;
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [token, roomId, meId],
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

  return {
    messages,
    memberIds,
    error,
    sending,
    reload: () => load(true),
    send,
    upload,
    markRead,
  };
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
