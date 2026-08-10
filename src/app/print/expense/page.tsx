'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase, friendlyError } from '@/lib/supabase';
import { useMembers } from '@/lib/useMembers';
import { useSession } from '@/lib/session';
import { korDateFull, won } from '@/lib/format';
import {
  expenseCategoryLabel,
  expenseTotals,
  groupByDate,
  monthLabel,
  monthRange,
  parseExpenseParts,
  payMethodLabel,
  payMethodShort,
  thisMonth,
  type ExpensePrintPart,
} from '@/lib/expense';
import { Icon } from '@/components/Icon';
import { BrandMark } from '@/components/Brand';
import { ErrorBanner } from '@/components/ui';
import type { AppRow, Expense, ExpenseFile } from '@/lib/types';

/**
 * 월별 지출결의서 — 인쇄 / PDF 저장.
 *
 * 회계에 넘길 문서 한 장이 되도록 순서를 잡았다:
 *   표지(합계·서명란) → 구분별 소계 → 날짜별 소계 → 지출 명세 표 → 영수증 첨부
 *
 * **명세 표의 번호와 영수증 사진의 번호가 같다.** 증빙은 "이 금액의 영수증이
 * 이것" 이 연결돼야 의미가 있어서, 번호로 묶는 게 이 문서의 핵심이다.
 *
 * 프로그램 인쇄(/print/[id])와 같이 PDF 라이브러리를 쓰지 않고 브라우저 인쇄를 쓴다.
 *
 * ※ 이 경로는 고정 경로라서 빌드 때 미리 그려보려 한다. 안쪽에서 useSearchParams
 *   (month·parts) 를 쓰니 Suspense 로 감싸야 빌드가 통과한다.
 */
export default function ExpensePrintPage() {
  return (
    <Suspense fallback={<Preparing />}>
      <ExpensePrintDoc />
    </Suspense>
  );
}

function Preparing() {
  return <p className="p-10 text-center text-[14px] text-neutral-500">문서를 준비하고 있어요…</p>;
}

