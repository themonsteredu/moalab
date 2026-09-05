'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useTopics } from '@/lib/useTopics';
import { today } from '@/lib/format';
import { logActivity } from '@/lib/log';
import { rowTitle, safeKind } from '@/lib/dutyTable';
import { commaNumber } from '@/lib/expense';
import {
  EMPTY_ORG,
  type AppRow,
  type AppSample,
  type CostSheet,
  type DutyColumn,
  type DutyRow,
  type LessonPlan,
  type OrgProfile,
} from '@/lib/types';
import {
  DRAFT_KEY,
  PRINT_DRAFT_KEY,
  MAX_ITEMS,
  MAX_SAMPLES,
  DEFAULT_CLOSING,
  defaultGreeting,
  emptyProposal,
  grandTotal,
  hasUnpriced,
  itemFromApp,
  lineTotal,
  orgReady,
  priceText,
  proposalProblems,
  toNumber,
  type ProposalInput,
  type ProposalItem,
} from '@/lib/proposal';
import { downloadProposalHwpx } from '@/lib/hwpx';
import { PageHeader } from '@/components/PageHeader';
import { Icon } from '@/components/Icon';
import { CardSkeleton, Collapsible, ErrorBanner, Sheet, Skeleton, useToast } from '@/components/ui';

/**
 * 제안서 — 프로그램을 골라 **기관에 보내는 문서**를 만든다.
 *
 * 원장이 *"양식들 잘 쓸 법한 거는 구축이 낫지 않아?"* 라고 했고, 기관에 보내는 문서 중
 * 제일 먼저 나가는 것이 제안서다. 강의계획서(PlanForm)와 같은 방식이다 —
 * 앱 안에서 채우고 **A4 로 인쇄하거나 한글 파일(.hwpx)로 받는다.**
 *
 * **새 표를 안 만든다.** 프로그램·강의계획서 목표·원가표 판매가·샘플 사진을 **읽어서** 채우고,
 * 원장이 여기서 학년·차시·인원·가격을 고친다. 고친 값은 이 문서에만 들어가고 프로그램
 * 정보는 안 바뀐다 — 제안마다 값이 다르다. 회사 정보(`settings.org`)만 저장한다.
 *
 * · 쓰던 것은 **이 기기에 초안**으로 남는다(`DRAFT_KEY`). 폰에서 전화를 받고 돌아와도
 *   이어 쓴다. 서버에 저장하는 게 아니라 '자동저장 금지' 규칙과 부딪히지 않는다 —
 *   그 규칙이 지키려는 것이 바로 *쓰던 걸 날리지 않는 것* 이다
 * · 기관 표(`DutyTable`)의 줄에서 **`이 기관에 제안서 만들기`** 로 들어오면
 *   받는 곳·담당자·연락처가 채워진 채 시작한다 (`?duty=&row=`). 보내고 나면
 *   그 줄의 진행 상태를 **`제안서 보냄`** 으로 바꿀 수 있다 — 표를 다시 열어 고치게
 *   하면 안 고친다
 * · 인쇄는 새 창(`/print/proposal`)이고 내용은 저장소로 넘긴다 — 주소창에 실으면 잘린다
 */

interface RowCtx {
  dutyId: string;
  row: DutyRow;
  cols: DutyColumn[];
  /** 첫 고르기 칸 — 상태 칩이 되는 그 칸 (statusCounts 와 같은 규칙) */
  statusCol: DutyColumn | null;
  /** 그 칸의 보기 중 '제안' 이 든 것 — 없으면 '보냄으로 표시' 버튼을 안 그린다 */
  sentLabel: string | null;
}

interface Draft {
  input: ProposalInput;
  /** 마지막으로 채워준 기관 줄 — 같은 줄로 다시 들어오면 덮어쓰지 않는다 */
  rowId?: string | null;
}

function readDraft(): Draft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    if (!d?.input || !Array.isArray(d.input.items)) return null;
    return d;
  } catch {
    return null;
  }
}

function writeDraft(d: Draft) {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* 저장소가 막힌 브라우저 — 초안만 못 남길 뿐이다 */
  }
}

