'use client';

import { useLayoutEffect, useRef } from 'react';
import type { LessonPlan, LessonPlanItem, PlanSlot } from '@/lib/types';

/* ------------------------------------------------------- 강의계획서 표
   원장이 준 한글 양식(강의계획서.hwp)과 같은 표다.
   칸 이름·순서·병합을 그대로 옮겼으므로 PlanForm 의 칸을 바꾸면 여기도 같이 고쳐야 한다.

   표는 3칸이다. 보통 줄은 [과정 | 강의내용(2칸 병합)] 이고,
   운영사항 줄만 [운영사항(2줄 병합) | 교구·기타사항 | 내용] 으로 갈라진다.

   ★ 이 장은 **늘 A4 단면 한 장**이다.
   장 전체를 인쇄 영역 크기(186×268mm)로 고정해 두고, 사진 칸 높이(--ph)를
   "이 장이 안 넘치는 가장 큰 값"으로 잰다(이진 탐색). 사진을 몇 장을 올리든
   사진이 줄어들 뿐 표가 두 쪽으로 넘어가지 않고, 반대로 내용이 적으면
   같은 탐색이 사진을 키워 아래까지 채운다 (예전 fill 옵션이 하던 일까지 겸한다).
   사진은 칸 안에 contain 으로 들어가므로 비율이 제각각이어도 잘리지 않는다.
   화면에서는 같은 장을 폭에 맞게 축소해서(transform) 보여준다 —
   화면에 보이는 배치가 곧 인쇄 배치다. */

const LINE = '#b9c4de';
const FILL = '#dce4f5';

/* A4 210×297mm 에서 @page 여백(위아래 14mm·양옆 12mm)을 뺀 인쇄 영역.
   높이는 반올림 오차로 빈 쪽이 딸려 나오지 않게 1mm 여유를 둔다 */
const SHEET_W_MM = 186;
const SHEET_H_MM = 268;
const PX_PER_MM = 96 / 25.4; // CSS 의 mm→px 는 화면 배율과 무관한 고정 비율이다
const PHOTO_MIN_PX = 15 * PX_PER_MM; // 이보다 줄여도 안 들어가면 글이 너무 긴 것 — 미리보기에 그대로 보인다
const PHOTO_MAX_PX = 95 * PX_PER_MM;

