'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/session';
import { BottomNav } from '@/components/BottomNav';

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
    <div className="min-h-dvh pb-[76px]">
      <div className="mx-auto max-w-3xl">{children}</div>
      <BottomNav />
    </div>
  );
}
