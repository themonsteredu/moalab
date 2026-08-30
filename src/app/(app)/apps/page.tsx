'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { AppBoardCard, AppCard, AppGalleryCard } from '@/components/AppCard';
import { AppForm } from '@/components/AppForm';
import { TopicManager } from '@/components/TopicManager';
import { TopicMove } from '@/components/TopicMove';
import { CardSkeleton, EmptyState, ErrorBanner, Sheet, useToast } from '@/components/ui';
import { useAppsOverview, PIECES, type Completeness } from '@/lib/useAppsOverview';
import { useMembers } from '@/lib/useMembers';
import { useSession } from '@/lib/session';
import { STATUS_META } from '@/lib/status';
import { Icon, type IconName } from '@/components/Icon';
import type { AppStatus } from '@/lib/types';

type View = 'tree' | 'list' | 'board' | 'gallery';
/** 'todo' = 검증 완료를 뺀 것 = 아직 손이 필요한 것. 목록의 기본값이다 */
type Filter = 'todo' | 'all' | AppStatus | 'mine' | `missing:${keyof Completeness}`;
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

const BOARD_COLS: AppStatus[] = ['fixing', 'recheck', 'pending', 'done'];

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
  const toast = useToast();

  const [view, setView] = useState<View>('tree');
  /** 펼쳐둔 주제 (접힘이 기본 — 폰에서 21개를 다 늘어놓으면 끝까지 스크롤해야 한다) */
  const [openTopics, setOpenTopics] = useState<string[]>([]);
  // 기본은 '할 일' — 검증 완료된 건 목록에서 빼둔다.
  // 다 끝난 것이 목록을 채우고 있으면 지금 봐야 할 게 뭔지 안 보인다.
  const [filter, setFilter] = useState<Filter>('todo');
  const [sort, setSort] = useState<Sort>('due');
  const [q, setQ] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  /** 목록 전체 인쇄 — 강의계획서 전부 / 검증 현황 표 */
  const [printOpen, setPrintOpen] = useState(false);
  /** '빠진 것' 칩 줄 — 접어두고 필요할 때만 편다.
      이미 그 필터가 걸려 있으면 접힌 채로 두면 안 된다 (왜 걸렸는지 안 보인다) */
  const [piecesOpen, setPiecesOpen] = useState(false);

  // 보기 방식은 기억해둔다 (원장은 보드, 강사는 리스트를 주로 쓴다)
  useEffect(() => {
    const v = window.localStorage.getItem(VIEW_KEY) as View | null;
    if (v && VIEWS.some((x) => x.value === v)) setView(v);
  }, []);
  useEffect(() => {
    window.localStorage.setItem(VIEW_KEY, view);
  }, [view]);

  // '빠진 것' 으로 거르고 있으면 그 줄을 펴둔다
  useEffect(() => {
    if (filter.startsWith('missing:')) setPiecesOpen(true);
  }, [filter]);

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
      if (filter === 'todo') {
        if (it.status === 'done') return false;
      } else if (filter === 'mine') {
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

  /**
   * 검색·필터가 걸리면 저절로 펼친다 — 접힌 채로 0건처럼 보이면 안 된다.
   *
   * ★ 기본값인 'todo' 는 여기서 빼야 한다. 안 그러면 **첫 화면부터 전부 펼쳐져서**
   *   주제를 접어둔 이유(폰 첫 화면에 전체 구조가 보이게)가 사라진다.
   *   실제로 그렇게 만들었다가 /apps 가 812px → 2030px 이 됐다.
   */
  const searching = q.trim().length > 0 || (filter !== 'all' && filter !== 'todo');
  const isOpen = (t: string) => searching || openTopics.includes(t);
  const toggleTopic = (t: string) =>
    setOpenTopics((v) => (v.includes(t) ? v.filter((x) => x !== t) : [...v, t]));
  const allOpen = groups.length > 0 && groups.every((g) => isOpen(g.topic));

  const doneCount = items.filter((i) => i.status === 'done').length;
  /** 검증 완료를 뺀 수 = '할 일' 칩에 붙는 숫자 */
  const todoCount = items.length - doneCount;

  /**
   * 검증 완료 보관함 — 기본 화면('할 일')에서 완료된 프로그램이 그냥 사라지면
   * "어디 갔지?" 가 된다. 목록 맨 아래 접힌 보관함으로 **따로 모아** 둔다.
   * 검색어가 있으면 보관함 안에서도 찾아지고, 그때는 저절로 펼친다.
   */
  const doneArchive = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items
      .filter((i) => i.status === 'done')
      .filter(
        (i) => !term || i.app.title_ko.toLowerCase().includes(term) || i.app.slug.toLowerCase().includes(term),
      )
      .sort((a, b) => a.app.title_ko.localeCompare(b.app.title_ko, 'ko'));
  }, [items, q]);
  /** 6개 항목 중 안 채워진 게 있는 프로그램 수 */
  const missingCount = (k: keyof Completeness) => items.filter((i) => !i.done[k]).length;
  /** 뭐라도 빠진 프로그램 수 — 접힌 머리글에 이것만 보여준다 */
  const missingTotal = items.filter((i) => PIECES.some((p) => !i.done[p.key])).length;

  return (
    <>
      <PageHeader
        title="프로그램계획"
        subtitle={`전체 ${items.length}개 · 검증 완료 ${doneCount}개`}
        right={
          <span className="flex items-center gap-2">
            <button
              onClick={() => setPrintOpen(true)}
              aria-label="목록 인쇄"
              className="btn-ghost h-10 w-10 px-0"
            >
              <Icon name="printer" size={16} />
            </button>
            {/* 프로그램 등록은 강사도 한다 — 만든 사람이 바로 올려야 등록이 안 밀린다.
                목록 전체를 건드리는 것(주제 관리·주제로 옮기기·보관)만 원장 몫이다 */}
            <button onClick={() => setFormOpen(true)} className="btn-primary h-10 px-3.5 text-[14px]">
              + 새 앱
            </button>
          </span>
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

        {/* 검색과 정렬을 한 줄로. 따로 두면 그 자체로 100px 인데,
            둘 다 '목록을 좁히는' 같은 일이라 나란히 두는 게 읽기도 쉽다 */}
        <div className="mb-2 flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="프로그램 이름으로 찾기"
            className="field min-w-0 flex-1"
            aria-label="프로그램 검색"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label="정렬"
            className="h-11 shrink-0 rounded-lg border border-neutral-300 bg-surface px-2 text-[12.5px] font-semibold text-neutral-600"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {/* 상태 칩과 '빠진 것' 을 **같은 가로 스크롤 줄**에 태운다.
            줄을 나누면 그것만으로 52px 인데, 둘 다 '무엇만 볼까' 라 성격이 같다.
            예전엔 컨트롤이 여섯 줄이었다 — 프로그램이 몇 개든 매번 그만큼 지나야 했다. */}
        <div className="no-scrollbar -mx-4 mb-2 flex gap-2 overflow-x-auto px-4">
          <Chip on={filter === 'todo'} onClick={() => setFilter('todo')}>
            할 일 {todoCount}
          </Chip>
          <Chip on={filter === 'all'} onClick={() => setFilter('all')}>
            전체 {items.length}
          </Chip>
          <Chip on={filter === 'mine'} onClick={() => setFilter('mine')}>
            내 담당
          </Chip>
          {(['fixing', 'recheck', 'pending', 'done'] as AppStatus[]).map((s) => (
            <Chip key={s} on={filter === s} onClick={() => setFilter(s)}>
              {STATUS_META[s].label}
            </Chip>
          ))}
          <span className="shrink-0 self-center border-l border-neutral-200 pl-2">
            <button
              onClick={() => setPiecesOpen((v) => !v)}
              aria-expanded={piecesOpen}
              className="tap shrink-0 gap-1 rounded-full border border-neutral-300 bg-surface px-3 text-[12.5px] font-bold text-neutral-500"
            >
              <Icon
                name="chevronDown"
                size={12}
                className={`transition-transform ${piecesOpen ? '' : '-rotate-90'}`}
              />
              빠진 것
              {missingTotal > 0 && <span className="ml-0.5 text-brand">{missingTotal}</span>}
            </button>
          </span>
        </div>

        {piecesOpen && (
          <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
            {PIECES.map((p) => {
              const n = missingCount(p.key);
              const key: Filter = `missing:${p.key}`;
              return (
                <Chip key={p.key} on={filter === key} onClick={() => setFilter(filter === key ? 'todo' : key)} dim={n === 0}>
                  <Icon name={p.icon} size={12} className="mr-1" />
                  {p.label} {n > 0 && <span className="ml-0.5 text-brand">{n}</span>}
                </Chip>
              );
            })}
          </div>
        )}

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
            title={
              items.length === 0
                ? '아직 등록된 프로그램이 없어요'
                : filter === 'todo'
                  ? '지금 손볼 프로그램이 없어요'
                  : '조건에 맞는 게 없어요'
            }
            desc={
              items.length === 0
                ? '위 “+ 새 앱” 버튼으로 첫 프로그램을 등록해보세요.'
                : filter === 'todo'
                  ? doneCount > 0
                    ? '전부 검증 완료예요. 아래 보관함에 모아뒀어요.'
                    : '조건에 맞는 게 없어요. 검색어를 바꿔보세요.'
                  : '필터나 검색어를 바꿔보세요.'
            }
          />
        ) : view === 'tree' ? (
          <div className="space-y-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              {!searching && groups.length > 1 ? (
                <button
                  onClick={() => setOpenTopics(allOpen ? [] : groups.map((g) => g.topic))}
                  /* py 로 손가락이 닿는 면을 넓히고 -my 로 되돌린다 —
                     글씨 줄은 그대로인데 탭 영역만 44px 이 된다 */
                  className="-my-3 flex min-h-[44px] items-center text-[12px] font-bold text-neutral-400"
                >
                  {allOpen ? '전부 접기' : '전부 펼치기'}
                </button>
              ) : (
                <span />
              )}
              {isAdmin && (
                <span className="flex items-center gap-3">
                  <button
                    onClick={() => setMoveOpen(true)}
                    className="-my-3 flex min-h-[44px] items-center gap-1 text-[12px] font-bold text-brand"
                  >
                    <Icon name="check" size={13} />
                    주제로 옮기기
                  </button>
                  <button
                    onClick={() => setTopicsOpen(true)}
                    className="-my-3 flex min-h-[44px] items-center gap-1 text-[12px] font-bold text-neutral-400"
                  >
                    <Icon name="tree" size={13} />
                    주제 관리
                  </button>
                </span>
              )}
            </div>
            {groups.map((g) => {
              const open = isOpen(g.topic);
              return (
                <div key={g.topic} className="card overflow-hidden">
                  {/* 접힌 머리글에 **프로그램 이름을 싣는다.**
                      주제 16개에 프로그램 33개라 주제마다 2개꼴인데, 예전 머리글은
                      "2개" 라고만 적혀 있어서 **두 화면을 넘겨도 프로그램 이름이
                      하나도 안 보였다.** 이름을 실으면 펼치지 않고도 찾을 수 있다.
                      개수·수정필요·완료는 오른쪽 배지로 옮겨 두 줄을 유지하면서도
                      줄 높이를 87px → 약 56px 로 줄였다. */}
                  <button
                    onClick={() => toggleTopic(g.topic)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left"
                  >
                    <Icon
                      name="chevronDown"
                      size={15}
                      className={`shrink-0 text-neutral-400 transition-transform ${open ? '' : '-rotate-90'}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-1.5">
                        <span
                          className={`min-w-0 truncate text-[14px] ${
                            g.topic === NO_TOPIC ? 'font-semibold text-neutral-500' : 'font-bold text-neutral-900'
                          }`}
                        >
                          {g.topic}
                        </span>
                        <span className="shrink-0 text-[11.5px] text-neutral-400">{g.list.length}</span>
                        {g.fixing > 0 && (
                          <span className="shrink-0 text-[11.5px] font-bold text-red-600">수정 {g.fixing}</span>
                        )}
                        {g.done > 0 && (
                          <span className="shrink-0 text-[11.5px] font-bold text-green-700">완료 {g.done}</span>
                        )}
                      </span>
                      {/* 펼치면 바로 아래에 같은 이름이 카드로 나오니 그때는 안 그린다 */}
                      {!open && (
                        <span className="mt-0.5 block truncate text-[11.5px] text-neutral-400">
                          {g.list.map((i) => i.app.title_ko).join(' · ')}
                        </span>
                      )}
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
          /* 보드 — 상태별 칸반. 모바일에서는 가로 스크롤 대신 세로로 쌓는다.
             기본('할 일')에서는 완료가 다 걸러져 있으니 빈 '검증 완료' 칸을 그리지 않는다
             — 완료는 아래 보관함에 있다 */
          <div className="space-y-5">
            {BOARD_COLS.filter((col) => !(filter === 'todo' && col === 'done')).map((col) => {
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

        {/* ------------------------------------ 검증 완료 보관함 (기본 화면에서만) */}
        {!loading && filter === 'todo' && doneArchive.length > 0 && (
          <details open={q.trim().length > 0} className="card mt-4 overflow-hidden">
            <summary className="flex min-h-[44px] cursor-pointer select-none list-none items-center gap-2 px-3.5 py-3 [&::-webkit-details-marker]:hidden">
              <Icon name="checkCircle" size={16} className="shrink-0 text-green-600" />
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-bold text-neutral-700">
                  검증 완료 보관함 <span className="text-green-700">{doneArchive.length}</span>
                </span>
                <span className="mt-0.5 block text-[11.5px] text-neutral-400">
                  검증이 끝난 프로그램은 여기에 따로 모여요
                </span>
              </span>
              <Icon name="chevronDown" size={15} className="shrink-0 text-neutral-400" />
            </summary>
            <div className="space-y-2 border-t border-neutral-100 p-2.5">
              {doneArchive.map((it) => (
                <AppCard key={it.app.id} item={it} nameOf={nameOf} />
              ))}
            </div>
          </details>
        )}
      </div>

      {/* 목록 전체 인쇄 고르기 */}
      <Sheet open={printOpen} onClose={() => setPrintOpen(false)} title="목록 인쇄">
        <div className="space-y-3">
          <a
            href="/print/lectures"
            target="_blank"
            rel="noreferrer"
            onClick={() => setPrintOpen(false)}
            className="block rounded-xl border border-neutral-200 bg-surface p-3.5 active:bg-neutral-50"
          >
            <span className="flex items-center gap-2 text-[14.5px] font-bold text-neutral-900">
              <Icon name="doc" size={16} className="text-brand" />
              강의계획서 전체 인쇄
            </span>
            <span className="mt-1 block text-[12px] leading-relaxed text-neutral-500">
              강의계획서를 쓴 프로그램 전부를 한 장씩 이어서 뽑아요. 안 쓴 프로그램은 빠져요.
            </span>
          </a>

          <a
            href="/print/status"
            target="_blank"
            rel="noreferrer"
            onClick={() => setPrintOpen(false)}
            className="block rounded-xl border border-neutral-200 bg-surface p-3.5 active:bg-neutral-50"
          >
            <span className="flex items-center gap-2 text-[14.5px] font-bold text-neutral-900">
              <Icon name="checkCircle" size={16} className="text-green-600" />
              검증 현황 표 인쇄
            </span>
            <span className="mt-1 block text-[12px] leading-relaxed text-neutral-500">
              검증 완료 / 미완료로 나눈 표예요. 미완료엔 상태(수정 필요·다시확인·진행 중)도 실려요.
            </span>
          </a>

          <p className="text-[12px] leading-relaxed text-neutral-400">
            열린 화면에서 인쇄하거나 <b>PDF로 저장</b> 하면 돼요. 프로그램 하나만 뽑을 땐
            그 프로그램 화면의 <b>인쇄 / PDF 저장</b> 을 쓰세요.
          </p>
        </div>
      </Sheet>

      <TopicMove
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        items={items}
        topics={topics}
        onMoved={(n, name) => {
          toast.show(`${n}개를 '${name}' 으로 옮겼어요.`);
          void reload();
        }}
      />

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

      {toast.node}
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
