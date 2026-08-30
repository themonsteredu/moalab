'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { CardSkeleton, EmptyState, ErrorBanner } from '@/components/ui';
import { won } from '@/lib/format';
import { friendlyError, supabase } from '@/lib/supabase';
import type { AppRow, RevenueSharePlan } from '@/lib/types';

interface RevenueRow {
  app: AppRow;
  plan: RevenueSharePlan | null;
}

const FUNDING_LABEL: Record<RevenueSharePlan['funding_type'], string> = {
  private: '민간·자체 매출',
  public_contract: '공공기관 계약',
  grant: '지원금 사업',
};

export default function RevenueListPage() {
  const [rows, setRows] = useState<RevenueRow[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [appsRes, plansRes] = await Promise.all([
        supabase.from('apps').select('*').eq('archived', false).order('title_ko'),
        supabase.from('revenue_share_plans').select('*'),
      ]);
      if (appsRes.error) throw appsRes.error;

      const apps = (appsRes.data ?? []) as AppRow[];
      const plans = plansRes.error ? [] : ((plansRes.data ?? []) as RevenueSharePlan[]);
      const planByApp = new Map(plans.map((plan) => [plan.app_id, plan]));

      setRows(apps.map((app) => ({ app, plan: planByApp.get(app.id) ?? null })));
      if (plansRes.error) {
        setError(friendlyError(plansRes.error, '저장된 배분 기준만 불러오지 못했어요.'));
      }
    } catch (e) {
      setRows([]);
      setError(friendlyError(e, '수익배분 기준을 불러오지 못했어요. 다시 시도해주세요.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader title="수익배분" subtitle={rows ? `프로그램 ${rows.length}개` : undefined} />

      <div className="space-y-3 px-4 pb-8 pt-3">
        <section className="card overflow-hidden" aria-labelledby="revenue-rule-title">
          <div className="border-b border-brand/10 bg-brand-50 px-4 py-3.5">
            <p id="revenue-rule-title" className="text-[12px] font-bold text-brand-700">
              배분 원칙
            </p>
            <p className="mt-1 break-keep text-[15px] font-black leading-relaxed text-neutral-900">
              실제 수금액 - 직접비 - 역할별 성과몫 = 남은 금액 1/N
            </p>
          </div>
          <p className="break-keep px-4 py-3 text-[13px] font-semibold leading-relaxed text-neutral-600">
            성과 담당자도 기본 1/N을 다시 받음
          </p>
        </section>

        {error && <ErrorBanner message={error} onRetry={() => void load()} />}

        {rows === null ? (
          <CardSkeleton rows={3} />
        ) : rows.length === 0 && !error ? (
          <EmptyState
            icon="won"
            title="등록된 프로그램이 없어요"
            desc="프로그램계획에서 프로그램을 먼저 등록해주세요."
          />
        ) : (
          <div className="space-y-2.5">
            {rows.map(({ app, plan }) => (
              <RevenueCard key={app.id} app={app} plan={plan} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function RevenueCard({ app, plan }: RevenueRow) {
  const activePools = plan?.pools.filter((pool) => pool.active) ?? [];

  return (
    <Link
      href={`/revenue/${app.id}`}
      className="card block p-4 transition active:bg-neutral-50"
      aria-label={`${app.title_ko} 수익배분 ${plan ? '보기' : '계산 시작'}`}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-bold text-neutral-900">{app.title_ko}</p>
          <p className="mt-0.5 truncate text-[12px] text-neutral-400">{app.slug}</p>
        </div>
        <span
          className={`chip shrink-0 ${
            plan ? 'bg-green-100 text-green-800' : 'bg-neutral-100 text-neutral-500'
          }`}
        >
          {plan ? '저장됨' : '아직 기준 없음'}
        </span>
      </div>

      {plan ? (
        <>
          <p className="mt-3 text-[12px] font-bold text-brand-700">{FUNDING_LABEL[plan.funding_type]}</p>

          <dl className="mt-2 grid grid-cols-2 gap-2">
            <Amount label="배분 기준액" value={plan.gross_amount} />
            <Amount label="직접비" value={plan.direct_costs} />
          </dl>

          <div className="mt-3">
            <p className="text-[11px] font-semibold text-neutral-400">역할별 성과몫</p>
            {activePools.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {activePools.map((pool) => (
                  <span key={pool.id} className="chip max-w-full bg-brand-50 text-brand-700">
                    <span className="truncate">{pool.label}</span>
                    <span className="ml-1 shrink-0 tabular-nums">
                      {pool.rate_mode === 'recommended' ? '규모 추천 자동' : `${pool.rate_percent}%`}
                    </span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-[12px] text-neutral-400">활성화된 성과몫이 없어요.</p>
            )}
          </div>

          <p className="mt-3 text-right text-[12.5px] font-bold text-brand">기준 보기 ›</p>
        </>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-neutral-50 px-3 py-2.5">
          <p className="break-keep text-[12.5px] leading-relaxed text-neutral-500">
            참여자와 역할별 성과율을 정해주세요.
          </p>
          <span className="shrink-0 text-[12.5px] font-bold text-brand">계산 시작 ›</span>
        </div>
      )}
    </Link>
  );
}

function Amount({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-xl bg-neutral-50 px-3 py-2.5">
      <dt className="truncate text-[11px] text-neutral-500">{label}</dt>
      <dd className="mt-0.5 truncate text-[15px] font-black tabular-nums text-neutral-900">{won(value)}원</dd>
    </div>
  );
}
