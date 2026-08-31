'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { CardSkeleton, EmptyState, ErrorBanner, useToast } from '@/components/ui';
import { monthLabel, shiftMonth, thisMonth } from '@/lib/expense';
import { won } from '@/lib/format';
import { aggregateMonthlyRevenueShares } from '@/lib/revenueShare';
import { useSession } from '@/lib/session';
import { friendlyError, supabase } from '@/lib/supabase';
import type { RevenueFundingType, RevenueProject, RevenueProjectMonth, RevenueShareRateStatus } from '@/lib/types';

interface RevenueRow {
  project: RevenueProject;
  month: RevenueProjectMonth | null;
}

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const FUNDING_LABEL: Record<RevenueFundingType, string> = {
  private: '민간·자체 매출',
  public_contract: '공공기관 계약',
  grant: '지원금 사업',
};

const RATE_STATUS_META: Record<RevenueShareRateStatus, { label: string; cls: string }> = {
  undecided: { label: '비율 미정', cls: 'bg-amber-100 text-amber-800' },
  draft: { label: '검토안', cls: 'bg-blue-100 text-blue-800' },
  agreed: { label: '합의됨', cls: 'bg-green-100 text-green-800' },
};

export default function RevenueListPage() {
  return (
    <Suspense fallback={<RevenueListFallback />}>
      <RevenueListContent />
    </Suspense>
  );
}

function RevenueListFallback() {
  return (
    <>
      <PageHeader title="월별 수익배분" />
      <div className="space-y-3 px-4 py-4">
        <CardSkeleton rows={4} />
      </div>
    </>
  );
}

function RevenueListContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session, isAdmin } = useSession();
  const toast = useToast();
  const loadGeneration = useRef(0);
  const requestedMonth = searchParams.get('month');
  const month = requestedMonth && MONTH_KEY_RE.test(requestedMonth) ? requestedMonth : thisMonth();
  const [rows, setRows] = useState<RevenueRow[] | null>(null);
  const [loadedMonth, setLoadedMonth] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setRows(null);
    setLoadedMonth(null);
    setError('');
    try {
      const [projectsRes, monthsRes] = await Promise.all([
        supabase.from('revenue_projects').select('*').order('updated_at', { ascending: false }),
        supabase.from('revenue_project_months').select('*').eq('settlement_month', `${month}-01`),
      ]);
      if (generation !== loadGeneration.current) return;
      if (projectsRes.error) throw projectsRes.error;

      const projects = (projectsRes.data ?? []) as RevenueProject[];
      const months = monthsRes.error ? [] : ((monthsRes.data ?? []) as RevenueProjectMonth[]);
      const monthByProject = new Map(months.map((row) => [row.project_id, row]));

      setRows(
        projects
          .filter((project) => !project.archived || monthByProject.has(project.id))
          .map((project) => ({
            project,
            month: monthByProject.get(project.id) ?? null,
          })),
      );
      setLoadedMonth(month);

      const warnings = [];
      if (monthsRes.error) warnings.push(friendlyError(monthsRes.error, '월 계산안은 불러오지 못했어요.'));
      if (warnings.length > 0) setError(warnings.join(' '));
    } catch (e) {
      if (generation !== loadGeneration.current) return;
      setRows([]);
      setLoadedMonth(month);
      setError(friendlyError(e, '월별 수익배분을 불러오지 못했어요. 다시 시도해주세요.'));
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeMonth = (nextMonth: string) => {
    if (!MONTH_KEY_RE.test(nextMonth) || nextMonth === month) return;
    loadGeneration.current += 1;
    setRows(null);
    router.replace(`/revenue?month=${nextMonth}`, { scroll: false });
  };

  const visibleRows = loadedMonth === month ? rows : null;

  const createProject = async () => {
    const name = newName.trim();
    if (!session || !isAdmin || !name || creating) return;
    setCreating(true);
    setError('');
    try {
      const { data, error: createError } = await supabase
        .from('revenue_projects')
        .insert({ name, created_by: session.id, updated_at: new Date().toISOString() })
        .select('*')
        .single();
      if (createError) throw createError;
      const project = data as RevenueProject;
      toast.show(`${project.name} 프로젝트를 만들었어요.`);
      router.push(`/revenue/${project.id}?month=${month}`);
    } catch (e) {
      setError(friendlyError(e, '프로젝트를 만들지 못했어요. 다시 눌러주세요.'));
    } finally {
      setCreating(false);
    }
  };

  const aggregation = useMemo(() => {
    const saved = (visibleRows ?? []).flatMap((row) => (row.month ? [row.month] : []));
    try {
      return {
        summary: aggregateMonthlyRevenueShares(
          saved.map((row) => ({
            rateStatus: row.rate_status,
            calculation: row.calculation,
            memberNames: Object.fromEntries(
              (Array.isArray(row.member_snapshot) ? row.member_snapshot : []).map((member) => [member.id, member.name]),
            ),
          })),
        ),
        error: '',
      };
    } catch (e) {
      return { summary: null, error: friendlyError(e, '저장된 월 계산 합계가 맞지 않아요.') };
    }
  }, [visibleRows]);

  const summary = aggregation.summary;

  return (
    <>
      <PageHeader
        title="월별 수익배분"
        subtitle={visibleRows ? `${monthLabel(month)} · 저장 ${summary?.settlementCount ?? 0}개 프로젝트` : undefined}
      />

      <div className="space-y-3 px-4 pb-8 pt-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => changeMonth(shiftMonth(month, -1))}
            aria-label="지난 달"
            className="tap w-11 rounded-xl border border-neutral-200 bg-surface text-neutral-500"
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
            className="tap w-11 rounded-xl border border-neutral-200 bg-surface text-neutral-500"
          >
            ›
          </button>
          {month !== thisMonth() && (
            <button type="button" onClick={() => changeMonth(thisMonth())} className="btn-ghost h-11 px-3 text-[12px]">
              이 달
            </button>
          )}
        </div>

        <section className="card overflow-hidden" aria-labelledby="revenue-rule-title">
          <div className="border-b border-brand/10 bg-brand-50 px-4 py-3.5">
            <div className="flex items-center justify-between gap-2">
              <p id="revenue-rule-title" className="text-[12px] font-bold text-brand-700">정산 규칙</p>
              <span className="chip bg-amber-100 text-amber-800">엑셀 기본안 · 조정 가능</span>
            </div>
            <p className="mt-1 break-keep text-[15px] font-black leading-relaxed text-neutral-900">
              수금액 − 직접비 − 회사 운영비 = 역할몫 + 균등 1/N
            </p>
          </div>
          <ol className="divide-y divide-neutral-100 px-4">
            <RuleStep number="1" title="실제 수금액 확정" desc="계약금액이 아니라 실제로 정산할 수금액을 적어요." />
            <RuleStep number="2" title="직접 운영비 먼저 차감" desc="강사비·재료비·교통비·세금·수수료 등을 먼저 빼요." />
            <RuleStep number="3" title="회사 운영비 적립" desc="직접비를 뺀 순수익에서 운영비를 먼저 적립해요. 엑셀 시작값은 20%예요." />
            <RuleStep number="4" title="역할 성과몫 계산" desc="배분 대상 금액의 개발·기획 25% · 영업 15% · 사업계획서 10%를 역할 참여자끼리 나눠요." />
            <RuleStep number="5" title="균등 몫 1/N" desc="기본 50%와 참여자가 없는 역할의 몫을 해당 프로젝트 참여자에게 균등 배분해요." />
          </ol>
          <p className="break-keep border-t border-neutral-100 px-4 py-3 text-[12.5px] font-semibold leading-relaxed text-neutral-600">
            광주중학교·모두의창업처럼 프로젝트를 각각 계산한 뒤 같은 사람의 {monthLabel(month)} 예상액을 합쳐요.
          </p>
        </section>

        {isAdmin && (
          <section className="card overflow-hidden">
            <button
              type="button"
              onClick={() => setShowCreate((current) => !current)}
              aria-expanded={showCreate}
              className="flex min-h-[52px] w-full items-center justify-between px-4 text-left"
            >
              <span>
                <span className="block text-[14px] font-bold">새 수익 프로젝트</span>
                <span className="mt-0.5 block text-[11.5px] text-neutral-400">
                  학교·기관·지원사업 이름으로 만들어요.
                </span>
              </span>
              <span className="text-[20px] font-light text-brand">{showCreate ? '−' : '+'}</span>
            </button>
            {showCreate && (
              <div className="space-y-3 border-t border-neutral-100 px-4 py-4">
                <div>
                  <label htmlFor="revenue-project-name" className="label">프로젝트명</label>
                  <input
                    id="revenue-project-name"
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    className="field"
                    placeholder="예: 광주중학교, 모두의창업"
                    maxLength={120}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void createProject()}
                  disabled={!newName.trim() || creating}
                  className="btn-primary w-full"
                >
                  {creating ? '만드는 중…' : '프로젝트 만들고 계산하기'}
                </button>
              </div>
            )}
          </section>
        )}

        {error && <ErrorBanner message={error} onRetry={() => void load()} />}
        {aggregation.error && <ErrorBanner message={aggregation.error} onRetry={() => void load()} />}

        {summary && summary.settlementCount > 0 && (
          <>
            <section className="card overflow-hidden">
              <div className="border-b border-neutral-100 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-[15px] font-bold">{monthLabel(month)} 합계</h2>
                  <span className={`chip ${summary.agreedCount === summary.settlementCount ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                    {summary.agreedCount === summary.settlementCount ? '모두 합의됨' : '가안 포함'}
                  </span>
                </div>
                <p className="mt-0.5 text-[11.5px] text-neutral-400">
                  비율 미정 {summary.undecidedCount} · 검토안 {summary.draftCount} · 합의됨 {summary.agreedCount}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-px bg-neutral-100">
                <SummaryStat label="실제 수금액" value={summary.grossAmount} />
                <SummaryStat label="직접비" value={summary.directCosts} />
                <SummaryStat label="순수익" value={summary.contributionProfit} />
                <SummaryStat label="회사 운영비" value={summary.operatingCostAmount} />
                <SummaryStat label="배분 대상 금액" value={summary.distributableAmount} />
                <SummaryStat label="예상 배분 합계" value={summary.totalDistributed} />
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex items-end justify-between px-0.5">
                <div>
                  <h2 className="text-[15px] font-bold">사람별 월 예상액</h2>
                  <p className="mt-0.5 text-[11.5px] text-neutral-400">프로젝트별 기본몫과 성과몫을 모두 합산</p>
                </div>
              </div>
              {summary.members.map((member) => (
                <article key={member.memberId} className="card p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-bold">{member.memberName ?? '이름 미상'}</p>
                      <p className="mt-0.5 text-[11.5px] text-neutral-400">{member.projectCount}개 프로젝트</p>
                    </div>
                    <p className="shrink-0 text-[19px] font-black tabular-nums">{won(member.totalAmount)}원</p>
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-neutral-100 pt-2.5 text-[11.5px]">
                    <span className="rounded-lg bg-neutral-50 px-2.5 py-1.5 text-neutral-600">기본 {won(member.baseAmount)}원</span>
                    <span className="rounded-lg bg-brand-50 px-2.5 py-1.5 font-bold text-brand-700">성과 +{won(member.performanceAmount)}원</span>
                  </div>
                </article>
              ))}
            </section>
          </>
        )}

        {visibleRows === null ? (
          <CardSkeleton rows={3} />
        ) : visibleRows.length === 0 && !error ? (
          <EmptyState
            icon="won"
            title="등록된 수익 프로젝트가 없어요"
            desc="위에서 광주중학교·모두의창업처럼 프로젝트를 먼저 만들어주세요."
          />
        ) : (
          <div className="space-y-2.5">
            <div className="px-0.5">
              <h2 className="text-[15px] font-bold">프로젝트별 계산</h2>
              <p className="mt-0.5 text-[11.5px] text-neutral-400">월 수금액·직접비·참여자를 프로젝트마다 입력해요.</p>
            </div>
            {visibleRows.map((row) => <RevenueCard key={row.project.id} {...row} selectedMonth={month} />)}
          </div>
        )}
      </div>
      {toast.node}
    </>
  );
}

function RevenueCard({
  project,
  month,
  selectedMonth,
}: RevenueRow & { selectedMonth: string }) {
  const rules = Array.isArray(month?.pools) ? month.pools : [];
  const activePools = rules.filter((pool) => pool.active);
  const contributionProfit = Number(month?.calculation?.contributionProfit);
  const distributableAmount = Number(
    month?.calculation?.distributableAmount ?? month?.calculation?.contributionProfit,
  );
  const operatingCostAmount = Number(month?.calculation?.operatingCostAmount ?? 0);
  const validCalculation =
    Number.isSafeInteger(contributionProfit) && contributionProfit >= 0 &&
    Number.isSafeInteger(distributableAmount) && distributableAmount >= 0 &&
    Number.isSafeInteger(operatingCostAmount) && operatingCostAmount >= 0;
  const status = month
    ? RATE_STATUS_META[month.rate_status] ?? { label: '데이터 확인', cls: 'bg-red-100 text-red-800' }
    : null;

  return (
    <Link
      href={`/revenue/${project.id}?month=${selectedMonth}`}
      className="card block p-4 transition active:bg-neutral-50"
      aria-label={`${project.name} ${monthLabel(selectedMonth)} 수익배분 ${month ? '보기' : '계산 시작'}`}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-bold text-neutral-900">{project.name}</p>
          <p className="mt-0.5 truncate text-[12px] text-neutral-400">수익 프로젝트{project.archived ? ' · 보관됨' : ''}</p>
        </div>
        <span className={`chip shrink-0 ${status?.cls ?? 'bg-neutral-100 text-neutral-500'}`}>
          {status?.label ?? '월 계산 없음'}
        </span>
      </div>

      {month && validCalculation ? (
        <>
          <p className="mt-3 text-[12px] font-bold text-brand-700">{FUNDING_LABEL[month.funding_type]}</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Amount label="수금" value={Number(month.gross_amount)} />
            <Amount label="직접비" value={Number(month.direct_costs)} />
            <Amount label="회사 운영비" value={operatingCostAmount} />
            <Amount label="배분 대상" value={distributableAmount} />
          </dl>
        </>
      ) : month ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[12.5px] text-red-700">
          저장된 계산 결과를 확인해주세요.
        </div>
      ) : (
        <div className="mt-3 rounded-xl bg-neutral-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-neutral-500">
          수금액·직접비·참여자를 입력하면 이 달 예상액을 계산해요.
        </div>
      )}

      {activePools.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {activePools.map((pool) => (
            <span key={pool.id} className="chip max-w-full bg-brand-50 text-brand-700">
              <span className="truncate">{pool.label}</span>
              <span className="ml-1 shrink-0 tabular-nums">
                {pool.rate_mode === 'recommended' ? '추천 가안' : `${pool.rate_percent}%`}
              </span>
            </span>
          ))}
        </div>
      )}

      <p className="mt-3 text-right text-[12.5px] font-bold text-brand">{month ? '월 계산 보기' : '월 계산 시작'} ›</p>
    </Link>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface px-3.5 py-3">
      <p className="text-[11px] text-neutral-400">{label}</p>
      <p className="mt-0.5 text-[16px] font-black tabular-nums">{won(value)}원</p>
    </div>
  );
}

function RuleStep({ number, title, desc }: { number: string; title: string; desc: string }) {
  return (
    <li className="flex gap-3 py-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-black text-brand">
        {number}
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-bold text-neutral-800">{title}</p>
        <p className="mt-0.5 break-keep text-[11.5px] leading-relaxed text-neutral-500">{desc}</p>
      </div>
    </li>
  );
}

function Amount({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-xl bg-neutral-50 px-2.5 py-2.5">
      <dt className="truncate text-[10.5px] text-neutral-500">{label}</dt>
      <dd className="mt-0.5 break-all text-[13.5px] font-black tabular-nums text-neutral-900">{won(value)}원</dd>
    </div>
  );
}
