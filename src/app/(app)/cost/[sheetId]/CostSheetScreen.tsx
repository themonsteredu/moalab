'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { logActivity } from '@/lib/log';
import { buildShoppingList, calcItem, calcSheet, categoryColor, categoryLabel } from '@/lib/cost';
import { won, won1 } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { CostItemForm, type EditingItem } from '@/components/CostItemForm';
import { CostChart } from '@/components/CostChart';
import { Icon } from '@/components/Icon';
import { CardSkeleton, ConfirmDialog, EmptyState, ErrorBanner, Sheet, useToast } from '@/components/ui';
import type { CostItem, CostItemPhoto, CostSheet } from '@/lib/types';

export default function CostSheetScreen() {
  const { sheetId } = useParams<{ sheetId: string }>();
  const router = useRouter();
  const { session } = useSession();
  const toast = useToast();

  const [sheet, setSheet] = useState<CostSheet | null>(null);
  const [items, setItems] = useState<CostItem[]>([]);
  const [photos, setPhotos] = useState<CostItemPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 인원수·판매가는 화면에서 즉시 반응해야 하므로 로컬 상태로 둔다 (저장은 명시적 버튼)
  const [headcount, setHeadcount] = useState(20);
  const [salePrice, setSalePrice] = useState(0);
  const [saving, setSaving] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EditingItem | null>(null);
  const [deleting, setDeleting] = useState<CostItem | null>(null);
  const [shopOpen, setShopOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [delSheetOpen, setDelSheetOpen] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const { data: s, error: sErr } = await supabase
        .from('cost_sheets')
        .select('*')
        .eq('id', sheetId)
        .maybeSingle();
      if (sErr) throw sErr;
      if (!s) {
        setError('원가표를 찾지 못했어요.');
        setLoading(false);
        return;
      }
      setSheet(s as CostSheet);
      setHeadcount(s.headcount ?? 20);
      setSalePrice(Number(s.sale_price) || 0);

      const { data: its } = await supabase
        .from('cost_items')
        .select('*')
        .eq('sheet_id', sheetId)
        .order('sort_order');
      const list = (its ?? []) as CostItem[];
      setItems(list);

      if (list.length > 0) {
        const { data: ph } = await supabase
          .from('cost_item_photos')
          .select('*')
          .in('item_id', list.map((i) => i.id));
        setPhotos((ph ?? []) as CostItemPhoto[]);
      } else {
        setPhotos([]);
      }
    } catch (e) {
      setError(friendlyError(e, '원가표를 불러오지 못했어요. 다시 시도해주세요.'));
    } finally {
      setLoading(false);
    }
  }, [sheetId]);

  useEffect(() => {
    void load();
  }, [load]);

  const photosOf = useCallback((itemId: string) => photos.filter((p) => p.item_id === itemId), [photos]);

  const totals = useMemo(() => calcSheet(items, headcount, salePrice), [items, headcount, salePrice]);
  const shopping = useMemo(() => buildShoppingList(items, headcount), [items, headcount]);

  const dirty = sheet ? headcount !== sheet.headcount || salePrice !== Number(sheet.sale_price) : false;

  const saveSettings = async () => {
    setSaving(true);
    const { error: e } = await supabase
      .from('cost_sheets')
      .update({ headcount, sale_price: salePrice, updated_at: new Date().toISOString() })
      .eq('id', sheetId);
    setSaving(false);
    if (e) {
      setError(friendlyError(e));
      return;
    }
    setSheet((s) => (s ? { ...s, headcount, sale_price: salePrice } : s));
    logActivity(session?.id, `${sheet?.title} 인원/판매가 저장 (${headcount}명)`, `sheet:${sheetId}`);
    toast.show('저장했어요.');
  };

  const removeItem = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    const { error: e } = await supabase.from('cost_items').delete().eq('id', target.id);
    if (e) {
      setError(friendlyError(e, '삭제하지 못했어요. 다시 눌러주세요.'));
      return;
    }
    toast.show('지웠어요.');
    await load();
  };

  const duplicate = async () => {
    setDupOpen(false);
    if (!sheet) return;
    try {
      const { data: ns, error: e } = await supabase
        .from('cost_sheets')
        .insert({
          app_id: sheet.app_id,
          title: `${sheet.title} (복제)`,
          headcount: sheet.headcount,
          sale_price: sheet.sale_price,
        })
        .select()
        .single();
      if (e) throw e;

      if (items.length > 0) {
        const { data: newItems, error: e2 } = await supabase
          .from('cost_items')
          .insert(
            items.map(({ id: _id, sheet_id: _s, ...rest }) => ({ ...rest, sheet_id: ns.id })),
          )
          .select();
        if (e2) throw e2;

        // 사진도 같이 복제 (같은 파일 URL 을 참조)
        const rows: { item_id: string; photo_url: string }[] = [];
        (newItems ?? []).forEach((ni, idx) => {
          for (const p of photosOf(items[idx].id)) rows.push({ item_id: ni.id, photo_url: p.photo_url });
        });
        if (rows.length > 0) await supabase.from('cost_item_photos').insert(rows);
      }

      logActivity(session?.id, `원가표 복제 — ${sheet.title}`, `sheet:${ns.id}`);
      router.push(`/cost/${ns.id}`);
    } catch (e) {
      setError(friendlyError(e, '복제하지 못했어요. 다시 눌러주세요.'));
    }
  };

  const deleteSheet = async () => {
    setDelSheetOpen(false);
    const { error: e } = await supabase.from('cost_sheets').delete().eq('id', sheetId);
    if (e) {
      setError(friendlyError(e));
      return;
    }
    logActivity(session?.id, `원가표 삭제 — ${sheet?.title}`, null);
    router.push('/cost');
  };

  /** 카톡에 그대로 붙여넣을 수 있는 텍스트 */
  const kakaoText = useMemo(() => {
    if (!sheet) return '';
    const lines: string[] = [
      `[${sheet.title}]`,
      `참여 인원 ${headcount}명`,
      '',
      ...items.map((it) => {
        const c = calcItem(it, headcount);
        return `· ${it.name}${it.spec ? ` (${it.spec})` : ''} — 1인 ${won1(c.perPerson)}원`;
      }),
      '',
      `1인당 원가 ${won(totals.perPerson)}원`,
      `총 원가 ${won(totals.total)}원`,
    ];
    if (salePrice > 0) {
      lines.push(
        `판매 단가 ${won(salePrice)}원`,
        `마진 ${won(totals.margin)}원 (${totals.marginRate?.toFixed(1) ?? '-'}%)`,
      );
    }
    return lines.join('\n');
  }, [sheet, items, headcount, salePrice, totals]);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show(`${label} 복사했어요.`);
    } catch {
      toast.show('복사가 안 됐어요. 길게 눌러 직접 복사해주세요.');
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader title="불러오는 중" back="/cost" />
        <div className="px-4 py-4">
          <CardSkeleton rows={4} />
        </div>
      </>
    );
  }

  if (!sheet) {
    return (
      <>
        <PageHeader title="원가계산서" back="/cost" />
        <div className="px-4 py-4">
          <ErrorBanner message={error || '원가표를 찾지 못했어요.'} onRetry={() => void load()} />
        </div>
      </>
    );
  }

  const marginNegative = totals.marginRate != null && totals.marginRate < 0;

  return (
    <>
      <PageHeader
        title={sheet.title}
        subtitle={`${items.length}개 항목`}
        back="/cost"
        right={
          <button onClick={() => setFormOpen(true)} className="btn-primary h-10 px-3.5 text-[14px]">
            + 항목
          </button>
        }
      />

      {/* 요약 바(최대 ~230px)가 마지막 버튼을 덮지 않도록 여유를 둔다 */}
      <div className="space-y-4 px-4 pb-[280px] pt-3">
        {error && <ErrorBanner message={error} onRetry={() => void load()} />}

        {items.length === 0 ? (
          <EmptyState
            icon="receipt"
            title="아직 항목이 없어요"
            desc="재료비·AI API비·강사비를 하나씩 넣어보세요."
            action={
              <button onClick={() => setFormOpen(true)} className="btn-primary px-5">
                첫 항목 추가
              </button>
            }
          />
        ) : (
          <>
            <div className="space-y-2.5">
              {items.map((it) => {
                const c = calcItem(it, headcount);
                const ph = photosOf(it.id);
                return (
                  <div key={it.id} className="card p-3.5">
                    <div className="flex gap-3">
                      {ph.length > 0 ? (
                        <a
                          href={ph[0].photo_url}
                          target="_blank"
                          rel="noreferrer"
                          className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-neutral-100"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={ph[0].photo_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                          {ph.length > 1 && (
                            <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 text-[10px] text-white">
                              +{ph.length - 1}
                            </span>
                          )}
                        </a>
                      ) : (
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-300">
                          <Icon name="image" size={17} />
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 truncate text-[15px] font-bold">{it.name}</p>
                          <span
                            className="chip shrink-0 text-white"
                            style={{ backgroundColor: categoryColor(it.category) }}
                          >
                            {categoryLabel(it.category)}
                          </span>
                        </div>

                        <p className="mt-0.5 truncate text-[12px] text-neutral-500">
                          {it.vendor ? `${it.vendor} · ` : ''}
                          {it.spec ? `${it.spec} · ` : ''}
                          {won(it.pack_price)}원
                          {!it.reusable && ` / ${it.pack_qty}개`}
                        </p>

                        <p className="mt-1.5 text-[13.5px] font-bold text-neutral-800">
                          1인 {won1(c.perPerson)}원
                          {it.reusable && (
                            <span className="ml-1.5 text-[12px] font-normal text-neutral-500">
                              (재사용 {it.reuse_count}회 · 1회 {won1(c.perUse ?? 0)}원)
                            </span>
                          )}
                        </p>

                        {it.memo && <p className="mt-1 text-[12px] text-neutral-400">{it.memo}</p>}
                      </div>
                    </div>

                    <div className="mt-2.5 flex gap-2">
                      {it.buy_url && (
                        <a
                          href={it.buy_url}
                          target="_blank"
                          rel="noreferrer"
                          className="h-9 flex-1 rounded-lg border border-neutral-300 text-center text-[13px] font-semibold leading-9 text-neutral-600"
                        >
                          구매처
                        </a>
                      )}
                      <button
                        onClick={() => {
                          setEditing({ item: it, photos: ph });
                          setFormOpen(true);
                        }}
                        className="h-9 flex-1 rounded-lg border border-neutral-300 text-[13px] font-semibold text-neutral-600"
                      >
                        수정
                      </button>
                      <button
                        onClick={() => setDeleting(it)}
                        className="h-9 rounded-lg border border-neutral-300 px-3 text-[13px] text-neutral-500"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <CostChart totals={totals} />

            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setShopOpen(true)} className="btn-ghost gap-1.5">
                <Icon name="cart" size={15} />
                구매 목록
              </button>
              <button onClick={() => copy(kakaoText, '원가 요약을')} className="btn-ghost gap-1.5">
                <Icon name="copy" size={15} />
                카톡용 복사
              </button>
              <button onClick={() => setDupOpen(true)} className="btn-ghost gap-1.5">
                <Icon name="doc" size={15} />
                원가표 복제
              </button>
              <button onClick={() => setDelSheetOpen(true)} className="btn-ghost text-red-600">
                원가표 삭제
              </button>
            </div>
          </>
        )}
      </div>

      {/* 하단 고정 요약 바 — 인원수를 바꾸면 즉시 다시 계산된다 */}
      <div className="fixed inset-x-0 bottom-[56px] z-30 border-t border-neutral-200 bg-surface/97 backdrop-blur safe-bottom">
        <div className="mx-auto max-w-3xl px-4 py-3">
          <div className="flex items-center gap-3">
            <label htmlFor="hc" className="shrink-0 text-[12.5px] font-bold text-neutral-600">
              인원
            </label>
            <input
              id="hc"
              type="range"
              min={1}
              max={60}
              value={headcount}
              onChange={(e) => setHeadcount(Number(e.target.value))}
              className="h-8 flex-1 accent-[#F26522]"
            />
            <input
              value={headcount}
              onChange={(e) => setHeadcount(Math.max(1, Math.min(999, Number(e.target.value.replace(/\D/g, '')) || 1)))}
              inputMode="numeric"
              aria-label="참여 인원수"
              className="h-9 w-14 rounded-lg border border-neutral-300 text-center text-[15px] font-bold"
            />
            <span className="shrink-0 text-[12.5px] text-neutral-500">명</span>
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-neutral-100 px-3 py-2">
              <p className="text-[10.5px] text-neutral-500">1인당 원가</p>
              <p className="text-[17px] font-black leading-tight tabular-nums">{won(totals.perPerson)}원</p>
            </div>
            <div className="rounded-xl bg-neutral-100 px-3 py-2">
              <p className="text-[10.5px] text-neutral-500">총 원가</p>
              <p className="text-[17px] font-black leading-tight tabular-nums">{won(totals.total)}원</p>
            </div>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <label htmlFor="sp" className="shrink-0 text-[12.5px] font-bold text-neutral-600">
              판매 단가
            </label>
            <input
              id="sp"
              value={salePrice || ''}
              onChange={(e) => setSalePrice(Number(e.target.value.replace(/\D/g, '')) || 0)}
              inputMode="numeric"
              placeholder="1500"
              className="h-9 w-24 rounded-lg border border-neutral-300 px-2 text-right text-[15px] font-bold"
            />
            <span className="shrink-0 text-[12.5px] text-neutral-500">원</span>
            <span
              className={`ml-auto text-right text-[13px] font-black tabular-nums ${
                marginNegative ? 'text-red-600' : 'text-neutral-800'
              }`}
            >
              마진 {won(totals.margin)}원
              {totals.marginRate != null && (
                <span className="ml-1">({totals.marginRate.toFixed(1)}%)</span>
              )}
            </span>
          </div>

          {dirty && (
            <button onClick={saveSettings} disabled={saving} className="btn-primary mt-2.5 h-10 w-full text-[14px]">
              {saving ? '저장 중…' : '인원·판매가 저장'}
            </button>
          )}
        </div>
      </div>

      <CostItemForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSaved={() => {
          toast.show('저장했어요.');
          void load();
        }}
        sheetId={sheetId}
        headcount={headcount}
        nextSortOrder={items.length}
        editing={editing}
      />

      {/* 구매 목록 */}
      <Sheet open={shopOpen} onClose={() => setShopOpen(false)} title={`구매 목록 (${headcount}명 기준)`}>
        {shopping.length === 0 ? (
          <p className="py-8 text-center text-[13.5px] text-neutral-400">살 물건이 없어요.</p>
        ) : (
          <div className="space-y-4">
            {shopping.map((g) => (
              <div key={g.vendor}>
                <div className="mb-2 flex items-baseline justify-between">
                  <p className="text-[15px] font-bold">{g.vendor}</p>
                  <p className="text-[13px] font-bold text-neutral-500">{won(g.subtotal)}원</p>
                </div>
                <div className="space-y-2">
                  {g.items.map(({ item, buyQty, buyCost }) => {
                    const ph = photosOf(item.id);
                    return (
                      <div key={item.id} className="flex items-center gap-3 rounded-xl border border-neutral-200 p-2.5">
                        {ph.length > 0 ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={ph[0].photo_url}
                            alt=""
                            loading="lazy"
                            className="h-12 w-12 shrink-0 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-300">
                            <Icon name="image" size={17} />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-semibold">{item.name}</p>
                          <p className="text-[12px] text-neutral-500">
                            {item.spec ? `${item.spec} · ` : ''}
                            {buyQty}묶음 · {won(buyCost)}원
                          </p>
                        </div>
                        {item.buy_url && (
                          <a
                            href={item.buy_url}
                            target="_blank"
                            rel="noreferrer"
                            className="tap shrink-0 px-2 text-[13px] font-bold text-brand"
                          >
                            링크
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            <button
              onClick={() =>
                copy(
                  shopping
                    .map(
                      (g) =>
                        `[${g.vendor}] ${won(g.subtotal)}원\n` +
                        g.items
                          .map(({ item, buyQty }) => `· ${item.name}${item.spec ? ` (${item.spec})` : ''} ${buyQty}묶음`)
                          .join('\n'),
                    )
                    .join('\n\n'),
                  '구매 목록을',
                )
              }
              className="btn-ghost w-full gap-1.5"
            >
              <Icon name="copy" size={15} />
              장보기 리스트 복사
            </button>
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`'${deleting?.name ?? ''}' 항목을 지울까요?`}
        onCancel={() => setDeleting(null)}
        onConfirm={removeItem}
      />
      <ConfirmDialog
        open={dupOpen}
        title="이 원가표를 복제할까요?"
        message="항목과 사진이 그대로 복사돼요."
        confirmLabel="복제"
        danger={false}
        onCancel={() => setDupOpen(false)}
        onConfirm={duplicate}
      />
      <ConfirmDialog
        open={delSheetOpen}
        title="원가표를 통째로 지울까요?"
        message="항목과 사진 기록이 모두 사라져요. 되돌릴 수 없어요."
        onCancel={() => setDelSheetOpen(false)}
        onConfirm={deleteSheet}
      />

      {toast.node}
    </>
  );
}
