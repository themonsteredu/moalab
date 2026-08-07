'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/session';

export default function RootPage() {
  const { session, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(session ? '/home' : '/login');
  }, [session, loading, router]);

  return (
    <main className="flex min-h-dvh items-center justify-center">
      <div className="text-[28px] font-black tracking-tight text-brand">모아랩</div>
    </main>
  );
}