/** 칸 이름으로 찾는다 — 표마다 칸이 달라서 위치로는 못 찾는다 */
function colByName(cols: DutyColumn[], ...words: string[]): DutyColumn | null {
  return cols.find((c) => words.some((w) => c.name.replace(/\s/g, '').includes(w))) ?? null;
}

function cellStr(row: DutyRow, col: DutyColumn | null): string {
  if (!col) return '';
  const v = (row.cells ?? {})[col.id];
  return v === null || v === undefined ? '' : String(v).trim();
}

export default function ProposalPage() {
  return (
    <Suspense
      fallback={
        <div>
          <PageHeader title="제안서" />
          <div className="px-4 py-4">
            <CardSkeleton rows={4} />
          </div>
        </div>
      }
    >
      <ProposalInner />
    </Suspense>
  );
}

function ProposalInner() {
  const params = useSearchParams();
  const dutyParam = params?.get('duty') ?? '';
  const rowParam = params?.get('row') ?? '';
  const { session, isAdmin } = useSession();
  const { topics, nameOfTopic } = useTopics();
  const toast = useToast();

  const [apps, setApps] = useState<AppRow[]>([]);
  const [plans, setPlans] = useState<Record<string, LessonPlan>>({});
  const [costs, setCosts] = useState<Record<string, CostSheet>>({});
  const [samples, setSamples] = useState<Record<string, AppSample[]>>({});
  const [org, setOrg] = useState<OrgProfile>(EMPTY_ORG);
  const [orgDirty, setOrgDirty] = useState(false);
  /** settings 를 읽기 전에는 회사 정보 칸을 안 그린다 — Collapsible 이 첫 defaultOpen 만 잡아서,
   *  빈 값으로 먼저 그리면 저장해둔 사람도 늘 펼쳐진 채 시작한다 */
  const [orgLoaded, setOrgLoaded] = useState(false);
  const [rowCtx, setRowCtx] = useState<RowCtx | null>(null);
  const [input, setInput] = useState<ProposalInput | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'' | 'hwp' | 'org' | 'mark'>('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickQ, setPickQ] = useState('');
  const [marked, setMarked] = useState(false);
  const draftRowRef = useRef<string | null>(null);

  /* ------------------------------------------------------------- 불러오기 */
  const load = useCallback(async () => {
    setError('');
    try {
      const [appRes, planRes, costRes, sampleRes, orgRes] = await Promise.all([
        supabase.from('apps').select('*').eq('archived', false).order('title_ko'),
        supabase.from('lesson_plans').select('*'),
        supabase.from('cost_sheets').select('*').order('updated_at', { ascending: false }),
        supabase.from('app_samples').select('*').order('sort_order'),
        supabase.from('settings').select('*').eq('key', 'org').maybeSingle(),
      ]);
      for (const r of [appRes, planRes, costRes, sampleRes, orgRes]) if (r.error) throw r.error;

      setApps((appRes.data ?? []) as AppRow[]);

      const pm: Record<string, LessonPlan> = {};
      for (const p of (planRes.data ?? []) as LessonPlan[]) pm[p.app_id] = p;
      setPlans(pm);

      // 프로그램마다 원가표 하나 — 판매가가 있는 것을 먼저, 없으면 가장 최근 것
      const cm: Record<string, CostSheet> = {};
      for (const c of (costRes.data ?? []) as CostSheet[]) {
        if (!c.app_id) continue;
        const cur = cm[c.app_id];
        if (!cur || (cur.sale_price <= 0 && c.sale_price > 0)) cm[c.app_id] = c;
      }
      setCosts(cm);

      const sm: Record<string, AppSample[]> = {};
      for (const s of (sampleRes.data ?? []) as AppSample[]) (sm[s.app_id] ??= []).push(s);
      setSamples(sm);

      const saved = orgRes.data as { value?: Partial<OrgProfile> } | null;
      setOrg({ ...EMPTY_ORG, ...(saved?.value ?? {}) });
    } catch (e) {
      setError(friendlyError(e, '프로그램 목록을 불러오지 못했어요.'));
    } finally {
      setOrgLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* ---------------------------------------- 초안 + 기관 줄로 시작하기 */
  useEffect(() => {
    let alive = true;
    (async () => {
      const draft = readDraft();
      let next: ProposalInput = draft?.input ?? emptyProposal(today());
      // 마지막으로 채워준 기관 줄 — **초안에 적힌 값**으로 판단한다. ref 로 판단하면
      // 개발 모드(StrictMode)처럼 이 효과가 두 번 돌 때 첫 번째가 ref 를 먼저 채워
      // 두 번째가 "이미 채웠다" 고 건너뛴다 (실제로 그렇게 짰다가 점검에서 잡혔다)
      let rowId: string | null = draft?.rowId ?? null;
      let ctx: RowCtx | null = null;

      if (dutyParam && rowParam) {
        try {
          const [colRes, rowRes] = await Promise.all([
            supabase.from('duty_columns').select('*').eq('duty_id', dutyParam).order('sort_order'),
            supabase.from('duty_rows').select('*').eq('id', rowParam).maybeSingle(),
          ]);
          const cols = (colRes.data ?? []) as DutyColumn[];
          const row = rowRes.data as DutyRow | null;
          if (row && cols.length > 0) {
            const statusCol = cols.find((c) => safeKind(c.kind) === 'select') ?? null;
            const sentLabel = statusCol?.options?.find((o) => o.includes('제안')) ?? null;
            ctx = { dutyId: dutyParam, row, cols, statusCol, sentLabel };

            // 같은 줄로 다시 들어온 게 아니면 받는 곳을 그 줄로 채운다.
            // 인사말은 손대지 않은 것(기본 문구 그대로)일 때만 새 기관 이름으로 다시 만든다
            if (rowId !== row.id) {
              const orgName = rowTitle(cols, row);
              const untouched = next.greeting.trim() === defaultGreeting(next.org).trim();
              next = {
                ...next,
                org: orgName === '이름 없음' ? '' : orgName,
                contact: cellStr(row, colByName(cols, '담당')),
                tel: cellStr(row, colByName(cols, '연락처', '전화')),
                greeting: untouched ? defaultGreeting(orgName) : next.greeting,
              };
              rowId = row.id;
            }
          }
        } catch {
          /* 줄을 못 읽어도 빈 제안서로 시작하면 된다 */
        }
      }
      if (!alive) return;
      draftRowRef.current = rowId;
      setRowCtx(ctx);
      setInput(next);
    })();
    return () => {
      alive = false;
    };
  }, [dutyParam, rowParam]);

  // 바뀔 때마다 이 기기에 초안으로 남긴다 (서버 저장이 아니다)
  useEffect(() => {
    if (!input) return;
    writeDraft({ input, rowId: draftRowRef.current });
  }, [input]);

  const patch = (p: Partial<ProposalInput>) => setInput((cur) => (cur ? { ...cur, ...p } : cur));
  const patchItem = (appId: string, p: Partial<ProposalItem>) =>
    setInput((cur) =>
      cur ? { ...cur, items: cur.items.map((it) => (it.appId === appId ? { ...it, ...p } : it)) } : cur,
    );
  const removeItem = (appId: string) =>
    setInput((cur) => (cur ? { ...cur, items: cur.items.filter((it) => it.appId !== appId) } : cur));
  const moveItem = (appId: string, dir: -1 | 1) =>
    setInput((cur) => {
      if (!cur) return cur;
      const i = cur.items.findIndex((it) => it.appId === appId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= cur.items.length) return cur;
      const items = [...cur.items];
      [items[i], items[j]] = [items[j], items[i]];
      return { ...cur, items };
    });

  /* ------------------------------------------------------ 프로그램 고르기 */
  const chosen = useMemo(() => new Set((input?.items ?? []).map((it) => it.appId)), [input]);

  const pickList = useMemo(() => {
    const q = pickQ.trim().toLowerCase();
    const list = q ? apps.filter((a) => a.title_ko.toLowerCase().includes(q)) : apps;
    // 주제 순서 → 이름. 주제 없음은 맨 아래 (프로그램 목록 트리와 같은 규칙)
    const order = new Map(topics.map((t, i) => [t.id, i]));
    const groups = new Map<string, AppRow[]>();
    for (const a of list) (groups.get(a.topic_id ?? '') ?? groups.set(a.topic_id ?? '', []).get(a.topic_id ?? '')!).push(a);
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === '') return 1;
      if (b === '') return -1;
      return (order.get(a) ?? 999) - (order.get(b) ?? 999);
    });
  }, [apps, topics, pickQ]);

  const toggleApp = (app: AppRow) => {
    setInput((cur) => {
      if (!cur) return cur;
      if (cur.items.some((it) => it.appId === app.id)) {
        return { ...cur, items: cur.items.filter((it) => it.appId !== app.id) };
      }
      if (cur.items.length >= MAX_ITEMS) {
        toast.show(`프로그램은 ${MAX_ITEMS}개까지만 넣을 수 있어요.`);
        return cur;
      }
      return { ...cur, items: [...cur.items, itemFromApp(app, plans[app.id], costs[app.id], samples[app.id] ?? [])] };
    });
  };

  /* --------------------------------------------------------- 회사 정보 저장 */
  const saveOrg = async () => {
    if (!session) return;
    setBusy('org');
    try {
      const { error: e } = await supabase
        .from('settings')
        .upsert({ key: 'org', value: org, updated_by: session.id, updated_at: new Date().toISOString() });
      if (e) throw e;
      setOrgDirty(false);
      toast.show('회사 정보를 저장했어요.');
      logActivity(session.id, '회사 정보 저장', org.name);
    } catch (e) {
      toast.show(friendlyError(e));
    } finally {
      setBusy('');
    }
  };

  /* ----------------------------------------------------------- 내보내기 */
  const problems = input ? proposalProblems(input) : [];

  const openPrint = () => {
    if (!input || !session) return;
    if (problems.length > 0) {
      toast.show(problems[0]);
      return;
    }
    try {
      window.localStorage.setItem(PRINT_DRAFT_KEY, JSON.stringify({ input, org }));
    } catch {
      toast.show('이 브라우저는 저장소를 막아서 인쇄 화면을 열 수 없어요.');
      return;
    }
    logActivity(session.id, '제안서 인쇄', input.org);
    window.open('/print/proposal', '_blank');
  };

  const hwp = async () => {
    if (!input || !session) return;
    if (problems.length > 0) {
      toast.show(problems[0]);
      return;
    }
    setBusy('hwp');
    try {
      const r = await downloadProposalHwpx(input, org);
      toast.show(r.skipped > 0 ? `받았어요. 사진 ${r.skipped}장은 못 넣었어요.` : '한글 파일을 받았어요.');
      logActivity(session.id, '제안서 한글 파일', input.org);
    } catch (e) {
      toast.show(friendlyError(e, '한글 파일을 만들지 못했어요. 잠시 후 다시 눌러주세요.'));
    } finally {
      setBusy('');
    }
  };

  /** 기관 표의 그 줄을 '제안서 보냄' 으로 — 표를 다시 열어 고치게 하면 안 고친다 */
  const markSent = async () => {
    if (!rowCtx?.statusCol || !rowCtx.sentLabel || !session) return;
    setBusy('mark');
    try {
      const cells = { ...(rowCtx.row.cells ?? {}), [rowCtx.statusCol.id]: rowCtx.sentLabel };
      const { error: e } = await supabase
        .from('duty_rows')
        .update({ cells, updated_by: session.id, updated_at: new Date().toISOString() })
        .eq('id', rowCtx.row.id);
      if (e) throw e;
      setMarked(true);
      toast.show(`${rowTitle(rowCtx.cols, rowCtx.row)} 을(를) '${rowCtx.sentLabel}' 으로 바꿨어요.`);
    } catch (e) {
      toast.show(friendlyError(e));
    } finally {
      setBusy('');
    }
  };

  const reset = () => {
    draftRowRef.current = null;
    setInput(emptyProposal(today()));
    setMarked(false);
    toast.show('새 제안서로 시작해요.');
  };

  /* ------------------------------------------------------------------ 화면 */
  if (!input) {
    return (
      <div>
        <PageHeader title="제안서" />
        <div className="px-4 py-4">
          <CardSkeleton rows={4} />
        </div>
      </div>
    );
  }

  const rowTitleText = rowCtx ? rowTitle(rowCtx.cols, rowCtx.row) : '';
  const total = grandTotal(input.items);

  return (
    <div>
      <PageHeader
        title="제안서"
        subtitle="프로그램을 골라 기관에 보내는 문서를 만들어요"
        right={
          <button onClick={reset} className="tap -my-2 px-2 text-[13px] font-semibold text-neutral-500">
            새로 시작
          </button>
        }
      />
      {toast.node}

      <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
        {error && <ErrorBanner message={error} onRetry={() => void load()} />}

        {rowCtx && (
          <p className="rounded-xl border border-brand-300 bg-brand-100 px-3 py-2 text-[12.5px] leading-snug text-brand-700">
            기관 표의 <b>{rowTitleText}</b> 줄에서 왔어요. 받는 곳이 그 줄 그대로 채워졌어요.
          </p>
        )}

        {/* ---------------------------------------------------------- 받는 곳 */}
        <section className="card p-4">
          <h2 className="mb-3 text-[15px] font-bold">받는 곳</h2>
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="p-org">기관 이름 *</label>
              <input
                id="p-org"
                className="field"
                value={input.org}
                placeholder="예: 광주 ○○중학교"
                onChange={(e) => {
                  const untouched = input.greeting.trim() === defaultGreeting(input.org).trim();
                  patch({ org: e.target.value, greeting: untouched ? defaultGreeting(e.target.value) : input.greeting });
                }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="p-contact">담당자</label>
                <input id="p-contact" className="field" value={input.contact} placeholder="예: 김선생님" onChange={(e) => patch({ contact: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="p-tel">연락처</label>
                <input id="p-tel" className="field" inputMode="tel" value={input.tel} placeholder="예: 062-000-0000" onChange={(e) => patch({ tel: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="p-date">제안일</label>
                <input id="p-date" type="date" className="field" value={input.date} onChange={(e) => patch({ date: e.target.value })} />
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- 프로그램 */}
        <section className="card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-bold">
              프로그램 <span className="text-[13px] font-semibold text-neutral-500">{input.items.length}개</span>
            </h2>
            <button onClick={() => setPickerOpen(true)} className="btn-ghost -my-1 px-3 text-[13px]">
              <Icon name="plus" size={14} />
              프로그램 고르기
            </button>
          </div>

          {input.items.length === 0 ? (
            <p className="rounded-xl bg-raised px-3 py-3 text-[13px] leading-relaxed text-neutral-500">
              아직 고른 프로그램이 없어요. <b>프로그램 고르기</b> 를 눌러 제안할 수업을 담으세요.
              학년·가격은 프로그램에 적힌 값이 있으면 채워지고, 없으면 여기서 적으면 돼요.
            </p>
          ) : (
            <div className="space-y-3">
              {input.items.map((it, i) => (
                <ItemEditor
                  key={it.appId}
                  index={i}
                  count={input.items.length}
                  item={it}
                  onChange={(p) => patchItem(it.appId, p)}
                  onRemove={() => removeItem(it.appId)}
                  onMove={(d) => moveItem(it.appId, d)}
                />
              ))}
              <div className="flex items-center justify-between rounded-xl bg-raised px-3 py-2.5 text-[14px]">
                <span className="font-semibold text-neutral-600">합계</span>
                <span className="font-black">
                  {priceText(total)}
                  {hasUnpriced(input.items) && <span className="ml-1 text-[11px] font-semibold text-neutral-500">(일부 협의)</span>}
                </span>
              </div>
            </div>
          )}
        </section>

        {/* ---------------------------------------------------------- 인사말 */}
        {/* 기본 문구가 이미 들어 있어 대개 안 고친다 — 펼쳐두면 폰에서 250px 을 먹는다 */}
        <Collapsible
          id="proposal.text"
          title="인사말 · 맺음말"
          badge={
            <span className="chip bg-neutral-100 text-neutral-600">
              {input.greeting.trim() === defaultGreeting(input.org).trim() && input.closing.trim() === DEFAULT_CLOSING.trim()
                ? '기본 문구'
                : '고쳐 씀'}
            </span>
          }
        >
          <div className="card space-y-3 p-4">
            <div>
              <label className="label" htmlFor="p-greeting">인사말 (표지 위쪽)</label>
              <textarea id="p-greeting" className="field min-h-[110px] leading-relaxed" value={input.greeting} onChange={(e) => patch({ greeting: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="p-closing">맺음말 (표지 아래쪽)</label>
              <textarea id="p-closing" className="field min-h-[80px] leading-relaxed" value={input.closing} onChange={(e) => patch({ closing: e.target.value })} />
              {input.closing.trim() !== DEFAULT_CLOSING.trim() && (
                <button onClick={() => patch({ closing: DEFAULT_CLOSING })} className="tap -my-3 px-1 text-[12px] font-semibold text-neutral-500">
                  기본 문구로 되돌리기
                </button>
              )}
            </div>
          </div>
        </Collapsible>

        {/* ---------------------------------------------------------- 회사 정보 */}
        {!orgLoaded ? (
          <Skeleton className="h-11 w-full" />
        ) : (
        <Collapsible
          id="proposal.org"
          title="보내는 곳 (우리 회사 정보)"
          badge={
            orgReady(org) ? (
              <span className="chip bg-neutral-100 text-neutral-600">{org.name}</span>
            ) : (
              <span className="chip bg-red-50 text-red-600">아직 안 적음</span>
            )
          }
          defaultOpen={!orgReady(org)}
        >
          <div className="card space-y-3 p-4">
            <p className="text-[12.5px] leading-snug text-neutral-500">
              문서 아래쪽과 표지의 <b>보내는 곳</b> 에 실려요. 한 번 저장하면 다음 제안서에도 그대로 들어가요.
              {!isAdmin && ' 고치는 건 원장만 할 수 있어요.'}
            </p>
            {(
              [
                ['name', '회사 이름 *', '예: 모아킷'],
                ['ceo', '대표', '예: 강양희'],
                ['tel', '전화', '예: 010-0000-0000'],
                ['email', '이메일', ''],
                ['address', '주소', ''],
                ['bizNo', '사업자등록번호', '예: 000-00-00000'],
              ] as [keyof OrgProfile, string, string][]
            ).map(([k, label, ph]) => (
              <div key={k}>
                <label className="label" htmlFor={`org-${k}`}>{label}</label>
                <input
                  id={`org-${k}`}
                  className="field"
                  value={org[k]}
                  placeholder={ph}
                  disabled={!isAdmin}
                  onChange={(e) => {
                    setOrg((o) => ({ ...o, [k]: e.target.value }));
                    setOrgDirty(true);
                  }}
                />
              </div>
            ))}
            {isAdmin && (
              <button onClick={() => void saveOrg()} disabled={!orgDirty || busy === 'org' || !orgReady(org)} className="btn-ghost w-full">
                {busy === 'org' ? '저장 중…' : '회사 정보 저장'}
              </button>
            )}
          </div>
        </Collapsible>
        )}

        {/* ---------------------------------------------------------- 내보내기 */}
        <section className="card space-y-2 p-4">
          {problems.length > 0 && (
            <p className="text-[12.5px] font-semibold text-red-600">{problems[0]}</p>
          )}
          {!orgReady(org) && problems.length === 0 && (
            <p className="text-[12.5px] text-neutral-500">회사 이름이 비어 있으면 문서에 보내는 곳이 안 실려요. 위 <b>회사 정보</b> 를 채우면 좋아요.</p>
          )}
          <button onClick={openPrint} disabled={problems.length > 0} className="btn-primary w-full">
            <Icon name="printer" size={15} />
            미리보기 · 인쇄 / PDF
          </button>
          <button onClick={() => void hwp()} disabled={problems.length > 0 || busy === 'hwp'} className="btn-ghost w-full">
            <Icon name="download" size={14} />
            {busy === 'hwp' ? '만드는 중…' : '한글 파일(.hwpx) 받기'}
          </button>
          {rowCtx?.statusCol && rowCtx.sentLabel && (
            <button onClick={() => void markSent()} disabled={marked || busy === 'mark'} className="btn-ghost w-full">
              <Icon name="check" size={14} />
              {marked ? `'${rowCtx.sentLabel}' 으로 표시됨` : `기관 표에서 '${rowCtx.sentLabel}' 으로 표시`}
            </button>
          )}
          {rowCtx && (
            <Link href={`/roles/${rowCtx.dutyId}?q=${encodeURIComponent(rowTitleText)}`} className="tap w-full text-[13px] font-semibold text-neutral-500">
              기관 표로 돌아가기
            </Link>
          )}
        </section>
      </div>

      {/* ----------------------------------------------------- 프로그램 고르기 시트 */}
      <Sheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="프로그램 고르기"
        footer={
          <button onClick={() => setPickerOpen(false)} className="btn-primary w-full">
            {input.items.length}개 담고 닫기
          </button>
        }
      >
        <input
          className="field mb-3"
          placeholder="프로그램 이름으로 찾기"
          value={pickQ}
          onChange={(e) => setPickQ(e.target.value)}
          aria-label="프로그램 검색"
        />
        {apps.length === 0 ? (
          <p className="text-[13px] text-neutral-500">아직 등록된 프로그램이 없어요. 프로그램계획에서 먼저 등록하세요.</p>
        ) : pickList.length === 0 ? (
          <p className="text-[13px] text-neutral-500">찾는 이름이 없어요.</p>
        ) : (
          <div className="space-y-4">
            {pickList.map(([topicId, list]) => (
              <div key={topicId || '__none'}>
                <p className="mb-1 text-[12px] font-bold text-neutral-500">{topicId ? nameOfTopic(topicId) : '주제 없음'}</p>
                <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200">
                  {list.map((a) => {
                    const on = chosen.has(a.id);
                    const cost = costs[a.id];
                    const facts = [
                      a.target_grade?.trim() || null,
                      cost && cost.sale_price > 0 ? `1인당 ${cost.sale_price.toLocaleString('ko-KR')}원` : null,
                      (samples[a.id]?.length ?? 0) > 0 ? `사진 ${samples[a.id].length}` : null,
                    ].filter(Boolean);
                    return (
                      <li key={a.id}>
                        <button
                          onClick={() => toggleApp(a)}
                          aria-pressed={on}
                          className="tap w-full justify-start gap-3 px-3 py-2 text-left"
                        >
                          <span
                            className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border ${
                              on ? 'border-brand bg-brand text-white' : 'border-neutral-300 bg-surface'
                            }`}
                          >
                            {on && <Icon name="check" size={12} />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-semibold">{a.title_ko}</span>
                            <span className="block truncate text-[11.5px] text-neutral-500">
                              {facts.length > 0 ? facts.join(' · ') : '학년·가격이 아직 없어요 — 담은 뒤 적으면 돼요'}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Sheet>
    </div>
  );
}

/* ------------------------------------------------------- 프로그램 한 줄 편집 */

function ItemEditor({
  index,
  count,
  item,
  onChange,
  onRemove,
  onMove,
}: {
  index: number;
  count: number;
  item: ProposalItem;
  onChange: (p: Partial<ProposalItem>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [open, setOpen] = useState(false);
  const total = lineTotal(item);

  return (
    <div className="rounded-xl border border-neutral-200 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[12px] font-bold text-neutral-400">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-bold">{item.title}</span>
        <button onClick={() => onMove(-1)} disabled={index === 0} aria-label="위로" className="tap -my-2 w-9 text-neutral-400 disabled:opacity-30">
          <Icon name="chevronUp" size={16} />
        </button>
        <button onClick={() => onMove(1)} disabled={index === count - 1} aria-label="아래로" className="tap -my-2 w-9 text-neutral-400 disabled:opacity-30">
          <Icon name="chevronDown" size={16} />
        </button>
        <button onClick={onRemove} aria-label="빼기" className="tap -my-2 w-9 text-neutral-400">
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="label" htmlFor={`g-${item.appId}`}>대상 (학년)</label>
          <input id={`g-${item.appId}`} className="field" value={item.grade} placeholder="예: 중 1~3" onChange={(e) => onChange({ grade: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={`p-${item.appId}`}>1인당 가격 (원)</label>
          <input
            id={`p-${item.appId}`}
            className="field text-right"
            inputMode="numeric"
            value={item.unitPrice > 0 ? commaNumber(String(item.unitPrice)) : ''}
            placeholder="비우면 '협의'"
            onChange={(e) => onChange({ unitPrice: toNumber(e.target.value) })}
          />
        </div>
        <div>
          <label className="label" htmlFor={`s-${item.appId}`}>차시</label>
          <input
            id={`s-${item.appId}`}
            type="number"
            min={1}
            className="field"
            value={item.sessions}
            onChange={(e) => onChange({ sessions: Math.max(1, toNumber(e.target.value)) })}
          />
        </div>
        <div>
          <label className="label" htmlFor={`h-${item.appId}`}>인원</label>
          <input
            id={`h-${item.appId}`}
            type="number"
            min={1}
            className="field"
            value={item.headcount}
            onChange={(e) => onChange({ headcount: Math.max(1, toNumber(e.target.value)) })}
          />
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-[12.5px]">
        <span className="text-neutral-500">
          {item.unitPrice > 0 ? `${priceText(item.unitPrice)} × ${item.headcount}명 × ${item.sessions}차시` : '가격을 비우면 문서에 협의로 적혀요'}
        </span>
        <span className="font-bold">{priceText(total)}</span>
      </div>

      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="tap -mb-3 mt-1 w-full justify-start gap-1 text-[12.5px] font-semibold text-neutral-500"
      >
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={13} />
        소개 · 목표 · 사진 {open ? '접기' : '보기'}
        {!open && (
          <span className="ml-1 font-normal">
            {[item.purpose ? '소개' : null, item.goal ? '목표' : null, item.samples.length > 0 ? `사진 ${item.samples.length}` : null]
              .filter(Boolean)
              .join(' · ') || '비어 있음'}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <div>
            <label className="label" htmlFor={`pu-${item.appId}`}>이런 수업입니다 (프로그램 소개)</label>
            <textarea id={`pu-${item.appId}`} className="field min-h-[80px] leading-relaxed" value={item.purpose} placeholder="프로그램에 적힌 소개가 없어요. 두세 줄 적어주세요." onChange={(e) => onChange({ purpose: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor={`go-${item.appId}`}>수업 목표 (강의계획서의 목표)</label>
            <textarea id={`go-${item.appId}`} className="field min-h-[80px] leading-relaxed" value={item.goal} placeholder="강의계획서에 목표를 쓰면 여기 채워져요." onChange={(e) => onChange({ goal: e.target.value })} />
          </div>
          <div>
            <p className="label">결과물 사진 (최대 {MAX_SAMPLES}장 · 프로그램의 샘플 이미지)</p>
            {item.samples.length === 0 ? (
              <p className="text-[12.5px] text-neutral-500">
                샘플 이미지가 없어요. <Link href={`/apps/${item.appId}`} className="font-semibold text-brand-700 underline">프로그램 페이지</Link>에 올리면 여기 들어와요.
              </p>
            ) : (
              <div className="flex gap-2">
                {item.samples.map((u) => (
                  <div key={u} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-neutral-200 bg-raised">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt="" className="h-full w-full object-cover" />
                    {/* 눌리는 면은 44px(규칙), 보이는 동그라미는 24px — 80px 사진 위에 44px 검은 판을
                        올리면 사진이 안 보인다 */}
                    <button
                      onClick={() => onChange({ samples: item.samples.filter((x) => x !== u) })}
                      aria-label="이 사진 빼기"
                      className="absolute right-0 top-0 flex h-11 w-11 items-start justify-end p-1"
                    >
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white">
                        <Icon name="close" size={12} />
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
