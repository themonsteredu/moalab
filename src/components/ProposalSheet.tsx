'use client';

import { useLayoutEffect, useRef } from 'react';
import type { OrgProfile } from '@/lib/types';
import { grandTotal, hasUnpriced, lineTotal, orgLine, priceText, type ProposalInput } from '@/lib/proposal';

/* ------------------------------------------------------------ 제안서 A4
   강의계획서(PlanSheet)와 같은 방식이다 — 장 전체를 인쇄 영역 크기(186×268mm)로
   고정해 두고, 화면에서는 폭에 맞게 통째로 줄여 보여준다(transform). 인쇄에서는
   globals.css 의 .print-a4-sheet 가 원래 크기로 되돌린다. 화면 배치가 곧 인쇄 배치다.

   쪽 구성은 고정이다 — 1쪽 표지(받는 곳·인사말·요약표·맺음말), 그 뒤 **프로그램마다 한 쪽**.
   사진 칸 높이를 재서 맞추는 일은 안 한다 (계획서와 달리 글이 길어질 칸이 없다).
   넘치면 잘린 채 미리보기에 그대로 보인다. */

const SHEET_W_MM = 186;
const SHEET_H_MM = 268;
const PX_PER_MM = 96 / 25.4;
const LINE = '#b9c4de';
const FILL = '#dce4f5';

function A4Page({ first = false, children }: { first?: boolean; children: React.ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
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
    rescale();
    window.addEventListener('resize', rescale);
    return () => window.removeEventListener('resize', rescale);
  }, []);

  return (
    <div
      ref={outerRef}
      className={`print-a4-outer overflow-hidden ${first ? '' : 'print-page-break'} mb-4 print:mb-0`}
    >
      <div
        ref={sheetRef}
        className="print-a4-sheet relative origin-top-left overflow-hidden bg-white text-black"
        style={{ width: `${SHEET_W_MM}mm`, height: `${SHEET_H_MM}mm` }}
      >
        {children}
      </div>
    </div>
  );
}

/** 모든 쪽 맨 아래 — 회사 한 줄 */
function Footer({ org, page, total }: { org: OrgProfile; page: number; total: number }) {
  return (
    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between border-t pt-1.5 text-[9.5px] text-neutral-500" style={{ borderColor: LINE }}>
      <span className="truncate">{orgLine(org) || ' '}</span>
      <span className="shrink-0 pl-3">{page} / {total}</span>
    </div>
  );
}

