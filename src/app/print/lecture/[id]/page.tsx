'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { Icon } from '@/components/Icon';
import { ErrorBanner } from '@/components/ui';
import {
  LECTURE_BADGE,
  LECTURE_CLOSING,
  LECTURE_DEV_TITLE,
  LECTURE_PHOTO_LIMIT,
  LECTURE_TOOLS,
  LECTURE_WORK_TITLE,
  lectureIntroText,
} from '@/lib/lecture';
import type { AppRow, AppSample, LecturePlanItem, LecturePlanRow, Photo } from '@/lib/types';

/** 서식에 실리는 이미지 한 칸 — 강의계획서 항목·샘플·수업 사진을 한 모양으로 */
interface SheetImage {
  key: string;
  url: string;
  label: string | null;
}

/**
 * 강의계획서 — 학교에 보내는 한 장짜리 서식.
 *
 * `/print/[id]` (내부용 종합 문서)와 다르게 이 화면은 **외부 제출용**이라
 * 검증·원가 같은 내부 정보는 싣지 않는다.
 *
 * - 내용은 프로그램 화면의 **강의계획서 섹션**(`moalab.lesson_plans` +
 *   `lesson_plan_items`)에서 채운 그대로 실린다. 안 채운 칸은 기본 문구로,
 *   활동 화면이 없으면 샘플 이미지로, 활동작품이 없으면 수업 사진으로 대체한다.
 * - 내용이 적어 한 장이 안 차면 **사진 칸이 늘어나 A4 아래까지 채운다**
 *   (본문을 flex 로 두고 전개 칸만 flex-1). 사진은 70mm 에서 멈춘다 —
 *   남는 높이를 다 먹이면 세로로 길쭉해져 어색하다.
 * - **활동작품이 없으면 그 블록 자체를 싣지 않는다.** 빈 제목만 남으면
 *   덜 만든 문서처럼 보인다. 활동 화면 블록도 마찬가지다.
 *
 * PDF 라이브러리 없이 브라우저 인쇄를 쓰는 것은 다른 인쇄 화면과 같다.
 */
