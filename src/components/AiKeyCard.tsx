'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from '@/lib/session';
import { Icon } from '@/components/Icon';
import { ConfirmDialog, ErrorBanner } from '@/components/ui';

interface Status {
  configured: boolean;
  hint?: string | null;
  updated_at?: string | null;
  missing?: boolean;
  detail?: string;
}

/**
 * AI 키 등록·삭제 — 원장 전용, `말로 업무 넣기` 에만 쓰인다.
 *
 * **키는 화면으로 절대 안 내려온다.** 저장되는 표(`app_secrets`)는 PIN 과 똑같이
 * 브라우저에서 아예 못 붙게 잠가뒀고, 서버도 끝 4자리(hint)만 돌려준다.
 * 그래서 한 번 넣으면 다시 확인할 수 없고, 바꾸려면 새로 붙여넣는다.
 *
 * 이미 등록돼 있으면 한 줄로 접는다 — 다 끝난 설정이 관리 화면에서
 * 계속 자리를 먹으면 안 된다 (PushToggle 과 같은 판단).
 */
export function AiKeyCard() {
  const { session } = useSession();
  const [status, setStatus] = useState<Status | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [killing, setKilling] = useState(false);

  const headers = useCallback(
    () => ({ 'Content-Type': 'application/json', 'x-actor-id': session?.id ?? '' }),
    [session],
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/ai', { headers: headers() });
      setStatus((await res.json()) as Status);
    } catch {
      setStatus({ configured: false });
    }
  }, [headers]);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  const save = async () => {
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/settings/ai', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ key: value.trim() }),
      });
      const data = (await res.json()) as Status & { error?: string };
      if (!res.ok) throw new Error(data.error ?? '저장하지 못했어요.');
      setValue('');
      setEditing(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했어요.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setKilling(false);
    setError('');
    try {
      const res = await fetch('/api/settings/ai', { method: 'DELETE', headers: headers() });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? '지우지 못했어요.');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '지우지 못했어요.');
    }
  };

  if (!status) return null;

  // 등록돼 있고 고치는 중이 아니면 한 줄로
  if (status.configured && !editing) {
    return (
      <>
        <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-surface px-3.5 py-2">
          <Icon name="checkCircle" size={15} className="shrink-0 text-green-700" />
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-neutral-600">
            AI 키 등록됨 · <span className="text-neutral-400">····{status.hint}</span>
          </span>
          <button
            onClick={() => {
              setEditing(true);
              setValue('');
            }}
            className="-my-2 shrink-0 py-2 text-[12px] font-bold text-neutral-400"
          >
            바꾸기
          </button>
          <button
            onClick={() => setKilling(true)}
            className="-my-2 shrink-0 py-2 text-[12px] font-bold text-neutral-400"
          >
            삭제
          </button>
        </div>
        <ConfirmDialog
          open={killing}
          title="AI 키를 지울까요?"
          message="지우면 “말로 업무 넣기” 가 안 됩니다. 다른 기능은 그대로예요."
          onConfirm={() => void remove()}
          onCancel={() => setKilling(false)}
        />
      </>
    );
  }

  return (
    <section className="card p-3.5">
      <div className="flex items-start gap-2">
        <Icon name="wrench" size={16} className="mt-0.5 shrink-0 text-neutral-400" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-neutral-800">AI 키</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-neutral-500">
            <b>말로 업무 넣기</b> 에만 씁니다. console.anthropic.com 에서 만든 키를 붙여넣어 주세요.
          </p>
        </div>
      </div>

      {error && (
        <div className="mt-2.5">
          <ErrorBanner message={error} />
        </div>
      )}

      {status.missing && (
        <p className="mt-2.5 rounded-lg bg-yellow-50 px-3 py-2 text-[12px] leading-relaxed text-yellow-900">
          키를 담을 표가 아직 없어요. <b>supabase/schema.sql</b> 을 한 번 실행해주세요.
        </p>
      )}

      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        type="password"
        placeholder="sk-ant-..."
        aria-label="Anthropic API 키"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="field mt-2.5"
      />
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-neutral-400">
        키는 <b>서버에만 저장되고 화면으로 다시 내려오지 않습니다.</b> 넣은 뒤에는 끝 4자리만 보여요.
      </p>

      <div className="mt-2.5 flex gap-2">
        <button
          onClick={() => void save()}
          disabled={busy || !value.trim()}
          className="btn-primary h-11 flex-1 text-[13.5px]"
        >
          {busy ? '저장 중…' : '저장'}
        </button>
        {editing && (
          <button onClick={() => setEditing(false)} className="btn-ghost h-11 px-4 text-[13.5px]">
            취소
          </button>
        )}
      </div>
    </section>
  );
}
