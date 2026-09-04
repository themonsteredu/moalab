'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { Skeleton } from '@/components/ui';
import { Avatar, BrandMark } from '@/components/Brand';
import type { MemberPublic } from '@/lib/types';

export default function LoginPage() {
  const router = useRouter();
  const { session, loading: sessionLoading, signIn } = useSession();

  const [members, setMembers] = useState<MemberPublic[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [picked, setPicked] = useState<MemberPublic | null>(null);
  const [pickedIdx, setPickedIdx] = useState(0);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!sessionLoading && session) router.replace('/home');
  }, [session, sessionLoading, router]);

  const load = useCallback(async () => {
    setLoadError('');
    if (!isSupabaseConfigured) {
      setMembers([]);
      setLoadError('서버 설정이 아직 안 됐어요. 관리자에게 알려주세요.');
      return;
    }
    const { data, error: e } = await supabase
      .from('members_public')
      .select('*')
      .eq('active', true)
      .order('sort_order')
      .order('name');
    if (e) {
      setMembers([]);
      setLoadError('멤버 목록을 불러오지 못했어요. 화면을 새로고침해주세요.');
      return;
    }
    setMembers((data ?? []) as MemberPublic[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(
    async (value: string, member: MemberPublic) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError('');
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ memberId: member.id, pin: value }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(json.error ?? '로그인이 안 됐어요. 다시 눌러주세요.');
          setPin('');
          setShake(true);
          setTimeout(() => setShake(false), 450);
          return;
        }
        signIn({ ...json.member, token: json.token ?? null });
        router.replace('/home');
      } catch {
        setError('인터넷 연결이 불안정해요. 잠시 후 다시 눌러주세요.');
        setPin('');
        setShake(true);
        setTimeout(() => setShake(false), 450);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [signIn, router],
  );

  const press = (d: string) => {
    if (busy || !picked || pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setError('');
    if (next.length === 4) void submit(next, picked);
  };

  const back = () => {
    if (busy) return;
    setPin((p) => p.slice(0, -1));
    setError('');
  };

  // PC 에서는 물리 키보드로도 입력되게
  useEffect(() => {
    if (!picked) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
      else if (e.key === 'Escape') reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, pin, busy]);

  const reset = () => {
    setPicked(null);
    setPin('');
    setError('');
  };

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-canvas">
      {/* 배경 — 브랜드 컬러가 은은하게 번지는 느낌 */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 -top-28 h-72 w-72 rounded-full bg-brand/[.07] blur-3xl" />
        <div className="absolute -right-20 top-40 h-64 w-64 rounded-full bg-violet-500/[.06] blur-3xl" />
        <div className="absolute -bottom-28 left-1/3 h-72 w-72 rounded-full bg-brand/[.05] blur-3xl" />
      </div>

      <div className="relative flex w-full flex-1 flex-col items-center justify-center px-5 py-10">
        <div className="w-full max-w-[400px]">
          {/* 로고 — 모아킷 로고는 어두운 배경 기준으로 만들어져 있어서
              앱 아이콘과 같은 검은 판 위에 올린다 (밝은 배경에 teal 만 두면 붕 뜬다) */}
          <div className="mb-8 flex flex-col items-center">
            <span className="flex h-[84px] w-[84px] items-center justify-center rounded-[22px] border border-neutral-200 bg-black">
              <BrandMark size={54} />
            </span>
            <h1 className="mt-3.5 text-[26px] font-black leading-none tracking-tight text-neutral-900">
              모아랩
            </h1>
            <p className="mt-2 text-[13px] font-normal tracking-wide text-neutral-400">
              업무 워크스페이스
            </p>
          </div>

          {!picked ? (
            /* ---------------------------------------------- 이름 고르기 */
            <section className="animate-fade-up">
              <p className="mb-4 text-center text-[15px] font-bold text-neutral-700">누구세요?</p>

              {members === null ? (
                <div className="grid grid-cols-2 gap-2.5">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-[104px] w-full rounded-2xl" />
                  ))}
                </div>
              ) : members.length === 0 ? (
                <div className="rounded-2xl border border-neutral-200 bg-surface p-7 text-center">
                  <p className="text-[14px] leading-relaxed text-neutral-600">
                    {loadError || '등록된 멤버가 없어요.'}
                  </p>
                  <button onClick={() => void load()} className="btn-ghost mt-5 w-full">
                    다시 불러오기
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5">
                  {members.map((m, i) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        setPicked(m);
                        setPickedIdx(i);
                        setPin('');
                        setError('');
                      }}
                      style={{ animationDelay: `${i * 45}ms` }}
                      className="group relative flex animate-fade-up flex-col items-center gap-2.5 rounded-2xl
                                 border border-neutral-200 bg-surface px-3 py-5
                                 transition-colors duration-100
                                 hover:border-neutral-300 hover:bg-neutral-100
                                 active:bg-neutral-50"
                    >
                      {m.role === 'admin' && (
                        <span className="absolute right-2.5 top-2.5 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold text-brand-700">
                          원장
                        </span>
                      )}
                      <Avatar name={m.name} index={i} size={46} />
                      <span className="text-[15px] font-bold text-neutral-800">{m.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          ) : (
            /* ---------------------------------------------------- PIN */
            <section className="animate-fade-up">
              <div className="mb-5 flex flex-col items-center">
                <Avatar name={picked.name} index={pickedIdx} size={52} ring />
                <p className="mt-2.5 text-[18px] font-bold text-neutral-900">{picked.name}</p>
                <p className="mt-1 text-[13px] text-neutral-400">PIN 4자리를 입력해주세요</p>
              </div>

              {/* 점 4개 */}
              <div
                className={`mb-3 flex justify-center gap-3.5 ${shake ? 'animate-shake' : ''}`}
                role="status"
                aria-label={`${pin.length}자리 입력됨`}
              >
                {[0, 1, 2, 3].map((i) => {
                  const filled = pin.length > i;
                  const active = pin.length === i && !busy;
                  return (
                    <span
                      key={i}
                      className={`h-3.5 w-3.5 rounded-full transition-all duration-150 ${
                        error
                          ? 'bg-red-400'
                          : filled
                            ? 'scale-110 bg-brand'
                            : active
                              ? 'bg-brand/30 ring-2 ring-brand/50'
                              : 'bg-neutral-300/80'
                      }`}
                    />
                  );
                })}
              </div>

              <p
                className={`mb-4 text-center text-[13px] font-bold ${
                  error ? 'text-red-600' : 'text-neutral-400'
                }`}
                role={error ? 'alert' : undefined}
              >
                {busy ? '확인 중…' : error || ' '}
              </p>

              {/* 숫자 키패드 — 폰에서 OS 키보드가 화면을 가리지 않게 */}
              <div className="grid grid-cols-3 gap-2.5">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                  <Key key={d} onClick={() => press(d)} disabled={busy}>
                    {d}
                  </Key>
                ))}
                <Key onClick={reset} disabled={busy} muted>
                  <span className="text-[13px] font-bold">취소</span>
                </Key>
                <Key onClick={() => press('0')} disabled={busy}>
                  0
                </Key>
                <Key onClick={back} disabled={busy || pin.length === 0} muted ariaLabel="한 자리 지우기">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9L2 12z" strokeLinejoin="round" />
                    <path d="m17 9-5 6M12 9l5 6" strokeLinecap="round" />
                  </svg>
                </Key>
              </div>

              <button
                onClick={reset}
                className="mt-5 w-full py-2 text-center text-[13px] font-bold text-neutral-400 transition hover:text-neutral-600"
              >
                다른 사람으로 로그인
              </button>
            </section>
          )}
        </div>
      </div>

      <p className="relative pb-7 text-center text-[11.5px] text-neutral-400">
        한 번 로그인하면 30일 동안 유지돼요
      </p>
    </main>
  );
}

function Key({
  children,
  onClick,
  disabled,
  muted,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  muted?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`flex h-[58px] items-center justify-center rounded-2xl text-[22px] font-bold transition
                  active:scale-95 disabled:opacity-35 disabled:active:scale-100 ${
                    muted
                      ? 'text-neutral-400 hover:bg-surface/70'
                      : 'border border-neutral-300/90 bg-surface/85 text-neutral-800 shadow-[0_2px_10px_-4px_rgba(120,70,40,.2)] backdrop-blur hover:bg-surface active:bg-brand-50'
                  }`}
    >
      {children}
    </button>
  );
}
