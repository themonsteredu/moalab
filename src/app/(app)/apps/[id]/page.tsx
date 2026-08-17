'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { logActivity } from '@/lib/log';
import { openNextRound, recomputeAppStatus } from '@/lib/verify';
import { computeStatus, openFindings, roundProgress, STATUS_META } from '@/lib/status';
import { ddayClass, ddayLabel, korDate, korDateFull } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { Findings, FindingHistory, bundleFindings } from '@/components/Findings';
import { CommentThread } from '@/components/CommentThread';
import { LessonPlan } from '@/components/LessonPlan';
import { PlanForm } from '@/components/PlanForm';
import { CostInline } from '@/components/CostInline';
import { SampleImages } from '@/components/SampleImages';
import { AppForm } from '@/components/AppForm';
import { Avatar } from '@/components/Brand';
import { Icon, type IconName } from '@/components/Icon';
import { CardSkeleton, ConfirmDialog, ErrorBanner, ProgressBar, Sheet, useToast } from '@/components/ui';
import { PRINT_PARTS, type PrintPart } from '@/lib/print';
import type {
  Album,
  AppRow,
  Finding,
  FindingFile,
  FindingReply,
  Photo,
  Round,
  RoundSignoff,
} from '@/lib/types';

/** 프로그램 페이지의 목차. 이 순서가 곧 일하는 순서다. */
const SECTIONS = [
  { id: 'verify', icon: 'checkCircle', label: '검증' },
  { id: 'plan', icon: 'doc', label: '강의계획서' },
  { id: 'planfile', icon: 'clip', label: '첨부' },
  { id: 'cost', icon: 'won', label: '원가' },
  { id: 'sample', icon: 'image', label: '샘플' },
  { id: 'photos', icon: 'camera', label: '수업 사진' },
  { id: 'comment', icon: 'comment', label: '댓글' },
] as const satisfies readonly { id: string; icon: IconName; label: string }[];

