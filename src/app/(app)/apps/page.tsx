'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { AppBoardCard, AppCard, AppGalleryCard } from '@/components/AppCard';
import { AppForm } from '@/components/AppForm';
import { TopicManager } from '@/components/TopicManager';
import { CardSkeleton, EmptyState, ErrorBanner } from '@/components/ui';
import { useAppsOverview, PIECES, type Completeness } from '@/lib/useAppsOverview';
import { useMembers } from '@/lib/useMembers';
import { useSession } from '@/lib/session';
import { STATUS_META } from '@/lib/status';
import { Icon, type IconName } from '@/components/Icon';
import type { AppStatus } from '@/lib/types';

type View = 'tree' | 'list' | 'board' | 'gallery';
type Filter = 'all' | AppStatus | 'mine' | `missing:${keyof Completeness}`;
type Sort = 'due' | 'name' | 'filled';

const VIEWS: { value: View; icon: IconName; label: string }[] = [
  { value: 'tree', icon: 'tree', label: '주제별' },
  { value: 'list', icon: 'list', label: '리스트' },
  { value: 'board', icon: 'board', label: '보드' },
  { value: 'gallery', icon: 'grid', label: '갤러리' },
];

/** 주제가 비어 있는 프로그램을 묶는 이름 */
const NO_TOPIC = '주제 없음';
const OPEN_KEY = 'moalab.apps.openTopics';

const BOARD_COLS: AppStatus[] = ['fixing', 'pending', 'done'];

const SORTS: { value: Sort; label: string }[] = [
  { value: 'due', label: '마감 임박순' },
  { value: 'filled', label: '덜 채워진 순' },
  { value: 'name', label: '이름순' },
];

const VIEW_KEY = 'moalab.apps.view';

export default function AppsPage() {
  const { session, isAdmin } = useSession();
  const { items, topics, loading, error, reload } = useAppsOverview();
  const { nameOf } = useMembers(true);
  const router = useRouter();

  const [view, setView] = useState<View>('tree');
  /** 펼쳐둔 주제 (접힘이 기본 — 폰에서 21개를 다 늘어놓으면 끝까지 스크롤해야 한다) */
  const [openTopics, setOpenTopics] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('due');
  const [q, setQ] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [topicsOpen, setTopicsOpen] = useState(false);

  // 보기 방식은 기억해둔다 (원장은 보드, 강사는 리스트를 주로 쓴다)
  useEffect(() => {
    const v = window.localStorage.getItem(VIEW_KEY) as View | null;
    if (v && VIEWS.some((x) => x.value === v)) setView(v);
  }, []);
  useEffect(() => {
    window.localStorage.setItem(VIEW_KEY, view);
  }, [view]);

  // 어떤 주제를 펼쳐뒀는지도 기억한다
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(OPEN_KEY);
      if (raw) setOpenTopics(JSON.parse(raw) as string[]);
    } catch {
      /* 무시 */
    }
  }, []);
  useEffect(() => {
    window.localStorage.setItem(OPEN_KEY, JSON.stringify(openTopics));
  }, [openTopics]);

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

  /**
   * 주제별 트리. 검색·필터가 걸리면 그 결과 안에서 묶는다.
   * 순서는 '주제 관리' 에서 정한 순서를 따르고, '주제 없음' 은 늘 맨 아래다.
   * 프로그램이 하나도 없는 주제는 그리지 않는다 (빈 줄이 쌓이면 스크롤만 길어진다).
   */
  const groups = useMemo(() => {
    const m = new Map<string, typeof filtered>();
    for (const it of filtered) {
      const t = it.topicName || NO_TOPIC;
      const list = m.get(t) ?? [];
      list.push(it);
      m.set(t, list);
    }
    const order = new Map(topics.map((t, i) => [t.name, i]));
    return [...m.entries()]
      .map(([topic, list]) => ({
        topic,
        list,
        fixing: list.filter((i) => i.status === 'fixing').length,
        done: list.filter((i) => i.status === 'done').length,
      }))
      .sort((a, b) => {
        if (a.topic === NO_TOPIC) return 1;
        if (b.topic === NO_TOPIC) return -1;
        const ai = order.get(a.topic) ?? 9999;
        const bi = order.get(b.topic) ?? 9999;
        return ai - bi || a.topic.localeCompare(b.topic, 'ko');
      });
  }, [filtered, topics]);

  /** 주제별 프로그램 수 — 주제 관리에서 지울 때 경고에 쓴다 */
  const countOfTopic = (topicId: string) => items.filter((i) => i.app.topic_id === topicId).length;

  /** 검색 중이면 저절로 펼친다 — 접힌 채로 0건처럼 보이면 안 된다 */
  const searching = q.trim().length > 0 || filter !== 'all';
  const isOpen = (t: string) => searching || openTopics.includes(t);
  const toggleTopic = (t: string) =>
    setOpenTopics((v) => (v.includes(t) ? v.filter((x) => x !== t) : [...v, t]));
  const allOpen = groups.length > 0 && groups.every((g) => isOpen(g.topic));

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
                  : '프로그램이 등록되면 여기에 보여요.'
                : '필터나 검색어를 바꿔보세요.'
            }
          />
        ) : view === 'tree' ? (
          <div className="space-y-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              {!searching && groups.length > 1 ? (
                <button
                  onClick={() => setOpenTopics(allOpen ? [] : groups.map((g) => g.topic))}
                  className="text-[12px] font-bold text-neutral-400"
                >
                  {allOpen ? '전부 접기' : '전부 펼치기'}
                </button>
              ) : (
                <span />
              )}
              {isAdmin && (
                <button
                  onClick={() => setTopicsOpen(true)}
                  className="flex items-center gap-1 text-[12px] font-bold text-brand"
                >
                  <Icon name="tree" size={13} />
                  주제 관리
                </button>
              )}
            </div>
            {groups.map((g) => {
              const open = isOpen(g.topic);
              return (
                <div key={g.topic} className="card overflow-hidden">
                  <button
                    onClick={() => toggleTopic(g.topic)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-2 px-3.5 py-3 text-left"
                  >
                    <Icon
                      name="chevronDown"
                      size={15}
                      className={`shrink-0 text-neutral-400 transition-transform ${open ? '' : '-rotate-90'}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-[14.5px] ${
                          g.topic === NO_TOPIC ? 'font-semibold text-neutral-500' : 'font-bold text-neutral-900'
                        }`}
                      >
                        {g.topic}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-neutral-400">
                        {g.list.length}개
                        {g.fixing > 0 && <span className="font-bold text-red-600">수정 필요 {g.fixing}</span>}
                        {g.done > 0 && <span className="font-bold text-green-700">완료 {g.done}</span>}
                      </span>
                    </span>
                    {/* 접혀 있어도 상태 구성이 보이게 */}
                    <span className="flex shrink-0 gap-0.5">
                      {g.list.slice(0, 8).map((i) => (
                        <span key={i.app.id} className={`h-1.5 w-1.5 rounded-full ${STATUS_META[i.status].dot}`} />
                      ))}
                    </span>
                  </button>

                  {open && (
                    <div className="border-t border-neutral-100 p-2.5">
                      <div className="space-y-2">
                        {g.list.map((it) => (
                          <AppCard key={it.app.id} item={it} nameOf={nameOf} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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

      <TopicManager
        open={topicsOpen}
        onClose={() => setTopicsOpen(false)}
        topics={topics}
        countOf={countOfTopic}
        onChanged={() => void reload()}
      />

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
