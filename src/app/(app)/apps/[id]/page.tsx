'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { logActivity } from '@/lib/log';
import { openNextRound, recomputeAppStatus } from '@/lib/verify';
import { computeStatus, roundProgress, STATUS_META } from '@/lib/status';
import { ddayClass, ddayLabel, korDateFull } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { ReviewerChecklist } from '@/components/Checklist';
import { RoundHistory } from '@/components/RoundHistory';
import { CommentThread } from '@/components/CommentThread';
import { AppForm } from '@/components/AppForm';
import { CardSkeleton, ConfirmDialog, ErrorBanner, ProgressBar, SectionTitle, Sheet, useToast } from '@/components/ui';
import type { AppRow, CheckRow, CostSheet, Round } from '@/lib/types';

type Tab = 'verify' | 'comment' | 'info';

export default function AppDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { session, isAdmin } = useSession();
  const { nameOf, members } = useMembers(true);
  const toast = useToast();

  const [app, setApp] = useState<AppRow | null>(null);
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [checks, setChecks] = useState<CheckRow[]>([]);
  const [sheet, setSheet] = useState<CostSheet | null>(null);
  const [photoCount, setPhotoCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [tab, setTab] = useState<Tab>('verify');
  const [reopenOpen, setReopenOpen] = useState(false);
  const [changeNote, setChangeNote] = useState('');
  const [reopenErr, setReopenErr] = useState('');
  const [reopenBusy, setReopenBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const { data: a, error: aErr } = await supabase.from('apps').select('*').eq('id', id).maybeSingle();
      if (aErr) throw aErr;
      if (!a) {
        setError('앱을 찾지 못했어요. 목록으로 돌아가 주세요.');
        setLoading(false);
        return;
      }
      setApp(a as AppRow);

      const [revRes, roundRes, sheetRes] = await Promise.all([
        supabase.from('app_reviewers').select('member_id').eq('app_id', id),
        supabase.from('rounds').select('*').eq('app_id', id).order('round_no', { ascending: false }),
        supabase.from('cost_sheets').select('*').eq('app_id', id).limit(1).maybeSingle(),
      ]);

      setReviewerIds((revRes.data ?? []).map((r) => r.member_id));
      const rs = (roundRes.data ?? []) as Round[];
      setRounds(rs);
      setSheet((sheetRes.data as CostSheet | null) ?? null);

      if (rs.length > 0) {
        const { data: cs } = await supabase
          .from('checks')
          .select('*')
          .in('round_id', rs.map((r) => r.id));
        setChecks((cs ?? []) as CheckRow[]);
      } else {
        setChecks([]);
      }

      const { data: albums } = await supabase.from('albums').select('id').eq('app_id', id);
      if (albums && albums.length > 0) {
        const { count } = await supabase
          .from('photos')
          .select('id', { count: 'exact', head: true })
          .in('album_id', albums.map((x) => x.id));
        setPhotoCount(count ?? 0);
      } else {
        setPhotoCount(0);
      }
    } catch (e) {
      setError(friendlyError(e, '앱 정보를 불러오지 못했어요. 다시 시도해주세요.'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const currentRound = rounds[0] ?? null;
  const currentChecks = useMemo(
    () => (currentRound ? checks.filter((c) => c.round_id === currentRound.id) : []),
    [checks, currentRound],
  );
  const status = computeStatus(currentChecks, reviewerIds.length);
  const progress = roundProgress(currentChecks, reviewerIds.length);

  const checksByRound = useMemo(() => {
    const m = new Map<string, CheckRow[]>();
    for (const c of checks) {
      const list = m.get(c.round_id) ?? [];
      list.push(c);
      m.set(c.round_id, list);
    }
    return m;
  }, [checks]);

  const reopen = async () => {
    setReopenErr('');
    if (!changeNote.trim()) {
      setReopenErr('무엇을 수정했는지 적어주세요. 이게 있어야 검증자가 뭘 다시 볼지 알 수 있어요.');
      return;
    }
    setReopenBusy(true);
    try {
      const round = await openNextRound(id, changeNote.trim(), reviewerIds);
      logActivity(session?.id, `${app?.slug} ${round.round_no}차 재검증 요청`, `app:${id}`);
      setReopenOpen(false);
      setChangeNote('');
      toast.show(`${round.round_no}차 검증이 시작됐어요.`);
      await load();
    } catch (e) {
      setReopenErr(friendlyError(e, '재검증을 시작하지 못했어요. 다시 눌러주세요.'));
    } finally {
      setReopenBusy(false);
    }
  };

  const archive = async () => {
    setArchiveOpen(false);
    const { error: e } = await supabase.from('apps').update({ archived: !app?.archived }).eq('id', id);
    if (e) {
      setError(friendlyError(e));
      return;
    }
    logActivity(session?.id, `${app?.slug} ${app?.archived ? '보관 해제' : '보관 처리'}`, `app:${id}`);
    if (!app?.archived) router.push('/apps');
    else await load();
  };

  const createSheet = async () => {
    const { data, error: e } = await supabase
      .from('cost_sheets')
      .insert({ app_id: id, title: `${app?.title_ko ?? ''} 원가표`, headcount: 20, sale_price: 0 })
      .select()
      .single();
    if (e) {
      setError(friendlyError(e));
      return;
    }
    logActivity(session?.id, `${app?.slug} 원가표 생성`, `sheet:${data.id}`);
    router.push(`/cost/${data.id}`);
  };

  if (loading) {
    return (
      <>
        <PageHeader title="불러오는 중" back="/apps" />
        <div className="px-4 py-4">
          <CardSkeleton rows={3} />
        </div>
      </>
    );
  }

  if (!app) {
    return (
      <>
        <PageHeader title="앱" back="/apps" />
        <div className="px-4 py-4">
          <ErrorBanner message={error || '앱을 찾지 못했어요.'} onRetry={() => void load()} />
        </div>
      </>
    );
  }

  const meta = STATUS_META[status];
  const dday = ddayLabel(app.due_date);
  const iAmReviewer = reviewerIds.includes(session?.id ?? '');
  const canReopen = isAdmin || app.creator_id === session?.id;

  return (
    <>
      <PageHeader
        title={app.title_ko}
        subtitle={app.slug}
        back="/apps"
        right={
          isAdmin ? (
            <button onClick={() => setEditOpen(true)} className="btn-ghost h-9 px-3 text-[13px]">
              수정
            </button>
          ) : null
        }
      />

      <div className="px-4 pb-8 pt-3">
        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} onRetry={() => void load()} />
          </div>
        )}

        {/* 요약 */}
        <div className="card p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`chip ${meta.chip}`}>{meta.label}</span>
            <span className="chip bg-neutral-100 text-neutral-600">
              {currentRound?.round_no ?? app.current_round}차 검증 {status === 'done' ? '완료' : '중'}
            </span>
            {dday && <span className={`chip ${ddayClass(app.due_date)}`}>{dday}</span>}
            {app.archived && <span className="chip bg-neutral-200 text-neutral-600">보관됨</span>}
          </div>

          <div className="mt-3 flex items-center gap-2.5">
            <ProgressBar value={progress} className="flex-1" />
            <span className="w-10 shrink-0 text-right text-[12px] font-bold text-neutral-500">{progress}%</span>
          </div>

          {app.url && (
            <a
              href={app.url}
              target="_blank"
              rel="noreferrer"
              className="btn-primary mt-3.5 w-full"
            >
              앱 열어보기 ↗
            </a>
          )}

          {canReopen && (
            <button onClick={() => setReopenOpen(true)} className="btn-ghost mt-2 w-full">
              🔄 수정했음 → 재검증 요청
            </button>
          )}
        </div>

        {/* 탭 */}
        <div className="mt-4 flex gap-1.5 rounded-xl bg-neutral-200/60 p-1">
          {(
            [
              ['verify', '검증'],
              ['comment', '댓글'],
              ['info', '정보'],
            ] as [Tab, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setTab(v)}
              className={`tap flex-1 rounded-lg text-[14px] font-bold transition ${
                tab === v ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {tab === 'verify' && (
            <>
              {!currentRound ? (
                <p className="py-8 text-center text-[13.5px] text-neutral-400">
                  아직 검증 라운드가 없어요.
                </p>
              ) : reviewerIds.length === 0 ? (
                <p className="py-8 text-center text-[13.5px] text-neutral-400">
                  검증자가 배정되지 않았어요. 원장님이 앱 정보를 수정해 검증자를 골라주세요.
                </p>
              ) : (
                <>
                  <SectionTitle>{currentRound.round_no}차 검증 (진행 중)</SectionTitle>
                  {currentRound.change_note && (
                    <div className="mb-3 rounded-xl bg-brand-50 px-3.5 py-3">
                      <p className="text-[11.5px] font-bold text-brand-700">이번에 수정한 내용</p>
                      <p className="mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed text-neutral-700">
                        {currentRound.change_note}
                      </p>
                    </div>
                  )}

                  <div className="space-y-3">
                    {/* 내 카드를 항상 맨 위로 */}
                    {[...reviewerIds]
                      .sort((a, b) => (a === session?.id ? -1 : b === session?.id ? 1 : 0))
                      .map((memberId) => (
                        <ReviewerChecklist
                          key={memberId}
                          appId={id}
                          appSlug={app.slug}
                          roundId={currentRound.id}
                          roundNo={currentRound.round_no}
                          memberId={memberId}
                          memberName={nameOf(memberId)}
                          rows={currentChecks.filter((c) => c.member_id === memberId)}
                          editable={memberId === session?.id}
                          onSaved={() => {
                            toast.show('저장했어요.');
                            void load();
                          }}
                        />
                      ))}
                  </div>

                  {!iAmReviewer && (
                    <p className="mt-3 text-center text-[12.5px] text-neutral-400">
                      나는 이 앱의 검증자가 아니에요. 보기만 할 수 있어요.
                    </p>
                  )}
                </>
              )}

              {rounds.length > 1 && (
                <div className="mt-6">
                  <SectionTitle>지난 검증 기록</SectionTitle>
                  <RoundHistory rounds={rounds.slice(1)} checksByRound={checksByRound} nameOf={nameOf} />
                </div>
              )}
            </>
          )}

          {tab === 'comment' && <CommentThread appId={id} appSlug={app.slug} />}

          {tab === 'info' && (
            <div className="space-y-3">
              <div className="card divide-y divide-neutral-100">
                <InfoRow label="제작 목적" value={app.purpose || '-'} multiline />
                <InfoRow label="대상 학년" value={app.target_grade || '-'} />
                <InfoRow label="제작자" value={nameOf(app.creator_id)} />
                <InfoRow
                  label="검증자"
                  value={reviewerIds.map((r) => nameOf(r)).join(', ') || '미배정'}
                />
                <InfoRow label="마감일" value={korDateFull(app.due_date)} />
                <InfoRow label="배포 링크" value={app.url || '-'} link={app.url ?? undefined} />
              </div>

              <div className="card divide-y divide-neutral-100">
                {sheet ? (
                  <Link href={`/cost/${sheet.id}`} className="tap w-full justify-between px-4 py-3.5 text-[14px]">
                    <span className="font-semibold">💰 원가계산서 보기</span>
                    <span className="text-neutral-400">›</span>
                  </Link>
                ) : (
                  <button onClick={createSheet} className="tap w-full justify-between px-4 py-3.5 text-[14px]">
                    <span className="font-semibold">💰 원가계산서 만들기</span>
                    <span className="text-neutral-400">+</span>
                  </button>
                )}
                <Link
                  href={`/gallery?app=${app.id}`}
                  className="tap w-full justify-between px-4 py-3.5 text-[14px]"
                >
                  <span className="font-semibold">🖼️ 이 프로그램 작품 보기</span>
                  <span className="text-[13px] text-neutral-400">{photoCount}장 ›</span>
                </Link>
              </div>

              {isAdmin && (
                <button onClick={() => setArchiveOpen(true)} className="btn-ghost w-full text-neutral-500">
                  {app.archived ? '보관 해제' : '이 앱 보관하기'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 재검증 요청 */}
      <Sheet
        open={reopenOpen}
        onClose={() => setReopenOpen(false)}
        title={`${(currentRound?.round_no ?? app.current_round) + 1}차 검증 시작`}
        footer={
          <button onClick={reopen} disabled={reopenBusy} className="btn-primary w-full">
            {reopenBusy ? '처리 중…' : '재검증 요청'}
          </button>
        }
      >
        <div className="space-y-3">
          <div className="rounded-xl bg-yellow-50 px-3.5 py-3">
            <p className="text-[13px] leading-relaxed text-yellow-900">
              지금까지의 검증 체크가 모두 <b>미확인</b>으로 리셋돼요. 이전 라운드 기록은 그대로 남습니다.
            </p>
          </div>
          {reopenErr && <ErrorBanner message={reopenErr} />}
          <div>
            <label className="label" htmlFor="change-note">
              무엇을 수정했나요?
            </label>
            <textarea
              id="change-note"
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              rows={5}
              placeholder={'예) AI 응답 안 나오던 것 고침\n반코드 입력창 크게 바꿈'}
              className="field resize-none"
            />
          </div>
        </div>
      </Sheet>

      <AppForm
        open={editOpen}
        onClose={() => setEditOpen(false)}
        editing={{ app, reviewerIds }}
        onSaved={() => {
          toast.show('수정했어요.');
          void load();
        }}
      />

      <ConfirmDialog
        open={archiveOpen}
        title={app.archived ? '보관을 해제할까요?' : '이 앱을 보관할까요?'}
        message={app.archived ? '다시 목록에 나타나요.' : '목록에서 숨겨져요. 기록은 지워지지 않아요.'}
        confirmLabel={app.archived ? '해제' : '보관'}
        danger={!app.archived}
        onCancel={() => setArchiveOpen(false)}
        onConfirm={archive}
      />

      {toast.node}
      {/* 검증자 배정이 바뀌면 상태를 다시 맞춰준다 */}
      <StatusSync appId={id} deps={[reviewerIds.length]} />
      {members.length === 0 && null}
    </>
  );
}

function InfoRow({
  label,
  value,
  multiline,
  link,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  link?: string;
}) {
  return (
    <div className="px-4 py-3">
      <p className="text-[12px] font-semibold text-neutral-500">{label}</p>
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="mt-1 block break-all text-[14px] text-brand underline"
        >
          {value}
        </a>
      ) : (
        <p
          className={`mt-1 text-[14px] leading-relaxed text-neutral-800 ${multiline ? 'whitespace-pre-wrap' : ''}`}
        >
          {value}
        </p>
      )}
    </div>
  );
}

/** 검증자 수가 바뀌면 저장된 status 와 계산값이 어긋날 수 있어 한 번 맞춰준다. */
function StatusSync({ appId, deps }: { appId: string; deps: unknown[] }) {
  useEffect(() => {
    void recomputeAppStatus(appId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, ...deps]);
  return null;
}
