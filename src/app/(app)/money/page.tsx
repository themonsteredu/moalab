'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase, friendlyError } from '@/lib/supabase';
import { monthRange, thisMonth } from '@/lib/expense';
import { won } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { Icon, type IconName } from '@/components/Icon';
import { ErrorBanner, Skeleton } from '@/components/ui';

/**
 * 회계 — 원가 · 수익배분 · 지출결의서로 들어가는 문 하나.
 *
 * **메뉴만 합친 것이다.** 표도 계산도 그대로 셋으로 나뉘어 있다 —
 * 원가(`cost_sheets`)는 *앞으로 얼마 들까*(계획)이고 지출(`expenses`)은
 * *실제로 얼마 썼나*(증빙)라서, 섞으면 둘 다 못 쓴다. 이 문서가 여러 번
 * 적어둔 판단이라 여기서도 지킨다.
 *
 * 그냥 넘겨보내는 화면이면 한 번 더 누르게 만드는 값을 못 한다. 그래서
 * **지금 숫자를 같이 싣는다** — 이번 달 얼마 썼는지, 원가표가 몇 장인지.
 */

interface Counts {
  sheets: number;
  projects: number;
  expenseCount: number;
  expenseSum: number;
  noReceipt: number;
}

const CARDS: { href: string; label: string; icon: IconName; desc: string }[] = [
  {
    href: '/cost',
    label: '원가',
    icon: 'cart',
    desc: '앞으로 얼마 들까 — 재료·교구로 1인당 원가와 마진을 계산해요.',
  },
  {
    href: '/revenue',
    label: '월별 수익배분',
    icon: 'won',
    desc: '수금액에서 직접비를 빼고, 성과몫과 남은 이익을 사람별로 나눠요.',
  },
  {
    href: '/expense',
    label: '지출결의서',
    icon: 'receipt',
    desc: '실제로 쓴 돈 + 영수증. 달마다 문서로 인쇄해요.',
  },
];

export default function MoneyPage() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState('');
  const month = thisMonth();

  const load = useCallback(async () => {
    setError('');
    try {
      const { from, to } = monthRange(month);
      const [sheetRes, projRes, expRes, fileRes] = await Promise.all([
        supabase.from('cost_sheets').select('id', { count: 'exact', head: true }),
        supabase.from('revenue_projects').select('id', { count: 'exact', head: true }),
        supabase.from('expenses').select('id, amount').gte('spent_on', from).lte('spent_on', to),
        supabase.from('expense_files').select('expense_id'),
      ]);
      const rows = (expRes.data ?? []) as { id: string; amount: number }[];
      const withFile = new Set(((fileRes.data ?? []) as { expense_id: string }[]).map((f) => f.expense_id));
      setCounts({
        sheets: sheetRes.count ?? 0,
        projects: projRes.count ?? 0,
        expenseCount: rows.length,
        expenseSum: rows.reduce((a, r) => a + (r.amount ?? 0), 0),
        noReceipt: rows.filter((r) => !withFile.has(r.id)).length,
      });
    } catch (e) {
      setError(friendlyError(e, '숫자를 불러오지 못했어요.'));
      setCounts({ sheets: 0, projects: 0, expenseCount: 0, expenseSum: 0, noReceipt: 0 });
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 카드마다 지금 숫자 한 줄. 없으면 아예 안 그린다 — '0건' 만 적으면 자리만 먹는다 */
  const factOf = (href: string): { text: string; warn?: boolean } | null => {
    if (!counts) return null;
    if (href === '/cost') return counts.sheets > 0 ? { text: `원가표 ${counts.sheets}장` } : null;
    if (href === '/revenue') return counts.projects > 0 ? { text: `프로젝트 ${counts.projects}개` } : null;
    if (counts.expenseCount === 0) return null;
    return {
      text:
        `이번 달 ${counts.expenseCount}건 · ${won(counts.expenseSum)}` +
        (counts.noReceipt > 0 ? ` · 영수증 없음 ${counts.noReceipt}` : ''),
      warn: counts.noReceipt > 0,
    };
  };

  return (
    <div>
      <PageHeader title="회계" subtitle="원가 · 수익배분 · 지출결의서" />

      <div className="mx-auto max-w-3xl px-4 py-4">
        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} onRetry={() => void load()} />
          </div>
        )}

        <div className="space-y-2.5">
          {CARDS.map((c) => {
            const fact = factOf(c.href);
            return (
              <Link
                key={c.href}
                href={c.href}
                className="card flex items-start gap-3 p-4 transition hover:border-brand-300"
              >
                <span className="mt-0.5 shrink-0 rounded-xl bg-raised p-2 text-neutral-600">
                  <Icon name={c.icon} size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold">{c.label}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-neutral-500">{c.desc}</span>
                  {counts === null ? (
                    <Skeleton className="mt-1.5 h-3.5 w-32" />
                  ) : (
                    fact && (
                      <span
                        className={`mt-1.5 block text-[12px] font-bold ${
                          fact.warn ? 'text-red-600' : 'text-neutral-600'
                        }`}
                      >
                        {fact.text}
                      </span>
                    )
                  )}
                </span>
                <span className="mt-1 shrink-0 text-neutral-300">
                  <Icon name="chevronDown" size={15} className="-rotate-90" />
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
