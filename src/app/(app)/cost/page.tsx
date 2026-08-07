'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { logActivity } from '@/lib/log';
import { calcSheet } from '@/lib/cost';
import { won } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { CardSkeleton, EmptyState, ErrorBanner, Sheet } from '@/components/ui';
import type { AppRow, CostItem, CostSheet } from '@/lib/types';

interface Row {
  sheet: CostSheet;
  appTitle: string | null;
  perPerson: number;
  total: number;
  itemCount: number;
}

export default function CostListPage() {
  const router = useRouter();
  const { session } = useSession();

  const [rows, setRows] = useState<Row[] | null>(null);
  const [apps, setApps] = useState<AppRow[]>([]);
  const [error, setError] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [appId, setAppId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [sRes, aRes] = await Promise.all([
        supabase.from('cost_sheets').select('*').order('updated_at', { ascending: false }),
        supabase.from('apps').select('*').eq('archived', false).order('title_ko'),
      ]);
      if (sRes.error) throw sRes.error;

      const sheets = (sRes.data ?? []) as CostSheet[];
      const appList = (aRes.data ?? []) as AppRow[];
      setApps(appList);

      let itemsBySheet = new Map<string, CostItem[]>();
      if (sheets.length > 0) {
        const { data } = await supabase
          .from('cost_items')
          .select('*')
          .in('sheet_id', sheets.map((s) => s.id));
        for (const it of (data ?? []) as CostItem[]) {
          const list = itemsBySheet.get(it.sheet_id) ?? [];
          list.push(it);
          itemsBySheet.set(it.sheet_id, list);
        }
      }

      const titleOf = new Map(appList.map((a) => [a.id, a.title_ko]));
      setRows(
        sheets.map((sheet) => {
          const items = itemsBySheet.get(sheet.id) ?? [];
          const t = calcSheet(items, sheet.headcount, sheet.sale_price);
          return {
            sheet,
            appTitle: sheet.app_id ? (titleOf.get(sheet.app_id) ?? null) : null,
            perPerson: t.perPerson,
            total: t.total,
            itemCount: items.length,
          };
        }),
      );
    } catch (e) {
      setRows([]);
      setError(friendlyError(e, '원가표를 불러오지 못했어요. 다시 시도해주세요.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!title.trim()) {
      setError('원가표 이름을 입력해주세요.');
      return;
    }
    setBusy(true);
    try {
      const { data, error: e } = await supabase
        .from('cost_sheets')
        .insert({ title: title.trim(), app_id: appId || null, headcount: 20, sale_price: 0 })
        .select()
        .single();
      if (e) throw e;
      logActivity(session?.id, `원가표 생성 — ${title.trim()}`, `sheet:${data.id}`);
      setNewOpen(false);
      setTitle('');
      setAppId('');
      router.push(`/cost/${data.id}`);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="원가계산서"
        subtitle={rows ? `${rows.length}개` : undefined}
        right={
          <button onClick={() => setNewOpen(true)} className="btn-primary h-10 px-3.5 text-[14px]">
            + 새 원가표
          </button>
        }
      />

      <div className="space-y-3 px-4 pb-8 pt-3">
        {error && <ErrorBanner message={error} onRetry={() => void load()} />}

        {rows === null ? (
          <CardSkeleton rows={3} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="won"
            title="원가표가 아직 없어요"
            desc="프로그램 하나당 원가표 하나를 만들어 재료비·API비를 정리해보세요."
            action={
              <button onClick={() => setNewOpen(true)} className="btn-primary px-5">
                첫 원가표 만들기
              </button>
            }
          />
        ) : (
          rows.map((r) => (
            <Link key={r.sheet.id} href={`/cost/${r.sheet.id}`} className="card block p-4 active:bg-neutral-50">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[16px] font-bold">{r.sheet.title}</p>
                  <p className="mt-0.5 truncate text-[12px] text-neutral-500">
                    {r.appTitle ? `${r.appTitle} · ` : ''}
                    {r.sheet.headcount}명 기준 · 항목 {r.itemCount}개
                  </p>
                </div>
                <span className="chip shrink-0 bg-neutral-100 text-neutral-600">{r.sheet.headcount}명</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-neutral-50 px-3 py-2">
                  <p className="text-[11px] text-neutral-500">1인당 원가</p>
                  <p className="text-[16px] font-black">{won(r.perPerson)}원</p>
                </div>
                <div className="rounded-xl bg-neutral-50 px-3 py-2">
                  <p className="text-[11px] text-neutral-500">총 원가</p>
                  <p className="text-[16px] font-black">{won(r.total)}원</p>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>

      <Sheet
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="새 원가표"
        footer={
          <button onClick={create} disabled={busy} className="btn-primary w-full">
            {busy ? '만드는 중…' : '만들기'}
          </button>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="cs-title">
              원가표 이름
            </label>
            <input
              id="cs-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="제과제빵 원가표"
              className="field"
            />
          </div>
          <div>
            <label className="label" htmlFor="cs-app">
              연결할 프로그램 (선택)
            </label>
            <select id="cs-app" value={appId} onChange={(e) => setAppId(e.target.value)} className="field">
              <option value="">연결 안 함</option>
              {apps.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title_ko}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Sheet>
    </>
  );
}
