'use client';

import type { LessonPlan, LessonPlanItem, PlanSlot } from '@/lib/types';

/* ------------------------------------------------------- 강의계획서 표
   원장이 준 한글 양식(강의계획서.hwp)과 같은 표다.
   칸 이름·순서·병합을 그대로 옮겼으므로 PlanForm 의 칸을 바꾸면 여기도 같이 고쳐야 한다.

   표는 3칸이다. 보통 줄은 [과정 | 강의내용(2칸 병합)] 이고,
   운영사항 줄만 [운영사항(2줄 병합) | 교구·기타사항 | 내용] 으로 갈라진다. */

const LINE = '#b9c4de';
const FILL = '#dce4f5';

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

  const head = `border p-1.5 text-center align-middle font-bold`;
  const body = `border p-2 align-top whitespace-pre-wrap leading-relaxed`;

  return (
    <div style={{ borderColor: LINE }}>
      <h2 className="mb-3 text-center text-[21px] font-black tracking-[0.25em]">강의계획서</h2>

      <table className="w-full table-fixed border-collapse text-[11.5px]" style={{ borderColor: LINE }}>
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

          {/* 전개 — 웹앱활동(가로 3칸) + 활동작품(만드는 순서 / 결과 이미지) */}
          <tr>
            <td className={head} style={{ borderColor: LINE, background: FILL }}>
              전 개
            </td>
            <td colSpan={2} className={`${body} whitespace-normal`} style={{ borderColor: LINE }}>
              {plan.dev_title && <p className="font-bold">{plan.dev_title}</p>}
              {steps.length > 0 && (
                <div className="mt-1.5 grid grid-cols-3 gap-2">
                  {steps.map((s, i) => (
                    <div key={s.id} className="print-block">
                      <p className="text-[10.5px] font-semibold leading-snug">
                        {i + 1}. {s.label}
                      </p>
                      {s.url && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={s.url} alt="" className="mt-1 w-full object-contain" />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {plan.work_title && <p className="mt-3 font-bold">{plan.work_title}</p>}
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

      {plan.logo_url && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={plan.logo_url} alt="" className="mx-auto mt-4 h-11 object-contain" />
      )}
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
          <li key={r.id} className="print-block">
            {r.label && <p className="text-[10.5px] leading-snug">{r.label}</p>}
            {r.url && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={r.url} alt="" className="mt-0.5 w-full object-contain" />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