export default function AppDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { session, isAdmin } = useSession();
  const { nameOf, members } = useMembers(true);
  const toast = useToast();

  const [app, setApp] = useState<AppRow | null>(null);
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [findingFiles, setFindingFiles] = useState<FindingFile[]>([]);
  const [findingReplies, setFindingReplies] = useState<FindingReply[]>([]);
  const [signoffs, setSignoffs] = useState<RoundSignoff[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [openComments, setOpenComments] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [active, setActive] = useState<string>('verify');
  const [reopenOpen, setReopenOpen] = useState(false);
  const [changeNote, setChangeNote] = useState('');
  const [reopenErr, setReopenErr] = useState('');
  const [reopenBusy, setReopenBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  /** 인쇄에 넣을 묶음 — 기본은 전부 */
  const [printParts, setPrintParts] = useState<PrintPart[]>(PRINT_PARTS.map((p) => p.key));
  const navRef = useRef<HTMLDivElement>(null);

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

      const [revRes, roundRes, albumRes, cmtRes] = await Promise.all([
        supabase.from('app_reviewers').select('member_id').eq('app_id', id),
        supabase.from('rounds').select('*').eq('app_id', id).order('round_no', { ascending: false }),
        supabase.from('albums').select('*').eq('app_id', id).order('class_date', { ascending: false }),
        supabase.from('comments').select('id', { count: 'exact', head: true }).eq('app_id', id).eq('resolved', false),
      ]);

      setReviewerIds((revRes.data ?? []).map((r) => r.member_id));
      const rs = (roundRes.data ?? []) as Round[];
      setRounds(rs);
      setOpenComments(cmtRes.count ?? 0);

      const als = (albumRes.data ?? []) as Album[];
      setAlbums(als);
      if (als.length > 0) {
        const { data: ps } = await supabase
          .from('photos')
          .select('*')
          .in('album_id', als.map((x) => x.id))
          .order('created_at', { ascending: false })
          .limit(60);
        setPhotos((ps ?? []) as Photo[]);
      } else {
        setPhotos([]);
      }

      // 지적 + 캡처 + 답변 + 검증완료 표시. 라운드가 늘어도 쿼리 수는 그대로다
      const { data: fds } = await supabase
        .from('findings')
        .select('*')
        .eq('app_id', id)
        .order('created_at', { ascending: false });
      const fdRows = (fds ?? []) as Finding[];
      setFindings(fdRows);

      if (fdRows.length > 0) {
        const ids = fdRows.map((f) => f.id);
        const [flRes, rpRes] = await Promise.all([
          supabase.from('finding_files').select('*').in('finding_id', ids).order('sort_order'),
          supabase.from('finding_replies').select('*').in('finding_id', ids).order('created_at'),
        ]);
        setFindingFiles((flRes.data ?? []) as FindingFile[]);
        setFindingReplies((rpRes.data ?? []) as FindingReply[]);
      } else {
        setFindingFiles([]);
        setFindingReplies([]);
      }

      if (rs.length > 0) {
        const { data: so } = await supabase
          .from('round_signoffs')
          .select('*')
          .in('round_id', rs.map((r) => r.id));
        setSignoffs((so ?? []) as RoundSignoff[]);
      } else {
        setSignoffs([]);
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

  const bundle = useMemo(
    () => bundleFindings(findings, findingFiles, findingReplies, signoffs),
    [findings, findingFiles, findingReplies, signoffs],
  );

  const currentFindings = useMemo(
    () => (currentRound ? findings.filter((f) => f.round_id === currentRound.id) : []),
    [findings, currentRound],
  );
  // 지금 검증자로 배정된 사람의 표시만 센다.
  // 배정에서 빠진 사람의 낡은 기록이 남아 있으면 정족수가 부풀려진다
  const signedCount = currentRound
    ? signoffs.filter((s) => s.round_id === currentRound.id && reviewerIds.includes(s.member_id)).length
    : 0;
  const status = computeStatus(currentFindings, reviewerIds.length, signedCount);
  const progress = roundProgress(reviewerIds.length, signedCount);
  const openCount = openFindings(currentFindings).length;

  /** 스크롤에 따라 목차 칩을 따라가게 */
  useEffect(() => {
    if (loading) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: '-120px 0px -60% 0px', threshold: 0 },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [loading]);

  const goto = (sid: string) => {
    window.dispatchEvent(new CustomEvent('moalab:open-section', { detail: sid }));
    setActive(sid);
    // 펼쳐지면서 높이가 바뀌므로 한 프레임 뒤에 위치를 잡는다
    requestAnimationFrame(() => {
      const el = document.getElementById(sid);
      if (!el) return;
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 100, behavior: 'smooth' });
    });
  };

  const reopen = async () => {
    setReopenErr('');
    if (!changeNote.trim()) {
      setReopenErr('무엇을 수정했는지 적어주세요. 이게 있어야 검증자가 뭘 다시 볼지 알 수 있어요.');
      return;
    }
    setReopenBusy(true);
    try {
      const round = await openNextRound(id, changeNote.trim());
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
        <PageHeader title="프로그램" back="/apps" />
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

      {/* 목차 — 노션 페이지 상단 목차처럼 */}
      <div
        ref={navRef}
        className="sticky top-[53px] z-20 border-b border-neutral-200 bg-surface/95 backdrop-blur"
      >
        {/* 목차도 본문과 같은 폭으로 잘라서 왼쪽 선을 맞춘다 */}
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 py-2 lg:max-w-4xl">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => goto(s.id)}
              className={`flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[12.5px] font-bold transition ${
                active === s.id ? 'bg-brand text-white' : 'bg-neutral-100 text-neutral-500'
              }`}
            >
              <Icon name={s.icon} size={13} />
              {s.label}
              {s.id === 'comment' && openComments > 0 && (
                <span
                  className={`ml-0.5 rounded-full px-1 text-[10px] ${
                    active === s.id ? 'bg-surface/25' : 'bg-brand text-white'
                  }`}
                >
                  {openComments}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* 프로그램 페이지는 위에서 아래로 읽는 한 장의 문서다. 단일 컬럼이라
          폭을 안 막으면 PC 에서 '수정완료 로 답변 올리기' 같은 버튼이 화면 끝까지 늘어난다.
          가운데 정렬은 안 한다 — 헤더·사이드바와 왼쪽 선을 맞춰야 하기 때문. */}
      <div className="px-4 pb-10 pt-4 lg:max-w-4xl">
        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} onRetry={() => void load()} />
          </div>
        )}

        {/* ------------------------------------------------ 속성 블록 */}
        <div className="card overflow-hidden">
          <div className="border-b border-neutral-100 px-4 py-3.5">
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
              <span className="w-16 shrink-0 text-right text-[12px] font-bold text-neutral-500">
                검증 {signedCount}/{reviewerIds.length}
              </span>
            </div>
          </div>

          <dl className="divide-y divide-neutral-100">
            <Prop icon="user" label="제작자">
              <span className="flex items-center gap-1.5">
                {app.creator_id && <Avatar name={nameOf(app.creator_id)} size={20} />}
                <span className="font-semibold">{nameOf(app.creator_id)}</span>
              </span>
            </Prop>
            <Prop icon="users" label="검증자">
              {reviewerIds.length === 0 ? (
                <span className="text-neutral-400">미배정</span>
              ) : (
                <span className="flex flex-wrap items-center gap-1.5">
                  {reviewerIds.map((r) => (
                    <span key={r} className="flex items-center gap-1 rounded-full bg-neutral-100 py-0.5 pl-0.5 pr-2">
                      <Avatar name={nameOf(r)} size={18} />
                      <span className="text-[12.5px] font-semibold">{nameOf(r)}</span>
                    </span>
                  ))}
                </span>
              )}
            </Prop>
            <Prop icon="calendar" label="마감일">
              {app.due_date ? korDateFull(app.due_date) : <span className="text-neutral-400">없음</span>}
            </Prop>
            <Prop icon="cap" label="대상 학년">
              {app.target_grade || <span className="text-neutral-400">미입력</span>}
            </Prop>
            <Prop icon="link" label="배포 링크">
              {app.url ? (
                <a href={app.url} target="_blank" rel="noreferrer" className="break-all text-brand underline">
                  {app.url}
                </a>
              ) : (
                <span className="text-neutral-400">없음</span>
              )}
            </Prop>
            {app.purpose && (
              <Prop icon="target" label="제작 목적">
                <span className="whitespace-pre-wrap leading-relaxed">{app.purpose}</span>
              </Prop>
            )}
          </dl>

          {/* 폰은 2열(인쇄만 한 줄 통째), PC 는 3열 한 줄 —
              화면이 넓다고 버튼까지 가로로 쭉 늘어나면 오히려 보기 힘들다 */}
          <div className="grid grid-cols-2 gap-2 border-t border-neutral-100 p-3 lg:grid-cols-3">
            {app.url ? (
              <a href={app.url} target="_blank" rel="noreferrer" className="btn-primary gap-1.5">
                앱 열어보기
                <Icon name="external" size={14} />
              </a>
            ) : (
              <span />
            )}
            {canReopen && (
              <button onClick={() => setReopenOpen(true)} className="btn-ghost gap-1.5">
                <Icon name="refresh" size={14} />
                재검증 요청
              </button>
            )}
            <button onClick={() => setPrintOpen(true)} className="btn-ghost col-span-2 gap-1.5 lg:col-span-1">
              <Icon name="printer" size={14} />
              인쇄 / PDF 저장
            </button>
          </div>
        </div>

        {/* ------------------------------------------------------ 검증 */}
        <Section
          id="verify"
          icon="checkCircle"
          title="검증"
          defaultOpen
          badge={openCount > 0 ? `지적 ${openCount}` : `${signedCount}/${reviewerIds.length}`}
        >
          {!currentRound ? (
            <p className="py-6 text-center text-[13.5px] text-neutral-400">아직 검증 라운드가 없어요.</p>
          ) : (
            <>
              {currentRound.change_note && (
                <div className="mb-3 rounded-xl bg-brand-50 px-3.5 py-3">
                  <p className="text-[11.5px] font-bold text-brand-700">
                    {currentRound.round_no}차 — 이번에 수정한 내용
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed text-neutral-700">
                    {currentRound.change_note}
                  </p>
                </div>
              )}

              <Findings
                appId={id}
                appSlug={app.slug}
                appTitle={app.title_ko}
                round={currentRound}
                reviewerIds={reviewerIds}
                members={members.filter((m) => m.active)}
                bundle={bundle}
                nameOf={nameOf}
                onChanged={() => {
                  toast.show('저장했어요.');
                  void load();
                }}
              />
            </>
          )}

          {rounds.length > 1 && (
            <div className="mt-5">
              <p className="mb-2 text-[13px] font-bold text-neutral-500">지난 검증 기록</p>
              <FindingHistory rounds={rounds.slice(1)} bundle={bundle} nameOf={nameOf} />
            </div>
          )}
        </Section>

        {/* ------------------------------------------------ 수업계획안
            위: 양식 그대로 채우는 강의계획서 (그대로 인쇄된다)
            아래: 한글 원본 첨부 + 판(버전) — 예전부터 쓰던 것을 그대로 둔다 */}
        <Section id="plan" icon="doc" title="강의계획서">
          <PlanForm appId={id} appSlug={app.slug} appTitle={app.title_ko} nameOf={nameOf} />
        </Section>

        <Section id="planfile" icon="clip" title="계획안 첨부파일">
          <LessonPlan appId={id} appSlug={app.slug} appTitle={app.title_ko} nameOf={nameOf} />
        </Section>

        {/* -------------------------------------------------------- 원가 */}
        <Section id="cost" icon="won" title="원가">
          <CostInline appId={id} appTitle={app.title_ko} appSlug={app.slug} />
        </Section>

        {/* -------------------------------------------------- 샘플 이미지 */}
        <Section id="sample" icon="image" title="샘플 이미지">
          <SampleImages appId={id} appSlug={app.slug} />
        </Section>

        {/* --------------------------------------------------- 수업 사진 */}
        <Section
          id="photos"
          icon="camera"
          title="수업 사진"
          badge={photos.length > 0 ? `${photos.length}장` : undefined}
          right={
            <Link href={`/gallery?app=${id}`} className="text-[12.5px] font-bold text-brand">
              전체 보기 ›
            </Link>
          }
        >
          {albums.length === 0 ? (
            <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50/60 px-4 py-6 text-center">
              <Icon name="camera" size={22} className="text-neutral-300" />
              <p className="mt-1.5 text-[13px] font-semibold text-neutral-500">아직 수업 사진이 없어요</p>
              <Link href="/gallery" className="mt-3 inline-block text-[12.5px] font-bold text-brand">
                갤러리에서 앨범 만들기 ›
              </Link>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-1.5">
                {photos.slice(0, 8).map((p) => (
                  <Link
                    key={p.id}
                    href={`/gallery/${p.album_id}`}
                    className="relative aspect-square overflow-hidden rounded-lg bg-neutral-100"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={p.caption ?? ''} loading="lazy" className="h-full w-full object-cover" />
                    {p.has_face && (
                      <span className="absolute left-0.5 top-0.5 rounded bg-black/60 px-1 text-[9px] font-bold text-white">
                        얼굴O
                      </span>
                    )}
                  </Link>
                ))}
              </div>
              <ul className="mt-2.5 divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200">
                {albums.slice(0, 4).map((al) => (
                  <li key={al.id}>
                    <Link
                      href={`/gallery/${al.id}`}
                      className="flex items-center justify-between px-3 py-2.5 active:bg-neutral-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-semibold">{al.school}</span>
                        <span className="text-[11.5px] text-neutral-500">
                          {korDate(al.class_date)}
                          {al.grade ? ` · ${al.grade}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-[12px] text-neutral-400">
                        {photos.filter((p) => p.album_id === al.id).length}장 ›
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>

        {/* -------------------------------------------------------- 댓글 */}
        <Section id="comment" icon="comment" title="댓글" badge={openComments > 0 ? `미해결 ${openComments}` : undefined}>
          <CommentThread appId={id} appSlug={app.slug} />
        </Section>

        {isAdmin && (
          <button onClick={() => setArchiveOpen(true)} className="btn-ghost mt-6 w-full text-neutral-500">
            {app.archived ? '보관 해제' : '이 프로그램 보관하기'}
          </button>
        )}
      </div>

      {/* 재검증 */}
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

      {/* 인쇄할 것 고르기 */}
      <Sheet open={printOpen} onClose={() => setPrintOpen(false)} title="인쇄 / PDF 저장">
        <div className="space-y-3">
          <p className="text-[13px] leading-relaxed text-neutral-500">
            인쇄물에 넣을 것을 골라주세요. 표지(제목·상태·제작자·마감)가 맨 앞에 붙습니다.
            <br />
            <b>강의계획서만</b> 고르면 표지 없이 그 한 장만 나갑니다 — 학교에 낼 때 쓰세요.
          </p>

          {/* 학교에 내는 건 계획서 한 장이다. 매번 다섯 개를 꺼서 만드는 건 번거롭다 */}
          <button
            type="button"
            onClick={() => setPrintParts(['plan'])}
            className="tap w-full gap-1.5 rounded-xl border border-brand bg-brand-50 text-[13.5px] font-bold text-brand-700"
          >
            <Icon name="doc" size={15} />
            강의계획서 한 장만
          </button>

          <div className="space-y-1.5">
            {PRINT_PARTS.map((p) => {
              const on = printParts.includes(p.key);
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() =>
                    setPrintParts((v) => (on ? v.filter((x) => x !== p.key) : [...v, p.key]))
                  }
                  aria-pressed={on}
                  className={`tap w-full justify-start gap-2.5 rounded-xl border px-3 text-[14px] font-semibold transition ${
                    on ? 'border-brand bg-brand-50 text-brand-700' : 'border-neutral-200 bg-surface text-neutral-500'
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                      on ? 'border-brand bg-brand text-white' : 'border-neutral-300'
                    }`}
                  >
                    {on && <Icon name="check" size={12} strokeWidth={3} />}
                  </span>
                  {p.label}
                </button>
              );
            })}
          </div>

          <a
            href={`/print/${id}?parts=${printParts.join(',')}`}
            target="_blank"
            rel="noreferrer"
            onClick={() => setPrintOpen(false)}
            className={`btn-primary w-full ${printParts.length === 0 ? 'pointer-events-none opacity-40' : ''}`}
          >
            <Icon name="printer" size={15} />
            인쇄 화면 열기
          </a>

          <p className="text-[12px] leading-relaxed text-neutral-400">
            아이폰은 열린 화면에서 <b>공유 → 프린트</b>, PC 는 인쇄 대화상자에서
            대상을 <b>PDF로 저장</b> 으로 바꾸면 파일로 저장돼요.
          </p>
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
        title={app.archived ? '보관을 해제할까요?' : '이 프로그램을 보관할까요?'}
        message={app.archived ? '다시 목록에 나타나요.' : '목록에서 숨겨져요. 기록은 지워지지 않아요.'}
        confirmLabel={app.archived ? '해제' : '보관'}
        danger={!app.archived}
        onCancel={() => setArchiveOpen(false)}
        onConfirm={archive}
      />

      {toast.node}
      <StatusSync appId={id} deps={[reviewerIds.length]} />
      {members.length === 0 && null}
    </>
  );
}

/* --------------------------------------------------------------- 조각들 */

function Prop({ icon, label, children }: { icon: IconName; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 px-4 py-2">
      <dt className="flex w-[80px] shrink-0 items-center gap-1.5 text-[12.5px] text-neutral-500">
        <Icon name={icon} size={13} className="text-neutral-400" />
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-[13.5px] leading-snug text-neutral-800">{children}</dd>
    </div>
  );
}

/**
 * 접이식 섹션.
 * 전부 펼쳐두면 프로그램 페이지가 6000px 를 넘어가 폰에서 스크롤이 고역이라
 * 기본은 '검증'만 열어두고 나머지는 제목만 보여준다.
 */
function Section({
  id,
  icon,
  title,
  badge,
  right,
  defaultOpen = false,
  children,
}: {
  id: string;
  icon: IconName;
  title: string;
  badge?: string;
  right?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // 목차에서 이 섹션을 누르면 자동으로 펼친다
  useEffect(() => {
    const onOpen = (e: Event) => {
      if ((e as CustomEvent<string>).detail === id) setOpen(true);
    };
    window.addEventListener('moalab:open-section', onOpen);
    return () => window.removeEventListener('moalab:open-section', onOpen);
  }, [id]);

  return (
    <section id={id} className="mt-3 scroll-mt-28">
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 pr-3">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex min-h-[52px] flex-1 items-center gap-2 px-4 text-left"
          >
            <Icon name={icon} size={16} className={open ? 'text-brand' : 'text-neutral-400'} />
            <span className="text-[15px] font-bold text-neutral-900">{title}</span>
            {badge && (
              <span className="chip bg-neutral-100 text-neutral-500">{badge}</span>
            )}
            <Icon
              name="chevronDown"
              size={15}
              className={`ml-auto text-neutral-300 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>
          {open && right}
        </div>
        {open && <div className="border-t border-neutral-100 p-3.5">{children}</div>}
      </div>
    </section>
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
