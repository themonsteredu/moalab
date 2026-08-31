'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Role } from './types';

const KEY = 'moalab.session.v1';
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

export interface Session {
  id: string;
  name: string;
  role: Role;
  /** epoch ms. 지나면 다시 PIN 을 받는다. */
  expiresAt: number;
  /**
   * 대화 전용 신원 확인용. 없어도 나머지 화면은 그대로 돌아간다 —
   * 이 칸이 생기기 전에 로그인한 사람은 대화만 다시 로그인을 요구받는다.
   */
  token?: string | null;
}

interface Ctx {
  session: Session | null;
  /** localStorage 를 아직 안 읽은 상태 (깜빡임 방지용) */
  loading: boolean;
  signIn: (m: { id: string; name: string; role: Role; token?: string | null }) => void;
  signOut: () => void;
  isAdmin: boolean;
}

const SessionContext = createContext<Ctx>({
  session: null,
  loading: true,
  signIn: () => {},
  signOut: () => {},
  isAdmin: false,
});

function read(): Session | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (!s?.id || !s?.expiresAt || s.expiresAt < Date.now()) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSession(read());
    setLoading(false);
  }, []);

  const signIn = useCallback((m: { id: string; name: string; role: Role; token?: string | null }) => {
    const s: Session = { ...m, expiresAt: Date.now() + THIRTY_DAYS };
    window.localStorage.setItem(KEY, JSON.stringify(s));
    setSession(s);
  }, []);

  const signOut = useCallback(() => {
    window.localStorage.removeItem(KEY);
    setSession(null);
  }, []);

  const value = useMemo<Ctx>(
    () => ({ session, loading, signIn, signOut, isAdmin: session?.role === 'admin' }),
    [session, loading, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
