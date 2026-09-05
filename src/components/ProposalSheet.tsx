'use client';

import { useLayoutEffect, useRef } from 'react';
import type { OrgProfile } from '@/lib/types';
import {
  grandTotal,
  hasUnpriced,
  lineTotal,
  moneyInKoreanLine,
  orgLine,
  priceText,
  validUntil,
  vatLabel,
  vatSplit,
  type ProposalInput,
} from '@/lib/proposal';

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

/* ------------------------------------------------------------ 견적서 A4
   **한 장이다.** 제안서와 같은 입력에서 나오지만 쓰임이 다르다 — 제안서는 읽히는 문서,
   견적서는 결재에 붙는 문서다. 그래서 소개·사진은 빼고 수신·공급자·합계(한글 금액)·품목 표·
   부가세·비고·(인) 자리만 싣는다. 흔한 견적서 양식 그대로라 받는 쪽이 낯설지 않다. */

export function QuoteSheet({ input, org }: { input: ProposalInput; org: OrgProfile }) {
  const split = vatSplit(input.items, input.vat);
  const th = 'border px-2 py-1.5 text-center text-[10.5px] font-bold';
  const td = 'border px-2 py-1.5 text-[10.5px]';
  const until = validUntil(input.date, input.validDays);

  return (
    <A4Page first>
      <div className="flex h-full flex-col pb-8">
        <div className="mb-4 flex items-end justify-between border-b-2 border-black pb-2">
          <span className="text-[11px] font-bold text-neutral-600">{org.name || ' '}</span>
          <span className="text-[11px] text-neutral-500">견적번호 {input.quoteNo}</span>
        </div>
        <h1 className="mb-5 text-center text-[26px] font-black tracking-[0.5em]">견적서</h1>

        <div className="mb-4 grid grid-cols-2 gap-3 text-[11px] leading-relaxed">
          <div className="rounded-lg border px-3 py-2" style={{ borderColor: LINE }}>
            <div>
              <span className="font-bold">수신</span>&nbsp;&nbsp;{input.org} 귀하
            </div>
            {input.contact && <div>담당&nbsp;&nbsp;{input.contact}</div>}
            {input.tel && <div>연락처&nbsp;&nbsp;{input.tel}</div>}
            <div>견적일&nbsp;&nbsp;{input.date}</div>
            <div>
              유효기간&nbsp;&nbsp;{until ? `${until} 까지` : ''} (견적일로부터 {input.validDays}일)
            </div>
          </div>
          <div className="rounded-lg border px-3 py-2" style={{ borderColor: LINE, background: '#f5f7fc' }}>
            <div className="mb-0.5 font-bold text-neutral-600">공급자</div>
            {org.name && (
              <div>
                상호&nbsp;&nbsp;{org.name}
                {org.ceo && <span className="ml-2">대표 {org.ceo}</span>}
              </div>
            )}
            {org.bizNo && <div>사업자등록번호&nbsp;&nbsp;{org.bizNo}</div>}
            {org.address && <div>주소&nbsp;&nbsp;{org.address}</div>}
            {org.tel && <div>전화&nbsp;&nbsp;{org.tel}</div>}
            {org.email && <div>이메일&nbsp;&nbsp;{org.email}</div>}
          </div>
        </div>

        <p className="mb-1 text-[11.5px]">아래와 같이 견적합니다.</p>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 rounded-lg border px-4 py-2" style={{ borderColor: LINE }}>
          <span className="text-[12px] font-bold">합계 금액 ({vatLabel(input.vat)})</span>
          <span className="text-[14px] font-black">
            {moneyInKoreanLine(split.total)}
            <span className="ml-2 text-[11.5px] font-semibold text-neutral-600">(₩{split.total.toLocaleString('ko-KR')})</span>
          </span>
        </div>

        <table className="w-full table-fixed border-collapse" style={{ borderColor: LINE }}>
          <colgroup>
            <col style={{ width: '7%' }} />
            <col />
            <col style={{ width: '20%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '18%' }} />
          </colgroup>
          <thead>
            <tr style={{ background: FILL }}>
              {['No.', '품목', '규격', '수량', '단가', '금액'].map((t) => (
                <th key={t} className={th} style={{ borderColor: LINE }}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {input.items.map((it, i) => (
              <tr key={it.appId}>
                <td className={`${td} text-center`} style={{ borderColor: LINE }}>{i + 1}</td>
                <td className={`${td} font-semibold`} style={{ borderColor: LINE }}>{it.title}</td>
                <td className={`${td} text-center`} style={{ borderColor: LINE }}>
                  {[it.grade, `${it.sessions}차시`].filter(Boolean).join(' · ')}
                </td>
                <td className={`${td} text-center`} style={{ borderColor: LINE }}>{it.headcount}명</td>
                <td className={`${td} text-right`} style={{ borderColor: LINE }}>{priceText(it.unitPrice)}</td>
                <td className={`${td} text-right`} style={{ borderColor: LINE }}>{priceText(lineTotal(it))}</td>
              </tr>
            ))}
            {[
              ['공급가액', split.supply],
              [input.vat === 'exempt' ? '부가세 (면세)' : '부가세', split.vat],
              ['합계', split.total],
            ].map(([label, n], k) => (
              <tr key={String(label)} style={k === 2 ? { background: FILL } : undefined}>
                <td colSpan={5} className={`${td} text-right ${k === 2 ? 'font-bold' : ''}`} style={{ borderColor: LINE }}>{label}</td>
                <td className={`${td} text-right ${k === 2 ? 'font-bold' : ''}`} style={{ borderColor: LINE }}>
                  {Number(n).toLocaleString('ko-KR')}원
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-[9.5px] text-neutral-500">금액 = 단가(1인당) × 수량(인원) × 차시.</p>

        {input.terms.trim() && (
          <section className="mt-5">
            <h3 className="mb-1 text-[11.5px] font-bold text-neutral-600">비고</h3>
            <p className="whitespace-pre-wrap text-[11.5px] leading-relaxed">{input.terms}</p>
          </section>
        )}

        <div className="mt-auto flex items-end justify-between text-[11.5px]">
          <span>{input.date}</span>
          <span>
            {org.name}
            {org.ceo && ` 대표 ${org.ceo}`}
            <span className="ml-3 inline-block w-12 border-b border-black">&nbsp;</span> (인)
          </span>
        </div>
      </div>
      <Footer org={org} page={1} total={1} />
    </A4Page>
  );
}

/** 갈래에 맞는 장을 그린다 — 인쇄 화면이 쓴다 */
export function DocumentSheet({ input, org }: { input: ProposalInput; org: OrgProfile }) {
  return input.kind === 'quote' ? <QuoteSheet input={input} org={org} /> : <ProposalSheet input={input} org={org} />;
}
