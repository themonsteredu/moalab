'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { AppBoardCard, AppCard, AppGalleryCard } from '@/components/AppCard';
import { AppForm } from '@/components/AppForm';
import { CardSkeleton, EmptyState, ErrorBanner } from '@/components/ui';
import { useAppsOverview, PIECES, type Completeness } from '@/lib/useAppsOverview';
import { useMembers } from '@/lib/useMembers';
import { useSession } from '@/lib/session';
import { STATUS_META } from '@/lib/status';
import { Icon, type IconName } from '@/components/Icon';
import type { AppStatus } from '@/lib/types';

type View = 'list' | 'board' | 'gallery';
type Filter = 'all' | AppStatus | 'mine' | `missing:${keyof Completeness}`;
type Sort = 'due' | 'name' | 'filled';

const VIEWS: { value: View; icon: IconName; label: string }[] = [
  { value: 'list', icon: 'list', label: '리스트' },
  { value: 'board', icon: 'board', label: '보드' },
  { value: 'gallery', icon: 'grid', label: '갤러리' },
];

const BOARD_COLS: AppStatus[] = ['fixing', 'pending', 'done'];

const SORTS: { value: Sort; label: string }[] = [
  { value: 'due', label: '마감 임박순' },
  { value: 'filled', label: '덜 채워진 순' },
  { value: 'name', label: '이름순' },
];

const VIEW_KEY = 'moalab.apps.view';

