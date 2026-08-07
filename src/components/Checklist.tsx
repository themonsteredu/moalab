'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { logActivity } from '@/lib/log';
import { recomputeAppStatus } from '@/lib/verify';
import { uploadMany } from '@/lib/upload';
import { ErrorBanner } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { relTime } from '@/lib/format';
import {
  CHECK_ITEMS,
  type CheckFile,
  type CheckResult,
  type CheckRow,
  type ResponseState,
} from '@/lib/types';

const RESULTS: { value: CheckResult; label: string; on: string }[] = [
  { value: 'none', label: '미확인', on: 'bg-neutral-500 text-white' },
  { value: 'pass', label: '통과', on: 'bg-green-600 text-white' },
  { value: 'fail', label: '실패', on: 'bg-red-600 text-white' },
];

export const RESPONSE_META: Record<Exclude<ResponseState, 'none'>, { label: string; box: string; chip: string }> = {
  fixed: {
    label: '업데이트 완료',
    box: 'border-green-200 bg-green-50',
    chip: 'bg-green-100 text-green-800',
  },
  explained: {
    label: '제작자 사유',
    box: 'border-amber-200 bg-amber-50',
    chip: 'bg-amber-100 text-amber-800',
  },
};

interface Draft {
  result: CheckResult;
  note: string;
}

/**
 * 검증자 한 명의 5항목 체크 카드.
 * 저장은 자동이 아니라 명시적 버튼 — 잘못 눌러서 날리는 사고를 막는다.
 * '실패'를 고르면 메모 없이는 저장되지 않고, 캡처를 같이 붙일 수 있다.
 * 붙은 지적사항에는 제작자(또는 원장)가 "업데이트 완료" 또는 사유로 답한다.
 */
