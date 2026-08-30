'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { CardSkeleton, EmptyState, ErrorBanner } from '@/components/ui';
import { monthLabel, shiftMonth, thisMonth } from '@/lib/expense';
import { won } from '@/lib/format';
import { aggregateMonthlyRevenueShares } from '@/lib/revenueShare';
import { friendlyError, supabase } from '@/lib/supabase';
import type { AppRow, RevenueFundingType, RevenueShareMonth, RevenueShareRateStatus } from '@/lib/types';

interface RevenueRow {
  app: AppRow;
  month: RevenueShareMonth | null;
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
  const loadGeneration = useRef(0);
  const requestedMonth = searchParams.get('month');
  const month = requestedMonth && MONTH_KEY_RE.test(requestedMonth) ? requestedMonth : thisMonth();
  const [rows, setRows] = useState<RevenueRow[] | null>(null);
  const [loadedMonth, setLoadedMonth] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setRows(null);
    setLoadedMonth(null);
    setError('');
    try {
      const [appsRes, monthsRes] = await Promise.all([
        supabase.from('apps').select('*').order('title_ko'),
        supabase.from('revenue_share_months').select('*').eq('settlement_month', `${month}-01`),
      ]);
      if (generation !== loadGeneration.current) return;
      if (appsRes.error) throw appsRes.error;

      const apps = (appsRes.data ?? []) as AppRow[];
      const months = monthsRes.error ? [] : ((monthsRes.data ?? []) as RevenueShareMonth[]);
      const monthByApp = new Map(months.map((row) => [row.app_id, row]));

      setRows(
        apps
          .filter((app) => !app.archived || monthByApp.has(app.id))
          .map((app) => ({
            app,
            month: monthByApp.get(app.id) ?? null,
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
        subtitle={visibleRows ? `${monthLabel(month)} · 저장 ${summary?.settlementCount ?? 0}개 프로그램` : undefined}
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
            <p id="revenue-rule-title" className="text-[12px] font-bold text-brand-700">월별 배분 원칙</p>
            <p className="mt-1 break-keep text-[15px] font-black leading-relaxed text-neutral-900">
              프로그램별 수금액 − 직접비 − 역할 성과몫 = 남은 금액 1/N
            </p>
          </div>
          <p className="break-keep px-4 py-3 text-[12.5px] font-semibold leading-relaxed text-neutral-600">
            각 프로그램을 먼저 계산한 뒤 같은 사람의 {monthLabel(month)} 예상액을 합쳐요. 비율 미정은 지급 확정액이 아닙니다.
          </p>
        </section>

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
                <SummaryStat label="직접 운영비" value={summary.directCosts} />
                <SummaryStat label="배분가능이익" value={summary.contributionProfit} />
                <SummaryStat label="예상 배분 합계" value={summary.totalDistributed} />
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex items-end justify-between px-0.5">
                <div>
                  <h2 className="text-[15px] font-bold">사람별 월 예상액</h2>
                  <p className="mt-0.5 text-[11.5px] text-neutral-400">프로그램별 기본몫과 성과몫을 모두 합산</p>
                </div>
              </div>
              {summary.members.map((member) => (
                <article key={member.memberId} className="card p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-bold">{member.memberName ?? '이름 미상'}</p>
                      <p className="mt-0.5 text-[11.5px] text-neutral-400">{member.programCount}개 프로그램</p>
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
            title="등록된 프로그램이 없어요"
            desc="프로그램계획에서 프로그램을 먼저 등록해주세요."
          />
        ) : (
          <div className="space-y-2.5">
            <div className="px-0.5">
              <h2 className="text-[15px] font-bold">프로그램별 계산</h2>
              <p className="mt-0.5 text-[11.5px] text-neutral-400">월 금액과 참여자를 프로그램마다 입력해요.</p>
            </div>
            {visibleRows.map((row) => <RevenueCard key={row.app.id} {...row} selectedMonth={month} />)}
          </div>
        )}
      </div>
    </>
  );
}

function RevenueCard({
  app,
  month,
  selectedMonth,
}: RevenueRow & { selectedMonth: string }) {
  const rules = Array.isArray(month?.pools) ? month.pools : [];
  const activePools = rules.filter((pool) => pool.active);
  const contributionProfit = Number(month?.calculation?.contributionProfit);
  const validCalculation = Number.isSafeInteger(contributionProfit) && contributionProfit >= 0;
  const status = month
    ? RATE_STATUS_META[month.rate_status] ?? { label: '데이터 확인', cls: 'bg-red-100 text-red-800' }
    : null;

  return (
    <Link
      href={`/revenue/${app.id}?month=${selectedMonth}`}
      className="card block p-4 transition active:bg-neutral-50"
      aria-label={`${app.title_ko} ${monthLabel(selectedMonth)} 수익배분 ${month ? '보기' : '계산 시작'}`}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-bold text-neutral-900">{app.title_ko}</p>
          <p className="mt-0.5 truncate text-[12px] text-neutral-400">{app.slug}{app.archived ? ' · 보관됨' : ''}</p>
        </div>
        <span className={`chip shrink-0 ${status?.cls ?? 'bg-neutral-100 text-neutral-500'}`}>
          {status?.label ?? '월 계산 없음'}
        </span>
      </div>

      {month && validCalculation ? (
        <>
          <p className="mt-3 text-[12px] font-bold text-brand-700">{FUNDING_LABEL[month.funding_type]}</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Amount label="수금" value={Number(month.gross_amount)} />
            <Amount label="직접비" value={Number(month.direct_costs)} />
            <Amount label="배분이익" value={contributionProfit} />
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

function Amount({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-xl bg-neutral-50 px-2.5 py-2.5">
      <dt className="truncate text-[10.5px] text-neutral-500">{label}</dt>
      <dd className="mt-0.5 break-all text-[13.5px] font-black tabular-nums text-neutral-900">{won(value)}원</dd>
    </div>
  );
}