export default function LecturePrintPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  // 이 화면은 (app) 레이아웃 밖이라 로그인 가드를 직접 붙인다
  const { session, loading: sessionLoading } = useSession();

  useEffect(() => {
    if (!sessionLoading && !session) router.replace('/login');
  }, [session, sessionLoading, router]);

  const [app, setApp] = useState<AppRow | null>(null);
  const [plan, setPlan] = useState<LecturePlanRow | null>(null);
  const [steps, setSteps] = useState<SheetImage[]>([]);
  const [works, setWorks] = useState<SheetImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const { data: a, error: aErr } = await supabase.from('apps').select('*').eq('id', id).maybeSingle();
      if (aErr) throw aErr;
      if (!a) {
        setError('프로그램을 찾지 못했어요.');
        setLoading(false);
        return;
      }
      setApp(a as AppRow);

      const [planRes, itemRes] = await Promise.all([
        supabase.from('lesson_plans').select('*').eq('app_id', id).maybeSingle(),
        supabase.from('lesson_plan_items').select('*').eq('app_id', id).order('slot').order('sort_order'),
      ]);
      setPlan((planRes.data ?? null) as LecturePlanRow | null);

      const items = ((itemRes.data ?? []) as LecturePlanItem[]).filter((i) => i.url);
      let stepImgs: SheetImage[] = items
        .filter((i) => i.slot === 'step')
        .map((i) => ({ key: i.id, url: i.url as string, label: i.label }));
      let workImgs: SheetImage[] = items
        .filter((i) => i.slot === 'work')
        .map((i) => ({ key: i.id, url: i.url as string, label: i.label }));

      // 활동 화면을 아직 안 올렸으면 샘플 이미지로 대신한다
      if (stepImgs.length === 0) {
        const { data: samples } = await supabase
          .from('app_samples')
          .select('*')
          .eq('app_id', id)
          .order('sort_order');
        stepImgs = ((samples ?? []) as AppSample[]).map((s) => ({ key: s.id, url: s.url, label: s.caption }));
      }

      // 활동작품이 없으면 이 프로그램의 수업 사진으로 대신한다
      if (workImgs.length === 0) {
        const { data: albums } = await supabase.from('albums').select('id').eq('app_id', id);
        const albumIds = (albums ?? []).map((x) => x.id);
        if (albumIds.length > 0) {
          const { data: ps } = await supabase
            .from('photos')
            .select('*')
            .in('album_id', albumIds)
            .order('created_at', { ascending: false })
            .limit(LECTURE_PHOTO_LIMIT);
          workImgs = ((ps ?? []) as Photo[]).map((p) => ({ key: p.id, url: p.url, label: null }));
        }
      }

      setSteps(stepImgs);
      setWorks(workImgs);
    } catch (e) {
      setError(friendlyError(e, '불러오지 못했어요.'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (sessionLoading || !session || loading) {
    return <p className="p-10 text-center text-[14px] text-neutral-500">인쇄할 내용을 준비하고 있어요…</p>;
  }
  if (error || !app) {
    return (
      <div className="p-6">
        <ErrorBanner message={error || '프로그램을 찾지 못했어요.'} />
      </div>
    );
  }

  const badge = plan?.category?.trim() || LECTURE_BADGE;
  const goalText = plan?.goal?.trim() || app.purpose?.trim() || '';
  const introText = plan?.intro?.trim() || lectureIntroText();
  const devTitle = plan?.dev_title?.trim() || LECTURE_DEV_TITLE;
  const workTitle = plan?.work_title?.trim() || LECTURE_WORK_TITLE;
  const closingText = plan?.closing?.trim() || LECTURE_CLOSING;
  const toolsText = plan?.tools?.trim() || LECTURE_TOOLS;
  const etcText = plan?.etc?.trim() || '';

  return (
    // A4(297mm) − 위아래 여백 14mm×2 = 269mm. 이 높이를 최소로 잡고 본문을
    // flex 로 세워서, 내용이 적으면 전개 칸(flex-1)이 늘어나 아래까지 채운다.
    <main className="mx-auto flex min-h-[269mm] max-w-[820px] flex-col bg-white p-6 text-black print:p-0">
      {/* 화면에서만 보이는 조작 줄 */}
      <div className="no-print mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-raised p-3">
        <button onClick={() => window.print()} className="btn-primary px-3.5 text-[14px]">
          <Icon name="printer" size={15} />
          인쇄 / PDF 저장
        </button>
        <button onClick={() => window.close()} className="btn-ghost px-3 text-[13px]">
          닫기
        </button>
        <p className="w-full text-[12px] leading-relaxed text-neutral-500">
          내용은 프로그램 화면의 <b>강의계획서</b> 섹션에서 고칠 수 있어요.
          <br />
          아이폰은 <b>공유 → 프린트</b> 를 누른 뒤 미리보기를 두 손가락으로 벌리면 PDF 로 저장됩니다. PC 는
          인쇄 대화상자에서 대상을 <b>PDF로 저장</b> 으로 바꾸세요.
        </p>
      </div>

      <h1 className="mb-4 text-center text-[24px] font-black tracking-[0.45em] [text-indent:0.45em]">
        강의계획서
      </h1>

      <div className="flex min-h-0 flex-1 flex-col border border-neutral-400">
        {/* ---------------------------------------------- 프로그램 이름 */}
        <div className="relative flex items-center justify-center border-b border-neutral-300 bg-neutral-100 px-16 py-2.5">
          <p className="text-[15px] font-black">{app.title_ko}</p>
          <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-neutral-800 px-2.5 py-1 text-[10px] font-bold leading-none text-white">
            {badge}
          </span>
        </div>

        {/* -------------------------------------------------- 칸 머리글 */}
        <div className="flex border-b border-neutral-300 bg-neutral-100 text-[12.5px] font-bold">
          <div className="w-[64px] shrink-0 border-r border-neutral-300 py-1.5 text-center tracking-[0.2em] [text-indent:0.2em]">
            과정
          </div>
          <div className="min-w-0 flex-1 py-1.5 text-center tracking-[0.3em] [text-indent:0.3em]">강의내용</div>
        </div>

        {/* ------------------------------------------------------ 목표 */}
        <LectureRow label="목표">
          {goalText ? (
            <p className="whitespace-pre-wrap text-[12px] leading-relaxed">{goalText}</p>
          ) : (
            <p className="no-print text-[11.5px] text-neutral-400">
              프로그램 화면의 <b>강의계획서</b> 섹션에서 목표를 채우면 여기에 실려요.
            </p>
          )}
        </LectureRow>

        {/* ------------------------------------------------------ 도입 */}
        <LectureRow label="도입">
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed">{introText}</p>
        </LectureRow>

        {/* ------------------------------------------------------ 전개 */}
        {/* 이 줄만 flex-1 — 한 장이 안 찰 때 남는 높이를 전부 가져가 사진이 늘어난다 */}
        <LectureRow label="전개" grow>
          {steps.length > 0 && (
            <div className="flex min-h-0 flex-1 flex-col">
              <p className="mb-1.5 text-[12px] font-black">{devTitle}</p>
              <ImageGrid images={steps} numbered />
            </div>
          )}

          {/* 활동작품이 없으면 제목까지 통째로 뺀다 — 빈 제목만 남으면 덜 만든 문서처럼 보인다 */}
          {works.length > 0 && (
            <div className={`flex min-h-0 flex-1 flex-col ${steps.length > 0 ? 'mt-3' : ''}`}>
              <p className="mb-1.5 text-[12px] font-black">{workTitle}</p>
              <ImageGrid images={works} />
            </div>
          )}

          {steps.length === 0 && works.length === 0 && (
            <div className="flex flex-1 items-center justify-center">
              <p className="no-print text-center text-[11.5px] leading-relaxed text-neutral-400">
                강의계획서 섹션에서 활동 화면을 올리면 {devTitle} 으로,
                <br />
                작품 사진을 올리면 {workTitle} 으로 실려요.
              </p>
            </div>
          )}
        </LectureRow>

        {/* ---------------------------------------------------- 마무리 */}
        <LectureRow label="마무리">
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed">{closingText}</p>
        </LectureRow>

        {/* -------------------------------------------------- 운영사항 */}
        <LectureRow label="운영사항" padded={false} last>
          <div className="flex border-b border-neutral-300">
            <div className="flex w-[72px] shrink-0 items-center justify-center border-r border-neutral-300 bg-neutral-50 py-2 text-[12px] font-bold tracking-[0.2em] [text-indent:0.2em]">
              교구
            </div>
            <p className="min-w-0 flex-1 px-3 py-2 text-[12px] leading-relaxed">{toolsText}</p>
          </div>
          <div className="flex flex-1">
            <div className="flex w-[72px] shrink-0 items-center justify-center border-r border-neutral-300 bg-neutral-50 py-2 text-[12px] font-bold">
              기타사항
            </div>
            <p className="min-w-0 flex-1 whitespace-pre-wrap px-3 py-2 text-[12px] leading-relaxed">{etcText}</p>
          </div>
        </LectureRow>
      </div>

      <footer className="mt-3 border-t border-neutral-300 pt-2 text-[10.5px] text-neutral-500">
        모아킷_교육을 위한 모든 것
      </footer>
    </main>
  );
}

/** 전개 칸의 이미지 묶음 — 남는 높이를 나눠 갖고, 사진 비율이 칸 높이를 못 정하게 absolute 로 깐다 */
function ImageGrid({ images, numbered = false }: { images: SheetImage[]; numbered?: boolean }) {
  const cols = Math.min(3, Math.max(1, images.length));
  return (
    <div
      className={`grid min-h-0 flex-1 auto-rows-fr gap-2 ${
        cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-2' : 'grid-cols-3'
      }`}
    >
      {images.map((img, i) => (
        <figure key={img.key} className="print-block flex min-h-0 flex-col">
          {img.label && (
            <figcaption className="mb-1 text-[11px] font-semibold leading-snug">
              {numbered ? `${i + 1}. ` : ''}
              {img.label}
            </figcaption>
          )}
          {/* 이미지를 absolute 로 깔아야 사진 비율이 칸 높이를 못 정한다.
              안 그러면 세로 사진 한 장에 문서가 두 장으로 넘어간다.
              늘어나되 70mm 에서 멈춘다 — 남는 높이를 다 먹이면 세로로 길쭉해져 어색하다 */}
          <div className="relative min-h-[30mm] max-h-[70mm] w-full flex-1 border border-neutral-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.url}
              alt={img.label ?? ''}
              className="absolute inset-0 h-full w-full object-cover"
            />
          </div>
        </figure>
      ))}
    </div>
  );
}

function LectureRow({
  label,
  grow,
  padded = true,
  last,
  children,
}: {
  label: string;
  /** 한 장이 안 찰 때 남는 높이를 가져갈 줄 (전개) */
  grow?: boolean;
  padded?: boolean;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex ${grow ? 'min-h-0 flex-1' : ''} ${last ? '' : 'border-b border-neutral-300'}`}>
      <div className="flex w-[64px] shrink-0 items-center justify-center border-r border-neutral-300 bg-neutral-100 px-1 py-2.5 text-center text-[12.5px] font-bold leading-tight">
        {label}
      </div>
      <div className={`flex min-w-0 flex-1 flex-col ${grow ? 'min-h-0' : ''} ${padded ? 'px-3 py-2.5' : ''}`}>
        {children}
      </div>
    </div>
  );
}
