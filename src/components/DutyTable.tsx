'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { supabase, friendlyError } from '@/lib/supabase';
import { contactCol } from '@/lib/sales';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { logActivity } from '@/lib/log';
import { relTime } from '@/lib/format';
import { Icon } from '@/components/Icon';
import { Collapsible, ConfirmDialog, EmptyState, ErrorBanner, Sheet, Skeleton } from '@/components/ui';
import { parseDutyDocument } from '@/lib/dutyDocument';
import {
  COLUMN_KINDS,
  PASTE_MAX,
  PRESETS,
  cellText,
  cleanCell,
  filterRows,
  nextOrder,
  parsePasted,
  rowTitle,
  safeKind,
  statusCounts,
  suggestPreset,
  type CellValue,
  type ColumnKind,
} from '@/lib/dutyTable';
import type { DutyColumn, DutyRow } from '@/lib/types';

/**
 * 역할에 붙는 **표** — "이 일은 무엇을 적어두는 일인가".
 *
 * 원장: *"학교기관관리 → 리스트 업하고 관리하는 페이지 구현, 그리고 그걸 자동저장."*
 *
 * **열이 데이터다.** 역할이 63개라 화면을 63개 만들 수 없어서, 프로그램을 코드
 * 수정 없이 늘리는 것과 같은 방식을 쓴다. 새 역할에 표를 붙일 때 고칠 파일은 없다.
 *
 * ⚠️ **여기만 자동저장이다.** 이 문서의 규칙은 `자동저장 금지 · 명시적 저장 버튼`
 * 인데, 그 규칙이 지키려는 것은 *"강사가 잘못 눌러서 쓰던 걸 날리는 것"* 이다.
 * 목록은 성격이 다르다 — 칸 하나를 고치는 일이 수십 번 일어나고, 그때마다 저장을
 * 누르게 하면 폰에서 **안 누르고 나가서 오히려 날아간다.** 대신 이렇게 지킨다:
 * · 저장은 **칸을 벗어날 때**(blur) 한 칸씩 — 타이핑 중에는 안 보낸다
 * · **무엇이 언제 저장됐는지 화면에 적는다** (`저장됨 · 방금`)
 * · 줄을 지우는 것만은 **확인 대화**를 거친다 (되돌릴 수 없는 것은 그대로 명시적)
 * · 표의 **모양(열)을 바꾸는 것은 명시적 저장 버튼**이다 — 모두의 화면이 바뀐다
 */

type Values = Record<string, CellValue>;

interface Draft {
  id: string;
  name: string;
  kind: ColumnKind;
  options: string;
  /** DB 에 이미 있는 열인지 (새로 만든 것은 insert) */
  saved: boolean;
}

