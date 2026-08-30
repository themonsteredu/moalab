'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { calcSheet } from '@/lib/cost';
import { commaNumber, digitsOnly } from '@/lib/expense';
import { won } from '@/lib/format';
import { logActivity } from '@/lib/log';
import {
  calculateRevenueShare,
  CREATOR_DEFAULT_RATE,
  recommendProposalIncentive,
  recommendSalesIncentive,
  validateRevenueShareInput,
  type RevenueShareCalculation,
  type SharePoolInput,
} from '@/lib/revenueShare';
import { useSession } from '@/lib/session';
import { friendlyError, supabase } from '@/lib/supabase';
import { Avatar } from '@/components/Brand';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { CardSkeleton, ErrorBanner, MultiPicker, useToast } from '@/components/ui';
import type {
  AppRow,
  CostItem,
  CostSheet,
  MemberPublic,
  RevenueFundingType,
  RevenueSharePlan,
  RevenueSharePoolKind,
  RevenueSharePoolRule,
} from '@/lib/types';

const FUNDING_META: Record<
  RevenueFundingType,
  { label: string; hint: string; tone: string }
> = {
  private: {
    label: '민간매출',
    hint: '실제 수금액에서 직접비를 뺀 이익을 기준으로 배분해요.',
    tone: 'border-green-200 bg-green-50 text-green-800',
  },
  public_contract: {
    label: '공공 용역계약',
    hint: '계약상 정산 제한과 세금·환수 가능액을 직접비에 먼저 반영해주세요.',
    tone: 'border-blue-200 bg-blue-50 text-blue-800',
  },
  grant: {
    label: '보조·지원금',
    hint: '지원금 총액에서 성공수수료를 바로 떼면 안 돼요. 승인된 비용과 반환액을 정산한 뒤 회사가 실제로 보유할 수 있는 자체 이익만 넣어주세요.',
    tone: 'border-amber-200 bg-amber-50 text-amber-800',
  },
};

const POOL_META: Record<
  RevenueSharePoolKind,
  { title: string; short: string; desc: string }
> = {
  creator: {
    title: '프로그램 창작',
    short: '창작',
    desc: '교육 설계·교안·활동 원형을 만든 기여',
  },
  proposal: {
    title: '사업계획서 채택',
    short: '제안서',
    desc: '계획서 작성과 선정에 기여한 성과',
  },
  sales: {
    title: '기관 영업·예산 확보',
    short: '영업',
    desc: '고객 발굴부터 계약·예산 확보까지의 성과',
  },
  custom: {
    title: '기타 성과',
    short: '기타',
    desc: '별도로 합의한 성과',
  },
};

interface CostPreset {
  sheet: CostSheet;
  revenue: number;
  directCosts: number;
}

function defaultPools(app: AppRow, memberIds: Set<string>): RevenueSharePoolRule[] {
  const creatorIds = app.creator_id && memberIds.has(app.creator_id) ? [app.creator_id] : [];
  return [
    {
      id: 'creator',
      kind: 'creator',
      label: '프로그램 창작',
      active: creatorIds.length > 0,
      rate_mode: 'manual',
      rate_percent: CREATOR_DEFAULT_RATE,
      member_ids: creatorIds,
    },
    {
      id: 'proposal',
      kind: 'proposal',
      label: '사업계획서 채택',
      active: false,
      rate_mode: 'recommended',
      rate_percent: 10,
      member_ids: [],
    },
    {
      id: 'sales',
      kind: 'sales',
      label: '기관 영업·예산 확보',
      active: false,
      rate_mode: 'recommended',
      rate_percent: 15,
      member_ids: [],
    },
  ];
}

