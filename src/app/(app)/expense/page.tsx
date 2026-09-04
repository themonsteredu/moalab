'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { logActivity } from '@/lib/log';
import { queueDrive, uploadMany } from '@/lib/upload';
import { won, korDate, today } from '@/lib/format';
import {
  EXPENSE_PRINT_PARTS,
  commaNumber,
  digitsOnly,
  expenseCategoryColor,
  expenseCategoryLabel,
  expenseTotals,
  groupByDate,
  monthLabel,
  monthRange,
  payMethodLabel,
  shiftMonth,
  thisMonth,
  type ExpensePrintPart,
} from '@/lib/expense';
import { PageHeader } from '@/components/PageHeader';
import { Icon } from '@/components/Icon';
import { CardSkeleton, ConfirmDialog, EmptyState, ErrorBanner, Sheet, useToast } from '@/components/ui';
import {
  EXPENSE_CATEGORIES,
  PAY_METHODS,
  type AppRow,
  type Expense,
  type ExpenseCategory,
  type ExpenseFile,
  type PayMethod,
} from '@/lib/types';

/**
 * 지출결의서.
 *
 * 영수증을 서랍에 모아두면 연말에 아무도 못 맞춘다. 쓴 그 자리에서
 * **날짜·금액·내용·영수증 사진** 네 가지만 넣어두면,
 * 월말에 `인쇄 / PDF 저장` 한 번으로 회계에 넘길 문서가 나온다.
 */