export function ProposalSheet({ input, org }: { input: ProposalInput; org: OrgProfile }) {
  const total = 1 + input.items.length;
  const th = 'border px-2 py-1.5 text-center text-[10.5px] font-bold';
  const td = 'border px-2 py-1.5 text-[10.5px]';

  return (
    <div>
      {/* ------------------------------------------------------------ 표지 */}
      <A4Page first>
        <div className="flex h-full flex-col pb-8">
          <div className="mb-5 flex items-end justify-between border-b-2 border-black pb-2">
            <span className="text-[11px] font-bold text-neutral-600">{org.name || ' '}</span>
            <span className="text-[13px] text-neutral-500">{input.date}</span>
          </div>
          <h1 className="mb-6 text-center text-[26px] font-black tracking-[0.3em]">프로그램 제안서</h1>

          <div className="mb-5 rounded-lg border px-4 py-3 text-[12px] leading-relaxed" style={{ borderColor: LINE, background: '#f5f7fc' }}>
            <div>
              <span className="font-bold">받는 곳</span>&nbsp;&nbsp;{input.org}
              {input.contact && <span className="ml-3 text-neutral-600">담당 {input.contact}</span>}
              {input.tel && <span className="ml-3 text-neutral-600">{input.tel}</span>}
            </div>
            {org.name && (
              <div className="mt-1">
                <span className="font-bold">보내는 곳</span>&nbsp;&nbsp;{org.name}
                {org.ceo && <span className="ml-3 text-neutral-600">대표 {org.ceo}</span>}
              </div>
            )}
          </div>

          <p className="mb-5 whitespace-pre-wrap text-[12px] leading-relaxed">{input.greeting}</p>

          <table className="w-full table-fixed border-collapse" style={{ borderColor: LINE }}>
            <colgroup>
              <col />
              <col style={{ width: '13%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '20%' }} />
            </colgroup>
            <thead>
              <tr style={{ background: FILL }}>
                {['프로그램', '대상', '차시', '인원', '1인당', '금액'].map((t) => (
                  <th key={t} className={th} style={{ borderColor: LINE }}>{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {input.items.map((it) => (
                <tr key={it.appId}>
                  <td className={`${td} font-semibold`} style={{ borderColor: LINE }}>{it.title}</td>
                  <td className={`${td} text-center`} style={{ borderColor: LINE }}>{it.grade || '-'}</td>
                  <td className={`${td} text-center`} style={{ borderColor: LINE }}>{it.sessions}</td>
                  <td className={`${td} text-center`} style={{ borderColor: LINE }}>{it.headcount}</td>
                  <td className={`${td} text-right`} style={{ borderColor: LINE }}>{priceText(it.unitPrice)}</td>
                  <td className={`${td} text-right`} style={{ borderColor: LINE }}>{priceText(lineTotal(it))}</td>
                </tr>
              ))}
              <tr style={{ background: FILL }}>
                <td colSpan={5} className={`${td} text-right font-bold`} style={{ borderColor: LINE }}>합계</td>
                <td className={`${td} text-right font-bold`} style={{ borderColor: LINE }}>
                  {priceText(grandTotal(input.items))}
                  {hasUnpriced(input.items) && <span className="ml-1 text-[9px] font-normal text-neutral-500">(일부 협의)</span>}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-1 text-[9.5px] text-neutral-500">금액 = 1인당 × 인원 × 차시. 부가세 별도 여부와 세부 조건은 협의 시 확정합니다.</p>

          <p className="mt-6 whitespace-pre-wrap text-[12px] leading-relaxed">{input.closing}</p>
        </div>
        <Footer org={org} page={1} total={total} />
      </A4Page>

      {/* ------------------------------------------------- 프로그램마다 한 쪽 */}
      {input.items.map((it, i) => (
        <A4Page key={it.appId}>
          <div className="flex h-full flex-col pb-8">
            <div className="mb-3 flex items-baseline gap-3 border-b-2 border-black pb-2">
              <span className="text-[13px] font-bold text-neutral-500">{i + 1}</span>
              <h2 className="text-[20px] font-black">{it.title}</h2>
            </div>
            <div className="mb-4 flex flex-wrap gap-1.5 text-[10.5px]">
              {[
                it.grade && `대상 ${it.grade}`,
                `${it.sessions}차시`,
                `${it.headcount}명 기준`,
                `1인당 ${priceText(it.unitPrice)}`,
                `합계 ${priceText(lineTotal(it))}`,
              ]
                .filter(Boolean)
                .map((t) => (
                  <span key={String(t)} className="rounded-full border px-2.5 py-0.5" style={{ borderColor: LINE, background: '#f5f7fc' }}>
                    {t}
                  </span>
                ))}
            </div>

            {it.purpose && (
              <section className="mb-4">
                <h3 className="mb-1 text-[11.5px] font-bold text-neutral-600">이런 수업입니다</h3>
                <p className="whitespace-pre-wrap text-[12px] leading-relaxed">{it.purpose}</p>
              </section>
            )}
            {it.goal && (
              <section className="mb-4">
                <h3 className="mb-1 text-[11.5px] font-bold text-neutral-600">수업 목표</h3>
                <p className="whitespace-pre-wrap text-[12px] leading-relaxed">{it.goal}</p>
              </section>
            )}

            {it.samples.length > 0 && (
              <section className="mb-4">
                <h3 className="mb-1.5 text-[11.5px] font-bold text-neutral-600">이런 결과물이 나옵니다</h3>
                <div className={`grid gap-2 ${it.samples.length === 1 ? 'grid-cols-2' : it.samples.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                  {it.samples.map((u) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={u} src={u} alt="" className="h-[58mm] w-full rounded border object-contain" style={{ borderColor: LINE, background: '#fafbfe' }} />
                  ))}
                </div>
              </section>
            )}

            <section className="mt-auto">
              <h3 className="mb-1 text-[11.5px] font-bold text-neutral-600">진행 방식</h3>
              <ol className="list-decimal space-y-0.5 pl-5 text-[11.5px] leading-relaxed">
                <li>강사가 교구와 태블릿·노트북을 가지고 방문합니다. 기관은 공간과 인터넷만 준비하시면 됩니다.</li>
                <li>학생이 직접 AI 웹앱을 다뤄 결과물을 만들고, 만든 것을 발표하며 마무리합니다.</li>
                <li>수업 후 결과물 사진과 간단한 소감을 정리해 드립니다.</li>
              </ol>
            </section>
          </div>
          <Footer org={org} page={i + 2} total={total} />
        </A4Page>
      ))}
    </div>
  );
}
