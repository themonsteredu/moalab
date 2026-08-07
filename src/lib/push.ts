'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

/** 서버에 알림을 보내달라고 부탁할 때 쓰는 모양 */
export interface PushPayload {
  title: string;
  body: string;
  /** 눌렀을 때 열릴 화면 */
  url?: string;
  /** 같은 tag 알림은 덮어쓴다 */
  tag?: string;
  /** 이 사람들에게만. 비우면 전원 (보낸 사람은 서버에서 빠진다) */
  memberIds?: string[];
  /** 보낸 사람 — 자기 알림은 자기한테 안 온다 */
  fromId?: string | null;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushState = 'unsupported' | 'denied' | 'off' | 'on';

/**
 * 푸시 알림 켜고 끄기.
 *
 * 아이폰은 사파리에서 **홈 화면에 추가** 를 해야 알림을 받을 수 있다 (iOS 16.4+).
 * 그래서 지원 여부를 그냥 숨기지 말고 화면에 이유를 적어준다.
 */
export function usePush(memberId: string | null) {
  const [state, setState] = useState<PushState>('off');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** 아이폰 사파리인데 홈 화면 추가를 안 한 경우 */
  const [needsInstall, setNeedsInstall] = useState(false);

  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const supported =
      'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

    if (!supported) {
      setState('unsupported');
      const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      // iOS 는 홈 화면에 추가(standalone)해야 PushManager 가 생긴다
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      setNeedsInstall(iOS && !standalone);
      return;
    }

    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }

    void (async () => {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? 'on' : 'off');
    })();
  }, []);

  const enable = useCallback(async () => {
    setError('');
    if (!memberId) return;
    if (!vapid) {
      setError('알림 키가 설정되지 않았어요. 원장님께 알려주세요.');
      return;
    }
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setState(perm === 'denied' ? 'denied' : 'off');
        return;
      }

      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapid) as BufferSource,
        }));

      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh: string; auth: string } };
      const { error: e } = await supabase.from('push_subscriptions').upsert(
        {
          member_id: memberId,
          endpoint: json.endpoint,
          p256dh: json.keys?.p256dh,
          auth: json.keys?.auth,
          user_agent: navigator.userAgent.slice(0, 300),
        },
        { onConflict: 'endpoint' },
      );
      if (e) throw e;
      setState('on');
    } catch (err) {
      setError(err instanceof Error ? err.message : '알림을 켜지 못했어요.');
    } finally {
      setBusy(false);
    }
  }, [memberId, vapid]);

  const disable = useCallback(async () => {
    setError('');
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        await sub.unsubscribe();
      }
      setState('off');
    } catch (err) {
      setError(err instanceof Error ? err.message : '알림을 끄지 못했어요.');
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, busy, error, needsInstall, enable, disable };
}

/**
 * 알림 보내기. 실패해도 본 작업(공지 저장 등)을 막지 않는다 —
 * 알림이 안 갔다고 공지가 안 올라가면 더 나쁘다.
 */
export function sendPush(payload: PushPayload): void {
  void fetch('/api/push/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});
}
