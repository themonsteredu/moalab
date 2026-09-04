'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from '@/lib/session';
import { AI_MODELS, AI_MODEL_DEFAULT, resolveModel } from '@/lib/ai';
import { Icon } from '@/components/Icon';
import { ConfirmDialog, ErrorBanner } from '@/components/ui';

interface Status {
  configured: boolean;
  hint?: string | null;
  model?: string | null;
  updated_at?: string | null;
  missing?: boolean;
  detail?: string;
}

/**
 * AI 키 등록·삭제 + 쓸 모델 고르기 — 원장 전용, `말로 업무 넣기` 에만 쓰인다.
 *
 * **키는 화면으로 절대 안 내려온다.** 저장되는 표(`app_secrets`)는 PIN 과 똑같이
 * 브라우저에서 아예 못 붙게 잠가뒀고, 서버도 끝 4자리(hint)만 돌려준다.
 *
 * 모델은 **키를 다시 넣지 않고** 바꿀 수 있다 — 화면에 안 보이는 값을
 * 다시 찾아오게 하면 안 된다.
 */
export function AiKeyCard() {
  const { session } = useSession();
  const [status, setStatus] = useState<Status | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [model, setModel] = useState(AI_MODEL_DEFAULT);
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
      const s = (await res.json()) as Status;
      setStatus(s);
      setModel(resolveModel(s.model));
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
        body: JSON.stringify({ key: value.trim(), model }),
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

  /** 모델만 바꾸기 — 키는 건드리지 않는다 */
  const changeModel = async (next: string) => {
    const before = model;
    setModel(next);
    setError('');
    try {
      const res = await fetch('/api/settings/ai', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ model: next }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? '모델을 바꾸지 못했어요.');
      }
    } catch (e) {
      setModel(before);
      setError(e instanceof Error ? e.message : '모델을 바꾸지 못했어요.');
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

  const picked = AI_MODELS.find((m) => m.value === model) ?? AI_MODELS[AI_MODELS.length - 1];

  const modelPicker = (
    <div>
      <label className="label" htmlFor="ai-model">
        어떤 모델을 쓸까요
      </label>
      <select
        id="ai-model"
        value={model}
        onChange={(e) => (status.configured && !editing ? void changeModel(e.target.value) : setModel(e.target.value))}
        className="field"
      >
        {AI_MODELS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label} — {m.cost}
          </option>
        ))}
      </select>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-neutral-400">{picked.hint}</p>
    </div>
  );

  // 등록돼 있고 고치는 중이 아니면 한 줄 + 모델 고르기
  if (status.configured && !editing) {
    return (
      <>
        <section className="card p-3.5">
          <div className="flex items-center gap-2">
            <Icon name="checkCircle" size={15} className="shrink-0 text-green-700" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-neutral-600">
              AI 키 등록됨 · <span className="text-neutral-400">····{status.hint}</span>
            </span>
            <button
              onClick={() => {
                setEditing(true);
                setValue('');
              }}
              className="-my-3 flex min-h-[44px] shrink-0 items-center text-[12px] font-bold text-neutral-400"
            >
              바꾸기
            </button>
            <button
              onClick={() => setKilling(true)}
              className="-my-3 flex min-h-[44px] shrink-0 items-center text-[12px] font-bold text-neutral-400"
            >
              삭제
            </button>
          </div>

          {error && (
            <div className="mt-2.5">
              <ErrorBanner message={error} />
            </div>
          )}

          <div className="mt-3 border-t border-neutral-200 pt-3">{modelPicker}</div>
        </section>

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

      <div className="mt-3">{modelPicker}</div>

      <div className="mt-3 flex gap-2">
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