export function PlanSheet({
  plan,
  items,
  title,
}: {
  plan: LessonPlan;
  items: LessonPlanItem[];
  title: string;
}) {
  const bySlot = (s: PlanSlot) =>
    items.filter((i) => i.slot === s).sort((a, b) => a.sort_order - b.sort_order);
  const steps = bySlot('step');
  const orders = bySlot('order');
  const results = bySlot('result');

  const outerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    /* 사진 칸 높이 맞추기 — 사진 칸만 --ph 로 움직이고 글 칸은 제 높이 그대로다.
       칸 높이가 고정이라 사진이 늦게 로드돼도 배치는 안 변한다 (기다릴 필요 없음) */
    const fitPhotos = () => {
      const el = sheetRef.current;
      if (!el) return;
      const fits = (h: number) => {
        el.style.setProperty('--ph', `${h}px`);
        return el.scrollHeight <= el.clientHeight;
      };
      let lo = PHOTO_MIN_PX;
      let hi = PHOTO_MAX_PX;
      if (!fits(lo)) return; // 최소로 줄여도 넘침 — 최소로 두고 넘친 글은 미리보기에서 잘려 보인다
      if (fits(hi)) return; // 최대로 키워도 남음 — 최대로 둔다
      while (hi - lo > 1) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
      fits(lo);
    };

    /* 화면 미리보기 — 장이 화면보다 넓으면(폰) 폭에 맞게 통째로 줄인다.
       인쇄에서는 globals.css 의 .print-a4-sheet 가 원래 크기로 되돌린다 */
    const rescale = () => {
      const outer = outerRef.current;
      const sheet = sheetRef.current;
      if (!outer || !sheet) return;
      const sw = SHEET_W_MM * PX_PER_MM;
      const sh = SHEET_H_MM * PX_PER_MM;
      const k = Math.min(1, outer.clientWidth / sw);
      sheet.style.transform = `scale(${k})`;
      sheet.style.marginLeft = `${Math.max(0, (outer.clientWidth - sw * k) / 2)}px`;
      outer.style.height = `${sh * k}px`;
    };

    fitPhotos();
    rescale();
    // 웹폰트(에스코어드림)가 늦게 오면 글 높이가 바뀐다 — 오고 나서 한 번 더 잰다
    void document.fonts?.ready?.then(() => fitPhotos());
    window.addEventListener('resize', rescale);
    return () => window.removeEventListener('resize', rescale);
  }, [plan, items, title]);

  const head = `border p-1.5 text-center align-middle font-bold`;
  const body = `border p-2 align-top whitespace-pre-wrap leading-relaxed`;

  return (
    <div ref={outerRef} className="print-a4-outer overflow-hidden">
      <div
        ref={sheetRef}
        className="print-a4-sheet flex origin-top-left flex-col overflow-hidden bg-white"
        style={
          {
            width: `${SHEET_W_MM}mm`,
            height: `${SHEET_H_MM}mm`,
            borderColor: LINE,
            '--ph': '52mm',
          } as React.CSSProperties
        }
      >
        <h2 className="mb-3 text-center text-[21px] font-black tracking-[0.25em]">강의계획서</h2>

        {/* 표가 남는 높이를 다 갖고, 그 높이는 h-full 을 준 전개 줄이 가져간다
            (표에서 height 는 최소 높이라 다른 줄은 제 내용만큼만 차지한다) */}
        <table
          className="w-full flex-1 table-fixed border-collapse text-[11.5px]"
          style={{ borderColor: LINE }}
        >
          <colgroup>
            <col style={{ width: '84px' }} />
            <col style={{ width: '78px' }} />
            <col />
          </colgroup>
          <tbody style={{ borderColor: LINE }}>
            {/* 프로그램명 + 분류 배지 */}
            <tr>
              <td colSpan={3} className="border p-2" style={{ borderColor: LINE, background: FILL }}>
                <div className="relative flex items-center justify-center">
                  <span className="text-[14.5px] font-bold">{title}</span>
                  {plan.category && (
                    <span
                      className="absolute right-0 rounded-full px-2 py-[3px] text-[9.5px] font-bold text-white"
                      style={{ background: '#3f5aa6' }}
                    >
                      {plan.category}
                    </span>
                  )}
                </div>
              </td>
            </tr>

            <tr>
              <td className={head} style={{ borderColor: LINE, background: FILL }}>
                과 정
              </td>
              <td colSpan={2} className={head} style={{ borderColor: LINE, background: FILL }}>
                강 의 내 용
              </td>
            </tr>

            <PlanRow label="목 표">{plan.goal}</PlanRow>
            <PlanRow label="도 입">{plan.intro}</PlanRow>

            {/* 전개 — 웹앱활동(가로 3칸) + 활동작품(만드는 순서 / 결과 이미지).
                항목이 없는 블록은 제목까지 통째로 뺀다 — 빈 제목만 남으면
                덜 만든 문서처럼 보인다 */}
            <tr className="h-full">
              <td className={head} style={{ borderColor: LINE, background: FILL }}>
                전 개
              </td>
              <td colSpan={2} className={`${body} whitespace-normal`} style={{ borderColor: LINE }}>
                {plan.dev_title && steps.length > 0 && <p className="font-bold">{plan.dev_title}</p>}
                {steps.length > 0 && (
                  <div className="mt-1.5 grid grid-cols-3 gap-2">
                    {steps.map((s, i) => (
                      <div key={s.id} className="flex flex-col">
                        <p className="pb-1 text-[10.5px] font-semibold leading-snug">
                          {i + 1}. {s.label}
                        </p>
                        {/* 사진 칸 높이는 --ph — 위의 fitPhotos 가 한 장에 맞게 잰다.
                            비율이 제각각이라도 자르지 않는다(contain).
                            3칸짜리 웹앱활동 칸은 폭이 좁아 너무 길어지지 않게 따로 캡을 둔다 */}
                        {s.url && (
                          <span
                            className="relative mt-auto block w-full overflow-hidden"
                            style={{ height: 'min(var(--ph), 60mm)' }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={s.url} alt="" className="absolute inset-0 h-full w-full object-contain" />
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {plan.work_title && (orders.length > 0 || results.length > 0) && (
                  <p className="mt-3 font-bold">{plan.work_title}</p>
                )}
                {(orders.length > 0 || results.length > 0) && (
                  <div className="mt-1.5 grid grid-cols-2 gap-3">
                    <PlanWorkCol title="*만드는 순서" rows={orders} />
                    <PlanWorkCol title="* 결과 이미지" rows={results} />
                  </div>
                )}
              </td>
            </tr>

            <PlanRow label="마 무 리">{plan.closing}</PlanRow>

            {/* 운영사항 — 왼쪽 칸이 두 줄에 걸친다 */}
            <tr>
              <td rowSpan={2} className={head} style={{ borderColor: LINE, background: FILL }}>
                운 영 사 항
              </td>
              <td className={head} style={{ borderColor: LINE, background: FILL }}>
                교 구
              </td>
              <td className={body} style={{ borderColor: LINE }}>
                {plan.tools}
              </td>
            </tr>
            <tr>
              <td className={head} style={{ borderColor: LINE, background: FILL }}>
                기타사항
              </td>
              <td className={body} style={{ borderColor: LINE }}>
                {plan.etc}
              </td>
            </tr>
          </tbody>
        </table>

        {/* 맨 아래 — 로고를 올렸으면 로고, 없으면 기본 문구. 장 높이가 고정이라 늘 장의 맨 아래에 붙는다 */}
        {plan.logo_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={plan.logo_url} alt="" className="mx-auto mt-4 h-11 shrink-0 object-contain" />
        ) : (
          <p className="mt-4 shrink-0 text-center text-[10.5px] tracking-wide text-neutral-500">
            모아킷_교육을 위한 모든 것
          </p>
        )}
      </div>
    </div>
  );
}

/** 보통 줄 — 왼쪽 과정 칸 + 오른쪽 내용(2칸 병합) */
function PlanRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <td
        className="border p-1.5 text-center align-middle font-bold"
        style={{ borderColor: LINE, background: FILL }}
      >
        {label}
      </td>
      <td
        colSpan={2}
        className="border whitespace-pre-wrap p-2 align-top leading-relaxed"
        style={{ borderColor: LINE }}
      >
        {children}
      </td>
    </tr>
  );
}

function PlanWorkCol({ title, rows }: { title: string; rows: LessonPlanItem[] }) {
  return (
    <div>
      <p className="text-[10.5px] font-bold">{title}</p>
      <ul className="mt-1 space-y-1.5">
        {rows.map((r) => (
          <li key={r.id}>
            {r.label && <p className="pb-0.5 text-[10.5px] leading-snug">{r.label}</p>}
            {/* 사진 칸 높이는 --ph — 사진이 많으면 fitPhotos 가 전부 같이 줄인다.
                자르지 않고(contain) 글 바로 아래에 붙인다(object-top) */}
            {r.url && (
              <span
                className="relative block w-full overflow-hidden"
                style={{ height: 'min(var(--ph), 92mm)' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.url} alt="" className="absolute inset-0 h-full w-full object-contain object-top" />
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
