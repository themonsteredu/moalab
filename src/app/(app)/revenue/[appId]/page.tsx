'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { commaNumber, digitsOnly, monthLabel, shiftMonth, thisMonth } from '@/lib/expense';
import { won } from '@/lib/format';
import { logActivity } from '@/lib/log';
import {
  calculateRevenueShare,
  calculateOperatingCostAmount,
  CREATOR_DEFAULT_RATE,
  DEFAULT_OPERATING_COST_RATE_PERCENT,
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
  RevenueProject,
  MemberPublic,
  RevenueFundingType,
  RevenueProjectPlan,
  RevenueProjectMonth,
  RevenueShareRateStatus,
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
    title: '프로그램 개발·기획',
    short: '개발/기획',
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

const RATE_STATUS_META: Record<
  RevenueShareRateStatus,
  { label: string; hint: string; tone: string }
> = {
  undecided: {
    label: '비율 미정',
    hint: '현재 비율은 비교를 위한 시작값이에요. 지급액으로 확정되지 않아요.',
    tone: 'border-amber-200 bg-amber-50 text-amber-800',
  },
  draft: {
    label: '검토안',
    hint: '팀이 검토 중인 비율이에요. 바꾸면 이 달 예상액도 다시 계산돼요.',
    tone: 'border-blue-200 bg-blue-50 text-blue-800',
  },
  agreed: {
    label: '합의됨',
    hint: '팀이 합의한 비율로 표시했지만, 이 화면은 아직 지급 확정 원장이 아니에요.',
    tone: 'border-green-200 bg-green-50 text-green-800',
  },
};

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthKeyOf(row: RevenueProjectMonth): string {
  return row.settlement_month.slice(0, 7);
}

function defaultPools(): RevenueSharePoolRule[] {
  const creatorIds: string[] = [];
  return [
    {
      id: 'creator',
      kind: 'creator',
      label: '프로그램 개발·기획',
      active: creatorIds.length > 0,
      rate_mode: 'manual',
      rate_percent: CREATOR_DEFAULT_RATE,
      member_ids: creatorIds,
    },
    {
      id: 'proposal',
      kind: 'proposal',
      label: '사업계획서·제안서',
      active: false,
      rate_mode: 'manual',
      rate_percent: 10,
      member_ids: [],
    },
    {
      id: 'sales',
      kind: 'sales',
      label: '기관 영업·예산 확보',
      active: false,
      rate_mode: 'manual',
      rate_percent: 15,
      member_ids: [],
    },
  ];
}

function normalizePools(
  raw: RevenueSharePoolRule[] | null | undefined,
  members: MemberPublic[],
): RevenueSharePoolRule[] {
  const validIds = new Set(members.map((m) => m.id));
  const defaults = defaultPools();
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
  return (
    <Suspense fallback={<RevenuePageFallback />}>
      <RevenueSharePageContent />
    </Suspense>
  );
}

function RevenuePageFallback() {
  return (
    <>
      <PageHeader title="수익배분" back="/revenue" />
      <div className="space-y-3 px-4 py-4">
        <CardSkeleton rows={4} />
      </div>
    </>
  );
}

function RevenueSharePageContent() {
  const { appId: projectId } = useParams<{ appId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session, isAdmin } = useSession();
  const toast = useToast();
  const loadGeneration = useRef(0);

  const requestedMonth = searchParams.get('month');
  const month = requestedMonth && MONTH_KEY_RE.test(requestedMonth) ? requestedMonth : thisMonth();

  const [project, setProject] = useState<RevenueProject | null>(null);
  const [members, setMembers] = useState<MemberPublic[]>([]);
  const [monthlyRows, setMonthlyRows] = useState<RevenueProjectMonth[]>([]);
  const [rateStatus, setRateStatus] = useState<RevenueShareRateStatus>('undecided');
  const [fundingType, setFundingType] = useState<RevenueFundingType>('private');
  const [grossAmount, setGrossAmount] = useState('100000');
  const [directCosts, setDirectCosts] = useState('0');
  const [operatingCostRatePercent, setOperatingCostRatePercent] = useState(
    DEFAULT_OPERATING_COST_RATE_PERCENT,
  );
  const [baseMemberIds, setBaseMemberIds] = useState<string[]>([]);
  const [pools, setPools] = useState<RevenueSharePoolRule[]>([]);
  const [note, setNote] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [loadedMonth, setLoadedMonth] = useState<string | null>(null);
  const [monthStorageReady, setMonthStorageReady] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError('');
    setLoadedMonth(null);
    try {
      const [projectRes, memberRes, planRes, monthRes] = await Promise.all([
        supabase.from('revenue_projects').select('*').eq('id', projectId).maybeSingle(),
        supabase.from('members_public').select('*').order('sort_order').order('name'),
        supabase.from('revenue_project_plans').select('*').eq('project_id', projectId).maybeSingle(),
        supabase
          .from('revenue_project_months')
          .select('*')
          .eq('project_id', projectId)
          .order('settlement_month', { ascending: false }),
      ]);
      if (generation !== loadGeneration.current) return;
      if (projectRes.error) throw projectRes.error;
      if (memberRes.error) throw memberRes.error;
      if (!projectRes.data) throw new Error('프로젝트를 찾지 못했어요.');

      const nextProject = projectRes.data as RevenueProject;
      const nextMembers = (memberRes.data ?? []) as MemberPublic[];
      const nextPlan = planRes.error ? null : (planRes.data as RevenueProjectPlan | null);
      const nextMonthlyRows = monthRes.error ? [] : ((monthRes.data ?? []) as RevenueProjectMonth[]);
      const savedMonth = nextMonthlyRows.find((row) => monthKeyOf(row) === month) ?? null;

      setProject(nextProject);
      setMembers(nextMembers);
      setMonthlyRows(nextMonthlyRows);
      setMonthStorageReady(!monthRes.error);
      setBaseMemberIds(
        (savedMonth?.base_member_ids ?? nextPlan?.base_member_ids)?.filter((id) =>
          nextMembers.some((member) => member.id === id),
        ) ?? nextMembers.filter((member) => member.active).map((member) => member.id),
      );
      setPools(normalizePools(savedMonth?.pools ?? nextPlan?.pools, nextMembers));
      setFundingType(savedMonth?.funding_type ?? nextPlan?.funding_type ?? 'private');
      // 새 달에 과거 예상 매출이 자동으로 복사되면 실제 매출처럼 보이므로 반드시 0원부터 시작한다.
      setGrossAmount(savedMonth ? String(Math.round(Number(savedMonth.gross_amount) || 0)) : '0');
      setDirectCosts(savedMonth ? String(Math.round(Number(savedMonth.direct_costs) || 0)) : '0');
      setOperatingCostRatePercent(
        savedMonth
          ? savedMonth.calculation?.operatingCostRatePercent ?? 0
          : DEFAULT_OPERATING_COST_RATE_PERCENT,
      );
      setRateStatus(savedMonth?.rate_status ?? 'undecided');
      setNote(savedMonth?.note ?? '');
      setSavedAt(savedMonth?.updated_at ?? null);
      setLoadedMonth(month);
      setDirty(false);

      const warnings = [];
      if (planRes.error) warnings.push(friendlyError(planRes.error, '프로젝트 기본안은 불러오지 못했어요.'));
      if (monthRes.error) warnings.push(friendlyError(monthRes.error, '월별 계산안은 불러오지 못했어요.'));
      if (warnings.length > 0) setError(warnings.join(' '));
    } catch (e) {
      if (generation !== loadGeneration.current) return;
      setError(friendlyError(e, '수익배분 기준을 불러오지 못했어요. 다시 시도해주세요.'));
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [projectId, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const amountNumbers = useMemo(() => {
    const gross = Number(grossAmount || 0);
    const costs = Number(directCosts || 0);
    const contributionProfit =
      Number.isSafeInteger(gross) && Number.isSafeInteger(costs) ? Math.max(0, gross - costs) : 0;
    const validOperatingRate =
      Number.isFinite(operatingCostRatePercent) &&
      operatingCostRatePercent >= 0 &&
      operatingCostRatePercent <= 100;
    const operatingCostAmount = validOperatingRate
      ? calculateOperatingCostAmount(contributionProfit, operatingCostRatePercent)
      : 0;
    return {
      gross,
      costs,
      contributionProfit,
      distributableAmount: contributionProfit - operatingCostAmount,
    };
  }, [directCosts, grossAmount, operatingCostRatePercent]);

  const calculationInput = useMemo(
    () => ({
      grossAmount: amountNumbers.gross,
      directCosts: amountNumbers.costs,
      operatingCostRatePercent,
      baseMemberIds,
      pools: pools.map((pool) => poolInput(pool, amountNumbers.distributableAmount)),
    }),
    [amountNumbers, baseMemberIds, operatingCostRatePercent, pools],
  );

  const issues = useMemo(() => validateRevenueShareInput(calculationInput), [calculationInput]);
  const calculation = useMemo<RevenueShareCalculation | null>(() => {
    if (issues.length > 0) return null;
    return calculateRevenueShare(calculationInput);
  }, [calculationInput, issues]);

  const updatePool = (id: string, patch: Partial<RevenueSharePoolRule>) => {
    setPools((current) => current.map((pool) => (pool.id === id ? { ...pool, ...patch } : pool)));
    setRateStatus((current) => (current === 'agreed' ? 'draft' : current));
    setDirty(true);
  };

  const changeMonth = (nextMonth: string) => {
    if (!MONTH_KEY_RE.test(nextMonth) || nextMonth === month) return;
    if (saving) return;
    if (dirty && !window.confirm('저장하지 않은 수정이 있어요. 이 달을 떠날까요?')) return;
    loadGeneration.current += 1;
    setLoading(true);
    router.replace(`/revenue/${projectId}?month=${nextMonth}`, { scroll: false });
  };

  const copyPreviousRules = () => {
    if (!project) return;
    const previous = monthlyRows
      .filter((row) => monthKeyOf(row) < month)
      .sort((a, b) => b.settlement_month.localeCompare(a.settlement_month))[0];
    if (!previous) return;
    setFundingType(previous.funding_type);
    setOperatingCostRatePercent(
      previous.calculation?.operatingCostRatePercent ?? 0,
    );
    setBaseMemberIds(previous.base_member_ids.filter((id) => members.some((member) => member.id === id)));
    setPools(normalizePools(previous.pools, members));
    setRateStatus('undecided');
    setDirty(true);
    toast.show(`${monthLabel(monthKeyOf(previous))} 참여자와 비율 가안을 불러왔어요.`);
  };

  const save = async () => {
    if (!project || !session || !isAdmin) return;
    if (!monthStorageReady || loadedMonth !== month) {
      setError('이 달의 저장소를 확인하지 못했어요. 다시 불러온 뒤 저장해주세요.');
      return;
    }
    if (issues.length > 0 || !calculation) {
      setError(issues[0] ?? '계산할 내용을 확인해주세요.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const now = new Date().toISOString();
      const memberSnapshot = baseMemberIds.flatMap((id) => {
        const member = members.find((item) => item.id === id);
        return member ? [{ id: member.id, name: member.name }] : [];
      });
      const { data, error: saveError } = await supabase
        .from('revenue_project_months')
        .upsert(
          {
            project_id: project.id,
            settlement_month: `${month}-01`,
            rate_status: rateStatus,
            funding_type: fundingType,
            gross_amount: amountNumbers.gross,
            direct_costs: amountNumbers.costs,
            base_member_ids: baseMemberIds,
            pools,
            member_snapshot: memberSnapshot,
            calculation,
            note: note.trim() || null,
            updated_by: session.id,
            updated_at: now,
          },
          { onConflict: 'project_id,settlement_month' },
        )
        .select('*')
        .single();
      if (saveError) throw saveError;
      const saved = data as RevenueProjectMonth;
      setMonthlyRows((current) => [saved, ...current.filter((row) => row.id !== saved.id)]);
      setSavedAt(now);
      setDirty(false);
      logActivity(session.id, `${project.name} ${monthLabel(month)} 수익배분 가안 저장`, `revenue-project:${project.id}`);
      toast.show(`${monthLabel(month)} 계산안을 저장했어요.`);
    } catch (e) {
      setError(friendlyError(e, '월 계산안을 저장하지 못했어요. 다시 눌러주세요.'));
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

  if (!project) {
    return (
      <>
        <PageHeader title="수익배분" back="/revenue" />
        <div className="px-4 py-4">
          <ErrorBanner message={error || '프로젝트를 찾지 못했어요.'} onRetry={() => void load()} />
        </div>
      </>
    );
  }

  if (loadedMonth !== month) {
    return (
      <>
        <PageHeader title={project.name} subtitle={monthLabel(month)} back={`/revenue?month=${month}`} />
        <div className="px-4 py-4">
          <ErrorBanner
            message={error || '이 달의 계산안을 불러오지 못했어요.'}
            onRetry={() => void load()}
          />
        </div>
      </>
    );
  }

  const funding = FUNDING_META[fundingType];
  const rateMeta = RATE_STATUS_META[rateStatus];
  const activePoolCount = pools.filter((pool) => pool.active).length;
  const currentMonthRow = monthlyRows.find((row) => monthKeyOf(row) === month) ?? null;
  const previousMonthRow = monthlyRows
    .filter((row) => monthKeyOf(row) < month)
    .sort((a, b) => b.settlement_month.localeCompare(a.settlement_month))[0] ?? null;

  return (
    <>
      <PageHeader
        title={project.name}
        subtitle={`${monthLabel(month)} · 기본 ${baseMemberIds.length}명 1/N`}
        back={`/revenue?month=${month}`}
      />

      <main className="space-y-3 px-4 pb-28 pt-3 lg:max-w-4xl">
        {error && <ErrorBanner message={error} onRetry={() => void load()} />}

        <section className="card p-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => changeMonth(shiftMonth(month, -1))}
              aria-label="지난 달"
              className="tap w-11 shrink-0 rounded-xl border border-neutral-200 bg-surface text-neutral-500"
            >
              ‹
            </button>
            <label className="min-w-0 flex-1">
              <span className="sr-only">계산할 달</span>
              <input
                type="month"
                value={month}
                onChange={(event) => changeMonth(event.target.value)}
                className="field text-center text-[15px] font-bold"
              />
            </label>
            <button
              type="button"
              onClick={() => changeMonth(shiftMonth(month, 1))}
              aria-label="다음 달"
              className="tap w-11 shrink-0 rounded-xl border border-neutral-200 bg-surface text-neutral-500"
            >
              ›
            </button>
            {month !== thisMonth() && (
              <button type="button" onClick={() => changeMonth(thisMonth())} className="btn-ghost h-11 shrink-0 px-3 text-[12px]">
                이 달
              </button>
            )}
          </div>

          <div className="mt-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-[14px] font-bold">{monthLabel(month)} 계산안</p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-neutral-400">
                새 달은 매출·비용 0원부터 시작하고, 저장한 달끼리 서로 덮어쓰지 않아요.
              </p>
            </div>
            <span className={`chip shrink-0 ${currentMonthRow ? 'bg-green-100 text-green-800' : 'bg-neutral-100 text-neutral-500'}`}>
              {currentMonthRow ? '저장됨' : '새 계산'}
            </span>
          </div>

          {!currentMonthRow && previousMonthRow && (
            <button type="button" onClick={copyPreviousRules} className="btn-ghost mt-3 w-full text-[12.5px]">
              {monthLabel(monthKeyOf(previousMonthRow))} 참여자·비율 가안 불러오기
            </button>
          )}

          {monthlyRows.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-neutral-100 pt-3">
              {monthlyRows.slice(0, 8).map((row) => {
                const savedMonth = monthKeyOf(row);
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => changeMonth(savedMonth)}
                    aria-pressed={savedMonth === month}
                    className={`chip ${savedMonth === month ? 'bg-brand-100 text-brand-700' : 'bg-neutral-100 text-neutral-600'}`}
                  >
                    {monthLabel(savedMonth)}
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-4 border-t border-neutral-100 pt-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[13px] font-bold">비율 상태</p>
              <span className="text-[11px] text-neutral-400">나중에 언제든 변경 가능</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="비율 합의 상태">
              {(Object.keys(RATE_STATUS_META) as RevenueShareRateStatus[]).map((status) => (
                <button
                  key={status}
                  type="button"
                  aria-pressed={rateStatus === status}
                  onClick={() => {
                    setRateStatus(status);
                    setDirty(true);
                  }}
                  className={`min-h-[42px] rounded-xl border px-2 text-[12.5px] font-bold ${
                    rateStatus === status
                      ? 'pick-on'
                      : 'border-neutral-200 bg-surface text-neutral-500'
                  }`}
                >
                  {RATE_STATUS_META[status].label}
                </button>
              ))}
            </div>
            <p className={`mt-2.5 rounded-xl border px-3 py-2.5 text-[12px] leading-relaxed ${rateMeta.tone}`}>
              {rateMeta.hint}
            </p>
          </div>
        </section>

        <section className="card p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand">
              <Icon name="won" size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold">배분 순서</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-neutral-600">
                실제 수금액 − 직접비 − 회사 운영비 − 창작·제안서·영업 성과몫 = 남은 금액을 {baseMemberIds.length || 0}명 1/N
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-neutral-400">
                성과 담당자도 자기 성과몫을 받은 뒤 기본 1/N을 똑같이 다시 받아요.
              </p>
            </div>
          </div>
          <details className="mt-3 rounded-xl bg-neutral-50 px-3.5 py-2.5">
            <summary className="tap -my-2 cursor-pointer text-[12.5px] font-bold text-neutral-600">
              규모별 검토용 시작안 보기
            </summary>
            <div className="space-y-1.5 pb-1 pt-2 text-[12px] leading-relaxed text-neutral-500">
              <p><b className="text-neutral-700">영업</b> 첫 300만원 15% · 다음 700만원 10% · 다음 2,000만원 7% · 초과분 5%</p>
              <p><b className="text-neutral-700">제안서</b> 첫 300만원 10% · 다음 700만원 7% · 다음 2,000만원 5% · 초과분 3%</p>
              <p>전체 금액에 한 비율을 곱하지 않고 구간마다 계산해서, 사업이 커져도 보상액이 갑자기 줄지 않아요.</p>
              <p>법정·업계 표준이나 확정 비율이 아니며, 비교용 가안으로만 불러와 직접 바꿀 수 있어요.</p>
            </div>
          </details>
        </section>

        <section className="card p-4">
          <h2 className="text-[15px] font-bold">1. 재원과 금액</h2>
          <div className="mt-3 grid grid-cols-3 gap-1.5" role="group" aria-label="재원 유형">
            {(Object.keys(FUNDING_META) as RevenueFundingType[]).map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={fundingType === type}
                onClick={() => {
                  setFundingType(type);
                  setDirty(true);
                }}
                className={`min-h-[48px] rounded-xl border px-1.5 text-[12px] font-bold transition ${
                  fundingType === type
                    ? 'pick-on'
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

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="revenue-gross" className="label">
                {fundingType === 'grant' ? '정산 후 회사 자체재원' : '실제 수금액'}
              </label>
              <div className="relative">
                <input
                  id="revenue-gross"
                  inputMode="numeric"
                  value={commaNumber(grossAmount)}
                  onChange={(event) => {
                    setGrossAmount(digitsOnly(event.target.value));
                    setDirty(true);
                  }}
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
                  onChange={(event) => {
                    setDirectCosts(digitsOnly(event.target.value));
                    setDirty(true);
                  }}
                  className="field pr-9 text-right font-bold tabular-nums"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-neutral-400">원</span>
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-neutral-400">강사비·재료비·교통비·수수료·세금 등</p>
            </div>
            <div>
              <label htmlFor="revenue-operating-rate" className="label">회사 운영비 비율</label>
              <div className="relative">
                <input
                  id="revenue-operating-rate"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={operatingCostRatePercent}
                  onChange={(event) => {
                    setOperatingCostRatePercent(Number(event.target.value));
                    setRateStatus((current) => (current === 'agreed' ? 'draft' : current));
                    setDirty(true);
                  }}
                  className="field pr-9 text-right font-bold tabular-nums"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-neutral-400">%</span>
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-neutral-400">직접비를 뺀 순수익에서 먼저 적립 · 엑셀 기본 20%</p>
            </div>
          </div>
          {calculation && (
            <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-neutral-100 bg-neutral-100">
              <MiniAmount label="순수익" value={calculation.contributionProfit} />
              <MiniAmount label="회사 운영비" value={calculation.operatingCostAmount} />
              <MiniAmount label="배분 대상" value={calculation.distributableAmount} emphasis />
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
            <MultiPicker
              options={members}
              selected={baseMemberIds}
              onChange={(memberIds) => {
                setBaseMemberIds(memberIds);
                setRateStatus((current) => (current === 'agreed' ? 'draft' : current));
                setDirty(true);
              }}
            />
          </div>
        </section>

        <section className="space-y-2.5">
          <div className="flex items-end justify-between px-0.5">
            <div>
              <h2 className="text-[15px] font-bold">3. 역할별 성과몫</h2>
              <p className="mt-0.5 text-[12px] text-neutral-400">적용 중 {activePoolCount}개 · 여러 역할을 맡으면 모두 더해져요</p>
            </div>
          </div>
          <div className="rounded-xl border border-brand-100 bg-brand-50 px-3.5 py-3 text-[12px] leading-relaxed text-brand-800">
            <p className="font-bold">엑셀 시작안 · 균등 50% · 개발/기획 25% · 영업 15% · 사업계획서 10%</p>
            <p className="mt-1 text-brand-700">
              적용하지 않은 역할의 몫은 자동으로 균등 1/N에 합쳐져요. 같은 역할을 여러 명이 맡으면 그 역할 몫을 다시 똑같이 나눠요.
            </p>
            {fundingType === 'grant' && (
              <p className="mt-1 font-semibold text-amber-800">지원금 사업은 사업계획서 몫을 끄고, 승인된 인건비·운영비 기준으로 보상해주세요.</p>
            )}
          </div>
          {pools.map((pool) => (
            <PoolCard
              key={pool.id}
              pool={pool}
              members={members.filter((member) => baseMemberIds.includes(member.id))}
              distributableAmount={amountNumbers.distributableAmount}
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
          <Results calculation={calculation} pools={pools} members={members} rateStatus={rateStatus} />
        )}

        <section className="card p-4">
          <label htmlFor="revenue-note" className="label">이 달 메모 (선택)</label>
          <textarea
            id="revenue-note"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setDirty(true);
            }}
            rows={3}
            className="field resize-none leading-relaxed"
            placeholder="예: 8월 수금 완료, 영업 비율은 다음 회의에서 재검토"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-neutral-400">
            <span>
              {dirty
                ? '저장하지 않은 수정이 있어요.'
                : savedAt
                  ? `저장된 월 계산안 · ${new Date(savedAt).toLocaleString('ko-KR')}`
                  : '아직 저장하지 않은 월 계산이에요.'}
            </span>
            <span>실제 지급·송금 내역 아님</span>
          </div>
        </section>

        {!isAdmin && (
          <p className="rounded-xl bg-neutral-50 px-3.5 py-3 text-center text-[12.5px] text-neutral-500">
            누구나 숫자를 바꿔 월별 예상액을 계산할 수 있고, 계산안 저장은 원장만 할 수 있어요.
          </p>
        )}

      </main>

      {isAdmin && (
        <div className="fixed inset-x-0 bottom-[56px] z-30 border-t border-neutral-200 bg-surface/95 px-4 py-2.5 backdrop-blur safe-bottom lg:bottom-0 lg:left-[232px]">
          <div className="mx-auto flex max-w-4xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11.5px] text-neutral-400">{monthLabel(month)} 예상 배분액</p>
              <p className="text-[17px] font-black tabular-nums">{won(calculation?.totalDistributed ?? 0)}원</p>
            </div>
            <button
              onClick={() => void save()}
              disabled={saving || issues.length > 0 || !monthStorageReady}
              className="btn-primary min-w-[116px]"
            >
              {saving ? '저장 중…' : monthStorageReady ? '계산안 저장' : '저장 준비 안 됨'}
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
  distributableAmount,
  calculation,
  onChange,
}: {
  pool: RevenueSharePoolRule;
  members: MemberPublic[];
  distributableAmount: number;
  calculation: RevenueShareCalculation | null;
  onChange: (patch: Partial<RevenueSharePoolRule>) => void;
}) {
  const meta = POOL_META[pool.kind];
  const canRecommend = pool.kind === 'proposal' || pool.kind === 'sales';
  const recommendation =
    pool.kind === 'sales'
      ? recommendSalesIncentive(distributableAmount)
      : pool.kind === 'proposal'
        ? recommendProposalIncentive(distributableAmount)
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
            <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-neutral-50 p-1" role="group" aria-label="비율 입력 방식">
              <button
                type="button"
                onClick={() => onChange({ rate_mode: 'recommended' })}
                aria-pressed={pool.rate_mode === 'recommended'}
                className={`min-h-[42px] rounded-lg px-2 text-[12.5px] font-bold ${
                  pool.rate_mode === 'recommended' ? 'bg-surface text-brand shadow-sm' : 'text-neutral-400'
                }`}
              >
                추천 가안 보기
              </button>
              <button
                type="button"
                onClick={() => onChange({ rate_mode: 'manual' })}
                aria-pressed={pool.rate_mode === 'manual'}
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
                  <p className="text-[11px] font-bold text-brand-700">규모별 누진 검토안</p>
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
              <div className="mt-2 flex flex-wrap gap-1.5" aria-label="빠른 비율 비교">
                {[5, 10, 15, 20, 25].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    aria-pressed={pool.rate_percent === rate}
                    onClick={() => onChange({ rate_percent: rate })}
                    className={`chip min-h-[32px] px-3 ${
                      pool.rate_percent === rate
                        ? 'bg-brand-100 text-brand-700'
                        : 'bg-neutral-100 text-neutral-600'
                    }`}
                  >
                    {rate}%
                  </button>
                ))}
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
  rateStatus,
}: {
  calculation: RevenueShareCalculation;
  pools: RevenueSharePoolRule[];
  members: MemberPublic[];
  rateStatus: RevenueShareRateStatus;
}) {
  const incentiveTotal = calculation.distributableAmount - calculation.baseAmount;
  const poolLabel = new Map(pools.map((pool) => [pool.id, POOL_META[pool.kind].short]));

  return (
    <section className="space-y-2.5">
      <div className="card overflow-hidden">
        <div className="border-b border-neutral-100 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-bold">4. 월 예상 배분</h2>
            <span className={`chip ${rateStatus === 'agreed' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
              {RATE_STATUS_META[rateStatus].label}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-neutral-400">
            원 단위까지 합계는 맞지만, 비율이 바뀌면 사람별 금액도 다시 계산돼요.
          </p>
        </div>
        {calculation.hasLoss ? (
          <div className="m-3.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] leading-relaxed text-red-800">
            직접비가 수금액보다 {won(calculation.deficitAmount)}원 더 커서 나눌 이익이 없어요. 성과몫과 기본몫은 모두 0원입니다.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-px bg-neutral-100">
            <ResultStat label="순수익" value={calculation.contributionProfit} />
            <ResultStat
              label="회사 운영비"
              value={calculation.operatingCostAmount}
              sub={`${calculation.operatingCostRatePercent.toFixed(1)}%`}
            />
            <ResultStat label="배분 대상 금액" value={calculation.distributableAmount} />
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
            const rate = calculation.distributableAmount > 0
              ? (row.totalAmount / calculation.distributableAmount) * 100
              : 0;
            return (
              <article key={member.id} className="card p-3.5">
                <div className="flex items-center gap-3">
                  <Avatar name={member.name} size={38} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[14.5px] font-bold">{member.name}</p>
                      {extras.length > 0 && <span className="chip bg-brand-50 text-brand-700">성과 {extras.length}개</span>}
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-neutral-400">배분 대상 금액의 {rate.toFixed(1)}%</p>
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

function MiniAmount({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div className={emphasis ? 'bg-brand-50 px-2 py-3 text-brand-800' : 'bg-surface px-2 py-3'}>
      <p className="truncate text-[10.5px] text-neutral-400">{label}</p>
      <p className="mt-0.5 break-all text-[13px] font-black tabular-nums">{won(value)}원</p>
    </div>
  );
}