export function ReviewerChecklist({
  appId,
  appSlug,
  roundNo,
  roundId,
  memberId,
  memberName,
  rows,
  filesByCheck,
  editable,
  canRespond,
  nameOf,
  onSaved,
}: {
  appId: string;
  appSlug: string;
  roundNo: number;
  roundId: string;
  memberId: string;
  memberName: string;
  rows: CheckRow[];
  filesByCheck: Map<string, CheckFile[]>;
  editable: boolean;
  /** 제작자 또는 원장 — 지적사항에 답할 수 있다 */
  canRespond: boolean;
  nameOf: (id: string | null) => string;
  onSaved: () => void;
}) {
  const { session } = useSession();
  const [draft, setDraft] = useState<Record<number, Draft>>({});
  /** 아직 올리지 않은 캡처 (저장 눌러야 올라간다) */
  const [pending, setPending] = useState<Record<number, File[]>>({});
  /** 지울 캡처 id */
  const [removed, setRemoved] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  // 내 카드만 펼쳐둔다. 검증자 3명이면 5항목 × 3 = 화면이 너무 길어진다.
  const [open, setOpen] = useState(editable);

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
    setPending({});
    setRemoved([]);
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
      ) ||
      Object.values(pending).some((f) => f.length > 0) ||
      removed.length > 0,
    [initial, draft, pending, removed],
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

      // 캡처를 붙이려면 체크 행의 id 가 필요해서 저장 결과를 돌려받는다
      const { data: saved, error: upErr } = await supabase
        .from('checks')
        .upsert(payload, { onConflict: 'round_id,member_id,item_no' })
        .select('id,item_no');
      if (upErr) throw upErr;

      const idOf = new Map<number, string>((saved ?? []).map((r) => [r.item_no as number, r.id as string]));

      // 지적을 새로 걸거나 내용을 바꿨으면 이전 답변은 무효다.
      // (안 그러면 새 지적인데 "업데이트 완료"가 붙어 있어 아무도 안 본다)
      const reopen = Object.entries(draft)
        .filter(([itemNo, d]) => {
          const i = Number(itemNo);
          const changed =
            initial[i].result !== d.result || (initial[i].note ?? '') !== d.note.trim();
          const answered = rows.find((r) => r.item_no === i)?.response_state !== 'none';
          return d.result === 'fail' && changed && answered;
        })
        .map(([itemNo]) => idOf.get(Number(itemNo)))
        .filter((v): v is string => Boolean(v));

      if (reopen.length > 0) {
        const { error: rErr } = await supabase
          .from('checks')
          .update({ response: null, response_state: 'none', responded_by: null, responded_at: null })
          .in('id', reopen);
        if (rErr) throw rErr;
      }

      if (removed.length > 0) {
        const { error: delErr } = await supabase.from('check_files').delete().in('id', removed);
        if (delErr) throw delErr;
      }

      const toUpload = Object.entries(pending).filter(([, f]) => f.length > 0);
      const total = toUpload.reduce((s, [, f]) => s + f.length, 0);
      let done = 0;
      for (const [itemNo, list] of toUpload) {
        const checkId = idOf.get(Number(itemNo));
        if (!checkId) continue;
        setProgress(`캡처 올리는 중… ${done}/${total}`);
        const uploaded = await uploadMany('moalab-comment-files', list, `check-${appId}`, (d) =>
          setProgress(`캡처 올리는 중… ${done + d}/${total}`),
        );
        done += list.length;
        const { error: fErr } = await supabase
          .from('check_files')
          .insert(uploaded.map((u) => ({ check_id: checkId, file_url: u.url, file_name: u.name })));
        if (fErr) throw fErr;
      }

      await recomputeAppStatus(appId);

      // 무엇이 바뀌었는지 한 줄씩 로그로 남긴다 ("누가 했냐" 분쟁 방지)
      for (let i = 1; i <= CHECK_ITEMS.length; i++) {
        if (initial[i].result !== draft[i].result) {
          const label = RESULTS.find((r) => r.value === draft[i].result)?.label ?? draft[i].result;
          logActivity(session?.id, `${appSlug} ${roundNo}차 검증 항목${i} ${label}`, `app:${appId}`);
        }
      }

      setSavedAt(now);
      setPending({});
      setRemoved([]);
      onSaved();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const passCount = Object.values(draft).filter((d) => d.result === 'pass').length;
  const failCount = Object.values(draft).filter((d) => d.result === 'fail').length;
  /** 아직 답 안 한 지적사항 — 제작자가 볼 신호 */
  const waiting = rows.filter((r) => r.result === 'fail' && r.response_state === 'none').length;

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left ${
          open ? 'border-b border-neutral-100' : ''
        }`}
      >
        <span className="min-w-0">
          <span className="block text-[14.5px] font-bold">
            {memberName}
            {editable && <span className="ml-1.5 text-[12px] font-semibold text-brand">(나)</span>}
          </span>
          <span className="mt-0.5 block text-[11.5px] text-neutral-500">
            통과 {passCount}/5
            {failCount > 0 && <span className="ml-1.5 font-semibold text-red-600">실패 {failCount}</span>}
            {waiting > 0 && <span className="ml-1.5 font-semibold text-amber-600">답변 대기 {waiting}</span>}
            {savedAt && <span className="ml-1.5 text-neutral-400">· {relTime(savedAt)}</span>}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {passCount === CHECK_ITEMS.length ? (
            <span className="chip bg-green-100 text-green-800">완료</span>
          ) : (
            <span className="flex gap-0.5">
              {CHECK_ITEMS.map((_, i) => {
                const r = draft[i + 1]?.result ?? 'none';
                return (
                  <span
                    key={i}
                    className={`h-1.5 w-3 rounded-full ${
                      r === 'pass' ? 'bg-green-500' : r === 'fail' ? 'bg-red-500' : 'bg-neutral-200'
                    }`}
                  />
                );
              })}
            </span>
          )}
          <Icon
            name="chevronDown"
            size={14}
            className={`text-neutral-300 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      {open && (
        <>
          <ul className="divide-y divide-neutral-100">
            {CHECK_ITEMS.map((label, idx) => {
              const no = idx + 1;
              const d = draft[no] ?? { result: 'none' as CheckResult, note: '' };
              const row = rows.find((r) => r.item_no === no) ?? null;
              const shots = (row ? (filesByCheck.get(row.id) ?? []) : []).filter(
                (f) => !removed.includes(f.id),
              );
              const picked = pending[no] ?? [];

              return (
                <li key={no} className="px-3.5 py-2.5">
                  <p className="mb-1.5 text-[13.5px] leading-snug text-neutral-800">
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
                            on ? `${r.on} border-transparent` : 'border-neutral-200 bg-surface text-neutral-500'
                          } ${!editable ? 'opacity-70' : 'active:scale-[.97]'}`}
                        >
                          {r.label}
                        </button>
                      );
                    })}
                  </div>

                  {d.result === 'fail' && (
                    <div className="mt-2 space-y-2">
                      {editable ? (
                        <>
                          <textarea
                            value={d.note}
                            onChange={(e) => set(no, { note: e.target.value })}
                            rows={2}
                            placeholder="무엇이 문제인가요? (필수)"
                            className="field resize-none border-red-300 focus:border-red-500 focus:ring-red-100"
                          />
                          <ShotPicker
                            id={`shot-${roundId}-${memberId}-${no}`}
                            shots={shots}
                            picked={picked}
                            onPick={(files) =>
                              setPending((p) => ({ ...p, [no]: [...(p[no] ?? []), ...files] }))
                            }
                            onDropPicked={(i) =>
                              setPending((p) => ({ ...p, [no]: (p[no] ?? []).filter((_, j) => j !== i) }))
                            }
                            onDropSaved={(fid) => setRemoved((v) => [...v, fid])}
                            onView={setViewer}
                          />
                        </>
                      ) : (
                        <>
                          {d.note && (
                            <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] leading-relaxed text-red-800">
                              {d.note}
                            </p>
                          )}
                          {shots.length > 0 && (
                            <div className="grid grid-cols-3 gap-1.5">
                              {shots.map((f) => (
                                <button
                                  key={f.id}
                                  type="button"
                                  onClick={() => setViewer(f.file_url)}
                                  className="aspect-square overflow-hidden rounded-lg bg-neutral-100"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={f.file_url}
                                    alt={f.file_name ?? '캡처'}
                                    loading="lazy"
                                    className="h-full w-full object-cover"
                                  />
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      )}

                      {row && (
                        <ResponseBlock
                          row={row}
                          canRespond={canRespond}
                          nameOf={nameOf}
                          appId={appId}
                          appSlug={appSlug}
                          itemNo={no}
                          onSaved={onSaved}
                        />
                      )}
                    </div>
                  )}
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
              {progress && <p className="mb-2 text-[12.5px] text-neutral-500">{progress}</p>}
              <button onClick={save} disabled={busy || !dirty} className="btn-primary w-full">
                {busy ? '저장 중…' : dirty ? '검증 결과 저장' : '저장됨'}
              </button>
            </div>
          )}
        </>
      )}

      {viewer && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setViewer(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={viewer} alt="캡처 크게 보기" className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </div>
  );
}

/** 캡처 고르기 + 이미 올린 캡처 지우기 */
function ShotPicker({
  id,
  shots,
  picked,
  onPick,
  onDropPicked,
  onDropSaved,
  onView,
}: {
  id: string;
  shots: CheckFile[];
  picked: File[];
  onPick: (files: File[]) => void;
  onDropPicked: (index: number) => void;
  onDropSaved: (fileId: string) => void;
  onView: (url: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  return (
    <div>
      {shots.length > 0 && (
        <div className="mb-2 grid grid-cols-3 gap-1.5">
          {shots.map((f) => (
            <div key={f.id} className="relative aspect-square overflow-hidden rounded-lg bg-neutral-100">
              <button type="button" onClick={() => onView(f.file_url)} className="h-full w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={f.file_url}
                  alt={f.file_name ?? '캡처'}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
              <button
                type="button"
                onClick={() => onDropSaved(f.id)}
                aria-label="캡처 빼기"
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {picked.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {picked.map((f, i) => (
            <span key={i} className="flex items-center gap-1.5 rounded-lg bg-neutral-100 px-2.5 py-1.5">
              <span className="max-w-[120px] truncate text-[11.5px] text-neutral-600">{f.name}</span>
              <button type="button" onClick={() => onDropPicked(i)} aria-label={`${f.name} 빼기`} className="text-neutral-400">
                <Icon name="close" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        ref={ref}
        id={id}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          onPick(Array.from(e.target.files ?? []));
          if (ref.current) ref.current.value = '';
        }}
        className="hidden"
      />
      <label
        htmlFor={id}
        className="tap w-full cursor-pointer gap-1.5 rounded-lg border border-dashed border-neutral-300 text-[13px] font-semibold text-neutral-500"
      >
        <Icon name="camera" size={14} />
        캡처 붙이기
      </label>
    </div>
  );
}

/**
 * 지적사항 한 건에 대한 답변.
 * 제작자·원장은 "업데이트 완료"로 다시 봐달라고 하거나, 사유를 남긴다.
 */
function ResponseBlock({
  row,
  canRespond,
  nameOf,
  appId,
  appSlug,
  itemNo,
  onSaved,
}: {
  row: CheckRow;
  canRespond: boolean;
  nameOf: (id: string | null) => string;
  appId: string;
  appSlug: string;
  itemNo: number;
  onSaved: () => void;
}) {
  const { session } = useSession();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(row.response ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setText(row.response ?? '');
    setEditing(false);
  }, [row.response, row.response_state]);

  const send = async (state: Exclude<ResponseState, 'none'>) => {
    setError('');
    if (state === 'explained' && !text.trim()) {
      setError('사유를 적어주세요.');
      return;
    }
    setBusy(true);
    try {
      const { error: e } = await supabase
        .from('checks')
        .update({
          response: text.trim() || null,
          response_state: state,
          responded_by: session?.id ?? null,
          responded_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      if (e) throw e;
      logActivity(
        session?.id,
        `${appSlug} 항목${itemNo} ${RESPONSE_META[state].label}`,
        `app:${appId}`,
      );
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const answered = row.response_state !== 'none';
  const meta = answered ? RESPONSE_META[row.response_state as Exclude<ResponseState, 'none'>] : null;

  if (!editing) {
    if (!answered) {
      if (!canRespond) {
        return <p className="text-[12px] text-amber-600">제작자 답변을 기다리고 있어요.</p>;
      }
      return (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="tap w-full gap-1.5 rounded-lg border border-brand bg-brand-50 text-[13px] font-bold text-brand-700"
        >
          <Icon name="comment" size={14} />
          이 지적에 답하기
        </button>
      );
    }
    return (
      <div className={`rounded-lg border px-3 py-2 ${meta!.box}`}>
        <p className="flex flex-wrap items-center gap-1.5">
          <span className={`chip ${meta!.chip}`}>{meta!.label}</span>
          <span className="text-[11.5px] text-neutral-500">
            {nameOf(row.responded_by)}
            {row.responded_at && ` · ${relTime(row.responded_at)}`}
          </span>
        </p>
        {row.response && (
          <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-700">
            {row.response}
          </p>
        )}
        {canRespond && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-1.5 text-[12px] font-bold text-neutral-500 underline"
          >
            답변 고치기
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-raised p-2.5">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="무엇을 어떻게 고쳤는지, 또는 왜 이대로 두는지 적어주세요."
        className="field resize-none"
        aria-label="지적사항 답변"
      />
      {error && (
        <div className="mt-2">
          <ErrorBanner message={error} />
        </div>
      )}
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          onClick={() => send('fixed')}
          disabled={busy}
          className="tap flex-1 rounded-lg bg-green-600 text-[13px] font-bold text-white disabled:opacity-40"
        >
          업데이트 완료
        </button>
        <button
          type="button"
          onClick={() => send('explained')}
          disabled={busy}
          className="tap flex-1 rounded-lg border border-neutral-300 bg-surface text-[13px] font-bold text-neutral-600 disabled:opacity-40"
        >
          사유만 남기기
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="tap shrink-0 rounded-lg px-2 text-[13px] text-neutral-400"
        >
          취소
        </button>
      </div>
    </div>
  );
}
