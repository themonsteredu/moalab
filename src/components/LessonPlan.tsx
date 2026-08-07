'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { uploadFile } from '@/lib/upload';
import { logActivity } from '@/lib/log';
import { downloadFilesAsZip, safeFileName } from '@/lib/zip';
import { ConfirmDialog, ErrorBanner, Sheet } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { shortTime } from '@/lib/format';
import type { PlanFile } from '@/lib/types';

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];

function extOf(name: string): string {
  return (name.split('.').pop() ?? '').toLowerCase();
}

/** 브라우저가 그대로 열 수 있는 것만 미리보기 */
function previewKind(name: string): 'image' | 'pdf' | 'none' {
  const e = extOf(name);
  if (IMAGE_EXT.includes(e)) return 'image';
  if (e === 'pdf') return 'pdf';
  return 'none';
}

/** 확장자를 색 있는 라벨로 — 뭐가 들었는지 바로 보인다 */
function FileBadge({ name, size = 36 }: { name: string; size?: number }) {
  const ext = extOf(name);
  const tone =
    ext === 'pdf'
      ? 'bg-red-50 text-red-600'
      : ['hwp', 'hwpx', 'doc', 'docx'].includes(ext)
        ? 'bg-blue-50 text-blue-600'
        : ['ppt', 'pptx'].includes(ext)
          ? 'bg-orange-50 text-orange-600'
          : ['xls', 'xlsx', 'csv'].includes(ext)
            ? 'bg-green-50 text-green-700'
            : IMAGE_EXT.includes(ext)
              ? 'bg-purple-50 text-purple-600'
              : 'bg-neutral-100 text-neutral-500';
  return (
    <span
      style={{ width: size, height: size }}
      className={`flex shrink-0 items-center justify-center rounded-lg text-[9.5px] font-bold uppercase ${tone}`}
    >
      {ext.slice(0, 4) || 'FILE'}
    </span>
  );
}

