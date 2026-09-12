'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { korDateFull } from '@/lib/format';
import { kstDateStr } from '@/lib/task';
import { cellText, rowTitle, safeKind, statusCounts } from '@/lib/dutyTable';
import { Icon } from '@/components/Icon';
import { ErrorBanner } from '@/components/ui';
import type { Department, Duty, DutyColumn, DutyGroup, DutyRow } from '@/lib/types';

/**
 * 역할 표 인쇄 — 회의에 들고 갈 종이 한 장.
 *
 * 원장: *"인쇄 기능해서 다운로드가 가능하게."* 두 가지를 같이 둔다 —
 * **인쇄(→ PDF 저장)** 와 **CSV 내려받기**(엑셀에서 열어 손보는 용).
 *
 * · 다른 인쇄 화면과 같이 **PDF 라이브러리를 쓰지 않는다** (브라우저 인쇄).
 * · **가로(landscape) 로 인쇄한다.** 열이 일곱 개를 넘으면 세로 A4 에서는
 *   칸이 뭉개진다. `@page` 를 이 화면에서만 가로로 덮어쓴다.
 * · `(app)` 레이아웃 밖이라 **로그인 가드를 직접 붙인다.**
 * · 화면에서 걸어둔 검색은 안 넘긴다 — 종이는 전부가 기본이다.
 *   (지출 인쇄는 필터를 넘기고 "일부만 뽑은 문서" 를 박아두는데, 저쪽은 달마다
 *   고정된 문서라 성격이 다르다. 여기는 목록 전체가 곧 그 일의 현황이다)
 */
