'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { logActivity } from '@/lib/log';
import { calcItem, calcSheet, categoryColor, categoryLabel } from '@/lib/cost';
import { won, won1 } from '@/lib/format';
import { ErrorBanner } from '@/components/ui';
import { Icon } from '@/components/Icon';
import type { CostItem, CostSheet } from '@/lib/types';

/**
 * 프로그램 페이지 안에서 보는 원가 요약.
 * 여기서 바로 숫자를 확인하고, 고칠 때만 원가표 화면으로 넘어간다.
 */
export function CostInline({
  appId,
  appTitle,
  appSlug,
}: {
  appId: string;
  appTitle: string;
  appSlug: string;
}) {
  const router = useRouter();
  const { session } = useSession();
  const [sheet, setSheet] = useState<CostSheet | null | undefined>(undefined);
  const [items, setItems] = useState<CostItem[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: s } = await supabase
      .from('cost_sheets')
      .select('*')
      .eq('app_id', appId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!s) {
      setSheet(null);
      setItems([]);
      return;
    }
    setSheet(s as CostSheet);
    const { data: its } = await supabase.from('cost_items').select('*').eq('sheet_id', s.id).order('sort_order');
    setItems((its ?? []) as CostItem[]);
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setError('');
    const { data, error: e } = await supabase
      .from('cost_sheets')
      .insert({ app_id: appId, title: `${appTitle} 원가표`, headcount: 20, sale_price: 0 })
      .select()
      .single();
    setBusy(false);
    if (e) {
      setError(friendlyError(e));
      return;
    }
    logActivity(session?.id, `${appSlug} 원가표 생성`, `sheet:${data.id}`);
    router.push(`/cost/${data.id}`);
  };

  if (sheet === undefined) return <div className="skeleton h-28 w-full" />;

  if (sheet === null) {
    return (
      <div className="space-y-3">
        {error && <ErrorBanner message={error} />}
        <button
          onClick={create}
          disabled={busy}
          className="flex w-full cursor-pointer flex-col items-center justify-center rounded-xl border
                     border-dashed border-neutral-300 bg-neutral-50/60 px-4 py-7 text-center"
        >
          <Icon name="won" size={24} className="text-neutral-300" />
          <span className="mt-1.5 text-[13px] font-semibold text-neutral-500">
            {busy ? '만드는 중…' : '원가표 만들기'}
          </span>
          <span className="mt-0.5 text-[11.5px] text-neutral-400">재료비·API비·강사비를 계산해요</span>
        </button>
      </div>
    );
  }

  const t = calcSheet(items, sheet.headcount, Number(sheet.sale_price) || 0);
  const negative = t.marginRate != null && t.marginRate < 0;

  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-2 gap-2">
        <Stat label={`1인당 원가 (${sheet.headcount}명)`} value={`${won(t.perPerson)}원`} />
        <Stat label="총 원가" value={`${won(t.total)}원`} />
      </div>

      {Number(sheet.sale_price) > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <Stat label="판매 단가" value={`${won(Number(sheet.sale_price))}원`} />
          <Stat
            label="마진율"
            value={t.marginRate != null ? `${t.marginRate.toFixed(1)}%` : '-'}
            tone={negative ? 'bad' : 'good'}
          />
        </div>
      )}

      {t.byCategory.length > 0 && (
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-neutral-100">
          {t.byCategory.map((c) => (
            <span
              key={c.category}
              title={`${c.label} ${won(c.total)}원`}
              style={{ width: `${c.ratio * 100}%`, backgroundColor: c.color }}
            />
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <p className="rounded-xl bg-neutral-50 px-3 py-3 text-center text-[12.5px] text-neutral-400">
          아직 원가 항목이 없어요.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200">
          {items.slice(0, 4).map((it) => {
            const c = calcItem(it, sheet.headcount);
            return (
              <li key={it.id} className="flex items-center gap-2 bg-white px-3 py-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: categoryColor(it.category) }}
                  title={categoryLabel(it.category)}
                />
                <span className="min-w-0 flex-1 truncate text-[13px] text-neutral-700">{it.name}</span>
                <span className="shrink-0 text-[12.5px] font-bold tabular-nums text-neutral-600">
                  {won1(c.perPerson)}원
                </span>
              </li>
            );
          })}
          {items.length > 4 && (
            <li className="bg-white px-3 py-2 text-center text-[12px] text-neutral-400">
              외 {items.length - 4}개
            </li>
          )}
        </ul>
      )}

      <Link href={`/cost/${sheet.id}`} className="btn-ghost w-full">
        원가표 자세히 보기 ›
      </Link>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-xl bg-neutral-50 px-3 py-2.5">
      <p className="truncate text-[11px] text-neutral-500">{label}</p>
      <p
        className={`text-[17px] font-black leading-tight tabular-nums ${
          tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-green-700' : 'text-neutral-900'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
