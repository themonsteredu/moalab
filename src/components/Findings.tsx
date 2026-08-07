'use client';

import { useMemo, useRef, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { logActivity } from '@/lib/log';
import { recomputeAppStatus } from '@/lib/verify';
import { uploadMany } from '@/lib/upload';
import { relTime } from '@/lib/format';
import { Icon } from '@/components/Icon';
import { ErrorBanner, Sheet } from '@/components/ui';
import {
  FINDING_META,
  REPLY_STATES,
  isOpenFinding,
  type Finding,
  type FindingFile,
  type FindingReply,
  type ReplyState,
  type Round,
  type RoundSignoff,
} from '@/lib/types';

export interface FindingBundle {
  findings: Finding[];
  filesBy: Map<string, FindingFile[]>;
  repliesBy: Map<string, FindingReply[]>;
  signoffs: RoundSignoff[];
}

/**
 * 검증 = 화면을 캡처해서 뭐가 이상한지 적고, 거기에 답을 다는 것.
 *
 * 5항목에 O/X 만 치면 "무엇이 왜 안 되는지" 가 안 남아서, 지적 한 건을
 * 캡처 + 글로 세우고 그 아래에 수정완료 / 수정불가 / 다시확인 답변을 붙인다.
 */
export function Findings({
  appId,
  appSlug,
  round,
  reviewerIds,
  bundle,
  nameOf,
  onChanged,
}: {
  appId: string;
  appSlug: string;
  round: Round;
  reviewerIds: string[];
  bundle: FindingBundle;
  nameOf: (id: string | null) => string;
  onChanged: () => void;
}) {
  const { session, isAdmin } = useSession();
  const [addOpen, setAddOpen] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  const [error, setError] = useState('');

  const list = useMemo(
    () => bundle.findings.filter((f) => f.round_id === round.id),
    [bundle.findings, round.id],
  );
  const open = list.filter((f) => isOpenFinding(f.status));
  const closed = list.filter((f) => !isOpenFinding(f.status));

  const iAmReviewer = Boolean(session && reviewerIds.includes(session.id));
  const iSigned = Boolean(session && bundle.signoffs.some((s) => s.round_id === round.id && s.member_id === session.id));
  // 지금 배정된 검증자의 표시만 센다 (빠진 사람의 낡은 기록은 무시)
  const signedIds = bundle.signoffs
    .filter((s) => s.round_id === round.id && reviewerIds.includes(s.member_id))
    .map((s) => s.member_id);

  const toggleSignoff = async () => {
    if (!session) return;
    setError('');
    try {
      if (iSigned) {
        const { error: e } = await supabase
          .from('round_signoffs')
          .delete()
          .eq('round_id', round.id)
          .eq('member_id', session.id);
        if (e) throw e;
      } else {
        if (open.length > 0) {
          setError('아직 안 닫힌 지적이 있어요. 먼저 확인완료로 닫아주세요.');
          return;
        }
        const { error: e } = await supabase
          .from('round_signoffs')
          .upsert({ round_id: round.id, member_id: session.id }, { onConflict: 'round_id,member_id' });
        if (e) throw e;
        logActivity(session.id, `${appSlug} ${round.round_no}차 검증 완료`, `app:${appId}`);
      }
      await recomputeAppStatus(appId);
      onChanged();
    } catch (e) {
      setError(friendlyError(e));
    }
  };

  return (
    <section>
      {error && (
        <div className="mb-3">
          <ErrorBanner message={error} />
        </div>
      )}

      <button onClick={() => setAddOpen(true)} className="btn-primary mb-3 w-full">
        <Icon name="camera" size={16} />
        캡처하고 지적 남기기
      </button>

      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 px-4 py-6 text-center text-[13px] leading-relaxed text-neutral-400">
          아직 지적이 없어요.
          <br />
          이상한 화면을 캡처해서 올려주세요.
        </p>
      ) : (
        <>
          {open.length > 0 && (
            <>
              <p className="mb-2 text-[12px] font-bold text-red-600">안 닫힌 지적 {open.length}건</p>
              <ul className="space-y-2.5">
                {open.map((f) => (
                  <FindingCard
                    key={f.id}
                    finding={f}
                    files={bundle.filesBy.get(f.id) ?? []}
                    replies={bundle.repliesBy.get(f.id) ?? []}
                    appId={appId}
                    appSlug={appSlug}
                    nameOf={nameOf}
                    canClose={Boolean(isAdmin || f.member_id === session?.id)}
                    onView={setViewer}
                    onChanged={onChanged}
                  />
                ))}
              </ul>
            </>
          )}

          {closed.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer list-none text-[12px] font-bold text-neutral-400">
                닫힌 지적 {closed.length}건 보기
              </summary>
              <ul className="mt-2 space-y-2.5">
                {closed.map((f) => (
                  <FindingCard
                    key={f.id}
                    finding={f}
                    files={bundle.filesBy.get(f.id) ?? []}
                    replies={bundle.repliesBy.get(f.id) ?? []}
                    appId={appId}
                    appSlug={appSlug}
                    nameOf={nameOf}
                    canClose={Boolean(isAdmin || f.member_id === session?.id)}
                    onView={setViewer}
                    onChanged={onChanged}
                  />
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {/* 검증 완료 표시 — "아무도 안 봤다" 와 "다 봤는데 문제없다" 를 구분하는 곳 */}
      <div className="mt-4 rounded-xl border border-neutral-200 bg-raised p-3">
        <p className="text-[12px] font-bold text-neutral-500">
          검증 완료 {signedIds.length}/{reviewerIds.length}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {reviewerIds.length === 0 ? (
            <span className="text-[12px] text-neutral-400">검증자가 배정되지 않았어요.</span>
          ) : (
            reviewerIds.map((id) => {
              const done = signedIds.includes(id);
              return (
                <span
                  key={id}
                  className={`chip ${done ? 'bg-green-100 text-green-800' : 'bg-neutral-100 text-neutral-500'}`}
                >
                  {nameOf(id)} {done ? '완료' : '미완료'}
                </span>
              );
            })
          )}
        </div>
        {iAmReviewer && (
          <button
            onClick={() => void toggleSignoff()}
            className={`tap mt-2.5 w-full gap-1.5 rounded-xl border text-[14px] font-bold transition ${
              iSigned
                ? 'border-neutral-300 bg-surface text-neutral-500'
                : 'border-green-600 bg-green-600 text-white'
            }`}
          >
            <Icon name={iSigned ? 'refresh' : 'check'} size={15} />
            {iSigned ? '검증 완료 취소' : '다 봤어요 — 검증 완료'}
          </button>
        )}
      </div>

      <AddFindingSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        appId={appId}
        appSlug={appSlug}
        roundId={round.id}
        onSaved={onChanged}
      />

      {viewer && <Lightbox url={viewer} onClose={() => setViewer(null)} />}
    </section>
  );
}

/* ------------------------------------------------------------- 지적 한 건 */

function FindingCard({
  finding,
  files,
  replies,
  appId,
  appSlug,
  nameOf,
  canClose,
  onView,
  onChanged,
}: {
  finding: Finding;
  files: FindingFile[];
  replies: FindingReply[];
  appId: string;
  appSlug: string;
  nameOf: (id: string | null) => string;
  /** 지적을 낸 사람(또는 원장)만 확인완료로 닫는다 */
  canClose: boolean;
  onView: (url: string) => void;
  onChanged: () => void;
}) {
  const { session } = useSession();
  const [picked, setPicked] = useState<ReplyState | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const meta = FINDING_META[finding.status];

  const setStatus = async (status: Finding['status']) => {
    const { error: e } = await supabase
      .from('findings')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', finding.id);
    if (e) throw e;
  };

  const sendReply = async () => {
    setError('');
    if (!picked) return;
    if (!body.trim()) {
      setError('무슨 내용인지 적어주세요. 상태만 바꾸면 다음 사람이 못 알아봐요.');
      return;
    }
    setBusy(true);
    try {
      const { error: e } = await supabase.from('finding_replies').insert({
        finding_id: finding.id,
        member_id: session?.id ?? null,
        state: picked,
        body: body.trim(),
      });
      if (e) throw e;
      await setStatus(picked);
      await recomputeAppStatus(appId);
      const label = REPLY_STATES.find((s) => s.value === picked)?.label ?? picked;
      logActivity(session?.id, `${appSlug} 지적 ${label}`, `app:${appId}`);
      setPicked(null);
      setBody('');
      onChanged();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const close = async (next: 'closed' | 'open') => {
    setError('');
    setBusy(true);
    try {
      await setStatus(next);
      await recomputeAppStatus(appId);
      logActivity(
        session?.id,
        `${appSlug} 지적 ${next === 'closed' ? '확인완료' : '다시 열기'}`,
        `app:${appId}`,
      );
      onChanged();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`card overflow-hidden border ${meta.box}`}>
      {files.length > 0 && (
        <div className={`grid gap-0.5 bg-neutral-100 ${files.length === 1 ? '' : 'grid-cols-2'}`}>
          {files.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onView(f.file_url)}
              className={`block w-full overflow-hidden bg-neutral-100 ${
                files.length === 1 ? 'max-h-[280px]' : 'aspect-[4/3]'
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={f.file_url}
                alt={f.file_name ?? '캡처'}
                loading="lazy"
                className={files.length === 1 ? 'w-full object-contain' : 'h-full w-full object-cover'}
              />
            </button>
          ))}
        </div>
      )}

      <div className="p-3.5">
        <p className="flex flex-wrap items-center gap-1.5">
          <span className={`chip ${meta.chip}`}>{meta.label}</span>
          <span className="text-[11.5px] text-neutral-400">
            {nameOf(finding.member_id)} · {relTime(finding.created_at)}
          </span>
        </p>

        <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-relaxed text-neutral-800">
          {finding.body}
        </p>

        {replies.length > 0 && (
          <ul className="mt-2.5 space-y-1.5 border-t border-neutral-100 pt-2.5">
            {replies.map((r) => {
              const rm = REPLY_STATES.find((s) => s.value === r.state);
              return (
                <li key={r.id} className="rounded-lg bg-raised px-2.5 py-2">
                  <p className="flex flex-wrap items-center gap-1.5">
                    <span className={`chip ${FINDING_META[r.state].chip}`}>{rm?.label ?? r.state}</span>
                    <span className="text-[11px] text-neutral-400">
                      {nameOf(r.member_id)} · {relTime(r.created_at)}
                    </span>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-700">
                    {r.body}
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        {error && (
          <div className="mt-2.5">
            <ErrorBanner message={error} />
          </div>
        )}

        {/* 답변 — 나든 다른 사람이든 누구나 달 수 있다 */}
        <div className="mt-2.5 flex gap-1.5">
          {REPLY_STATES.map((s) => {
            const on = picked === s.value;
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => setPicked(on ? null : s.value)}
                aria-pressed={on}
                className={`tap flex-1 rounded-lg border text-[13px] font-bold transition ${
                  on ? `${s.on} border-transparent` : 'border-neutral-200 bg-surface text-neutral-500'
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {picked && (
          <div className="mt-2">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              autoFocus
              placeholder={REPLY_STATES.find((s) => s.value === picked)?.hint}
              className="field resize-none"
              aria-label="답변 내용"
            />
            <button onClick={() => void sendReply()} disabled={busy} className="btn-primary mt-2 w-full">
              {busy ? '올리는 중…' : `${REPLY_STATES.find((s) => s.value === picked)?.label} 로 답변 올리기`}
            </button>
          </div>
        )}

        {canClose && !picked && (
          <button
            onClick={() => void close(isOpenFinding(finding.status) ? 'closed' : 'open')}
            disabled={busy}
            className="mt-2 w-full text-[12.5px] font-bold text-neutral-400 underline"
          >
            {isOpenFinding(finding.status) ? '확인했어요 — 이 지적 닫기' : '이 지적 다시 열기'}
          </button>
        )}
      </div>
    </li>
  );
}

/* --------------------------------------------------------- 지적 새로 쓰기 */

function AddFindingSheet({
  open,
  onClose,
  appId,
  appSlug,
  roundId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  appId: string;
  appSlug: string;
  roundId: string;
  onSaved: () => void;
}) {
  const { session } = useSession();
  const [files, setFiles] = useState<File[]>([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFiles([]);
    setBody('');
    setError('');
    setProgress('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const save = async () => {
    setError('');
    if (!body.trim()) {
      setError('무엇이 어떻게 이상한지 적어주세요.');
      return;
    }
    setBusy(true);
    try {
      const { data: finding, error: insErr } = await supabase
        .from('findings')
        .insert({
          app_id: appId,
          round_id: roundId,
          member_id: session?.id ?? null,
          body: body.trim(),
          status: 'open',
        })
        .select()
        .single();
      if (insErr) throw insErr;

      if (files.length > 0) {
        setProgress(`캡처 올리는 중… 0/${files.length}`);
        const uploaded = await uploadMany('moalab-comment-files', files, `finding-${appId}`, (d, t) =>
          setProgress(`캡처 올리는 중… ${d}/${t}`),
        );
        const { error: fErr } = await supabase.from('finding_files').insert(
          uploaded.map((u, i) => ({
            finding_id: finding.id,
            file_url: u.url,
            file_name: u.name,
            sort_order: i,
          })),
        );
        if (fErr) throw fErr;
      }

      await recomputeAppStatus(appId);
      logActivity(session?.id, `${appSlug} 지적 등록`, `app:${appId}`);
      reset();
      onClose();
      onSaved();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="지적 남기기">
      <div className="space-y-3">
        <div>
          <p className="label">1. 이상한 화면을 캡처해서 붙이기</p>
          <input
            ref={inputRef}
            id="finding-shots"
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setFiles((v) => [...v, ...Array.from(e.target.files ?? [])])}
            className="hidden"
          />
          <label
            htmlFor="finding-shots"
            className="tap w-full cursor-pointer gap-1.5 rounded-xl border border-dashed border-neutral-300 text-[14px] font-semibold text-neutral-500"
          >
            <Icon name="camera" size={16} />
            캡처 고르기
          </label>

          {files.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {files.map((f, i) => (
                <span key={i} className="flex items-center gap-1.5 rounded-lg bg-neutral-100 px-2.5 py-1.5">
                  <span className="max-w-[140px] truncate text-[12px] text-neutral-600">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => setFiles((v) => v.filter((_, j) => j !== i))}
                    aria-label={`${f.name} 빼기`}
                    className="text-neutral-400"
                  >
                    <Icon name="close" size={13} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="label" htmlFor="finding-body">
            2. 그 부분이 뭐가 이상한가요?
          </label>
          <textarea
            id="finding-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            placeholder="예) 3번 문제 화면에서 '다음' 버튼이 눌리지 않아요. 아이폰 사파리에서 세 번 해봤습니다."
            className="field resize-none"
          />
        </div>

        {error && <ErrorBanner message={error} />}
        {progress && <p className="text-[12.5px] text-neutral-500">{progress}</p>}

        <button onClick={() => void save()} disabled={busy} className="btn-primary w-full">
          {busy ? '올리는 중…' : '지적 올리기'}
        </button>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------ 지난 라운드 */

export function FindingHistory({
  rounds,
  bundle,
  nameOf,
}: {
  rounds: Round[];
  bundle: FindingBundle;
  nameOf: (id: string | null) => string;
}) {
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [viewer, setViewer] = useState<string | null>(null);

  if (rounds.length === 0) return null;

  return (
    <div className="space-y-2">
      {rounds.map((r) => {
        const list = bundle.findings.filter((f) => f.round_id === r.id);
        const isOpen = openIds.includes(r.id);
        return (
          <div key={r.id} className="card overflow-hidden">
            <button
              onClick={() => setOpenIds((v) => (isOpen ? v.filter((x) => x !== r.id) : [...v, r.id]))}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left"
            >
              <span className="min-w-0">
                <span className="text-[13.5px] font-bold text-neutral-600">{r.round_no}차 검증</span>
                <span className="ml-1.5 text-[11.5px] text-neutral-400">
                  지적 {list.length}건 · {relTime(r.opened_at)}
                </span>
              </span>
              <Icon
                name="chevronDown"
                size={14}
                className={`shrink-0 text-neutral-300 transition-transform ${isOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {isOpen && (
              <div className="border-t border-neutral-100 px-3.5 py-3">
                {r.change_note && (
                  <p className="mb-2.5 whitespace-pre-wrap rounded-lg bg-brand-50 px-3 py-2 text-[12.5px] leading-relaxed text-neutral-700">
                    <b className="text-brand-700">이번에 수정한 내용</b>
                    <br />
                    {r.change_note}
                  </p>
                )}

                {list.length === 0 ? (
                  <p className="py-2 text-center text-[12.5px] text-neutral-400">지적이 없었어요.</p>
                ) : (
                  <ul className="space-y-2">
                    {list.map((f) => {
                      const meta = FINDING_META[f.status];
                      const shots = bundle.filesBy.get(f.id) ?? [];
                      const replies = bundle.repliesBy.get(f.id) ?? [];
                      return (
                        <li key={f.id} className="rounded-lg border border-neutral-200 px-2.5 py-2">
                          <p className="flex flex-wrap items-center gap-1.5">
                            <span className={`chip ${meta.chip}`}>{meta.label}</span>
                            <span className="text-[11px] text-neutral-400">
                              {nameOf(f.member_id)} · {relTime(f.created_at)}
                            </span>
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-700">
                            {f.body}
                          </p>
                          {shots.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {shots.map((s) => (
                                <button
                                  key={s.id}
                                  type="button"
                                  onClick={() => setViewer(s.file_url)}
                                  className="h-12 w-12 overflow-hidden rounded-md bg-neutral-100"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={s.file_url}
                                    alt={s.file_name ?? '캡처'}
                                    loading="lazy"
                                    className="h-full w-full object-cover"
                                  />
                                </button>
                              ))}
                            </div>
                          )}
                          {replies.map((rp) => (
                            <p key={rp.id} className="mt-1 text-[12px] text-neutral-500">
                              <span className={`chip mr-1 ${FINDING_META[rp.state].chip}`}>
                                {REPLY_STATES.find((s) => s.value === rp.state)?.label}
                              </span>
                              {nameOf(rp.member_id)}: {rp.body}
                            </p>
                          ))}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        );
      })}

      {viewer && <Lightbox url={viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4" onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="캡처 크게 보기" className="max-h-full max-w-full object-contain" />
    </div>
  );
}

/** 여러 화면이 같은 방식으로 지적 데이터를 묶는다 */
export function bundleFindings(
  findings: Finding[],
  files: FindingFile[],
  replies: FindingReply[],
  signoffs: RoundSignoff[],
): FindingBundle {
  const filesBy = new Map<string, FindingFile[]>();
  for (const f of files) {
    const l = filesBy.get(f.finding_id) ?? [];
    l.push(f);
    filesBy.set(f.finding_id, l);
  }
  const repliesBy = new Map<string, FindingReply[]>();
  for (const r of replies) {
    const l = repliesBy.get(r.finding_id) ?? [];
    l.push(r);
    repliesBy.set(r.finding_id, l);
  }
  return { findings, filesBy, repliesBy, signoffs };
}