export default function AppsPage() {
  const { session, isAdmin } = useSession();
  const { items, loading, error, reload } = useAppsOverview();
  const { nameOf } = useMembers(true);
  const router = useRouter();

  const [view, setView] = useState<View>('list');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('due');
  const [q, setQ] = useState('');
  const [formOpen, setFormOpen] = useState(false);

  // 보기 방식은 기억해둔다 (원장은 보드, 강사는 리스트를 주로 쓴다)
  useEffect(() => {
    const v = window.localStorage.getItem(VIEW_KEY) as View | null;
    if (v && VIEWS.some((x) => x.value === v)) setView(v);
  }, []);
  useEffect(() => {
    window.localStorage.setItem(VIEW_KEY, view);
  }, [view]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const out = items.filter((it) => {
      if (filter === 'mine') {
        const mine = it.app.creator_id === session?.id || it.reviewerIds.includes(session?.id ?? '');
        if (!mine) return false;
      } else if (filter.startsWith('missing:')) {
        const key = filter.slice(8) as keyof Completeness;
        if (it.done[key]) return false;
      } else if (filter !== 'all' && it.status !== filter) {
        return false;
      }
      if (!term) return true;
      return it.app.title_ko.toLowerCase().includes(term) || it.app.slug.toLowerCase().includes(term);
    });

    return out.sort((a, b) => {
      if (sort === 'name') return a.app.title_ko.localeCompare(b.app.title_ko, 'ko');
      if (sort === 'filled') return a.filled - b.filled || a.app.title_ko.localeCompare(b.app.title_ko, 'ko');
      if (!a.app.due_date) return 1;
      if (!b.app.due_date) return -1;
      return a.app.due_date < b.app.due_date ? -1 : 1;
    });
  }, [items, filter, sort, q, session?.id]);

  const doneCount = items.filter((i) => i.status === 'done').length;
  /** 5개 항목 중 안 채워진 게 있는 프로그램 수 */
  const missingCount = (k: keyof Completeness) => items.filter((i) => !i.done[k]).length;

  return (
    <>
      <PageHeader
        title="프로그램계획"
        subtitle={`전체 ${items.length}개 · 검증 완료 ${doneCount}개`}
        right={
          isAdmin ? (
            <button onClick={() => setFormOpen(true)} className="btn-primary h-10 px-3.5 text-[14px]">
              + 새 앱
            </button>
          ) : null
        }
      />

      <div className="px-4 pb-8 pt-3">
        {/* 보기 전환 */}
        <div className="mb-3 flex gap-1.5 rounded-xl bg-neutral-200/60 p-1">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              onClick={() => setView(v.value)}
              className={`tap flex-1 gap-1.5 rounded-lg text-[13.5px] font-bold transition ${
                view === v.value ? 'bg-surface text-neutral-900 shadow-sm' : 'text-neutral-500'
              }`}
            >
              <Icon name={v.icon} size={14} />
              {v.label}
            </button>
          ))}
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="프로그램 이름으로 찾기"
          className="field mb-2.5"
          aria-label="프로그램 검색"
        />

        {/* 필터 — 상태 + "빠진 것" */}
        <div className="no-scrollbar -mx-4 mb-2 flex gap-2 overflow-x-auto px-4">
          <Chip on={filter === 'all'} onClick={() => setFilter('all')}>
            전체 {items.length}
          </Chip>
          <Chip on={filter === 'mine'} onClick={() => setFilter('mine')}>
            내 담당
          </Chip>
          {(['fixing', 'pending', 'done'] as AppStatus[]).map((s) => (
            <Chip key={s} on={filter === s} onClick={() => setFilter(s)}>
              {STATUS_META[s].label}
            </Chip>
          ))}
        </div>

        <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
          <span className="flex shrink-0 items-center text-[11.5px] font-bold text-neutral-400">빠진 것</span>
          {PIECES.map((p) => {
            const n = missingCount(p.key);
            const key: Filter = `missing:${p.key}`;
            return (
              <Chip key={p.key} on={filter === key} onClick={() => setFilter(filter === key ? 'all' : key)} dim={n === 0}>
                <Icon name={p.icon} size={12} className="mr-1" />
                {p.label} {n > 0 && <span className="ml-0.5 text-brand">{n}</span>}
              </Chip>
            );
          })}
        </div>

        {/* 정렬 */}
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[12.5px] text-neutral-400">{filtered.length}개</p>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label="정렬"
            className="h-8 rounded-lg border border-neutral-300 bg-surface px-2 text-[12.5px] font-semibold text-neutral-600"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
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
            icon="puzzle"
            title={items.length === 0 ? '아직 등록된 프로그램이 없어요' : '조건에 맞는 게 없어요'}
            desc={
              items.length === 0
                ? isAdmin
                  ? '위 “+ 새 앱” 버튼으로 첫 프로그램을 등록해보세요.'
                  : '원장님이 등록하면 여기에 보여요.'
                : '필터나 검색어를 바꿔보세요.'
            }
          />
        ) : view === 'list' ? (
          <div className="space-y-3">
            {filtered.map((it) => (
              <AppCard key={it.app.id} item={it} nameOf={nameOf} />
            ))}
          </div>
        ) : view === 'gallery' ? (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((it) => (
              <AppGalleryCard key={it.app.id} item={it} />
            ))}
          </div>
        ) : (
          /* 보드 — 상태별 칸반. 모바일에서는 가로 스크롤 대신 세로로 쌓는다 */
          <div className="space-y-5">
            {BOARD_COLS.map((col) => {
              const list = filtered.filter((i) => i.status === col);
              return (
                <div key={col}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${STATUS_META[col].dot}`} />
                    <h2 className="text-[14px] font-bold text-neutral-700">{STATUS_META[col].label}</h2>
                    <span className="text-[12px] font-bold text-neutral-400">{list.length}</span>
                  </div>
                  {list.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-neutral-200 py-4 text-center text-[12px] text-neutral-300">
                      없음
                    </p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {list.map((it) => (
                        <AppBoardCard key={it.app.id} item={it} nameOf={nameOf} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
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

function Chip({
  on,
  dim,
  onClick,
  children,
}: {
  on: boolean;
  dim?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`tap shrink-0 rounded-full border px-3 text-[13px] font-bold transition ${
        on
          ? 'border-brand bg-brand text-white'
          : dim
            ? 'border-neutral-200 bg-surface text-neutral-300'
            : 'border-neutral-300 bg-surface text-neutral-600'
      }`}
    >
      {children}
    </button>
  );
}
