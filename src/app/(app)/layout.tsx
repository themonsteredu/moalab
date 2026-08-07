'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/session';
import { BottomNav, SideNav } from '@/components/BottomNav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !session) router.replace('/login');
  }, [session, loading, router]);

  if (loading || !session) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="text-[24px] font-black tracking-tight text-brand/40">모아랩</div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh pb-[76px] lg:pb-0 lg:pl-[232px]">
      <SideNav />
      {/* 폰은 한 줄, PC 는 넓게.
          PC 위쪽 여백(pt-5)은 사이드바 로고와 같은 선에서 본문이 시작되도록 맞춘 값이다. */}
      <div className="mx-auto max-w-3xl lg:max-w-none lg:px-6 lg:pb-6 lg:pt-5">{children}</div>
      <BottomNav />
    </div>
  );
}