function normalizePools(
  raw: RevenueSharePoolRule[] | null | undefined,
  app: AppRow,
  members: MemberPublic[],
): RevenueSharePoolRule[] {
  const validIds = new Set(members.map((m) => m.id));
  const defaults = defaultPools(app, validIds);
  if (!Array.isArray(raw)) return defaults;

  return defaults.map((fallback) => {
    const saved = raw.find((p) => p?.id === fallback.id || p?.kind === fallback.kind);
    if (!saved) return fallback;
    return {
      ...fallback,
      active: Boolean(saved.active),
      rate_mode:
        fallback.kind === 'proposal' || fallback.kind === 'sales'
          ? saved.rate_mode === 'manual'
            ? 'manual'
            : 'recommended'
          : 'manual',
      rate_percent: Number.isFinite(Number(saved.rate_percent)) ? Number(saved.rate_percent) : fallback.rate_percent,
      member_ids: Array.isArray(saved.member_ids)
        ? [...new Set(saved.member_ids.filter((id) => validIds.has(id)))]
        : fallback.member_ids,
    };
  });
}

function poolInput(pool: RevenueSharePoolRule, contributionProfit: number): SharePoolInput {
  const base = {
    id: pool.id,
    kind: pool.kind,
    label: pool.label,
    active: pool.active,
    memberIds: pool.member_ids,
  };
  if (pool.rate_mode === 'recommended' && pool.kind === 'sales') {
    return { ...base, fixedAmount: recommendSalesIncentive(contributionProfit).amount };
  }
  if (pool.rate_mode === 'recommended' && pool.kind === 'proposal') {
    return { ...base, fixedAmount: recommendProposalIncentive(contributionProfit).amount };
  }
  return { ...base, ratePercent: pool.rate_percent };
}

