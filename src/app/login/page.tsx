'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { Skeleton } from '@/components/ui';
import type { MemberPublic } from '@/lib/types';

export default function LoginPage() {
  const router = useRouter();
  const { session, loading: sessionLoading, signIn } = useSession();

  const [members, setMembers] = useState<MemberPublic[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [picked, setPicked] = useState<MemberPublic | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!sessionLoading && session) router.replace('/home');
  }, [session, sessionLoading, router]);

  const load = useCallback(async () => {
    setLoadError('');
    if (!isSupabaseConfigured) {
      setMembers([]);
      setLoadError('서버 설정이 아직 안 됐어요. .env.local 에 Supabase 주소와 키를 넣어주세요.');
      return;
    }
    const { data, error } = await supabase
      .from('members_public')
      .select('*')
      .eq('active', true)
      .order('sort_order')
      .order('name');
    if (error) {
      setMembers([]);
      setLoadError('멤버 목록을 불러오지 못했어요. 화면을 새로고침해주세요.');
      return;
    }
    setMembers((data ?? []) as MemberPublic[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (picked) setTimeout(() => inputRef.current?.focus(), 80);
  }, [picked]);

  const submit = useCallback(
    async (value: string) => {
      if (!picked || value.length !== 4 || busy) return;
      setBusy(true);
      setError('');
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ memberId: picked.id, pin: value }),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? '로그인이 안 됐어요. 다시 눌러주세요.');
          setPin('');
          setBusy(false);
          return;
        }
        signIn(json.member);
        router.replace('/home');
      } catch {
        setError('인터넷 연결이 불안정해요. 잠시 후 다시 눌러주세요.');
        setPin('');
        setBusy(false);
      }
    },
    [picked, busy, signIn, router],
  );

  const onPinChange = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 4);
    setPin(digits);
    setError('');
    if (digits.length === 4) void submit(digits);
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10">
      <div className="mb-9 text-center">
        <div className="text-[30px] font-black leading-none tracking-tight text-brand">모아랩</div>
        <p className="mt-2.5 text-[14px] text-neutral-500">업무 워크스페이스</p>
      </div>

      {!picked ? (
        <section>
          <p className="mb-3 text-center text-[14px] font-semibold text-neutral-600">누구세요?</p>

          {members === null ? (
            <div className="space-y-2.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-2xl" />
              ))}
            </div>
          ) : members.length === 0 ? (
            <div className="card p-6 text-center">
              <p className="text-[14px] leading-relaxed text-neutral-600">
                {loadError || '등록된 멤버가 없어요.'}
              </p>
              <button onClick={() => void load()} className="btn-ghost mt-4 w-full">
                다시 불러오기
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {members.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setPicked(m);
                    setPin('');
                    setError('');
                  }}
                  className="tap w-full justify-between rounded-2xl border border-neutral-200 bg-white px-5
                             py-3.5 text-[17px] font-bold text-neutral-800 shadow-sm transition
                             active:scale-[.99] active:bg-neutral-50"
                >
                  <span>{m.name}</span>
                  {m.role === 'admin' && (
                    <span className="chip bg-brand-50 text-brand-700">원장</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section>
          <p className="mb-1 text-center text-[20px] font-bold">{picked.name}</p>
          <p className="mb-6 text-center text-[14px] text-neutral-500">PIN 4자리를 입력해주세요</p>

          {/* 실제 입력은 숨긴 input, 화면에는 4칸 점을 그린다 */}
          <button
            type="button"
            onClick={() => inputRef.current?.focus()}
            className="mb-4 flex w-full justify-center gap-3"
            aria-label="PIN 입력"
          >
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={`flex h-14 w-12 items-center justify-center rounded-2xl border-2 text-[22px] font-black transition ${
                  pin.length === i
                    ? 'border-brand bg-brand-50'
                    : pin.length > i
                      ? 'border-brand bg-brand text-white'
                      : 'border-neutral-200 bg-white'
                }`}
              >
                {pin.length > i ? '●' : ''}
              </span>
            ))}
          </button>

          <input
            ref={inputRef}
            value={pin}
            onChange={(e) => onPinChange(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            type="password"
            maxLength={4}
            disabled={busy}
            aria-label="PIN 숫자 4자리"
            className="sr-only"
          />

          {error && <p className="mb-3 text-center text-[13px] font-semibold text-red-600">{error}</p>}
          {busy && <p className="mb-3 text-center text-[13px] text-neutral-500">확인 중…</p>}

          <button
            onClick={() => {
              setPicked(null);
              setPin('');
              setError('');
            }}
            className="btn-ghost w-full"
          >
            다른 사람으로 로그인
          </button>

          <p className="mt-6 text-center text-[12px] leading-relaxed text-neutral-400">
            한 번 로그인하면 30일 동안 유지돼요.
          </p>
        </section>
      )}
    </main>
  );
}