export default function DutyTablePrintScreen() {
  const { dutyId } = useParams<{ dutyId: string }>();
  const router = useRouter();
  const { session, loading: sessionLoading } = useSession();

  const [duty, setDuty] = useState<Duty | null>(null);
  const [path, setPath] = useState('');
  const [cols, setCols] = useState<DutyColumn[] | null>(null);
  const [rows, setRows] = useState<DutyRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sessionLoading && !session) router.replace('/login');
  }, [session, sessionLoading, router]);

  useEffect(() => {
    (async () => {
      try {
        const [d, c, r] = await Promise.all([
          supabase.from('duties').select('*').eq('id', dutyId).maybeSingle(),
          supabase.from('duty_columns').select('*').eq('duty_id', dutyId).order('sort_order'),
          supabase.from('duty_rows').select('*').eq('duty_id', dutyId).order('sort_order'),
        ]);
        if (d.error) throw d.error;
        const found = (d.data ?? null) as Duty | null;
        setDuty(found);
        setCols((c.data ?? []) as DutyColumn[]);
        setRows((r.data ?? []) as DutyRow[]);
        if (found) {
          const { data: g } = await supabase
            .from('duty_groups')
            .select('*')
            .eq('id', found.group_id)
            .maybeSingle();
          const group = (g ?? null) as DutyGroup | null;
          const { data: dp } = group
            ? await supabase.from('departments').select('*').eq('id', group.dept_id).maybeSingle()
            : { data: null };
          setPath([(dp as Department | null)?.name, group?.name].filter(Boolean).join(' › '));
        }
      } catch (e) {
        setError(friendlyError(e, '목록을 불러오지 못했어요.'));
        setCols([]);
      }
    })();
  }, [dutyId]);

  const counts = useMemo(() => statusCounts(cols ?? [], rows), [cols, rows]);
  /* '오늘' 은 반드시 kstDateStr — Vercel 은 UTC 라 그냥 짜면 아침 9시 전까지 어제가 찍힌다 */
  const today = kstDateStr(new Date());

  if (!session || cols === null) {
    return <p className="p-10 text-center text-[14px] text-neutral-500">인쇄할 내용을 준비하고 있어요…</p>;
  }

  if (error || !duty) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <ErrorBanner message={error || '없는 역할이에요.'} />
      </div>
    );
  }

  const empty = cols.length === 0 || rows.length === 0;

  return (
    <div className="mx-auto max-w-[1100px] bg-surface p-6 text-neutral-900 print:p-0">
      {/* 이 화면에서만 가로 인쇄 — 열이 많은 표는 세로 A4 에서 칸이 뭉개진다 */}
      <style>{`@media print { @page { size: A4 landscape; margin: 12mm 10mm; } }`}</style>

      <div className="no-print mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-raised p-3">
        <button onClick={() => window.print()} className="btn-primary px-3.5 text-[14px]">
          <Icon name="printer" size={15} />
          인쇄 / PDF 저장
        </button>
        <a href={`/api/duty/csv?dutyId=${dutyId}`} className="btn-ghost px-3 text-[13px]">
          <Icon name="download" size={14} />
          엑셀(CSV)로 받기
        </a>
        <button onClick={() => window.close()} className="btn-ghost px-3 text-[13px]">
          닫기
        </button>
        <p className="w-full text-[12px] leading-relaxed text-neutral-500">
          <b>가로로</b> 인쇄됩니다 (열이 많아서요). 아이폰은 <b>공유 → 프린트</b> 를 누른 뒤 미리보기를
          두 손가락으로 벌리면 PDF 로 저장돼요. PC 는 인쇄 대화상자에서 대상을 <b>PDF로 저장</b> 으로
          바꾸세요.
          <br />
          <b>엑셀(CSV)</b> 은 받아서 엑셀·구글 시트에서 바로 열립니다.
        </p>
      </div>

      {/* 머리 — 무엇을, 언제 뽑은 것인지 */}
      <div className="print-block mb-3 border-b-2 border-neutral-900 pb-2">
        <p className="text-[11px] text-neutral-500">{path}</p>
        <h1 className="text-[20px] font-bold leading-tight">{duty.name}</h1>
        {duty.note && <p className="mt-0.5 text-[12px] text-neutral-600">{duty.note}</p>}
        <p className="mt-1 text-[11px] text-neutral-500">
          모두 {rows.length}줄 · {korDateFull(today)} 뽑음
          {counts && counts.counts.length > 0 && (
            <>
              {' · '}
              {counts.counts.map((c) => `${c.label} ${c.n}`).join(' · ')}
            </>
          )}
        </p>
      </div>

      {empty ? (
        <p className="py-10 text-center text-[13px] text-neutral-500">
          {cols.length === 0 ? '아직 표를 안 만들었어요.' : '아직 줄이 없어요.'}
        </p>
      ) : (
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="w-8 border border-neutral-300 bg-neutral-100 px-1 py-1 text-center font-bold">
                No.
              </th>
              {cols.map((c) => (
                <th
                  key={c.id}
                  className="border border-neutral-300 bg-neutral-100 px-1.5 py-1 text-left font-bold"
                >
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className="print-block">
                <td className="border border-neutral-300 px-1 py-1 text-center text-neutral-500">
                  {i + 1}
                </td>
                {cols.map((c, j) => {
                  const t = cellText(c, (r.cells ?? {})[c.id] ?? null);
                  return (
                    <td
                      key={c.id}
                      className={`border border-neutral-300 px-1.5 py-1 align-top ${
                        j === 0 ? 'font-bold' : ''
                      } ${safeKind(c.kind) === 'number' ? 'text-right' : ''}`}
                    >
                      {/* 첫 칸이 비면 화면과 같이 '이름 없음' — 빈 칸이 줄줄이 있으면 종이에서 줄을 못 센다 */}
                      {j === 0 ? rowTitle(cols, r) : t}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* 회의에서 이 종이를 놓고 정하는 게 실제 흐름이라 서명란을 둔다
          (부서업무·지출결의서 인쇄와 같은 판단) */}
      <div className="print-block mt-6 flex justify-end gap-8 text-[11px] text-neutral-500">
        <span>확인 __________________</span>
        <span>원장 __________________</span>
      </div>
    </div>
  );
}