export default function ExpensePage() {
  const { session, isAdmin } = useSession();
  const { members, nameOf } = useMembers(true);
  const toast = useToast();

  const [month, setMonth] = useState(thisMonth());
  const [rows, setRows] = useState<Expense[] | null>(null);
  const [files, setFiles] = useState<ExpenseFile[]>([]);
  const [apps, setApps] = useState<AppRow[]>([]);
  const [error, setError] = useState('');

  const [cat, setCat] = useState<'all' | ExpenseCategory>('all');
  const [who, setWho] = useState('all');
  const [onlyNoReceipt, setOnlyNoReceipt] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [printOpen, setPrintOpen] = useState(false);

  const load = useCallback(async () => {
    setError('');
    const { from, to } = monthRange(month);
    try {
      const [eRes, aRes] = await Promise.all([
        supabase
          .from('expenses')
          .select('*')
          .gte('spent_on', from)
          .lte('spent_on', to)
          .order('spent_on', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase.from('apps').select('*').eq('archived', false).order('title_ko'),
      ]);
      if (eRes.error) throw eRes.error;

      const list = (eRes.data ?? []) as Expense[];
      setRows(list);
      setApps((aRes.data ?? []) as AppRow[]);

      if (list.length > 0) {
        const { data } = await supabase
          .from('expense_files')
          .select('*')
          .in('expense_id', list.map((r) => r.id))
          .order('sort_order');
        setFiles((data ?? []) as ExpenseFile[]);
      } else {
        setFiles([]);
      }
    } catch (e) {
      setRows([]);
      setFiles([]);
      setError(friendlyError(e, '지출 내역을 불러오지 못했어요.'));
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const filesOf = useCallback((id: string) => files.filter((f) => f.expense_id === id), [files]);
  const receiptCount = useCallback((id: string) => filesOf(id).length, [filesOf]);

  /** 화면에 보이는 것만 합계에 넣는다 — 필터를 걸면 그 필터의 합계를 봐야 한다 */
  const shown = useMemo(() => {
    let list = rows ?? [];
    if (cat !== 'all') list = list.filter((r) => r.category === cat);
    if (who !== 'all') list = list.filter((r) => r.member_id === who);
    if (onlyNoReceipt) list = list.filter((r) => receiptCount(r.id) === 0);
    return list;
  }, [rows, cat, who, onlyNoReceipt, receiptCount]);

  const totals = useMemo(() => expenseTotals(shown, receiptCount), [shown, receiptCount]);
  const days = useMemo(() => groupByDate(shown), [shown]);
  const filterCount = (cat !== 'all' ? 1 : 0) + (who !== 'all' ? 1 : 0) + (onlyNoReceipt ? 1 : 0);
  const filtered = filterCount > 0;
  const resetFilters = () => {
    setCat('all');
    setWho('all');
    setOnlyNoReceipt(false);
  };

  const toggleApprove = async (r: Expense) => {
    if (!isAdmin) return;
    const next = !r.approved;
    try {
      const { error: e } = await supabase
        .from('expenses')
        .update({
          approved: next,
          approved_by: next ? (session?.id ?? null) : null,
          approved_at: next ? new Date().toISOString() : null,
        })
        .eq('id', r.id);
      if (e) throw e;
      setRows((prev) =>
        (prev ?? []).map((x) =>
          x.id === r.id
            ? {
                ...x,
                approved: next,
                approved_by: next ? (session?.id ?? null) : null,
                approved_at: next ? new Date().toISOString() : null,
              }
            : x,
        ),
      );
      toast.show(next ? '확인 처리했어요.' : '확인을 취소했어요.');
    } catch (e) {
      setError(friendlyError(e));
    }
  };

  return (
    <>
      <PageHeader
        title="지출결의서"
        subtitle={rows ? `${monthLabel(month)} · ${totals.count}건 · ${won(totals.total)}원` : undefined}
        right={
          <button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="btn-primary h-10 px-3.5 text-[14px]"
          >
            + 지출
          </button>
        }
      />

      <div className="space-y-3 px-4 pb-8 pt-3">
        {error && <ErrorBanner message={error} onRetry={() => void load()} />}

        {/* 달 넘기기 — 회계는 달 단위로 끊는다 */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMonth(shiftMonth(month, -1))}
            aria-label="지난 달"
            className="tap w-11 rounded-xl border border-neutral-200 bg-surface text-neutral-500"
          >
            ‹
          </button>
          <p className="flex-1 text-center text-[16px] font-bold">{monthLabel(month)}</p>
          <button
            onClick={() => setMonth(shiftMonth(month, 1))}
            aria-label="다음 달"
            className="tap w-11 rounded-xl border border-neutral-200 bg-surface text-neutral-500"
          >
            ›
          </button>
          {month !== thisMonth() && (
            <button onClick={() => setMonth(thisMonth())} className="btn-ghost h-11 px-3 text-[13px]">
              이 달
            </button>
          )}
        </div>

        {/* 합계 */}
        <div className="card p-4">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12px] text-neutral-500">
                {filtered ? '고른 것 합계' : `${monthLabel(month)} 합계`}
              </p>
              <p className="text-[26px] font-black leading-tight">{won(totals.total)}원</p>
              <p className="mt-0.5 text-[12px] text-neutral-500">{totals.count}건</p>
            </div>
            <button
              onClick={() => setPrintOpen(true)}
              disabled={totals.count === 0}
              className="btn-ghost h-10 shrink-0 px-3 text-[13px] disabled:opacity-40"
            >
              <Icon name="printer" size={15} />
              인쇄
            </button>
          </div>

          {(totals.noReceipt > 0 || totals.unapproved > 0) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {/* 누르는 것이 아니라 알림표다 — 걸러 보는 건 아래 '영수증 없는 것만' 칩이 한다
                  (작은 칩을 버튼으로 만들면 44px 탭 규칙을 어긴다) */}
              {totals.noReceipt > 0 && (
                <span className="chip bg-red-100 text-red-700">영수증 없음 {totals.noReceipt}건</span>
              )}
              {totals.unapproved > 0 && (
                <span className="chip bg-amber-100 text-amber-800">미확인 {totals.unapproved}건</span>
              )}
            </div>
          )}

          {/* 구분별 소계 — 막대 하나로 어디에 많이 썼는지 */}
          {totals.byCategory.length > 0 && (
            <div className="mt-3.5 space-y-1.5">
              <div className="flex h-2.5 overflow-hidden rounded-full bg-neutral-100">
                {totals.byCategory.map((c) => (
                  <span
                    key={c.value}
                    title={c.label}
                    style={{
                      width: `${totals.total > 0 ? (c.amount / totals.total) * 100 : 0}%`,
                      background: c.color,
                    }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {totals.byCategory.map((c) => (
                  <span key={c.value} className="flex items-center gap-1.5 text-[11.5px] text-neutral-600">
                    <i className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                    {c.label} {won(c.amount)}원
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 필터 — 접어둔다. 칩을 다 늘어놓으면 폰에서 네 줄(200px)을 먹고
            그만큼 정작 봐야 할 지출 목록이 화면 밖으로 밀린다.
            (갤러리와 같은 방식) */}
        <details className="card overflow-hidden" open={filterCount > 0}>
          <summary className="tap cursor-pointer list-none px-4 text-[14px] font-bold text-neutral-700">
            필터
            {filterCount > 0 && <span className="chip ml-1 bg-brand text-white">{filterCount}</span>}
          </summary>
          <div className="space-y-3 border-t border-neutral-100 p-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="ex-f-cat">
                  구분
                </label>
                <select
                  id="ex-f-cat"
                  value={cat}
                  onChange={(e) => setCat(e.target.value as 'all' | ExpenseCategory)}
                  className="field"
                >
                  <option value="all">전체</option>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="ex-f-who">
                  결의자
                </label>
                <select id="ex-f-who" value={who} onChange={(e) => setWho(e.target.value)} className="field">
                  <option value="all">전원</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="flex min-h-[44px] items-center gap-3 rounded-xl bg-neutral-50 px-3 py-2.5">
              <input
                type="checkbox"
                checked={onlyNoReceipt}
                onChange={(e) => setOnlyNoReceipt(e.target.checked)}
                className="h-5 w-5 accent-[#F26522]"
              />
              <span className="text-[14px] font-semibold">영수증 없는 것만</span>
            </label>

            {filterCount > 0 && (
              <button onClick={resetFilters} className="btn-ghost w-full">
                필터 초기화
              </button>
            )}
          </div>
        </details>

        {/* 날짜별 목록 */}
        {rows === null ? (
          <CardSkeleton rows={3} />
        ) : shown.length === 0 ? (
          <EmptyState
            icon="receipt"
            title={filtered ? '조건에 맞는 지출이 없어요' : `${monthLabel(month)} 지출이 아직 없어요`}
            desc={
              filtered
                ? '필터를 지우면 이 달 전체가 보여요.'
                : '재료를 사거나 교통비를 쓴 그 자리에서 영수증을 찍어 올려두면, 월말에 인쇄 한 번으로 끝나요.'
            }
            action={
              filtered ? (
                <button onClick={resetFilters} className="btn-ghost px-5">
                  필터 지우기
                </button>
              ) : (
                <button
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(true);
                  }}
                  className="btn-primary px-5"
                >
                  첫 지출 넣기
                </button>
              )
            }
          />
        ) : (
          days.map((d) => (
            <section key={d.date}>
              <div className="mb-1.5 mt-1 flex items-baseline justify-between px-1">
                <h2 className="text-[13.5px] font-bold text-neutral-700">{korDate(d.date)}</h2>
                <span className="text-[12px] font-semibold text-neutral-500">{won(d.amount)}원</span>
              </div>
              <div className="space-y-2">
                {d.rows.map((r) => {
                  const att = filesOf(r.id);
                  const mine = r.member_id === session?.id;
                  return (
                    <article key={r.id} className="card p-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className="chip text-white"
                              style={{ background: expenseCategoryColor(r.category) }}
                            >
                              {expenseCategoryLabel(r.category)}
                            </span>
                            <span className="chip bg-neutral-100 text-neutral-600">
                              {payMethodLabel(r.pay_method)}
                            </span>
                            {r.approved ? (
                              <span className="chip bg-green-100 text-green-800">확인</span>
                            ) : (
                              <span className="chip bg-amber-100 text-amber-800">미확인</span>
                            )}
                          </div>
                          <p className="mt-1.5 break-words text-[15px] font-semibold leading-snug">
                            {r.purpose}
                          </p>
                          <p className="mt-0.5 text-[12.5px] text-neutral-500">
                            {r.vendor || '사용처 없음'}
                            {r.school ? ` · ${r.school}` : ''}
                          </p>
                        </div>
                        <p className="shrink-0 text-[17px] font-black">{won(r.amount)}원</p>
                      </div>

                      {att.length > 0 && (
                        <div className="mt-2.5 flex gap-1.5 overflow-hidden">
                          {att.slice(0, 4).map((f) =>
                            f.is_image ? (
                              <a
                                key={f.id}
                                href={f.file_url}
                                target="_blank"
                                rel="noreferrer"
                                className="block h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-neutral-200"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={f.file_url} alt="영수증" className="h-full w-full object-cover" />
                              </a>
                            ) : (
                              <a
                                key={f.id}
                                href={f.file_url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 text-[10px] font-bold text-neutral-500"
                              >
                                {(f.file_name.split('.').pop() ?? 'FILE').toUpperCase().slice(0, 4)}
                              </a>
                            ),
                          )}
                          {att.length > 4 && (
                            <span className="flex h-14 items-center px-1 text-[11.5px] text-neutral-500">
                              +{att.length - 4}
                            </span>
                          )}
                        </div>
                      )}

                      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-neutral-100 pt-2.5">
                        <p className="min-w-0 truncate text-[12px] text-neutral-500">
                          {nameOf(r.member_id)}
                          {att.length === 0 ? (
                            <span className="font-bold text-red-600"> · 영수증 없음</span>
                          ) : (
                            ` · 영수증 ${att.length}장`
                          )}
                        </p>
                        <div className="flex shrink-0 gap-1.5">
                          {isAdmin && (
                            <button
                              onClick={() => void toggleApprove(r)}
                              className="tap rounded-lg border border-neutral-200 px-2.5 text-[12.5px] font-bold text-neutral-600"
                            >
                              {r.approved ? '확인 취소' : '확인'}
                            </button>
                          )}
                          {(mine || isAdmin) && (
                            <button
                              onClick={() => {
                                setEditing(r);
                                setFormOpen(true);
                              }}
                              className="tap rounded-lg border border-neutral-200 px-2.5 text-[12.5px] font-bold text-neutral-600"
                            >
                              수정
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>

      <ExpenseForm
        open={formOpen}
        editing={editing}
        apps={apps}
        month={month}
        onClose={() => setFormOpen(false)}
        onSaved={(msg) => {
          toast.show(msg);
          void load();
        }}
      />

      <PrintSheet
        open={printOpen}
        month={month}
        onClose={() => setPrintOpen(false)}
        extra={{
          category: cat === 'all' ? '' : cat,
          member: who === 'all' ? '' : who,
        }}
      />

      {toast.node}
    </>
  );
}

/* ------------------------------------------------------------------ 입력 폼 */

function ExpenseForm({
  open,
  editing,
  apps,
  month,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: Expense | null;
  apps: AppRow[];
  month: string;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const { session, isAdmin } = useSession();
  const { members } = useMembers(true);

  const [spentOn, setSpentOn] = useState(today());
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('material');
  const [purpose, setPurpose] = useState('');
  const [vendor, setVendor] = useState('');
  const [payMethod, setPayMethod] = useState<PayMethod>('card');
  const [memberId, setMemberId] = useState('');
  const [appId, setAppId] = useState('');
  const [school, setSchool] = useState('');
  const [note, setNote] = useState('');

  const [existing, setExisting] = useState<ExpenseFile[]>([]);
  const [picked, setPicked] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [err, setErr] = useState('');
  const [delOpen, setDelOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * 글을 먼저 저장하고 영수증을 올린다. 올리기가 실패했을 때 다시 눌러도
   * 지출이 두 번 들어가지 않게 만들어진 행의 id 를 기억한다.
   * (공지·지적에서 실제로 났던 버그다)
   */
  const createdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    createdRef.current = null;
    setErr('');
    setPicked([]);
    setProgress('');
    if (editing) {
      setSpentOn(editing.spent_on);
      setAmount(String(Math.round(Number(editing.amount || 0))));
      setCategory(editing.category);
      setPurpose(editing.purpose);
      setVendor(editing.vendor ?? '');
      setPayMethod(editing.pay_method);
      setMemberId(editing.member_id ?? '');
      setAppId(editing.app_id ?? '');
      setSchool(editing.school ?? '');
      setNote(editing.note ?? '');
      void supabase
        .from('expense_files')
        .select('*')
        .eq('expense_id', editing.id)
        .order('sort_order')
        .then(({ data }) => setExisting((data ?? []) as ExpenseFile[]));
    } else {
      // 이 달을 보고 있다면 그 달 안의 날짜로 시작한다 (지난 달을 정리할 때 편하다)
      const t = today();
      setSpentOn(t.startsWith(month) ? t : monthRange(month).from);
      setAmount('');
      setCategory('material');
      setPurpose('');
      setVendor('');
      setPayMethod('card');
      setMemberId(session?.id ?? '');
      setAppId('');
      setSchool('');
      setNote('');
      setExisting([]);
    }
  }, [open, editing, month, session?.id]);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    // ★ 먼저 배열로 복사한다. FileList 는 input 을 따라다니는 살아있는 목록이라
    //   아래에서 value='' 로 비우면 같이 비어버린다 — setPicked 의 함수는 나중에
    //   불리니 그때는 이미 0개가 된다 (같은 파일을 다시 고를 수 있게 value 는 비워야 한다)
    const added = Array.from(list);
    setPicked((prev) => [...prev, ...added]);
    if (fileRef.current) fileRef.current.value = '';
  };

  const save = async () => {
    const amt = Number(digitsOnly(amount) || 0);
    if (!spentOn) {
      setErr('지출한 날짜를 골라주세요.');
      return;
    }
    if (amt <= 0) {
      setErr('금액을 넣어주세요.');
      return;
    }
    if (!purpose.trim()) {
      setErr('무엇에 썼는지 적어주세요. 나중에 회계에서 이 칸을 봅니다.');
      return;
    }

    setBusy(true);
    setErr('');
    const payload = {
      spent_on: spentOn,
      amount: amt,
      category,
      purpose: purpose.trim(),
      vendor: vendor.trim() || null,
      pay_method: payMethod,
      member_id: memberId || null,
      app_id: appId || null,
      school: school.trim() || null,
      note: note.trim() || null,
    };

    try {
      // 1단계 — 지출 한 줄을 먼저 확정한다
      let id = editing?.id ?? createdRef.current;
      if (id) {
        const { error: e } = await supabase.from('expenses').update(payload).eq('id', id);
        if (e) throw e;
      } else {
        const { data, error: e } = await supabase.from('expenses').insert(payload).select().single();
        if (e) throw e;
        id = data.id as string;
        createdRef.current = id;
      }

      // 2단계 — 영수증. 실패해도 위에서 저장한 지출은 남는다
      if (picked.length > 0) {
        let uploaded;
        try {
          uploaded = await uploadMany(
            'moalab-receipts',
            picked,
            `expense/${id}`,
            (done, total) => setProgress(`영수증 올리는 중… ${done}/${total}`),
          );
        } catch (upErr) {
          // 토스트는 2초 뒤 사라지고 이 배너는 남는다.
          // 배너만 읽어도 "지출은 됐다 / 영수증만 안 됐다" 가 갈라져 보여야 한다.
          onSaved('지출은 저장됐어요 (영수증 제외).');
          setErr(`지출은 저장됐어요. 영수증만 못 올렸어요 — ${friendlyError(upErr, '다시 눌러주세요.')}`);
          setBusy(false);
          setProgress('');
          return;
        }

        const base = existing.length;
        const { error: fErr } = await supabase.from('expense_files').insert(
          uploaded.map((u, i) => ({
            expense_id: id,
            file_url: u.url,
            file_name: u.name,
            file_size: u.size,
            is_image: picked[i].type.startsWith('image/'),
            sort_order: base + i,
          })),
        );
        /* 구글 드라이브에도 한 벌 — 달마다 정산자료 폴더에 쌓인다.
           연말에 폴더째로 회계에 넘기려고 만든 자리다 */
        queueDrive(session?.id, session?.token, {
          kind: 'receipt',
          files: uploaded.map((u) => ({ url: u.url, name: u.name })),
          month: (spentOn || '').slice(0, 7),
          prefix: (purpose || '').trim() || null,
        });
        // 파일은 올라갔으니 목록에서 빼서 두 번 올라가지 않게 한다
        setPicked([]);
        if (fErr) {
          onSaved('지출은 저장됐어요 (영수증 제외).');
          setErr(
            `지출은 저장됐어요. 영수증 사진은 올라갔는데 목록에 못 붙였어요 — ${friendlyError(fErr, '다시 눌러주세요.')}`,
          );
          setBusy(false);
          setProgress('');
          return;
        }
      }

      logActivity(
        session?.id,
        `${editing ? '지출 수정' : '지출 등록'} — ${spentOn} ${won(amt)}원 ${purpose.trim()}`,
        `expense:${id}`,
      );
      onSaved(editing ? '수정했어요.' : '지출을 넣었어요.');
      onClose();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const removeExisting = async (f: ExpenseFile) => {
    try {
      const { error: e } = await supabase.from('expense_files').delete().eq('id', f.id);
      if (e) throw e;
      setExisting((prev) => prev.filter((x) => x.id !== f.id));
    } catch (e) {
      setErr(friendlyError(e));
    }
  };

  const removeExpense = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const { error: e } = await supabase.from('expenses').delete().eq('id', editing.id);
      if (e) throw e;
      logActivity(session?.id, `지출 삭제 — ${editing.spent_on} ${won(Number(editing.amount))}원`);
      setDelOpen(false);
      onSaved('지웠어요.');
      onClose();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={editing ? '지출 수정' : '지출 넣기'}
        footer={
          <div className="flex gap-2">
            {editing && (
              <button onClick={() => setDelOpen(true)} disabled={busy} className="btn-danger px-4">
                삭제
              </button>
            )}
            <button onClick={() => void save()} disabled={busy} className="btn-primary flex-1">
              {busy ? (progress || '저장 중…') : '저장'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {err && <ErrorBanner message={err} />}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="ex-date">
                지출일
              </label>
              <input
                id="ex-date"
                type="date"
                value={spentOn}
                onChange={(e) => setSpentOn(e.target.value)}
                className="field"
              />
            </div>
            <div>
              <label className="label" htmlFor="ex-amount">
                금액 (원)
              </label>
              <input
                id="ex-amount"
                inputMode="numeric"
                value={commaNumber(amount)}
                onChange={(e) => setAmount(digitsOnly(e.target.value))}
                placeholder="45,000"
                className="field text-right font-bold"
              />
            </div>
          </div>

          <div>
            <label className="label">구분</label>
            <div className="flex flex-wrap gap-1.5">
              {EXPENSE_CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategory(c.value)}
                  className={`tap rounded-full border px-3.5 text-[13.5px] font-semibold transition ${
                    category === c.value
                      ? 'border-transparent text-white'
                      : 'border-neutral-300 bg-surface text-neutral-600'
                  }`}
                  style={category === c.value ? { background: c.color } : undefined}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label" htmlFor="ex-purpose">
              사용 내용 <span className="font-normal text-neutral-400">— 회계가 읽는 칸</span>
            </label>
            <input
              id="ex-purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="업사이클링 수업 재료 (펠트지·글루건)"
              className="field"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="ex-vendor">
                사용처 (상호)
              </label>
              <input
                id="ex-vendor"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                placeholder="다이소 강남점"
                className="field"
              />
            </div>
            <div>
              <label className="label" htmlFor="ex-pay">
                결제수단
              </label>
              <select
                id="ex-pay"
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value as PayMethod)}
                className="field"
              >
                {PAY_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 영수증 */}
          <div>
            <label className="label">영수증 첨부</label>

            {existing.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {existing.map((f) => (
                  <div key={f.id} className="relative">
                    {f.is_image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={f.file_url}
                        alt="영수증"
                        className="h-20 w-20 rounded-lg border border-neutral-200 object-cover"
                      />
                    ) : (
                      <span className="flex h-20 w-20 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 text-[11px] font-bold text-neutral-500">
                        {(f.file_name.split('.').pop() ?? 'FILE').toUpperCase().slice(0, 4)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void removeExisting(f)}
                      aria-label="영수증 지우기"
                      className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-white"
                    >
                      <Icon name="close" size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {picked.length > 0 && (
              <ul className="mb-2 space-y-1">
                {picked.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex items-center gap-2 rounded-lg bg-neutral-50 px-2.5 py-2 text-[12.5px]"
                  >
                    <Icon name="clip" size={13} className="shrink-0 text-neutral-400" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => setPicked((prev) => prev.filter((_, x) => x !== i))}
                      aria-label="목록에서 빼기"
                      className="shrink-0 text-neutral-400"
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,.pdf,.hwp,.hwpx"
              onChange={(e) => addFiles(e.target.files)}
              className="hidden"
              id="ex-files"
            />
            <label htmlFor="ex-files" className="btn-ghost w-full cursor-pointer">
              <Icon name="camera" size={15} />
              영수증 사진·파일 고르기
            </label>
          </div>

          {/* 선택 항목 */}
          <details className="rounded-xl border border-neutral-200 p-3">
            <summary className="cursor-pointer text-[13.5px] font-bold text-neutral-700">
              더 넣을 것 (프로그램·학교·비고)
            </summary>
            <div className="mt-3 space-y-3">
              <div>
                <label className="label" htmlFor="ex-member">
                  결의자 (쓴 사람)
                </label>
                <select
                  id="ex-member"
                  value={memberId}
                  onChange={(e) => setMemberId(e.target.value)}
                  disabled={!isAdmin && !editing}
                  className="field disabled:opacity-60"
                >
                  <option value="">선택 안 함</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="ex-app">
                  관련 프로그램
                </label>
                <select id="ex-app" value={appId} onChange={(e) => setAppId(e.target.value)} className="field">
                  <option value="">연결 안 함</option>
                  {apps.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title_ko}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="ex-school">
                  학교·현장
                </label>
                <input
                  id="ex-school"
                  value={school}
                  onChange={(e) => setSchool(e.target.value)}
                  placeholder="○○초등학교"
                  className="field"
                />
              </div>
              <div>
                <label className="label" htmlFor="ex-note">
                  비고
                </label>
                <input
                  id="ex-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="3반 추가 재료"
                  className="field"
                />
              </div>
            </div>
          </details>
        </div>
      </Sheet>

      <ConfirmDialog
        open={delOpen}
        title="이 지출을 지울까요?"
        message="붙여둔 영수증도 같이 지워집니다."
        onConfirm={() => void removeExpense()}
        onCancel={() => setDelOpen(false)}
      />
    </>
  );
}

/* --------------------------------------------------------------- 인쇄 고르기 */

function PrintSheet({
  open,
  month,
  extra,
  onClose,
}: {
  open: boolean;
  month: string;
  extra: { category: string; member: string };
  onClose: () => void;
}) {
  const [parts, setParts] = useState<ExpensePrintPart[]>(EXPENSE_PRINT_PARTS.map((p) => p.key));

  const toggle = (k: ExpensePrintPart) =>
    setParts((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  const query = new URLSearchParams({ month, parts: parts.join(',') });
  if (extra.category) query.set('category', extra.category);
  if (extra.member) query.set('member', extra.member);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`${monthLabel(month)} 지출결의서 인쇄`}
      footer={
        <Link
          href={`/print/expense?${query.toString()}`}
          target="_blank"
          className={`btn-primary w-full ${parts.length === 0 ? 'pointer-events-none opacity-40' : ''}`}
          onClick={onClose}
        >
          <Icon name="printer" size={15} />
          문서 열기
        </Link>
      }
    >
      <div className="space-y-2">
        {/* 필터가 걸려 있을 때만 알린다 — 부분 문서가 전체로 오해되면 안 된다 */}
        {(extra.category || extra.member) && (
          <p className="text-[13px] leading-relaxed text-neutral-500">
            지금 걸어둔 필터가 그대로 적용됩니다.
          </p>
        )}
        {EXPENSE_PRINT_PARTS.map((p) => {
          const on = parts.includes(p.key);
          return (
            <button
              key={p.key}
              onClick={() => toggle(p.key)}
              className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition ${
                on ? 'border-brand bg-brand-50' : 'border-neutral-200 bg-surface'
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                  on ? 'border-brand bg-brand text-white' : 'border-neutral-300'
                }`}
              >
                {on && <Icon name="check" size={11} strokeWidth={3} />}
              </span>
              <span className="text-[14.5px] font-semibold">{p.label}</span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
