'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { uploadFile } from '@/lib/upload';
import { logActivity } from '@/lib/log';
import { ConfirmDialog, ErrorBanner } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { shortTime } from '@/lib/format';
import type { PlanFile } from '@/lib/types';

/** 확장자를 색 있는 작은 라벨로. 이모지보다 뭐가 들었는지 바로 보인다. */
function FileBadge({ name }: { name: string }) {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  const tone =
    ext === 'pdf'
      ? 'bg-red-50 text-red-600'
      : ['hwp', 'hwpx', 'doc', 'docx'].includes(ext)
        ? 'bg-blue-50 text-blue-600'
        : ['ppt', 'pptx'].includes(ext)
          ? 'bg-orange-50 text-orange-600'
          : ['xls', 'xlsx', 'csv'].includes(ext)
            ? 'bg-green-50 text-green-700'
            : ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)
              ? 'bg-purple-50 text-purple-600'
              : 'bg-neutral-100 text-neutral-500';
  return (
    <span
      className={`flex h-8 w-9 shrink-0 items-center justify-center rounded-md text-[9.5px] font-bold uppercase ${tone}`}
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
 * 수업계획안 — 프로그램 하나당 본문 1개 + 첨부파일 N개.
 * 지도안·활동지·PPT 를 이 프로그램 페이지 안에서 바로 올리고 받는다.
 * (예전엔 '제작 목적' 텍스트뿐이라 계획안이 딴 데 흩어져 있었다)
 */
export function LessonPlan({
  appId,
  appSlug,
  initialBody,
}: {
  appId: string;
  appSlug: string;
  initialBody: string | null;
}) {
  const { session } = useSession();
  const [body, setBody] = useState(initialBody ?? '');
  const [saved, setSaved] = useState(initialBody ?? '');
  const [files, setFiles] = useState<PlanFile[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState('');
  const [deleting, setDeleting] = useState<PlanFile | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('plan_files')
      .select('*')
      .eq('app_id', appId)
      .order('created_at');
    setFiles((data ?? []) as PlanFile[]);
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setBody(initialBody ?? '');
    setSaved(initialBody ?? '');
  }, [initialBody]);

  const dirty = body !== saved;

  const save = async () => {
    setBusy(true);
    setError('');
    const { error: e } = await supabase
      .from('apps')
      .update({ plan_body: body.trim() || null })
      .eq('id', appId);
    setBusy(false);
    if (e) {
      setError(friendlyError(e));
      return;
    }
    setSaved(body);
    logActivity(session?.id, `${appSlug} 수업계획안 저장`, `app:${appId}`);
  };

  const onFiles = async (picked: File[]) => {
    if (picked.length === 0) return;
    setError('');
    let ok = 0;
    for (let i = 0; i < picked.length; i++) {
      setUploading(`올리는 중… ${i + 1}/${picked.length}`);
      try {
        const up = await uploadFile('moalab-plans', picked[i], `app-${appId}`);
        const { error: e } = await supabase.from('plan_files').insert({
          app_id: appId,
          file_url: up.url,
          file_name: up.name,
          file_size: up.size,
        });
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

  const remove = async (f: PlanFile) => {
    setDeleting(null);
    const { error: e } = await supabase.from('plan_files').delete().eq('id', f.id);
    if (e) {
      setError(friendlyError(e, '삭제하지 못했어요. 다시 눌러주세요.'));
      return;
    }
    await load();
  };

  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} />}

      <div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={7}
          placeholder={
            '수업 흐름을 적어주세요.\n\n예)\n1. 도입 10분 — 밀랍초가 뭔지 이야기 나누기\n2. 전개 25분 — 앱으로 향 조합 설계\n3. 정리 10분 — 작품 사진 찍고 발표'
          }
          className="field resize-y leading-relaxed"
          aria-label="수업계획안 본문"
        />
        {dirty && (
          <button onClick={save} disabled={busy} className="btn-primary mt-2 w-full">
            {busy ? '저장 중…' : '수업계획안 저장'}
          </button>
        )}
      </div>

      {/* 첨부파일 */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[13px] font-bold text-neutral-600">
            첨부 파일 {files && files.length > 0 && <span className="text-brand">{files.length}</span>}
          </p>
          <label
            htmlFor={`plan-files-${appId}`}
            className="tap cursor-pointer px-2 text-[13px] font-bold text-brand"
          >
            {uploading || '+ 파일 올리기'}
          </label>
          <input
            id={`plan-files-${appId}`}
            ref={inputRef}
            type="file"
            multiple
            onChange={(e) => void onFiles(Array.from(e.target.files ?? []))}
            className="hidden"
          />
        </div>

        {files === null ? (
          <div className="skeleton h-12 w-full" />
        ) : files.length === 0 ? (
          <label
            htmlFor={`plan-files-${appId}`}
            className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed
                       border-neutral-300 bg-neutral-50/60 px-4 py-6 text-center"
          >
            <Icon name="clip" size={22} className="text-neutral-300" />
            <span className="mt-1.5 text-[13px] font-semibold text-neutral-500">
              지도안·활동지·PPT 를 올려두세요
            </span>
            <span className="mt-0.5 text-[11.5px] text-neutral-400">한글·PDF·PPT 다 됩니다</span>
          </label>
        ) : (
          <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-2.5 bg-white px-3 py-2.5">
                <FileBadge name={f.file_name} />
                <a
                  href={f.file_url}
                  target="_blank"
                  rel="noreferrer"
                  download={f.file_name}
                  className="min-w-0 flex-1"
                >
                  <span className="block truncate text-[13.5px] font-semibold text-neutral-800">
                    {f.file_name}
                  </span>
                  <span className="text-[11.5px] text-neutral-400">
                    {humanSize(f.file_size)} · {shortTime(f.created_at)}
                  </span>
                </a>
                <button
                  onClick={() => setDeleting(f)}
                  aria-label={`${f.file_name} 삭제`}
                  className="tap w-8 shrink-0 text-neutral-300 hover:text-red-500"
                >
                  <Icon name="close" size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`'${deleting?.file_name ?? ''}' 을 지울까요?`}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove(deleting)}
      />
    </div>
  );
}
