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
      {/* 폰은 한 줄, PC 는 넓게 — 단 끝까지 늘리지는 않는다.
          예전엔 lg:max-w-none 이라 27인치에서 버튼·진행바가 1500px 까지 늘어나
          "막대기가 끝까지 간다"가 됐다. 홈의 3단(lg:grid-cols-3)은 이 폭에서도 넉넉하다.
          PC 위쪽 여백(pt-5)은 사이드바 로고와 같은 선에서 본문이 시작되도록 맞춘 값이다. */}
      <div className="mx-auto max-w-3xl lg:max-w-[1280px] lg:px-6 lg:pb-6 lg:pt-5">{children}</div>
      <BottomNav />
    </div>
  );
}
