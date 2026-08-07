'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { AppCard } from '@/components/AppCard';
import { AppForm } from '@/components/AppForm';
import { CardSkeleton, EmptyState, ErrorBanner } from '@/components/ui';
import { useAppsOverview } from '@/lib/useAppsOverview';
import { useMembers } from '@/lib/useMembers';
import { useSession } from '@/lib/session';
import type { AppStatus } from '@/lib/types';

type Filter = 'all' | AppStatus | 'mine';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'mine', label: '내 담당' },
  { value: 'pending', label: '진행 중' },
  { value: 'fixing', label: '수정 필요' },
  { value: 'done', label: '검증 완료' },
];

export default function AppsPage() {
  const { session, isAdmin } = useSession();
  const { items, loading, error, reload } = useAppsOverview();
  const { nameOf } = useMembers(true);
  const router = useRouter();

  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [formOpen, setFormOpen] = useState(false);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter((it) => {
      if (filter === 'mine') {
        const mine = it.app.creator_id === session?.id || it.reviewerIds.includes(session?.id ?? '');
        if (!mine) return false;
      } else if (filter !== 'all' && it.status !== filter) {
        return false;
      }
      if (!term) return true;
      return (
        it.app.title_ko.toLowerCase().includes(term) || it.app.slug.toLowerCase().includes(term)
      );
    });
  }, [items, filter, q, session?.id]);

  const doneCount = items.filter((i) => i.status === 'done').length;

  return (
    <>
      <PageHeader
        title="웹앱 검증"
        subtitle={`전체 ${items.length}개 · 완료 ${doneCount}개`}
        right={
          isAdmin ? (
            <button onClick={() => setFormOpen(true)} className="btn-primary h-10 px-3.5 text-[14px]">
              + 새 앱
            </button>
          ) : null
        }
      />

      <div className="px-4 pb-6 pt-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="앱 이름으로 찾기"
          className="field mb-3"
          aria-label="앱 검색"
        />

        <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`tap shrink-0 rounded-full border px-3.5 text-[13.5px] font-bold transition ${
                filter === f.value
                  ? 'border-brand bg-brand text-white'
                  : 'border-neutral-300 bg-white text-neutral-600'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} onRetry={() => void reload()} />
          </div>
        )}

        {loading ? (
          <CardSkeleton rows={4} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="📱"
            title={items.length === 0 ? '아직 등록된 앱이 없어요' : '조건에 맞는 앱이 없어요'}
            desc={
              items.length === 0
                ? isAdmin
                  ? '위 “+ 새 앱” 버튼으로 첫 앱을 등록해보세요.'
                  : '원장님이 앱을 등록하면 여기에 보여요.'
                : '필터나 검색어를 바꿔보세요.'
            }
          />
        ) : (
          <div className="space-y-3">
            {filtered.map((it) => (
              <AppCard key={it.app.id} item={it} nameOf={nameOf} />
            ))}
          </div>
        )}
      </div>

      <AppForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={(id) => {
          void reload();
          router.push(`/apps/${id}`);
        }}
      />
    </>
  );
}
