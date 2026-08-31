'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { useRooms } from '@/lib/useChat';
import { chatKindLabel, unreadLabel } from '@/lib/chat';
import { relTime } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { CardSkeleton, EmptyState, ErrorBanner, Sheet } from '@/components/ui';

/**
 * 대화 목록.
 *
 * 방은 **찾아 만들지 않는다** — 전체 공지방과 내 부서 단톡방은 들어오면 저절로 있다.
 * 사람이 만드는 건 1:1 뿐이다.
 */
export default function ChatPage() {
  const { session } = useSession();
  const { members, nameOf } = useMembers();
  const router = useRouter();
  const { rooms, error, reload, openDm } = useRooms();
  const [pickOpen, setPickOpen] = useState(false);
  const meId = session?.id ?? '';

  /* 이미 1:1 방이 있는 사람은 목록에서 뺀다 — 눌러도 같은 방이 열려서 헛걸음이다 */
  const already = useMemo(() => {
    const s = new Set<string>();
    for (const r of rooms ?? []) {
      if (r.kind !== 'dm') continue;
      for (const m of r.memberIds) if (m !== meId) s.add(m);
    }
    return s;
  }, [rooms, meId]);

  const others = members.filter((m) => m.id !== meId && !already.has(m.id));

  const start = async (memberId: string) => {
    const id = await openDm(memberId);
    setPickOpen(false);
    if (id) router.push(`/chat/${id}`);
  };

  return (
    <>
      <PageHeader
        title="대화"
        right={
          <button onClick={() => setPickOpen(true)} className="btn-primary h-10 px-3.5 text-[14px]">
            + 1:1
          </button>
        }
      />

      <div className="px-4 pb-8 pt-3 lg:max-w-2xl">
        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} onRetry={() => void reload()} />
          </div>
        )}

        {rooms === null ? (
          <CardSkeleton rows={4} />
        ) : rooms.length === 0 ? (
          <EmptyState
            title="아직 대화가 없어요"
            desc="전체 공지방과 우리 부서 단톡방은 저절로 만들어져요. 위 + 1:1 로 한 사람과 바로 이야기할 수도 있어요."
          />
        ) : (
          <ul className="space-y-2">
            {rooms.map((r) => (
              <li key={r.id}>
                <Link href={`/chat/${r.id}`} className="card flex items-center gap-3 p-3.5 active:bg-neutral-50">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[15px] font-bold">{r.title}</span>
                      {r.kind !== 'dm' && (
                        <span className="chip shrink-0 bg-neutral-100 text-neutral-600">
                          {chatKindLabel(r.kind)}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-neutral-500">
                      {r.lastBody
                        ? `${r.kind !== 'dm' && r.lastFrom ? `${r.lastFrom}: ` : ''}${r.lastBody}`
                        : '아직 아무 말도 없어요'}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {r.lastAt && <span className="text-[11px] text-neutral-400">{relTime(r.lastAt)}</span>}
                    {r.unread > 0 && (
                      <span className="min-w-[20px] rounded-full bg-brand px-1.5 py-0.5 text-center text-[11px] font-bold text-white">
                        {unreadLabel(r.unread)}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Sheet open={pickOpen} onClose={() => setPickOpen(false)} title="누구와 이야기할까요">
        {others.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-neutral-400">
            이미 모든 멤버와 대화방이 있어요.
          </p>
        ) : (
          <ul className="space-y-2">
            {others.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => void start(m.id)}
                  className="tap w-full rounded-xl border border-neutral-300 bg-surface px-4 text-left text-[15px] font-semibold text-neutral-800"
                >
                  {nameOf(m.id)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </>
  );
}
