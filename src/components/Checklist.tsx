'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { logActivity } from '@/lib/log';
import { recomputeAppStatus } from '@/lib/verify';
import { ErrorBanner } from '@/components/ui';
import { relTime } from '@/lib/format';
import { CHECK_ITEMS, type CheckResult, type CheckRow } from '@/lib/types';

const RESULTS: { value: CheckResult; label: string; on: string }[] = [
  { value: 'none', label: '미확인', on: 'bg-neutral-500 text-white' },
  { value: 'pass', label: '통과', on: 'bg-green-600 text-white' },
  { value: 'fail', label: '실패', on: 'bg-red-600 text-white' },
];

interface Draft {
  result: CheckResult;
  note: string;
}

/**
 * 검증자 한 명의 5항목 체크 카드.
 * 저장은 자동이 아니라 명시적 버튼 — 잘못 눌러서 날리는 사고를 막는다.
 * '실패'를 고르면 메모 없이는 저장되지 않는다.
 */
export function ReviewerChecklist({
  appId,
  appSlug,
  roundNo,
  roundId,
  memberId,
  memberName,
  rows,
  editable,
  onSaved,
}: {
  appId: string;
  appSlug: string;
  roundNo: number;
  roundId: string;
  memberId: string;
  memberName: string;
  rows: CheckRow[];
  editable: boolean;
  onSaved: () => void;
}) {
  const { session } = useSession();
  const [draft, setDraft] = useState<Record<number, Draft>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const initial = useMemo(() => {
    const map: Record<number, Draft> = {};
    for (let i = 1; i <= CHECK_ITEMS.length; i++) {
      const row = rows.find((r) => r.item_no === i);
      map[i] = { result: row?.result ?? 'none', note: row?.note ?? '' };
    }
    return map;
  }, [rows]);

  useEffect(() => {
    setDraft(initial);
    const latest = rows.reduce<string | null>(
      (acc, r) => (!acc || r.updated_at > acc ? r.updated_at : acc),
      null,
    );
    setSavedAt(latest);
  }, [initial, rows]);

  const dirty = useMemo(
    () =>
      Object.keys(initial).some(
        (k) =>
          initial[Number(k)].result !== draft[Number(k)]?.result ||
          (initial[Number(k)].note ?? '') !== (draft[Number(k)]?.note ?? ''),
      ),
    [initial, draft],
  );

  const set = (itemNo: number, patch: Partial<Draft>) => {
    setError('');
    setDraft((d) => ({ ...d, [itemNo]: { ...d[itemNo], ...patch } }));
  };

  const save = async () => {
    setError('');
    for (let i = 1; i <= CHECK_ITEMS.length; i++) {
      if (draft[i]?.result === 'fail' && !draft[i]?.note?.trim()) {
        setError(`${i}번 항목이 '실패'예요. 무엇이 문제인지 적어주셔야 저장돼요.`);
        return;
      }
    }

    setBusy(true);
    try {
      const now = new Date().toISOString();
      const payload = Object.entries(draft).map(([itemNo, d]) => ({
        round_id: roundId,
        member_id: memberId,
        item_no: Number(itemNo),
        result: d.result,
        note: d.result === 'fail' ? d.note.trim() : d.note.trim() || null,
        updated_at: now,
      }));

      const { error: upErr } = await supabase
        .from('checks')
        .upsert(payload, { onConflict: 'round_id,member_id,item_no' });
      if (upErr) throw upErr;

      await recomputeAppStatus(appId);

      // 무엇이 바뀌었는지 한 줄씩 로그로 남긴다 ("누가 했냐" 분쟁 방지)
      for (let i = 1; i <= CHECK_ITEMS.length; i++) {
        if (initial[i].result !== draft[i].result) {
          const label = RESULTS.find((r) => r.value === draft[i].result)?.label ?? draft[i].result;
          logActivity(session?.id, `${appSlug} ${roundNo}차 검증 항목${i} ${label}`, `app:${appId}`);
        }
      }

      setSavedAt(now);
      onSaved();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const passCount = Object.values(draft).filter((d) => d.result === 'pass').length;
  const failCount = Object.values(draft).filter((d) => d.result === 'fail').length;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[15px] font-bold">
            {memberName}
            {editable && <span className="ml-1.5 text-[12px] font-semibold text-brand">(나)</span>}
          </p>
          <p className="mt-0.5 text-[12px] text-neutral-500">
            통과 {passCount}/5
            {failCount > 0 && <span className="ml-1.5 font-semibold text-red-600">실패 {failCount}</span>}
            {savedAt && <span className="ml-1.5 text-neutral-400">· {relTime(savedAt)}</span>}
          </p>
        </div>
        {passCount === CHECK_ITEMS.length && <span className="chip bg-green-100 text-green-800">완료</span>}
      </div>

      <ul className="divide-y divide-neutral-100">
        {CHECK_ITEMS.map((label, idx) => {
          const no = idx + 1;
          const d = draft[no] ?? { result: 'none' as CheckResult, note: '' };
          return (
            <li key={no} className="px-4 py-3">
              <p className="mb-2 text-[14px] leading-snug text-neutral-800">
                <span className="mr-1.5 font-bold text-neutral-400">{no}</span>
                {label}
              </p>

              <div className="flex gap-1.5" role="group" aria-label={`${no}번 항목 결과`}>
                {RESULTS.map((r) => {
                  const on = d.result === r.value;
                  return (
                    <button
                      key={r.value}
                      type="button"
                      disabled={!editable}
                      aria-pressed={on}
                      onClick={() => set(no, { result: r.value })}
                      className={`tap flex-1 rounded-lg border text-[13.5px] font-bold transition ${
                        on ? `${r.on} border-transparent` : 'border-neutral-200 bg-white text-neutral-500'
                      } ${!editable ? 'opacity-70' : 'active:scale-[.97]'}`}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>

              {d.result === 'fail' &&
                (editable ? (
                  <textarea
                    value={d.note}
                    onChange={(e) => set(no, { note: e.target.value })}
                    rows={2}
                    placeholder="무엇이 문제인가요? (필수)"
                    className="field mt-2 resize-none border-red-300 focus:border-red-500 focus:ring-red-100"
                  />
                ) : (
                  d.note && (
                    <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[13px] leading-relaxed text-red-800">
                      {d.note}
                    </p>
                  )
                ))}
            </li>
          );
        })}
      </ul>

      {editable && (
        <div className="border-t border-neutral-100 p-3">
          {error && (
            <div className="mb-2.5">
              <ErrorBanner message={error} />
            </div>
          )}
          <button onClick={save} disabled={busy || !dirty} className="btn-primary w-full">
            {busy ? '저장 중…' : dirty ? '검증 결과 저장' : '저장됨'}
          </button>
        </div>
      )}
    </div>
  );
}
