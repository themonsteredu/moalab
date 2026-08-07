'use client';

import { useEffect, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { uploadMany } from '@/lib/upload';
import { calcItem } from '@/lib/cost';
import { won1 } from '@/lib/format';
import { ErrorBanner, Sheet } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { COST_CATEGORIES, type CostCategory, type CostItem, type CostItemPhoto } from '@/lib/types';

export interface EditingItem {
  item: CostItem;
  photos: CostItemPhoto[];
}

const EMPTY = {
  category: 'material' as CostCategory,
  name: '',
  vendor: '',
  buy_url: '',
  spec: '',
  pack_qty: '1',
  pack_price: '',
  qty_per_person: '1',
  reusable: false,
  reuse_count: '',
  memo: '',
};

export function CostItemForm({
  open,
  onClose,
  onSaved,
  sheetId,
  headcount,
  nextSortOrder,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  sheetId: string;
  headcount: number;
  nextSortOrder: number;
  editing?: EditingItem | null;
}) {
  const [f, setF] = useState(EMPTY);
  const [photos, setPhotos] = useState<CostItemPhoto[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setNewFiles([]);
    if (editing) {
      const i = editing.item;
      setF({
        category: i.category,
        name: i.name,
        vendor: i.vendor ?? '',
        buy_url: i.buy_url ?? '',
        spec: i.spec ?? '',
        pack_qty: String(i.pack_qty ?? 1),
        pack_price: String(i.pack_price ?? ''),
        qty_per_person: String(i.qty_per_person ?? 1),
        reusable: i.reusable,
        reuse_count: i.reuse_count == null ? '' : String(i.reuse_count),
        memo: i.memo ?? '',
      });
      setPhotos(editing.photos);
    } else {
      setF(EMPTY);
      setPhotos([]);
    }
  }, [open, editing]);

  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => {
    setError('');
    setF((s) => ({ ...s, [k]: v }));
  };

  // 입력하는 동안 1인당 단가를 바로 보여준다
  const preview = calcItem(
    {
      id: '',
      sheet_id: sheetId,
      category: f.category,
      name: f.name,
      vendor: null,
      buy_url: null,
      spec: null,
      pack_qty: Number(f.pack_qty) || 1,
      pack_price: Number(f.pack_price) || 0,
      qty_per_person: Number(f.qty_per_person) || 0,
      reusable: f.reusable,
      reuse_count: Number(f.reuse_count) || null,
      memo: null,
      sort_order: 0,
    },
    headcount,
  );

  const save = async () => {
    setError('');
    if (!f.name.trim()) return setError('품목명을 입력해주세요.');
    if (!f.pack_price || Number(f.pack_price) < 0) return setError('묶음 가격을 입력해주세요.');
    if (!f.reusable && (!f.pack_qty || Number(f.pack_qty) <= 0))
      return setError('묶음 수량은 1 이상이어야 해요.');
    if (f.reusable && (!f.reuse_count || Number(f.reuse_count) <= 0))
      return setError('재사용품은 몇 회 쓸 수 있는지(감가 회차)를 적어주세요.');
    if (f.buy_url.trim() && !/^https?:\/\//i.test(f.buy_url.trim()))
      return setError('구매 링크는 http:// 또는 https:// 로 시작해야 해요.');

    setBusy(true);
    try {
      const payload = {
        sheet_id: sheetId,
        category: f.category,
        name: f.name.trim(),
        vendor: f.vendor.trim() || null,
        buy_url: f.buy_url.trim() || null,
        spec: f.spec.trim() || null,
        pack_qty: Number(f.pack_qty) || 1,
        pack_price: Number(f.pack_price) || 0,
        qty_per_person: Number(f.qty_per_person) || 0,
        reusable: f.reusable,
        reuse_count: f.reusable ? Number(f.reuse_count) || 1 : null,
        memo: f.memo.trim() || null,
      };

      let itemId: string;
      if (editing) {
        const { error: e } = await supabase.from('cost_items').update(payload).eq('id', editing.item.id);
        if (e) throw e;
        itemId = editing.item.id;
      } else {
        const { data, error: e } = await supabase
          .from('cost_items')
          .insert({ ...payload, sort_order: nextSortOrder })
          .select()
          .single();
        if (e) throw e;
        itemId = data.id;
      }

      if (newFiles.length > 0) {
        setProgress(`사진 올리는 중… 0/${newFiles.length}`);
        const uploaded = await uploadMany('moalab-cost-photos', newFiles, `sheet-${sheetId}`, (d, t) =>
          setProgress(`사진 올리는 중… ${d}/${t}`),
        );
        const { error: e } = await supabase
          .from('cost_item_photos')
          .insert(uploaded.map((u) => ({ item_id: itemId, photo_url: u.url })));
        if (e) throw e;
      }

      await supabase.from('cost_sheets').update({ updated_at: new Date().toISOString() }).eq('id', sheetId);
      onSaved();
      onClose();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const removePhoto = async (photoId: string) => {
    setPhotos((p) => p.filter((x) => x.id !== photoId));
    await supabase.from('cost_item_photos').delete().eq('id', photoId);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? '항목 수정' : '원가 항목 추가'}
      footer={
        <button onClick={save} disabled={busy} className="btn-primary w-full">
          {busy ? '저장 중…' : '저장'}
        </button>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}
        {progress && <p className="text-[12.5px] text-neutral-500">{progress}</p>}

        <div>
          <span className="label">구분</span>
          <div className="flex flex-wrap gap-2">
            {COST_CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => set('category', c.value)}
                className={`tap rounded-full border px-3.5 text-[14px] font-semibold transition ${
                  f.category === c.value
                    ? 'border-transparent text-white'
                    : 'border-neutral-300 bg-white text-neutral-600'
                }`}
                style={f.category === c.value ? { backgroundColor: c.color } : undefined}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label" htmlFor="ci-name">
            품목명
          </label>
          <input
            id="ci-name"
            value={f.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="밀랍 100g"
            className="field"
          />
        </div>

        {/* 재료 사진 */}
        <div>
          <span className="label">재료 사진</span>
          <div className="flex flex-wrap gap-2">
            {photos.map((p) => (
              <div key={p.id} className="relative h-20 w-20 overflow-hidden rounded-xl bg-neutral-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.photo_url} alt="" className="h-full w-full object-cover" />
                <button
                  onClick={() => removePhoto(p.id)}
                  aria-label="사진 삭제"
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
            {newFiles.map((file, i) => (
              <div
                key={i}
                className="flex h-20 w-20 flex-col items-center justify-center rounded-xl border border-dashed border-brand-300 bg-brand-50 px-1 text-center"
              >
                <span className="text-[10px] leading-tight text-brand-700">올릴 예정</span>
                <button
                  onClick={() => setNewFiles((v) => v.filter((_, j) => j !== i))}
                  className="mt-1 text-[11px] text-neutral-500"
                >
                  빼기
                </button>
              </div>
            ))}
            <label
              htmlFor="ci-photos"
              className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white text-neutral-400"
            >
              <span className="text-xl leading-none">＋</span>
              <span className="mt-0.5 text-[10.5px]">사진</span>
            </label>
            <input
              id="ci-photos"
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setNewFiles((v) => [...v, ...Array.from(e.target.files ?? [])])}
              className="hidden"
            />
          </div>
          <p className="mt-1.5 text-[11.5px] text-neutral-400">구매처에서 캡처한 사진도 좋아요.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="ci-vendor">
              구매처명
            </label>
            <input
              id="ci-vendor"
              value={f.vendor}
              onChange={(e) => set('vendor', e.target.value)}
              placeholder="다이소"
              className="field"
            />
          </div>
          <div>
            <label className="label" htmlFor="ci-spec">
              규격
            </label>
            <input
              id="ci-spec"
              value={f.spec}
              onChange={(e) => set('spec', e.target.value)}
              placeholder="100g / 1박스"
              className="field"
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="ci-url">
            구매 링크
          </label>
          <input
            id="ci-url"
            value={f.buy_url}
            onChange={(e) => set('buy_url', e.target.value)}
            placeholder="https://..."
            inputMode="url"
            autoCapitalize="none"
            className="field"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="ci-packqty">
              묶음 수량
            </label>
            <input
              id="ci-packqty"
              value={f.pack_qty}
              onChange={(e) => set('pack_qty', e.target.value)}
              inputMode="decimal"
              placeholder="20"
              className="field"
            />
          </div>
          <div>
            <label className="label" htmlFor="ci-packprice">
              묶음 가격 (원)
            </label>
            <input
              id="ci-packprice"
              value={f.pack_price}
              onChange={(e) => set('pack_price', e.target.value)}
              inputMode="numeric"
              placeholder="12000"
              className="field"
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="ci-perperson">
            1인 사용량
          </label>
          <input
            id="ci-perperson"
            value={f.qty_per_person}
            onChange={(e) => set('qty_per_person', e.target.value)}
            inputMode="decimal"
            placeholder="1"
            className="field"
            disabled={f.reusable}
          />
        </div>

        <div className="rounded-xl border border-neutral-200 p-3.5">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={f.reusable}
              onChange={(e) => set('reusable', e.target.checked)}
              className="h-5 w-5 accent-[#F26522]"
            />
            <span className="text-[14.5px] font-semibold">재사용품 (드론, 태블릿 등)</span>
          </label>

          {f.reusable && (
            <div className="mt-3">
              <label className="label" htmlFor="ci-reuse">
                감가 회차 — 몇 번 쓸 수 있나요?
              </label>
              <input
                id="ci-reuse"
                value={f.reuse_count}
                onChange={(e) => set('reuse_count', e.target.value)}
                inputMode="numeric"
                placeholder="50"
                className="field"
              />
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-neutral-500">
                강사비·교통비처럼 수업 한 번에 통으로 나가는 돈은 재사용 + 감가 회차 <b>1</b>로 넣으면 돼요.
              </p>
            </div>
          )}
        </div>

        <div>
          <label className="label" htmlFor="ci-memo">
            메모
          </label>
          <input
            id="ci-memo"
            value={f.memo}
            onChange={(e) => set('memo', e.target.value)}
            placeholder="배송비 별도 / 최소주문 3만원"
            className="field"
          />
        </div>

        <div className="rounded-xl bg-brand-50 px-3.5 py-3">
          <p className="text-[12px] font-bold text-brand-700">{headcount}명 기준 미리보기</p>
          <p className="mt-1 text-[14px] font-semibold text-neutral-800">
            1인당 {won1(preview.perPerson)}원
            {preview.perUse != null && (
              <span className="ml-2 text-[13px] font-normal text-neutral-500">
                (1회당 {won1(preview.perUse)}원)
              </span>
            )}
          </p>
        </div>
      </div>
    </Sheet>
  );
}
