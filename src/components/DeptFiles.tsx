'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { logActivity } from '@/lib/log';
import { queueDrive, uploadFile } from '@/lib/upload';
import { relTime } from '@/lib/format';
import { Icon } from '@/components/Icon';
import { Collapsible, ConfirmDialog, ErrorBanner } from '@/components/ui';

interface DeptFile {
  id: string;
  dept_id: string;
  file_url: string;
  file_name: string;
  file_size: number | null;
  note: string | null;
  member_id: string | null;
  created_at: string;
}

/**
 * 부서 자료함 — 그 부서가 만든 자료를 부서에 붙여 올린다.
 *
 * **없던 자리다.** 지금까지 파일은 프로그램·공지·지출·앨범에만 붙었고,
 * 부서에 붙는 곳이 하나도 없어서 부서에 사람을 배정해놓고도 그 부서가 만든
 * 자료를 올릴 데가 없었다.
 *
 * **새 메뉴를 만들지 않는다** — 부서에 사람을 배정하는 화면이 이미 부서를 맨 위에
 * 두고 있어서 여기에 칸만 더한다 (`plan_files.kind` 로 강사교육 문서를 담은 것과
 * 같은 판단). 드라이브로는 `업무분장/{부서명}` 으로 간다.
 */
export function DeptFiles({ deptId, deptName }: { deptId: string; deptName: string }) {
  const { session } = useSession();
  const { nameOf } = useMembers();
  const [files, setFiles] = useState<DeptFile[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState<File[]>([]);
  const [killing, setKilling] = useState<DeptFile | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('dept_files')
      .select('*')
      .eq('dept_id', deptId)
      .order('created_at', { ascending: false });
    if (e) {
      setFiles([]);
      setError(friendlyError(e, '자료를 불러오지 못했어요.'));
      return;
    }
    setFiles((data ?? []) as DeptFile[]);
    setError('');
  }, [deptId]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async () => {
    if (pending.length === 0) return;
    setError('');
    /** 실패한 것만 남긴다 — 다시 눌렀을 때 성공한 것이 두 번 올라가면 안 된다 */
    const left: File[] = [];
    const copied: { url: string; name: string }[] = [];
    let ok = 0;

    for (let i = 0; i < pending.length; i++) {
      setBusy(`올리는 중… ${i + 1}/${pending.length}`);
      try {
        const up = await uploadFile('moalab-plans', pending[i], `dept-${deptId}`);
        const { error: e } = await supabase.from('dept_files').insert({
          dept_id: deptId,
          file_url: up.url,
          file_name: up.name,
          file_size: up.size,
          note: note.trim() || null,
          member_id: session?.id ?? null,
        });
        if (e) throw e;
        copied.push({ url: up.url, name: up.name });
        ok += 1;
      } catch (e) {
        left.push(pending[i]);
        setError(friendlyError(e, `${pending[i].name} 을 올리지 못했어요.`));
      }
    }

    setBusy('');
    setPending(left);
    if (inputRef.current && left.length === 0) inputRef.current.value = '';
    if (ok > 0) {
      setNote('');
      logActivity(session?.id, `${deptName} 자료 ${ok}개 올림`, `dept:${deptId}`);
      // 구글 드라이브에도 한 벌 — 업무분장/{부서} 폴더로 (연결 안 돼 있으면 서버가 조용히 넘긴다)
      queueDrive(session?.id, { kind: 'dept', files: copied, deptName, prefix: deptName });
      await load();
    }
  };

  const remove = async (f: DeptFile) => {
    setKilling(null);
    const { error: e } = await supabase.from('dept_files').delete().eq('id', f.id);
    if (e) return setError(friendlyError(e, '지우지 못했어요.'));
    logActivity(session?.id, `${deptName} 자료 삭제 — ${f.file_name}`, `dept:${deptId}`);
    await load();
  };

  const n = files?.length ?? 0;

  return (
    <div className="mt-2">
      <Collapsible
        id={`dept-files-${deptId}`}
        dense
        title="자료"
        badge={
          n > 0 ? (
            <span className="chip bg-neutral-100 text-neutral-600">{n}개</span>
          ) : (
            <span className="chip bg-neutral-100 text-neutral-400">없음</span>
          )
        }
      >
        {error && (
          <div className="mb-2">
            <ErrorBanner message={error} />
          </div>
        )}

        {files && files.length > 0 && (
          <ul className="mb-2 space-y-1.5">
            {files.map((f) => (
              <li key={f.id} className="flex items-start gap-2 rounded-lg bg-raised px-3 py-2">
                <span className="mt-1 w-9 shrink-0 truncate rounded bg-neutral-200 px-1 py-0.5 text-center text-[9.5px] font-bold uppercase text-neutral-600">
                  {f.file_name.includes('.') ? f.file_name.split('.').pop()!.slice(0, 4) : '파일'}
                </span>
                <span className="min-w-0 flex-1">
                  <a
                    href={f.file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="-my-2 flex min-h-[44px] items-center truncate text-[13.5px] font-semibold text-neutral-800 underline"
                  >
                    {f.file_name}
                  </a>
                  {f.note && <span className="block text-[12px] leading-snug text-neutral-600">{f.note}</span>}
                  <span className="block text-[11px] text-neutral-400">
                    {nameOf(f.member_id)} · {relTime(f.created_at)}
                  </span>
                </span>
                <button
                  onClick={() => setKilling(f)}
                  aria-label={`${f.file_name} 지우기`}
                  className="tap -my-2 w-9 shrink-0 text-neutral-400"
                >
                  <Icon name="trash" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* 올리기 — 무엇을 만든 자료인지 한 줄 적을 수 있게 */}
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => setPending(Array.from(e.target.files ?? []))}
        />
        {pending.length > 0 && (
          <div className="mb-2 space-y-2">
            <p className="text-[12.5px] font-semibold text-neutral-600">
              고른 파일 {pending.length}개
              <span className="ml-1 text-neutral-400">{pending.map((f) => f.name).join(', ')}</span>
            </p>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="무엇을 만든 자료인가요 (선택)"
              className="field text-[13px]"
            />
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={() => inputRef.current?.click()} disabled={!!busy} className="btn-ghost flex-1 text-[13.5px]">
            파일 고르기
          </button>
          {pending.length > 0 && (
            <button onClick={() => void upload()} disabled={!!busy} className="btn-primary flex-1 text-[13.5px]">
              {busy || `${pending.length}개 올리기`}
            </button>
          )}
        </div>
      </Collapsible>

      <ConfirmDialog
        open={!!killing}
        title="이 자료를 지울까요?"
        message={`${killing?.file_name ?? ''} — 목록에서 사라져요. 구글 드라이브에 이미 올라간 것은 그대로 남아요.`}
        confirmLabel="지우기"
        onConfirm={() => killing && void remove(killing)}
        onCancel={() => setKilling(null)}
      />
    </div>
  );
}