export function DutyTable({
  dutyId,
  dutyName,
  groupName,
  defaultOpen = false,
}: {
  dutyId: string;
  dutyName: string;
  groupName?: string;
  /** 줄이 쌓이는 일이면 펼친 채로 시작한다 (DutyFiles 와 같은 꼴) */
  defaultOpen?: boolean;
}) {
  const { session } = useSession();
  const { nameOf } = useMembers();

  const [cols, setCols] = useState<DutyColumn[] | null>(null);
  const [rows, setRows] = useState<DutyRow[]>([]);
  const [error, setError] = useState('');
  /* `?q=기관이름` 으로 들어오면 그 줄부터 보여준다 — 영업 한 판의 '오늘 연락할 곳' 에서
     누르면 14줄짜리 표에 떨어져 다시 찾게 하지 않으려고. 검색만 미리 채우는 것이라
     주소를 지우면 원래 목록이다 */
  const params = useSearchParams();
  const [q, setQ] = useState(() => params?.get('q') ?? '');

  const [editing, setEditing] = useState<DutyRow | null>(null);
  const [values, setValues] = useState<Values>({});
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [killing, setKilling] = useState<DutyRow | null>(null);

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteError, setPasteError] = useState('');

  /** 목록으로 돌아가 `줄 추가`를 다시 누르지 않고 여러 건을 이어서 입력한다. */
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryValues, setEntryValues] = useState<Values>({});
  const [entryBusy, setEntryBusy] = useState(false);
  const [entryError, setEntryError] = useState('');
  const [entryCount, setEntryCount] = useState(0);

  const [structOpen, setStructOpen] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [structBusy, setStructBusy] = useState(false);
  const [structError, setStructError] = useState('');

  /** 시트를 닫을 때 '한 글자도 안 적은 새 줄' 인지 보려고 들고 있는다 */
  const freshRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [c, r] = await Promise.all([
        supabase.from('duty_columns').select('*').eq('duty_id', dutyId).order('sort_order'),
        supabase.from('duty_rows').select('*').eq('duty_id', dutyId).order('sort_order'),
      ]);
      if (c.error) throw c.error;
      if (r.error) throw r.error;
      setCols((c.data ?? []) as DutyColumn[]);
      setRows((r.data ?? []) as DutyRow[]);
    } catch (e) {
      setCols([]);
      setError(friendlyError(e, '목록을 불러오지 못했어요.'));
    }
  }, [dutyId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ------------------------------------------------------- 표 만들기 */

  /** 미리 만든 양식을 통째로 넣는다. 빈 표에서 열을 하나씩 만들라고 하면 아무도 시작을 못 한다 */
  const applyPreset = async (key: string) => {
    const preset = PRESETS.find((p) => p.key === key);
    if (!preset) return;
    setError('');
    try {
      const { data, error: e } = await supabase
        .from('duty_columns')
        .insert(
          preset.columns.map((c, i) => ({
            duty_id: dutyId,
            name: c.name,
            kind: c.kind,
            options: c.options ?? null,
            sort_order: i + 1,
          })),
        )
        .select();
      if (e) throw e;
      setCols((data ?? []) as DutyColumn[]);
      logActivity(session?.id, `역할 표 만들기 — ${dutyName} (${preset.label})`, `duty:${dutyId}`);
    } catch (e) {
      setError(friendlyError(e, '표를 만들지 못했어요.'));
    }
  };

  /* ---------------------------------------------------------- 줄 */

  const openEntry = () => {
    setEntryValues({});
    setEntryError('');
    setEntryCount(0);
    setEntryOpen(true);
  };

  /** 한 건을 저장하고 닫거나, 입력칸만 비워 다음 건을 바로 받는다. */
  const saveEntry = async (keepOpen: boolean) => {
    const first = (cols ?? [])[0];
    const title = first ? cleanCell(safeKind(first.kind), entryValues[first.id]) : null;
    if (title === null || title === '' || title === false) {
      setEntryError(`${first?.name ?? '첫 칸'}을 적어주세요.`);
      return;
    }
    const cells = Object.fromEntries(
      (cols ?? []).map((c) => [c.id, cleanCell(safeKind(c.kind), entryValues[c.id])]),
    );
    setEntryBusy(true);
    setEntryError('');
    try {
      const { data, error: e } = await supabase
        .from('duty_rows')
        .insert({ duty_id: dutyId, cells, sort_order: nextOrder(rows), updated_by: session?.id ?? null })
        .select()
        .single();
      if (e) throw e;
      const row = data as DutyRow;
      setRows((prev) => [...prev, row]);
      logActivity(session?.id, `역할 표 입력 — ${dutyName}`, `duty:${dutyId}`);
      if (keepOpen) {
        setEntryValues({});
        setEntryCount((n) => n + 1);
      } else {
        setEntryOpen(false);
      }
    } catch (e) {
      setEntryError(friendlyError(e, '내용을 저장하지 못했어요.'));
    } finally {
      setEntryBusy(false);
    }
  };

  /**
   * **여러 줄 한꺼번에 넣기.** 엑셀·한글 표에서 복사한 것을 붙여넣으면 줄이 된다.
   * 기관 목록처럼 수백 줄짜리는 `+ 줄 추가` 를 수백 번 누를 수 없다.
   *
   * 저장은 **insert 한 번**(배열)이다 — 중간에 반만 들어가는 일이 없다
   * (체크리스트 뿌리기·주제로 옮기기와 같은 규칙).
   */
  const runPaste = async () => {
    if (pasted.rows.length === 0) return;
    setPasteBusy(true);
    setPasteError('');
    try {
      const base = nextOrder(rows);
      const { data, error: e } = await supabase
        .from('duty_rows')
        .insert(
          pasted.rows.map((cells, i) => ({
            duty_id: dutyId,
            cells,
            sort_order: base + i,
            updated_by: session?.id ?? null,
          })),
        )
        .select();
      if (e) throw e;
      setRows((prev) => [...prev, ...((data ?? []) as DutyRow[])]);
      logActivity(
        session?.id,
        `역할 표 여러 줄 넣기 — ${dutyName} (${pasted.rows.length}줄)`,
        `duty:${dutyId}`,
      );
      setPasteOpen(false);
      setPasteText('');
    } catch (e) {
      setPasteError(friendlyError(e, '줄을 넣지 못했어요.'));
    } finally {
      setPasteBusy(false);
    }
  };

  const openRow = (row: DutyRow) => {
    setEditing(row);
    setValues({ ...(row.cells ?? {}) });
    setSavedAt(null);
  };

  /**
   * **칸을 벗어날 때 저장한다.** 타이핑 중에는 안 보낸다 —
   * 글자마다 보내면 폰에서 요청이 수십 번 나가고, 느린 망에서는 순서가 뒤집힌다.
   */
  const saveValues = async (next: Values) => {
    if (!editing) return;
    const before = editing.cells ?? {};
    // 안 바뀌었으면 아무것도 안 한다 (칸을 지나가기만 해도 저장되면 '저장됨' 이 거짓말이 된다)
    if (JSON.stringify(before) === JSON.stringify(next)) return;
    setSaving(true);
    setError('');
    try {
      const at = new Date().toISOString();
      const { error: e } = await supabase
        .from('duty_rows')
        .update({ cells: next, updated_by: session?.id ?? null, updated_at: at })
        .eq('id', editing.id);
      if (e) throw e;
      const updated: DutyRow = { ...editing, cells: next, updated_by: session?.id ?? null, updated_at: at };
      setEditing(updated);
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setSavedAt(at);
      freshRef.current = null;
    } catch (e) {
      setError(friendlyError(e, '저장이 안 됐어요.'));
    } finally {
      setSaving(false);
    }
  };

  /** 시트를 닫는다. 한 글자도 안 적은 새 줄이면 조용히 걷어낸다 ('이름 없음' 이 쌓이면 못 찾는다) */
  const closeRow = async () => {
    const row = editing;
    setEditing(null);
    if (!row || freshRef.current !== row.id) return;
    freshRef.current = null;
    const empty = Object.values(row.cells ?? {}).every((v) => v === null || v === '' || v === false);
    if (!empty) return;
    await supabase.from('duty_rows').delete().eq('id', row.id);
    setRows((prev) => prev.filter((r) => r.id !== row.id));
  };

  const removeRow = async () => {
    const row = killing;
    setKilling(null);
    if (!row) return;
    try {
      const { error: e } = await supabase.from('duty_rows').delete().eq('id', row.id);
      if (e) throw e;
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      setEditing(null);
    } catch (e) {
      setError(friendlyError(e, '지우지 못했어요.'));
    }
  };

  /* ------------------------------------------------------ 표의 모양(열) */

  const openStruct = () => {
    setStructError('');
    setDrafts(
      (cols ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        kind: safeKind(c.kind),
        options: (c.options ?? []).join(', '),
        saved: true,
      })),
    );
    setStructOpen(true);
  };

  /** 열을 바꾸는 것은 **명시적 저장**이다 — 모두의 화면 모양이 바뀐다 */
  const saveStruct = async () => {
    const clean = drafts.filter((d) => d.name.trim() !== '');
    if (clean.length === 0) {
      setStructError('열이 하나는 있어야 해요.');
      return;
    }
    setStructBusy(true);
    setStructError('');
    try {
      const keep = new Set(clean.filter((d) => d.saved).map((d) => d.id));
      const gone = (cols ?? []).filter((c) => !keep.has(c.id));
      if (gone.length > 0) {
        const { error: e } = await supabase
          .from('duty_columns')
          .delete()
          .in('id', gone.map((c) => c.id));
        if (e) throw e;
      }
      for (const [i, d] of clean.entries()) {
        const payload = {
          name: d.name.trim(),
          kind: d.kind,
          options:
            d.kind === 'select'
              ? d.options.split(',').map((s) => s.trim()).filter(Boolean)
              : null,
          sort_order: i + 1,
        };
        const { error: e } = d.saved
          ? await supabase.from('duty_columns').update(payload).eq('id', d.id)
          : await supabase.from('duty_columns').insert({ duty_id: dutyId, ...payload });
        if (e) throw e;
      }
      logActivity(session?.id, `역할 표 칸 수정 — ${dutyName}`, `duty:${dutyId}`);
      setStructOpen(false);
      await load();
    } catch (e) {
      setStructError(friendlyError(e, '표 모양을 바꾸지 못했어요.'));
    } finally {
      setStructBusy(false);
    }
  };

  /* ------------------------------------------------------------ 화면 */

  const shown = useMemo(() => filterRows(cols ?? [], rows, q), [cols, rows, q]);
  const counts = useMemo(() => statusCounts(cols ?? [], rows), [cols, rows]);
  /** 붙여넣은 것을 **저장하기 전에** 미리 보여준다 (뿌리기·말로 넣기와 같은 규칙) */
  const pasted = useMemo(
    () => parsePasted(cols ?? [], rows, pasteText),
    [cols, rows, pasteText],
  );
  const editingDocument = editing ? parseDutyDocument((editing.cells ?? {}).__document) : null;

  /** 머리글은 늘 같은 자리다 — 안이 무엇이든(불러오는 중·양식 고르기·목록) 접었다 폈다 한다 */
  const shell = (badge: React.ReactNode, body: React.ReactNode) => (
    <div className="mt-2">
      {/* 검색어가 있으면 펼친다 — 접힌 채로 0건처럼 보이면 안 된다 (`?q=` 로 들어온 경우도) */}
      <Collapsible
        id={`duty-table-${dutyId}`}
        dense
        defaultOpen={defaultOpen}
        forceOpen={q.trim() !== ''}
        title="목록"
        badge={badge}
      >
        {body}
      </Collapsible>
    </div>
  );

  if (cols === null) {
    return shell(
      null,
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>,
    );
  }

  /* 표가 아직 없다 — 양식을 고르는 자리 */
  if (cols.length === 0) {
    const pick = suggestPreset(dutyName, groupName);
    return shell(
      <span className="chip bg-neutral-100 text-neutral-400">아직 없음</span>,
      <div className="space-y-2.5">
        {error && <ErrorBanner message={error} onRetry={() => void load()} />}
        <p className="text-[12.5px] text-neutral-500">이 일에 사용할 양식을 선택하세요.</p>
        <div className="space-y-2">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => void applyPreset(p.key)}
              className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
                p.key === pick.key ? 'pick-on' : 'border-neutral-200 bg-surface hover:border-brand-300'
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-bold">
                  {p.label}
                  {p.key === pick.key && (
                    <span className="ml-1.5 text-[11px] font-bold text-brand">이 역할에 어울려요</span>
                  )}
                </span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-neutral-500">{p.hint}</span>
                <span className="mt-1 block truncate text-[11px] text-neutral-400">
                  {p.columns.map((c) => c.name).join(' · ')}
                </span>
              </span>
              <Icon name="plus" size={15} className="shrink-0 text-neutral-300" />
            </button>
          ))}
        </div>
      </div>,
    );
  }

  const field = (c: DutyColumn) => {
    const kind = safeKind(c.kind);
    const v = values[c.id] ?? null;
    const commit = (raw: unknown) => {
      const next = { ...values, [c.id]: cleanCell(kind, raw) };
      setValues(next);
      void saveValues(next);
    };
    if (kind === 'check') {
      return (
        <label className="tap -my-1.5 flex w-full items-center justify-between gap-2 py-1.5 text-left">
          <span className="text-[13px] font-semibold text-neutral-700">{c.name}</span>
          <input
            type="checkbox"
            checked={Boolean(v)}
            onChange={(e) => commit(e.target.checked)}
            className="h-5 w-5 shrink-0 accent-[#F26522]"
          />
        </label>
      );
    }
    return (
      <div>
        <label className="label" htmlFor={`f-${c.id}`}>
          {c.name}
        </label>
        {kind === 'select' ? (
          <select
            id={`f-${c.id}`}
            value={v === null ? '' : String(v)}
            onChange={(e) => commit(e.target.value)}
            className="field"
          >
            <option value="">안 고름</option>
            {(c.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
            {/* 보기에서 빠진 옛 값도 지워지지 않게 남긴다 */}
            {v !== null && !(c.options ?? []).includes(String(v)) && (
              <option value={String(v)}>{String(v)}</option>
            )}
          </select>
        ) : (
          <input
            id={`f-${c.id}`}
            type={kind === 'date' ? 'date' : 'text'}
            inputMode={kind === 'number' ? 'numeric' : undefined}
            value={v === null ? '' : String(v)}
            onChange={(e) => setValues({ ...values, [c.id]: e.target.value })}
            onBlur={(e) => commit(e.target.value)}
            className="field"
          />
        )}
      </div>
    );
  };

  /** 새 내용 입력은 저장 버튼을 누를 때 한 번에 넣는다. 기존 줄 수정만 자동저장이다. */
  const entryField = (c: DutyColumn) => {
    const kind = safeKind(c.kind);
    const value = entryValues[c.id] ?? null;
    if (kind === 'check') {
      return (
        <label className="tap -my-1.5 flex w-full items-center justify-between gap-2 py-1.5 text-left">
          <span className="text-[13px] font-semibold text-neutral-700">{c.name}</span>
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => setEntryValues((prev) => ({ ...prev, [c.id]: e.target.checked }))}
            className="h-5 w-5 shrink-0 accent-[#F26522]"
          />
        </label>
      );
    }
    return (
      <div>
        <label className="label" htmlFor={`new-${c.id}`}>{c.name}</label>
        {kind === 'select' ? (
          <select
            id={`new-${c.id}`}
            value={value === null ? '' : String(value)}
            onChange={(e) => setEntryValues((prev) => ({ ...prev, [c.id]: e.target.value }))}
            className="field"
          >
            <option value="">안 고름</option>
            {(c.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input
            id={`new-${c.id}`}
            type={kind === 'date' ? 'date' : 'text'}
            inputMode={kind === 'number' ? 'numeric' : undefined}
            value={value === null ? '' : String(value)}
            onChange={(e) => setEntryValues((prev) => ({ ...prev, [c.id]: e.target.value }))}
            className="field"
          />
        )}
      </div>
    );
  };

  return shell(
    <span className="chip bg-neutral-100 text-neutral-600">{rows.length}줄</span>,
    <div className="space-y-2.5">
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {/* 걸린 상태를 머리글에 싣는다 — 펼치지 않고도 지금 어디까지 왔는지 보인다 */}
      {counts && (
        <div className="flex flex-wrap gap-1">
          {counts.counts.map((c) => (
            <span key={c.label} className="chip bg-neutral-100 text-neutral-600">
              {c.label} {c.n}
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-1.5">
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-300">
            <Icon name="search" size={14} />
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`${rows.length}줄에서 찾기`}
            aria-label="목록에서 찾기"
            className="field pl-9"
          />
        </div>
        {/* 인쇄·CSV·칸 고치기 — 셋 다 아이콘 하나짜리다. 라벨을 달면 폰에서 줄이
            하나 더 생기는데, 매일 쓰는 건 검색이라 검색이 폭을 가져야 한다 */}
        <a
          href={`/print/duty/${dutyId}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="이 목록 인쇄 / 엑셀로 받기"
          className="tap flex w-11 shrink-0 items-center justify-center rounded-xl border border-neutral-300 text-neutral-500"
        >
          <Icon name="printer" size={15} />
        </a>
        {/* 서버가 내려준다 — 브라우저에서 Blob 으로 만들면 **파일 이름에 한글이 있을 때
            크로미움이 이름을 통째로 버리고 `download` 로 저장한다** (점검에서 잡았다) */}
        <a
          href={`/api/duty/csv?dutyId=${dutyId}`}
          aria-label="엑셀(CSV)로 받기"
          className="tap flex w-11 shrink-0 items-center justify-center rounded-xl border border-neutral-300 text-neutral-500"
        >
          <Icon name="download" size={15} />
        </a>
        <button
          onClick={openStruct}
          aria-label="표 칸 고치기"
          className="tap w-11 shrink-0 rounded-xl border border-neutral-300 text-neutral-500"
        >
          <Icon name="wrench" size={15} />
        </button>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon="list"
          title={q ? '찾는 줄이 없어요' : '아직 비어 있어요'}
          desc={q ? '다른 말로 찾아보세요.' : '새 내용을 입력하거나 목록을 한꺼번에 넣으세요.'}
        />
      ) : (
        <ul className="divide-y divide-neutral-100">
          {shown.map((r) => {
            /* **상태는 칩으로 오른쪽에, 나머지는 값만 한 줄로.**
               칸 이름을 값 앞에 붙이면(`담당 선생님 김선생님 · 연락처 010-…`)
               375px 에서 제일 중요한 상태가 잘려 나간다 — 실제로 재보고 고쳤다.
               이름은 제목(첫 칸)이 이미 말해주니 값만으로 읽힌다 */
            const st = counts && cellText(counts.col, (r.cells ?? {})[counts.col.id] ?? null);
            const rest = (cols ?? [])
              .filter((c) => c.id !== (cols ?? [])[0]?.id && c.id !== counts?.col.id)
              .map((c) => cellText(c, (r.cells ?? {})[c.id] ?? null))
              .filter((t) => t !== '' && t !== '아니오');
            return (
              <li key={r.id}>
                <button
                  onClick={() => openRow(r)}
                  className="flex min-h-[44px] w-full items-center gap-2 py-2 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-neutral-800">
                      {rowTitle(cols ?? [], r)}
                    </span>
                    {rest.length > 0 && (
                      <span className="mt-0.5 block truncate text-[11.5px] text-neutral-400">
                        {rest.slice(0, 3).join(' · ')}
                      </span>
                    )}
                  </span>
                  {st && <span className="chip shrink-0 bg-neutral-100 text-neutral-600">{st}</span>}
                  <Icon name="chevronDown" size={13} className="shrink-0 -rotate-90 text-neutral-300" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* 직접 연속 입력 / 복사한 목록 한꺼번에 입력 */}
      <div className="flex gap-1.5">
        <button
          onClick={openEntry}
          className="btn-primary min-w-0 flex-1 gap-1.5 text-[13px]"
        >
          <Icon name="plus" size={14} />새 내용 입력
        </button>
        <button
          onClick={() => {
            setPasteError('');
            setPasteOpen(true);
          }}
          className="btn-ghost min-w-0 flex-1 gap-1.5 text-[13px]"
        >
          <Icon name="copy" size={14} />목록 한꺼번에
        </button>
      </div>

      {/* ------------------------------------------------ 새 내용 연속 입력 */}
      <Sheet
        open={entryOpen}
        onClose={() => setEntryOpen(false)}
        title="새 내용 입력"
        footer={
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => void saveEntry(false)} disabled={entryBusy} className="btn-ghost">
              저장하고 닫기
            </button>
            <button onClick={() => void saveEntry(true)} disabled={entryBusy} className="btn-primary">
              {entryBusy ? '저장 중…' : '저장 후 다음 건'}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          {entryCount > 0 && (
            <p className="rounded-xl bg-green-50 px-3 py-2 text-[12px] font-bold text-green-700">
              {entryCount}건 저장됨 · 다음 내용을 이어서 입력하세요
            </p>
          )}
          {(cols ?? []).map((c) => <div key={c.id}>{entryField(c)}</div>)}
          {entryError && <ErrorBanner message={entryError} />}
        </div>
      </Sheet>

      {/* ------------------------------------------------ 줄 고치기 (자동저장) */}
      <Sheet
        open={!!editing}
        onClose={() => void closeRow()}
        title={editing ? rowTitle(cols ?? [], editing) : ''}
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-bold text-neutral-400">
              {saving ? '저장 중…' : savedAt ? `저장됨 · ${relTime(savedAt)}` : '고치면 바로 저장돼요'}
            </span>
            <button onClick={() => void closeRow()} className="btn-primary px-5">
              닫기
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          {editing && editingDocument && (
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-brand-200 bg-brand-50 p-2.5">
              <Link
                href={`/roles/${dutyId}/document?rowId=${editing.id}`}
                className="btn-primary min-w-0 gap-1.5 px-2 text-[12.5px]"
              >
                <Icon name="doc" size={14} />문서로 열기
              </Link>
              <a
                href={`/print/duty-document/${dutyId}/${editing.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost min-w-0 gap-1.5 px-2 text-[12.5px]"
              >
                <Icon name="printer" size={14} />문서 보기·PDF
              </a>
            </div>
          )}

          {(cols ?? []).map((c) => (
            <div key={c.id}>{field(c)}</div>
          ))}

          {editing?.updated_by && (
            <p className="text-[11.5px] text-neutral-400">
              마지막으로 {nameOf(editing.updated_by)} 님이 고쳤어요 · {relTime(editing.updated_at)}
            </p>
          )}

          {/* 기관 표(연락일 칸이 있는 표)에서는 이 줄로 바로 제안서를 만든다 —
              이름·담당·연락처를 다시 치게 하면 안 만든다 */}
          {editing && contactCol(cols ?? []) && (
            <Link
              href={`/proposal?duty=${dutyId}&row=${editing.id}`}
              className="tap w-full gap-1.5 rounded-xl border border-brand-300 text-[13px] font-bold text-brand-700"
            >
              <Icon name="present" size={14} />이 기관에 제안서 만들기
            </Link>
          )}

          {/* 지우는 것만은 확인을 거친다 — 되돌릴 수 없는 것은 그대로 명시적이다 */}
          {editing && (
            <button
              onClick={() => setKilling(editing)}
              className="tap w-full gap-1.5 rounded-xl border border-neutral-300 text-[13px] font-bold text-neutral-500"
            >
              <Icon name="trash" size={14} />이 줄 지우기
            </button>
          )}
        </div>
      </Sheet>

      <ConfirmDialog
        open={!!killing}
        title="이 줄을 지울까요?"
        message={killing ? rowTitle(cols ?? [], killing) : ''}
        onCancel={() => setKilling(null)}
        onConfirm={() => void removeRow()}
      />

      {/* --------------------------------------- 여러 줄 한꺼번에 넣기 (미리보기 필수) */}
      <Sheet
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        title="여러 줄 한꺼번에 넣기"
        footer={
          <button
            onClick={() => void runPaste()}
            disabled={pasteBusy || pasted.rows.length === 0}
            className="btn-primary w-full"
          >
            {pasteBusy ? '넣는 중…' : pasted.rows.length === 0 ? '붙여넣어 주세요' : `${pasted.rows.length}줄 넣기`}
          </button>
        }
      >
        <div className="space-y-2.5">
          <p className="text-[12.5px] text-neutral-500">엑셀·한글 표를 복사해 그대로 붙여넣으세요.</p>

          {(cols ?? []).length > 1 && (
            <p className="rounded-xl bg-neutral-50 px-3 py-2 text-[11.5px] leading-relaxed text-neutral-500">
              칸 순서 — {(cols ?? []).map((c) => c.name).join(' · ')}
            </p>
          )}

          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={7}
            aria-label="넣을 줄 붙여넣기"
            placeholder={`${(cols ?? [])[0]?.name ?? '이름'}을 한 줄에 하나씩\n(엑셀에서 복사한 표를 그대로 붙여넣어도 돼요)`}
            className="field h-auto py-2.5 text-[13px] leading-relaxed"
          />

          {/* **저장 전 미리보기.** 여러 건이 한꺼번에 생기는 동작이라, 잘못 넣으면
              지우는 것도 여러 번이다 (뿌리기·말로 넣기와 같은 규칙) */}
          {pasteText.trim() !== '' && (
            <div className="rounded-xl border border-neutral-200 p-2.5">
              <p className="text-[13px] font-bold text-neutral-800">
                {pasted.rows.length}줄이 들어갑니다
              </p>
              {pasted.titles.length > 0 && (
                <p className="mt-1 text-[11.5px] leading-snug text-neutral-500">
                  {pasted.titles.slice(0, 5).join(' · ')}
                  {pasted.titles.length > 5 && ` 외 ${pasted.titles.length - 5}개`}
                </p>
              )}
              {(pasted.dup > 0 || pasted.blank > 0 || pasted.cut > 0 || pasted.over > 0) && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {pasted.dup > 0 && (
                    <span className="chip bg-neutral-100 text-neutral-600">이미 있음 {pasted.dup}</span>
                  )}
                  {pasted.blank > 0 && (
                    <span className="chip bg-neutral-100 text-neutral-600">이름 없음 {pasted.blank}</span>
                  )}
                  {pasted.over > 0 && (
                    <span className="chip bg-amber-100 text-amber-800">칸이 남음 {pasted.over}</span>
                  )}
                  {pasted.cut > 0 && (
                    <span className="chip bg-amber-100 text-amber-800">
                      {PASTE_MAX}줄 넘어 잘림 {pasted.cut}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {pasteError && <ErrorBanner message={pasteError} />}
        </div>
      </Sheet>

      {/* ------------------------------------------------- 표 모양 (명시적 저장) */}
      <Sheet
        open={structOpen}
        onClose={() => setStructOpen(false)}
        title="표 칸 고치기"
        footer={
          <button onClick={() => void saveStruct()} disabled={structBusy} className="btn-primary w-full">
            {structBusy ? '저장 중…' : '저장'}
          </button>
        }
      >
        <div className="space-y-2.5">
          <p className="text-[12px] leading-relaxed text-neutral-500">
            <b className="text-neutral-700">첫 칸이 줄의 제목</b>이에요. 칸을 지우면 그 칸에 적어둔 값도
            같이 사라집니다.
          </p>

          {drafts.map((d, i) => (
            <div key={d.id} className="rounded-xl border border-neutral-200 p-2.5">
              <div className="flex gap-1.5">
                <input
                  value={d.name}
                  onChange={(e) =>
                    setDrafts((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                  }
                  placeholder="칸 이름"
                  aria-label={`${i + 1}번째 칸 이름`}
                  className="field min-w-0 flex-1"
                />
                <select
                  value={d.kind}
                  onChange={(e) =>
                    setDrafts((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, kind: e.target.value as ColumnKind } : x)),
                    )
                  }
                  aria-label={`${i + 1}번째 칸 갈래`}
                  className="field w-[92px] shrink-0"
                >
                  {COLUMN_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setDrafts((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={`${d.name || i + 1} 칸 빼기`}
                  className="tap w-11 shrink-0 text-neutral-400"
                >
                  <Icon name="close" size={15} />
                </button>
              </div>
              {d.kind === 'select' && (
                <input
                  value={d.options}
                  onChange={(e) =>
                    setDrafts((prev) => prev.map((x, j) => (j === i ? { ...x, options: e.target.value } : x)))
                  }
                  placeholder="보기를 쉼표로 — 연락 전, 제안서 보냄, 계약"
                  aria-label={`${d.name || i + 1} 칸 보기`}
                  className="field mt-1.5 text-[12.5px]"
                />
              )}
            </div>
          ))}

          <button
            onClick={() =>
              setDrafts((prev) => [
                ...prev,
                { id: `new-${prev.length}-${prev.length}`, name: '', kind: 'text', options: '', saved: false },
              ])
            }
            className="tap w-full gap-1.5 rounded-xl border border-dashed border-neutral-300 text-[13px] font-bold text-neutral-500"
          >
            <Icon name="plus" size={14} />칸 추가
          </button>

          {structError && <ErrorBanner message={structError} />}
        </div>
      </Sheet>
    </div>,
  );
}
