'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { uploadFile } from '@/lib/upload';
import { logActivity } from '@/lib/log';
import { ConfirmDialog, ErrorBanner, Sheet } from '@/components/ui';
import type { AppSample } from '@/lib/types';

/**
 * 프로그램 샘플 이미지 — 제안서·블로그에 쓸 "이 수업 하면 이런 게 나온다" 예시.
 * 수업 현장 사진(갤러리 앨범)과는 목적이 다르므로 프로그램에 직접 붙인다.
 */
export function SampleImages({ appId, appSlug }: { appId: string; appSlug: string }) {
  const { session } = useSession();
  const [items, setItems] = useState<AppSample[] | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState('');
  const [viewing, setViewing] = useState<AppSample | null>(null);
  const [caption, setCaption] = useState('');
  const [deleting, setDeleting] = useState<AppSample | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('app_samples')
      .select('*')
      .eq('app_id', appId)
      .order('sort_order')
      .order('created_at');
    setItems((data ?? []) as AppSample[]);
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onFiles = async (picked: File[]) => {
    if (picked.length === 0) return;
    setError('');
    let ok = 0;
    const base = items?.length ?? 0;
    for (let i = 0; i < picked.length; i++) {
      setUploading(`올리는 중… ${i + 1}/${picked.length}`);
      try {
        const up = await uploadFile('moalab-gallery', picked[i], `sample-${appId}`);
        const { error: e } = await supabase
          .from('app_samples')
          .insert({ app_id: appId, url: up.url, sort_order: base + i });
        if (e) throw e;
        ok++;
      } catch (e) {
        setError(friendlyError(e, `${i + 1}번째 사진을 올리지 못했어요.`));
      }
    }
    setUploading('');
    if (inputRef.current) inputRef.current.value = '';
    if (ok > 0) {
      logActivity(session?.id, `${appSlug} 샘플 이미지 ${ok}장 추가`, `app:${appId}`);
      await load();
    }
  };

  const saveCaption = async () => {
    if (!viewing) return;
    const { error: e } = await supabase
      .from('app_samples')
      .update({ caption: caption.trim() || null })
      .eq('id', viewing.id);
    if (e) {
      setError(friendlyError(e));
      return;
    }
    setItems((v) => v?.map((x) => (x.id === viewing.id ? { ...x, caption: caption.trim() || null } : x)) ?? null);
    setViewing(null);
  };

  const remove = async (s: AppSample) => {
    setDeleting(null);
    setViewing(null);
    const { error: e } = await supabase.from('app_samples').delete().eq('id', s.id);
    if (e) {
      setError(friendlyError(e, '삭제하지 못했어요. 다시 눌러주세요.'));
      return;
    }
    await load();
  };

  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} />}

      <input
        id={`samples-${appId}`}
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => void onFiles(Array.from(e.target.files ?? []))}
        className="hidden"
      />

      {items === null ? (
        <div className="grid grid-cols-3 gap-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton aspect-square w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <label
          htmlFor={`samples-${appId}`}
          className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed
                     border-neutral-300 bg-neutral-50/60 px-4 py-7 text-center"
        >
          <span className="text-2xl">🖼️</span>
          <span className="mt-1.5 text-[13px] font-semibold text-neutral-500">
            {uploading || '예시 작품 사진을 올려주세요'}
          </span>
          <span className="mt-0.5 text-[11.5px] leading-relaxed text-neutral-400">
            제안서·블로그에 바로 쓸 사진이에요
          </span>
        </label>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-1.5">
            {items.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setViewing(s);
                  setCaption(s.caption ?? '');
                }}
                className="relative aspect-square overflow-hidden rounded-lg bg-neutral-100"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt={s.caption ?? ''} loading="lazy" className="h-full w-full object-cover" />
                {s.caption && (
                  <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-3 text-left text-[10px] text-white">
                    {s.caption}
                  </span>
                )}
              </button>
            ))}
            <label
              htmlFor={`samples-${appId}`}
              className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg
                         border border-dashed border-neutral-300 text-neutral-400"
            >
              <span className="text-xl leading-none">＋</span>
              <span className="mt-0.5 text-[10.5px]">추가</span>
            </label>
          </div>
          {uploading && <p className="text-[12.5px] text-neutral-500">{uploading}</p>}
        </>
      )}

      <Sheet
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        title="샘플 이미지"
        footer={
          <button onClick={saveCaption} className="btn-primary w-full">
            저장
          </button>
        }
      >
        {viewing && (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl bg-neutral-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={viewing.url} alt={viewing.caption ?? ''} className="max-h-[46vh] w-full object-contain" />
            </div>
            <div>
              <label className="label" htmlFor="sample-caption">
                설명
              </label>
              <input
                id="sample-caption"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="밀랍초 완성 작품"
                className="field"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <a href={viewing.url} target="_blank" rel="noreferrer" className="btn-ghost">
                원본 열기 ↗
              </a>
              <button onClick={() => setDeleting(viewing)} className="btn-ghost text-red-600">
                삭제
              </button>
            </div>
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="이 샘플 이미지를 지울까요?"
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove(deleting)}
      />
    </div>
  );
}