function ExpensePrintDoc() {
  const search = useSearchParams();
  const router = useRouter();
  const { nameOf } = useMembers(true);
  // (app) 레이아웃 밖이라 로그인 가드를 직접 붙인다
  const { session, loading: sessionLoading } = useSession();

  useEffect(() => {
    if (!sessionLoading && !session) router.replace('/login');
  }, [session, sessionLoading, router]);

  const month = search.get('month') || thisMonth();
  const parts = useMemo<Set<ExpensePrintPart>>(() => parseExpenseParts(search.get('parts')), [search]);
  const catFilter = search.get('category') || '';
  const memberFilter = search.get('member') || '';

  const [rows, setRows] = useState<Expense[]>([]);
  const [files, setFiles] = useState<ExpenseFile[]>([]);
  const [apps, setApps] = useState<AppRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { from, to } = monthRange(month);
    try {
      let q = supabase
        .from('expenses')
        .select('*')
        .gte('spent_on', from)
        .lte('spent_on', to)
        .order('spent_on')
        .order('created_at');
      if (catFilter) q = q.eq('category', catFilter);
      if (memberFilter) q = q.eq('member_id', memberFilter);

      const [eRes, aRes] = await Promise.all([q, supabase.from('apps').select('id,title_ko')]);
      if (eRes.error) throw eRes.error;

      const list = (eRes.data ?? []) as Expense[];
      setRows(list);
      setApps((aRes.data ?? []) as AppRow[]);

      if (list.length > 0 && parts.has('receipt')) {
        const { data } = await supabase
          .from('expense_files')
          .select('*')
          .in('expense_id', list.map((r) => r.id))
          .order('sort_order');
        setFiles((data ?? []) as ExpenseFile[]);
      } else if (list.length > 0) {
        // 영수증을 안 싣더라도 '영수증 유무' 칸은 채워야 한다
        const { data } = await supabase
          .from('expense_files')
          .select('id,expense_id,file_url,file_name,file_size,is_image,sort_order,created_at')
          .in('expense_id', list.map((r) => r.id));
        setFiles((data ?? []) as ExpenseFile[]);
      }
    } catch (e) {
      setError(friendlyError(e, '지출 내역을 불러오지 못했어요.'));
    } finally {
      setLoading(false);
    }
  }, [month, catFilter, memberFilter, parts]);

  useEffect(() => {
    void load();
  }, [load]);

  const filesOf = useCallback((id: string) => files.filter((f) => f.expense_id === id), [files]);
  const totals = useMemo(() => expenseTotals(rows, (id) => filesOf(id).length), [rows, filesOf]);
  const days = useMemo(() => groupByDate(rows, false), [rows]);
  const appTitle = useCallback(
    (id: string | null) => (id ? (apps.find((a) => a.id === id)?.title_ko ?? '') : ''),
    [apps],
  );

  /** 명세 표의 번호. 영수증 첨부도 이 번호를 쓴다 */
  const noOf = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r, i) => m.set(r.id, i + 1));
    return m;
  }, [rows]);

  const withReceipt = rows.filter((r) => filesOf(r.id).length > 0);

  if (sessionLoading || !session || loading) return <Preparing />;
  if (error) {
    return (
      <div className="p-6">
        <ErrorBanner message={error} onRetry={() => void load()} />
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-[820px] bg-white p-6 text-black print:p-0">
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

      {/* ------------------------------------------------------------ 표지 */}
      <header className="print-block mb-6 border-b-2 border-black pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[26px] font-black leading-tight tracking-[0.2em]">지출결의서</h1>
            <p className="mt-1 text-[13px] font-bold">{monthLabel(month)}</p>
            <p className="text-[11.5px] text-neutral-500">
              {monthRange(month).from} ~ {monthRange(month).to} · 모아킷 · 모아랩
            </p>
          </div>
          <span className="flex shrink-0 items-center justify-center rounded-[14px] bg-black p-2.5">
            <BrandMark size={40} />
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11.5px] text-neutral-500">지출 합계</p>
            <p className="text-[24px] font-black leading-tight">{won(totals.total)}원</p>
            <p className="mt-0.5 text-[11.5px] text-neutral-500">
              총 {totals.count}건
              {totals.noReceipt > 0 && ` · 영수증 미첨부 ${totals.noReceipt}건`}
            </p>
          </div>

          {/* 결재란 — 종이로 넘길 때 여기 서명한다 */}
          <table className="border border-black text-center text-[11px]">
            <tbody>
              <tr>
                <th className="w-16 border border-black bg-neutral-100 px-2 py-1 font-bold">결의자</th>
                <th className="w-16 border border-black bg-neutral-100 px-2 py-1 font-bold">확인</th>
              </tr>
              <tr>
                <td className="h-12 border border-black" />
                <td className="h-12 border border-black" />
              </tr>
            </tbody>
          </table>
        </div>

        {(catFilter || memberFilter) && (
          <p className="mt-3 border border-neutral-300 bg-neutral-50 px-2 py-1 text-[11px]">
            일부만 뽑은 문서입니다 —
            {catFilter && ` 구분: ${expenseCategoryLabel(catFilter)}`}
            {memberFilter && ` 결의자: ${nameOf(memberFilter)}`}
          </p>
        )}

        <p className="mt-3 text-[11px] text-neutral-400">
          출력일 {korDateFull(new Date().toISOString().slice(0, 10))} · 출력자 {session.name}
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-neutral-500">
          {monthLabel(month)}에 등록된 지출이 없습니다.
        </p>
      ) : (
        <>
          {/* ------------------------------------------------ 구분별 소계 */}
          {parts.has('summary') && (
            <Section title="구분별 소계">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="bg-neutral-100">
                    <Th className="text-left">구분</Th>
                    <Th className="w-20 text-right">건수</Th>
                    <Th className="w-32 text-right">금액</Th>
                    <Th className="w-20 text-right">비중</Th>
                  </tr>
                </thead>
                <tbody>
                  {totals.byCategory.map((c) => (
                    <tr key={c.value}>
                      <Td>{c.label}</Td>
                      <Td className="text-right">{c.count}</Td>
                      <Td className="text-right font-semibold">{won(c.amount)}</Td>
                      <Td className="text-right text-neutral-500">
                        {totals.total > 0 ? Math.round((c.amount / totals.total) * 100) : 0}%
                      </Td>
                    </tr>
                  ))}
                  <tr className="bg-neutral-50 font-black">
                    <Td>합계</Td>
                    <Td className="text-right">{totals.count}</Td>
                    <Td className="text-right">{won(totals.total)}</Td>
                    <Td className="text-right">100%</Td>
                  </tr>
                </tbody>
              </table>

              {totals.byMethod.length > 0 && (
                <p className="mt-2 text-[11.5px] text-neutral-600">
                  결제수단 —{' '}
                  {totals.byMethod.map((m) => `${m.label} ${won(m.amount)}원(${m.count}건)`).join(' · ')}
                </p>
              )}
            </Section>
          )}

          {/* ------------------------------------------------ 날짜별 소계 */}
          {parts.has('daily') && (
            <Section title="날짜별 소계">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="bg-neutral-100">
                    <Th className="text-left">날짜</Th>
                    <Th className="w-20 text-right">건수</Th>
                    <Th className="w-32 text-right">금액</Th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.date}>
                      <Td>{korDateFull(d.date)}</Td>
                      <Td className="text-right">{d.rows.length}</Td>
                      <Td className="text-right font-semibold">{won(d.amount)}</Td>
                    </tr>
                  ))}
                  <tr className="bg-neutral-50 font-black">
                    <Td>합계</Td>
                    <Td className="text-right">{totals.count}</Td>
                    <Td className="text-right">{won(totals.total)}</Td>
                  </tr>
                </tbody>
              </table>
            </Section>
          )}

          {/* ------------------------------------------------ 지출 명세 표 */}
          {parts.has('list') && (
            <Section title="지출 명세" sub="번호는 뒤쪽 영수증 첨부와 같습니다">
              <table className="w-full border-collapse text-[11.5px]">
                <thead>
                  <tr className="bg-neutral-100">
                    <Th className="w-8">No</Th>
                    <Th className="w-14">날짜</Th>
                    <Th className="w-20 text-left">구분</Th>
                    <Th className="text-left">사용 내용</Th>
                    <Th className="w-24 text-left">사용처</Th>
                    <Th className="w-14">결제</Th>
                    <Th className="w-24 text-right">금액</Th>
                    <Th className="w-12">영수증</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const att = filesOf(r.id);
                    const app = appTitle(r.app_id);
                    return (
                      <tr key={r.id} className="print-block align-top">
                        <Td className="text-center font-bold">{noOf.get(r.id)}</Td>
                        <Td className="text-center">{r.spent_on.slice(5).replace('-', '/')}</Td>
                        <Td>{expenseCategoryLabel(r.category)}</Td>
                        <Td>
                          {r.purpose}
                          {(app || r.school || r.note) && (
                            <span className="block text-[10.5px] text-neutral-500">
                              {[app, r.school, r.note].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </Td>
                        <Td>{r.vendor || '-'}</Td>
                        <Td className="text-center">{payMethodShort(r.pay_method)}</Td>
                        <Td className="text-right font-semibold">{won(r.amount)}</Td>
                        <Td className="text-center">{att.length > 0 ? `${att.length}장` : '없음'}</Td>
                      </tr>
                    );
                  })}
                  <tr className="bg-neutral-50 font-black">
                    <Td className="text-center" colSpan={6}>
                      합계 {totals.count}건
                    </Td>
                    <Td className="text-right">{won(totals.total)}</Td>
                    <Td />
                  </tr>
                </tbody>
              </table>

              {/* 결의자별 소계 — 누가 얼마를 대신 썼는지가 정산의 핵심이다 */}
              <MemberSubtotal rows={rows} nameOf={nameOf} />
            </Section>
          )}

          {/* ------------------------------------------------- 영수증 첨부 */}
          {parts.has('receipt') && (
            <section className="print-page-break">
              <h2 className="mb-2 border-b border-black pb-1 text-[15px] font-black">
                영수증 첨부
                <span className="ml-2 text-[11.5px] font-normal text-neutral-500">
                  {withReceipt.length}건 · 번호는 지출 명세와 같습니다
                </span>
              </h2>

              {withReceipt.length === 0 ? (
                <p className="py-2 text-[12px] text-neutral-500">첨부된 영수증이 없습니다.</p>
              ) : (
                <div className="space-y-3">
                  {withReceipt.map((r) => {
                    const att = filesOf(r.id);
                    const images = att.filter((f) => f.is_image);
                    const others = att.filter((f) => !f.is_image);
                    return (
                      <div key={r.id} className="print-block border border-neutral-400 p-2">
                        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11.5px]">
                          <span className="border border-black px-1.5 font-black">
                            No.{noOf.get(r.id)}
                          </span>
                          <span className="font-bold">{korDateFull(r.spent_on)}</span>
                          <span>{expenseCategoryLabel(r.category)}</span>
                          <span className="font-black">{won(r.amount)}원</span>
                          <span className="text-neutral-600">{r.vendor || '사용처 없음'}</span>
                          <span className="text-neutral-500">{nameOf(r.member_id)}</span>
                        </p>
                        <p className="mt-0.5 text-[11.5px]">{r.purpose}</p>

                        {/* 영수증은 '읽혀야' 증빙이 된다 — 3칸으로 쪼개면 글씨가 안 보인다 */}
                        {images.length > 0 && (
                          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                            {images.map((f) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                key={f.id}
                                src={f.file_url}
                                alt={`No.${noOf.get(r.id)} 영수증`}
                                className="max-h-64 w-full border border-neutral-200 object-contain"
                              />
                            ))}
                          </div>
                        )}

                        {others.length > 0 && (
                          <p className="mt-1.5 text-[10.5px] text-neutral-500">
                            첨부 파일(인쇄 불가) — {others.map((f) => f.file_name).join(', ')}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {totals.noReceipt > 0 && (
                <div className="print-block mt-4 border border-red-400 p-2">
                  <p className="text-[12px] font-bold text-red-700">
                    영수증이 없는 지출 {totals.noReceipt}건 — 증빙을 채워야 합니다
                  </p>
                  <ul className="mt-1 space-y-0.5 text-[11.5px]">
                    {rows
                      .filter((r) => filesOf(r.id).length === 0)
                      .map((r) => (
                        <li key={r.id}>
                          No.{noOf.get(r.id)} · {korDateFull(r.spent_on)} · {won(r.amount)}원 · {r.purpose}
                          {r.vendor ? ` (${r.vendor})` : ''}
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </>
      )}

      <footer className="mt-8 border-t border-neutral-300 pt-2 text-[10.5px] text-neutral-500">
        모아킷 · 모아랩 업무 워크스페이스 — {monthLabel(month)} 지출결의서
      </footer>
    </main>
  );
}

/* --------------------------------------------------------------- 작은 조각들 */

function MemberSubtotal({
  rows,
  nameOf,
}: {
  rows: Expense[];
  nameOf: (id: string | null | undefined) => string;
}) {
  const byMember = useMemo(() => {
    const m = new Map<string, { amount: number; count: number }>();
    for (const r of rows) {
      const k = r.member_id ?? '';
      const cur = m.get(k) ?? { amount: 0, count: 0 };
      cur.amount += Number(r.amount || 0);
      cur.count += 1;
      m.set(k, cur);
    }
    return [...m.entries()].sort((a, b) => b[1].amount - a[1].amount);
  }, [rows]);

  if (byMember.length <= 1) return null;

  return (
    <p className="mt-2 text-[11.5px] text-neutral-600">
      결의자별 —{' '}
      {byMember
        .map(([id, v]) => `${id ? nameOf(id) : '미지정'} ${won(v.amount)}원(${v.count}건)`)
        .join(' · ')}
    </p>
  );
}

function Section({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 border-b border-black pb-1 text-[15px] font-black">
        {title}
        {sub && <span className="ml-2 text-[11.5px] font-normal text-neutral-500">{sub}</span>}
      </h2>
      {children}
    </section>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`border border-neutral-400 px-1.5 py-1 font-bold ${className}`}>{children}</th>;
}

function Td({
  children,
  className = '',
  colSpan,
}: {
  children?: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`border border-neutral-400 px-1.5 py-1 ${className}`}>
      {children}
    </td>
  );
}