function humanSize(n: number | null): string {
  if (!n) return '';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * 수업계획안 — 파일 첨부 전용.
 * 지도안·활동지·PPT 를 이 프로그램 페이지에서 올리고, 미리보고, 한꺼번에 받는다.
 */
export function LessonPlan({
  appId,
  appSlug,
  appTitle,
}: {
  appId: string;
  appSlug: string;
  appTitle: string;
}) {
  const { session } = useSession();
  const [files, setFiles] = useState<PlanFile[] | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState('');
  const [zipping, setZipping] = useState('');
  const [deleting, setDeleting] = useState<PlanFile | null>(null);
  const [preview, setPreview] = useState<PlanFile | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('plan_files').select('*').eq('app_id', appId).order('created_at');
    setFiles((data ?? []) as PlanFile[]);
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onFiles = async (picked: File[]) => {
    if (picked.length === 0) return;
    setError('');
    let ok = 0;
    for (let i = 0; i < picked.length; i++) {
      setUploading(`올리는 중… ${i + 1}/${picked.length}`);
      try {
        const up = await uploadFile('moalab-plans', picked[i], `app-${appId}`);
        const { error: e } = await supabase
          .from('plan_files')
          .insert({ app_id: appId, file_url: up.url, file_name: up.name, file_size: up.size });
        if (e) throw e;
        ok++;
      } catch (e) {
        setError(friendlyError(e, `${picked[i].name} 을 올리지 못했어요.`));
      }
    }
    setUploading('');
    if (inputRef.current) inputRef.current.value = '';
    if (ok > 0) {
      logActivity(session?.id, `${appSlug} 수업계획안 파일 ${ok}개 추가`, `app:${appId}`);
      await load();
    }
  };

  const downloadAll = async () => {
    if (!files || files.length === 0) return;
    setError('');
    setZipping(`묶는 중… 0/${files.length}`);
    try {
      await downloadFilesAsZip(
        files.map((f) => ({ url: f.file_url, name: f.file_name })),
        safeFileName(`${appTitle}_수업계획안`),
        (d, t) => setZipping(`묶는 중… ${d}/${t}`),
      );
      logActivity(session?.id, `${appSlug} 수업계획안 전체 다운로드`, `app:${appId}`);
    } catch (e) {
      setError(friendlyError(e, '다운로드가 안 됐어요. 다시 눌러주세요.'));
    } finally {
      setZipping('');
    }
  };

  const remove = async (f: PlanFile) => {
    setDeleting(null);
    setPreview(null);
    const { error: e } = await supabase.from('plan_files').delete().eq('id', f.id);
    if (e) {
      setError(friendlyError(e, '삭제하지 못했어요. 다시 눌러주세요.'));
      return;
    }
    await load();
  };

  const kind = preview ? previewKind(preview.file_name) : 'none';

  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} />}

      <input
        id={`plan-files-${appId}`}
        ref={inputRef}
        type="file"
        multiple
        onChange={(e) => void onFiles(Array.from(e.target.files ?? []))}
        className="hidden"
      />

      {files === null ? (
        <div className="skeleton h-16 w-full" />
      ) : files.length === 0 ? (
        <label
          htmlFor={`plan-files-${appId}`}
          className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed
                     border-neutral-300 bg-raised px-4 py-7 text-center transition hover:border-brand-300"
        >
          <Icon name="clip" size={22} className="text-neutral-300" />
          <span className="mt-1.5 text-[13.5px] font-semibold text-neutral-600">
            {uploading || '지도안 · 활동지 · PPT 를 올려주세요'}
          </span>
          <span className="mt-0.5 text-[11.5px] text-neutral-400">한글 · PDF · PPT · 엑셀 · 이미지</span>
        </label>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <p className="flex-1 text-[13px] font-bold text-neutral-600">
              첨부 파일 <span className="text-brand">{files.length}</span>
            </p>
            <button onClick={downloadAll} disabled={Boolean(zipping)} className="btn-ghost h-9 px-3 text-[12.5px]">
              <Icon name="download" size={14} />
              {zipping || '전체 다운로드'}
            </button>
            <label htmlFor={`plan-files-${appId}`} className="btn-primary h-9 cursor-pointer px-3 text-[12.5px]">
              <Icon name="plus" size={14} />
              {uploading || '추가'}
            </label>
          </div>

          <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-2.5 bg-surface px-3 py-2.5">
                <FileBadge name={f.file_name} />
                <button onClick={() => setPreview(f)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-[13.5px] font-semibold text-neutral-800">
                    {f.file_name}
                  </span>
                  <span className="text-[11.5px] text-neutral-400">
                    {humanSize(f.file_size)} · {shortTime(f.created_at)}
                  </span>
                </button>
                <button
                  onClick={() => setPreview(f)}
                  aria-label={`${f.file_name} 미리보기`}
                  className="tap w-8 shrink-0 text-neutral-400 hover:text-brand"
                >
                  <Icon name="search" size={15} />
                </button>
                <a
                  href={f.file_url}
                  download={f.file_name}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${f.file_name} 내려받기`}
                  className="tap w-8 shrink-0 text-neutral-400 hover:text-brand"
                >
                  <Icon name="download" size={15} />
                </a>
                <button
                  onClick={() => setDeleting(f)}
                  aria-label={`${f.file_name} 삭제`}
                  className="tap w-8 shrink-0 text-neutral-300 hover:text-red-500"
                >
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* 미리보기 */}
      <Sheet
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.file_name ?? '미리보기'}
        footer={
          preview ? (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setDeleting(preview)} className="btn-ghost text-red-600">
                삭제
              </button>
              <a
                href={preview.file_url}
                download={preview.file_name}
                target="_blank"
                rel="noreferrer"
                className="btn-primary"
              >
                <Icon name="download" size={15} />
                내려받기
              </a>
            </div>
          ) : undefined
        }
      >
        {preview && (
          <div>
            {kind === 'image' ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={preview.file_url}
                alt={preview.file_name}
                className="max-h-[62vh] w-full rounded-xl bg-raised object-contain"
              />
            ) : kind === 'pdf' ? (
              <object
                data={preview.file_url}
                type="application/pdf"
                className="h-[62vh] w-full rounded-xl border border-neutral-200 bg-raised"
              >
                <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                  <FileBadge name={preview.file_name} size={44} />
                  <p className="text-[13px] text-neutral-500">
                    이 브라우저에서는 PDF 를 바로 못 열어요. 내려받아서 봐주세요.
                  </p>
                </div>
              </object>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-neutral-300 bg-raised px-6 py-12 text-center">
                <FileBadge name={preview.file_name} size={48} />
                <p className="text-[14px] font-semibold text-neutral-700">
                  {extOf(preview.file_name).toUpperCase()} 는 화면에서 바로 못 열어요
                </p>
                <p className="text-[12.5px] leading-relaxed text-neutral-400">
                  아래 <b>내려받기</b>를 눌러 한글·오피스에서 열어주세요.
                </p>
              </div>
            )}
            <p className="mt-2.5 text-center text-[11.5px] text-neutral-400">
              {humanSize(preview.file_size)} · {shortTime(preview.created_at)}
            </p>
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`'${deleting?.file_name ?? ''}' 을 지울까요?`}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove(deleting)}
      />
    </div>
  );
}
