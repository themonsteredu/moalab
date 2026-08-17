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
  LECTURE_INTRO,
  LECTURE_PHOTO_LIMIT,
  LECTURE_TOOLS,
} from '@/lib/lecture';
import type { AppRow, AppSample, Photo } from '@/lib/types';

/**
 * 강의계획서 — 학교에 보내는 한 장짜리 서식.
 *
 * `/print/[id]` (내부용 종합 문서)와 다르게 이 화면은 **외부 제출용**이라
 * 검증·원가 같은 내부 정보는 싣지 않는다.
 *
 * - 목표는 앱의 '목적' 칸, [AI 웹앱활동]은 샘플 이미지(캡션 포함),
 *   [활동작품]은 이 프로그램의 수업 사진에서 가져온다.
 * - 내용이 적어 한 장이 안 차면 **사진 칸이 늘어나 A4 아래까지 채운다**
 *   (본문을 flex 로 두고 전개 칸만 flex-1). 내용이 많으면 그냥 다음 장으로 넘어간다.
 * - **활동작품이 없으면 그 블록 자체를 싣지 않는다.** 빈 제목만 남으면
 *   덜 만든 문서처럼 보인다. [AI 웹앱활동]도 마찬가지다.
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
  const [samples, setSamples] = useState<AppSample[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
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

      const [sampleRes, albumRes] = await Promise.all([
        supabase.from('app_samples').select('*').eq('app_id', id).order('sort_order'),
        supabase.from('albums').select('id').eq('app_id', id),
      ]);
      setSamples((sampleRes.data ?? []) as AppSample[]);

      const albumIds = (albumRes.data ?? []).map((x) => x.id);
      if (albumIds.length > 0) {
        const { data: ps } = await supabase
          .from('photos')
          .select('*')
          .in('album_id', albumIds)
          .order('created_at', { ascending: false })
          .limit(LECTURE_PHOTO_LIMIT);
        setPhotos((ps ?? []) as Photo[]);
      }
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

  const sampleCols = Math.min(3, Math.max(1, samples.length));

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
          아이폰은 <b>공유 → 프린트</b> 를 누른 뒤 미리보기를 두 손가락으로 벌리면 PDF 로 저장됩니다.
          <br />
          PC 는 인쇄 대화상자에서 대상을 <b>PDF로 저장</b> 으로 바꾸세요.
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
            {LECTURE_BADGE}
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
          {app.purpose ? (
            <p className="whitespace-pre-wrap text-[12px] leading-relaxed">{app.purpose}</p>
          ) : (
            <p className="no-print text-[11.5px] text-neutral-400">
              프로그램의 <b>목적</b> 칸을 채우면 여기에 목표로 실려요.
            </p>
          )}
        </LectureRow>

        {/* ------------------------------------------------------ 도입 */}
        <LectureRow label="도입">
          <ol className="space-y-0.5 text-[12px] leading-relaxed">
            {LECTURE_INTRO.map((line, i) => (
              <li key={line}>
                {i + 1}. {line}
              </li>
            ))}
          </ol>
        </LectureRow>

        {/* ------------------------------------------------------ 전개 */}
        {/* 이 줄만 flex-1 — 한 장이 안 찰 때 남는 높이를 전부 가져가 사진이 늘어난다 */}
        <LectureRow label="전개" grow>
          {samples.length > 0 && (
            <div className="flex min-h-0 flex-1 flex-col">
              <p className="mb-1.5 text-[12px] font-black">[AI 웹앱활동]</p>
              <div
                className={`grid min-h-0 flex-1 auto-rows-fr gap-2 ${
                  sampleCols === 1 ? 'grid-cols-1' : sampleCols === 2 ? 'grid-cols-2' : 'grid-cols-3'
                }`}
              >
                {samples.map((s, i) => (
                  <figure key={s.id} className="print-block flex min-h-0 flex-col">
                    {s.caption && (
                      <figcaption className="mb-1 text-[11px] font-semibold leading-snug">
                        {i + 1}. {s.caption}
                      </figcaption>
                    )}
                    {/* 이미지를 absolute 로 깔아야 사진 비율이 칸 높이를 못 정한다.
                        안 그러면 세로 사진 한 장에 문서가 두 장으로 넘어간다.
                        늘어나되 70mm 에서 멈춘다 — 남는 높이를 다 먹이면 세로로 길쭉해져 어색하다 */}
                    <div className="relative min-h-[30mm] max-h-[70mm] w-full flex-1 border border-neutral-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={s.url}
                        alt={s.caption ?? `활동 ${i + 1}`}
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    </div>
                  </figure>
                ))}
              </div>
            </div>
          )}

          {/* 활동작품이 없으면 제목까지 통째로 뺀다 — 빈 제목만 남으면 덜 만든 문서처럼 보인다 */}
          {photos.length > 0 && (
            <div className={`flex min-h-0 flex-1 flex-col ${samples.length > 0 ? 'mt-3' : ''}`}>
              <p className="mb-1.5 text-[12px] font-black">[활동작품]</p>
              <div
                className={`grid min-h-0 flex-1 auto-rows-fr gap-2 ${
                  photos.length === 1 ? 'grid-cols-1' : photos.length === 2 ? 'grid-cols-2' : 'grid-cols-3'
                }`}
              >
                {photos.map((p) => (
                  <div key={p.id} className="print-block relative min-h-[30mm] max-h-[70mm] w-full border border-neutral-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.url}
                      alt={p.caption ?? '활동작품'}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {samples.length === 0 && photos.length === 0 && (
            <div className="flex flex-1 items-center justify-center">
              <p className="no-print text-center text-[11.5px] leading-relaxed text-neutral-400">
                샘플 이미지를 올리면 [AI 웹앱활동]으로,
                <br />
                수업 사진을 올리면 [활동작품]으로 실려요.
              </p>
            </div>
          )}
        </LectureRow>

        {/* ---------------------------------------------------- 마무리 */}
        <LectureRow label="마무리">
          <p className="text-[12px] leading-relaxed">{LECTURE_CLOSING}</p>
        </LectureRow>

        {/* -------------------------------------------------- 운영사항 */}
        <LectureRow label="운영사항" padded={false} last>
          <div className="flex border-b border-neutral-300">
            <div className="flex w-[72px] shrink-0 items-center justify-center border-r border-neutral-300 bg-neutral-50 py-2 text-[12px] font-bold tracking-[0.2em] [text-indent:0.2em]">
              교구
            </div>
            <p className="min-w-0 flex-1 px-3 py-2 text-[12px] leading-relaxed">{LECTURE_TOOLS}</p>
          </div>
          <div className="flex flex-1">
            <div className="flex w-[72px] shrink-0 items-center justify-center border-r border-neutral-300 bg-neutral-50 py-2 text-[12px] font-bold">
              기타사항
            </div>
            <p className="min-w-0 flex-1 px-3 py-2 text-[12px]" />
          </div>
        </LectureRow>
      </div>

      <footer className="mt-3 border-t border-neutral-300 pt-2 text-[10.5px] text-neutral-500">
        모아킷_교육을 위한 모든 것
      </footer>
    </main>
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