export default function RevenueSharePage() {
  const { appId } = useParams<{ appId: string }>();
  const { session, isAdmin } = useSession();
  const toast = useToast();

  const [app, setApp] = useState<AppRow | null>(null);
  const [members, setMembers] = useState<MemberPublic[]>([]);
  const [costPresets, setCostPresets] = useState<CostPreset[]>([]);
  const [selectedCostId, setSelectedCostId] = useState('');
  const [fundingType, setFundingType] = useState<RevenueFundingType>('private');
  const [grossAmount, setGrossAmount] = useState('100000');
  const [directCosts, setDirectCosts] = useState('0');
  const [baseMemberIds, setBaseMemberIds] = useState<string[]>([]);
  const [pools, setPools] = useState<RevenueSharePoolRule[]>([]);
  const [note, setNote] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [appRes, memberRes, planRes, sheetRes] = await Promise.all([
        supabase.from('apps').select('*').eq('id', appId).maybeSingle(),
        supabase.from('members_public').select('*').eq('active', true).order('sort_order').order('name'),
        supabase.from('revenue_share_plans').select('*').eq('app_id', appId).maybeSingle(),
        supabase.from('cost_sheets').select('*').eq('app_id', appId).order('updated_at', { ascending: false }),
      ]);
      if (appRes.error) throw appRes.error;
      if (memberRes.error) throw memberRes.error;
      if (sheetRes.error) throw sheetRes.error;
      if (!appRes.data) throw new Error('프로그램을 찾지 못했어요.');

      const nextApp = appRes.data as AppRow;
      const nextMembers = (memberRes.data ?? []) as MemberPublic[];
      const plan = planRes.error ? null : (planRes.data as RevenueSharePlan | null);
      const sheets = (sheetRes.data ?? []) as CostSheet[];

      setApp(nextApp);
      setMembers(nextMembers);
      setBaseMemberIds(
        plan?.base_member_ids?.filter((id) => nextMembers.some((m) => m.id === id)) ??
          nextMembers.map((m) => m.id),
      );
      setPools(normalizePools(plan?.pools, nextApp, nextMembers));
      if (planRes.error) {
        setError(friendlyError(planRes.error, '저장된 배분 기준만 불러오지 못했어요.'));
      }
      if (plan) {
        setFundingType(plan.funding_type);
        setGrossAmount(String(Math.round(Number(plan.gross_amount) || 0)));
        setDirectCosts(String(Math.round(Number(plan.direct_costs) || 0)));
        setNote(plan.note ?? '');
        setSavedAt(plan.updated_at);
      }

      if (sheets.length === 0) {
        setCostPresets([]);
      } else {
        const { data: itemData, error: itemError } = await supabase
          .from('cost_items')
          .select('*')
          .in('sheet_id', sheets.map((s) => s.id));
        if (itemError) throw itemError;
        const items = (itemData ?? []) as CostItem[];
        setCostPresets(
          sheets.map((sheet) => {
            const totals = calcSheet(
              items.filter((item) => item.sheet_id === sheet.id),
              sheet.headcount,
              Number(sheet.sale_price) || 0,
            );
            return { sheet, revenue: Math.round(totals.revenue), directCosts: Math.round(totals.total) };
          }),
        );
      }
    } catch (e) {
      setError(friendlyError(e, '수익배분 기준을 불러오지 못했어요. 다시 시도해주세요.'));
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  const amountNumbers = useMemo(() => {
    const gross = Number(grossAmount || 0);
    const costs = Number(directCosts || 0);
    return {
      gross,
      costs,
      contributionProfit:
        Number.isSafeInteger(gross) && Number.isSafeInteger(costs) ? Math.max(0, gross - costs) : 0,
    };
  }, [directCosts, grossAmount]);

  const calculationInput = useMemo(
    () => ({
      grossAmount: amountNumbers.gross,
      directCosts: amountNumbers.costs,
      baseMemberIds,
      pools: pools.map((pool) => poolInput(pool, amountNumbers.contributionProfit)),
    }),
    [amountNumbers, baseMemberIds, pools],
  );

  const issues = useMemo(() => validateRevenueShareInput(calculationInput), [calculationInput]);
  const calculation = useMemo<RevenueShareCalculation | null>(() => {
    if (issues.length > 0) return null;
    return calculateRevenueShare(calculationInput);
  }, [calculationInput, issues]);

  const updatePool = (id: string, patch: Partial<RevenueSharePoolRule>) => {
    setPools((current) => current.map((pool) => (pool.id === id ? { ...pool, ...patch } : pool)));
  };

  const applyCostPreset = () => {
    const preset = costPresets.find((item) => item.sheet.id === selectedCostId);
    if (!preset) return;
    setGrossAmount(String(preset.revenue));
    setDirectCosts(String(preset.directCosts));
    toast.show(`${preset.sheet.title} 값을 불러왔어요.`);
  };

  const save = async () => {
    if (!app || !session || !isAdmin) return;
    if (issues.length > 0) {
      setError(issues[0]);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const now = new Date().toISOString();
      const { error: saveError } = await supabase.from('revenue_share_plans').upsert(
        {
          app_id: app.id,
          funding_type: fundingType,
          gross_amount: amountNumbers.gross,
          direct_costs: amountNumbers.costs,
          base_member_ids: baseMemberIds,
          pools,
          note: note.trim() || null,
          updated_by: session.id,
          updated_at: now,
        },
        { onConflict: 'app_id' },
      );
      if (saveError) throw saveError;
      setSavedAt(now);
      logActivity(session.id, `${app.slug} 수익배분 기준 저장`, `app:${app.id}`);
      toast.show('수익배분 기준을 저장했어요.');
    } catch (e) {
      setError(friendlyError(e, '수익배분 기준을 저장하지 못했어요. 다시 눌러주세요.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader title="수익배분" back="/revenue" />
        <div className="space-y-3 px-4 py-4">
          <CardSkeleton rows={4} />
        </div>
      </>
    );
  }

  if (!app) {
    return (
      <>
        <PageHeader title="수익배분" back="/revenue" />
        <div className="px-4 py-4">
          <ErrorBanner message={error || '프로그램을 찾지 못했어요.'} onRetry={() => void load()} />
        </div>
      </>
    );
  }

  const funding = FUNDING_META[fundingType];
  const activePoolCount = pools.filter((pool) => pool.active).length;

  return (
    <>
      <PageHeader
        title={app.title_ko}
        subtitle={`수익배분 · 기본 ${baseMemberIds.length}명 1/N`}
        back="/revenue"
      />

      <main className="space-y-3 px-4 pb-28 pt-3 lg:max-w-4xl">
        {error && <ErrorBanner message={error} onRetry={() => void load()} />}

        <section className="card p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand">
              <Icon name="won" size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold">배분 순서</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-neutral-600">
                실제 수금액 − 직접비 − 창작·제안서·영업 성과몫 = 남은 금액을 {baseMemberIds.length || 0}명 1/N
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-neutral-400">
                성과 담당자도 자기 성과몫을 받은 뒤 기본 1/N을 똑같이 다시 받아요.
              </p>
            </div>
          </div>
          <details className="mt-3 rounded-xl bg-neutral-50 px-3.5 py-2.5">
            <summary className="tap -my-2 cursor-pointer text-[12.5px] font-bold text-neutral-600">
              규모별 추천 시작안 보기
            </summary>
            <div className="space-y-1.5 pb-1 pt-2 text-[12px] leading-relaxed text-neutral-500">
              <p><b className="text-neutral-700">영업</b> 첫 300만원 15% · 다음 700만원 10% · 다음 2,000만원 7% · 초과분 5%</p>
              <p><b className="text-neutral-700">제안서</b> 첫 300만원 10% · 다음 700만원 7% · 다음 2,000만원 5% · 초과분 3%</p>
              <p>전체 금액에 한 비율을 곱하지 않고 구간마다 계산해서, 사업이 커져도 보상액이 갑자기 줄지 않아요.</p>
              <p>법정·업계 표준이 아니라 모아랩의 합의를 시작하기 위한 값이며, 직접 입력으로 바꿀 수 있어요.</p>
            </div>
          </details>
        </section>

        <section className="card p-4">
          <h2 className="text-[15px] font-bold">1. 재원과 금액</h2>
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {(Object.keys(FUNDING_META) as RevenueFundingType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setFundingType(type)}
                className={`min-h-[48px] rounded-xl border px-1.5 text-[12px] font-bold transition ${
                  fundingType === type
                    ? 'border-brand bg-brand text-white'
                    : 'border-neutral-300 bg-surface text-neutral-500'
                }`}
              >
                {FUNDING_META[type].label}
              </button>
            ))}
          </div>
          <div className={`mt-2.5 rounded-xl border px-3 py-2.5 text-[12px] leading-relaxed ${funding.tone}`}>
            {funding.hint}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="revenue-gross" className="label">
                {fundingType === 'grant' ? '정산 후 회사 자체재원' : '실제 수금액'}
              </label>
              <div className="relative">
                <input
                  id="revenue-gross"
                  inputMode="numeric"
                  value={commaNumber(grossAmount)}
                  onChange={(event) => setGrossAmount(digitsOnly(event.target.value))}
                  className="field pr-9 text-right font-bold tabular-nums"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-neutral-400">원</span>
              </div>
            </div>
            <div>
              <label htmlFor="revenue-costs" className="label">직접 운영비</label>
              <div className="relative">
                <input
                  id="revenue-costs"
                  inputMode="numeric"
                  value={commaNumber(directCosts)}
                  onChange={(event) => setDirectCosts(digitsOnly(event.target.value))}
                  className="field pr-9 text-right font-bold tabular-nums"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-neutral-400">원</span>
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-neutral-400">강사비·재료비·교통비·수수료·세금 등</p>
            </div>
          </div>

          {costPresets.length > 0 && (
            <div className="mt-3 rounded-xl bg-neutral-50 p-3">
              <label htmlFor="cost-preset" className="label">연결된 원가표 불러오기</label>
              <div className="flex gap-2">
                <select
                  id="cost-preset"
                  value={selectedCostId}
                  onChange={(event) => setSelectedCostId(event.target.value)}
                  className="field min-w-0 flex-1"
                >
                  <option value="">원가표 선택</option>
                  {costPresets.map((preset) => (
                    <option key={preset.sheet.id} value={preset.sheet.id}>
                      {preset.sheet.title} · 매출 {won(preset.revenue)}원 · 원가 {won(preset.directCosts)}원
                    </option>
                  ))}
                </select>
                <button type="button" onClick={applyCostPreset} disabled={!selectedCostId} className="btn-ghost shrink-0 px-3">
                  적용
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="card p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-bold">2. 기본 1/N 참여자</h2>
              <p className="mt-0.5 text-[12px] text-neutral-400">현재 {baseMemberIds.length}명 · 기본값은 활동 중인 팀 전원</p>
            </div>
            <span className="chip bg-neutral-100 text-neutral-600">{baseMemberIds.length}명</span>
          </div>
          <div className="mt-3">
            <MultiPicker options={members} selected={baseMemberIds} onChange={setBaseMemberIds} />
          </div>
        </section>

        <section className="space-y-2.5">
          <div className="flex items-end justify-between px-0.5">
            <div>
              <h2 className="text-[15px] font-bold">3. 역할별 성과몫</h2>
              <p className="mt-0.5 text-[12px] text-neutral-400">적용 중 {activePoolCount}개 · 여러 역할을 맡으면 모두 더해져요</p>
            </div>
          </div>
          {pools.map((pool) => (
            <PoolCard
              key={pool.id}
              pool={pool}
              members={members.filter((member) => baseMemberIds.includes(member.id))}
              contributionProfit={amountNumbers.contributionProfit}
              calculation={calculation}
              onChange={(patch) => updatePool(pool.id, patch)}
            />
          ))}
        </section>

        {issues.length > 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3.5">
            <div className="flex items-start gap-2">
              <Icon name="warning" size={17} className="mt-0.5 shrink-0 text-red-500" />
              <div>
                <p className="text-[13px] font-bold text-red-800">계산할 내용을 확인해주세요</p>
                <ul className="mt-1 space-y-1 text-[12.5px] leading-relaxed text-red-700">
                  {issues.map((issue) => <li key={issue}>· {issue}</li>)}
                </ul>
              </div>
            </div>
          </div>
        )}

        {calculation && (
          <Results calculation={calculation} pools={pools} members={members} />
        )}

        <section className="card p-4">
          <label htmlFor="revenue-note" className="label">합의 메모 (선택)</label>
          <textarea
            id="revenue-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            className="field resize-none leading-relaxed"
            placeholder="예: 2026년 9월부터 적용, 제안서 공동 작성자는 1/2"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-neutral-400">
            <span>{savedAt ? `저장된 기준 · ${new Date(savedAt).toLocaleString('ko-KR')}` : '아직 저장하지 않은 계산이에요.'}</span>
            <span>실제 지급 내역이 아닌 배분 기준</span>
          </div>
        </section>

        {!isAdmin && (
          <p className="rounded-xl bg-neutral-50 px-3.5 py-3 text-center text-[12.5px] text-neutral-500">
            누구나 숫자를 바꿔 계산해볼 수 있고, 합의 기준 저장은 원장만 할 수 있어요.
          </p>
        )}

        <Link href={`/apps/${app.id}`} className="btn-ghost w-full">프로그램 페이지로 돌아가기</Link>
      </main>

      {isAdmin && (
        <div className="fixed inset-x-0 bottom-[56px] z-30 border-t border-neutral-200 bg-surface/95 px-4 py-2.5 backdrop-blur safe-bottom lg:bottom-0 lg:left-[232px]">
          <div className="mx-auto flex max-w-4xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11.5px] text-neutral-400">최종 배분액</p>
              <p className="text-[17px] font-black tabular-nums">{won(calculation?.totalDistributed ?? 0)}원</p>
            </div>
            <button onClick={() => void save()} disabled={saving || issues.length > 0} className="btn-primary min-w-[116px]">
              {saving ? '저장 중…' : '기준 저장'}
            </button>
          </div>
        </div>
      )}
      {toast.node}
    </>
  );
}

function PoolCard({
  pool,
  members,
  contributionProfit,
  calculation,
  onChange,
}: {
  pool: RevenueSharePoolRule;
  members: MemberPublic[];
  contributionProfit: number;
  calculation: RevenueShareCalculation | null;
  onChange: (patch: Partial<RevenueSharePoolRule>) => void;
}) {
  const meta = POOL_META[pool.kind];
  const canRecommend = pool.kind === 'proposal' || pool.kind === 'sales';
  const recommendation =
    pool.kind === 'sales'
      ? recommendSalesIncentive(contributionProfit)
      : pool.kind === 'proposal'
        ? recommendProposalIncentive(contributionProfit)
        : null;
  const allocation = calculation?.pools.find((item) => item.id === pool.id);

  return (
    <article className={`card overflow-hidden transition ${pool.active ? 'border-brand-200' : ''}`}>
      <button
        type="button"
        role="switch"
        aria-checked={pool.active}
        onClick={() => onChange({ active: !pool.active })}
        className="flex min-h-[58px] w-full items-center gap-3 px-4 text-left"
      >
        <span className={`flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition ${pool.active ? 'bg-brand' : 'bg-neutral-300'}`}>
          <span className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${pool.active ? 'translate-x-4' : ''}`} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-bold text-neutral-800">{meta.title}</span>
          <span className="block truncate text-[11.5px] text-neutral-400">{meta.desc}</span>
        </span>
        <span className={`chip ${pool.active ? 'bg-brand-50 text-brand-700' : 'bg-neutral-100 text-neutral-400'}`}>
          {pool.active ? '적용' : '미적용'}
        </span>
      </button>

      {pool.active && (
        <div className="space-y-3 border-t border-neutral-100 px-4 py-3.5">
          {canRecommend && (
            <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-neutral-50 p-1">
              <button
                type="button"
                onClick={() => onChange({ rate_mode: 'recommended' })}
                className={`min-h-[42px] rounded-lg px-2 text-[12.5px] font-bold ${
                  pool.rate_mode === 'recommended' ? 'bg-surface text-brand shadow-sm' : 'text-neutral-400'
                }`}
              >
                규모 추천 자동
              </button>
              <button
                type="button"
                onClick={() => onChange({ rate_mode: 'manual' })}
                className={`min-h-[42px] rounded-lg px-2 text-[12.5px] font-bold ${
                  pool.rate_mode === 'manual' ? 'bg-surface text-brand shadow-sm' : 'text-neutral-400'
                }`}
              >
                직접 입력
              </button>
            </div>
          )}

          {pool.rate_mode === 'recommended' && recommendation ? (
            <div className="rounded-xl border border-brand-100 bg-brand-50 px-3 py-2.5">
              <div className="flex items-end justify-between gap-2">
                <div>
                  <p className="text-[11px] font-bold text-brand-700">규모별 누진 추천</p>
                  <p className="mt-0.5 text-[17px] font-black tabular-nums text-neutral-900">{won(recommendation.amount)}원</p>
                </div>
                <span className="chip bg-surface text-brand-700">실효 {recommendation.effectiveRate.toFixed(1)}%</span>
              </div>
            </div>
          ) : (
            <div>
              <label htmlFor={`pool-rate-${pool.id}`} className="label">성과 배분율</label>
              <div className="relative max-w-[180px]">
                <input
                  id={`pool-rate-${pool.id}`}
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={pool.rate_percent}
                  onChange={(event) => onChange({ rate_percent: Number(event.target.value) })}
                  className="field pr-9 text-right font-bold tabular-nums"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-neutral-400">%</span>
              </div>
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[13px] font-semibold text-neutral-500">이 일을 한 사람</p>
              <span className="text-[11.5px] text-neutral-400">{pool.member_ids.length > 0 ? `${pool.member_ids.length}명이 성과몫을 나눔` : '선택 필요'}</span>
            </div>
            <MultiPicker
              options={members}
              selected={pool.member_ids}
              onChange={(member_ids) => onChange({ member_ids })}
            />
          </div>

          {allocation && pool.member_ids.length > 0 && (
            <p className="rounded-xl bg-neutral-50 px-3 py-2.5 text-center text-[12.5px] font-semibold text-neutral-600">
              성과몫 {won(allocation.amount)}원 ÷ {pool.member_ids.length}명 = 1인 약 {won(allocation.memberShares[0]?.amount ?? 0)}원
              <span className="block pt-0.5 text-[11px] font-normal text-neutral-400">여기에 각자의 기본 1/N이 다시 더해져요.</span>
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function Results({
  calculation,
  pools,
  members,
}: {
  calculation: RevenueShareCalculation;
  pools: RevenueSharePoolRule[];
  members: MemberPublic[];
}) {
  const incentiveTotal = calculation.contributionProfit - calculation.baseAmount;
  const poolLabel = new Map(pools.map((pool) => [pool.id, POOL_META[pool.kind].short]));

  return (
    <section className="space-y-2.5">
      <div className="card overflow-hidden">
        <div className="border-b border-neutral-100 px-4 py-3">
          <h2 className="text-[15px] font-bold">4. 계산 결과</h2>
          <p className="mt-0.5 text-[12px] text-neutral-400">원 단위까지 합계가 정확히 맞아요.</p>
        </div>
        {calculation.hasLoss ? (
          <div className="m-3.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] leading-relaxed text-red-800">
            직접비가 수금액보다 {won(calculation.deficitAmount)}원 더 커서 나눌 이익이 없어요. 성과몫과 기본몫은 모두 0원입니다.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-px bg-neutral-100">
            <ResultStat label="배분가능이익" value={calculation.contributionProfit} />
            <ResultStat label="성과몫 합계" value={incentiveTotal} sub={`${calculation.totalEffectiveRate.toFixed(1)}%`} />
            <ResultStat label="남은 1/N 금액" value={calculation.baseAmount} sub={`${calculation.baseRatePercent.toFixed(1)}%`} />
            <ResultStat label="최종 배분 합계" value={calculation.totalDistributed} />
          </div>
        )}
      </div>

      <div className="space-y-2">
        {members
          .filter((member) => calculation.members.some((row) => row.memberId === member.id))
          .map((member) => {
            const row = calculation.members.find((item) => item.memberId === member.id)!;
            const extras = Object.entries(row.poolAmounts).filter(([, amount]) => amount > 0);
            const rate = calculation.contributionProfit > 0 ? (row.totalAmount / calculation.contributionProfit) * 100 : 0;
            return (
              <article key={member.id} className="card p-3.5">
                <div className="flex items-center gap-3">
                  <Avatar name={member.name} size={38} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[14.5px] font-bold">{member.name}</p>
                      {extras.length > 0 && <span className="chip bg-brand-50 text-brand-700">성과 {extras.length}개</span>}
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-neutral-400">전체 이익의 {rate.toFixed(1)}%</p>
                  </div>
                  <p className="shrink-0 text-[19px] font-black tabular-nums">{won(row.totalAmount)}원</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-neutral-100 pt-2.5 text-[11.5px]">
                  <span className="rounded-lg bg-neutral-50 px-2.5 py-1.5 text-neutral-600">기본 1/N {won(row.baseAmount)}원</span>
                  {extras.map(([poolId, amount]) => (
                    <span key={poolId} className="rounded-lg bg-brand-50 px-2.5 py-1.5 font-bold text-brand-700">
                      {poolLabel.get(poolId) ?? '성과'} +{won(amount)}원
                    </span>
                  ))}
                </div>
              </article>
            );
          })}
      </div>
    </section>
  );
}

function ResultStat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="bg-surface px-3.5 py-3">
      <p className="text-[11px] text-neutral-400">{label}</p>
      <p className="mt-0.5 text-[16px] font-black tabular-nums">{won(value)}원</p>
      {sub && <p className="mt-0.5 text-[10.5px] text-neutral-400">{sub}</p>}
    </div>
  );
}
