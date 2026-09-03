'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { Icon } from '@/components/Icon';
import { CardSkeleton, ErrorBanner } from '@/components/ui';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { logActivity } from '@/lib/log';
import {
  allDocumentFields,
  blankLineItems,
  documentTemplateByKey,
  documentTemplatesFor,
  parseDutyDocument,
  quoteTotal,
  summaryCellsForDocument,
  type DocumentField,
  type DocumentLineItem,
  type DocumentValues,
  type DutyDocumentTemplate,
} from '@/lib/dutyDocument';
import type { Department, Duty, DutyColumn, DutyGroup, DutyRow } from '@/lib/types';

type DriveState = 'idle' | 'syncing' | 'synced' | 'queued' | 'skipped' | 'failed';

function blankValues(template: DutyDocumentTemplate): DocumentValues {
  return Object.fromEntries(
    allDocumentFields(template).map((field) => [field.key, field.kind === 'lineItems' ? blankLineItems() : field.kind === 'check' ? false : '']),
  );
}

function stringValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function money(value: number) {
  return `${new Intl.NumberFormat('ko-KR').format(value)}원`;
}

export default function DutyDocumentPage() {
  const { dutyId } = useParams<{ dutyId: string }>();
  const { session } = useSession();
  const [duty, setDuty] = useState<Duty | null>(null);
  const [group, setGroup] = useState<DutyGroup | null>(null);
  const [dept, setDept] = useState<Department | null>(null);
  const [cols, setCols] = useState<DutyColumn[] | null>(null);
  const [templates, setTemplates] = useState<DutyDocumentTemplate[]>([]);
  const [templateKey, setTemplateKey] = useState('');
  const [values, setValues] = useState<DocumentValues>({});
  const [row, setRow] = useState<DutyRow | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [driveState, setDriveState] = useState<DriveState>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const requestedTemplate = params.get('template') ?? '';
        const requestedRowId = params.get('rowId');
        const [dutyResult, columnResult] = await Promise.all([
          supabase.from('duties').select('*').eq('id', dutyId).maybeSingle(),
          supabase.from('duty_columns').select('*').eq('duty_id', dutyId).order('sort_order'),
        ]);
        if (dutyResult.error) throw dutyResult.error;
        if (columnResult.error) throw columnResult.error;
        const foundDuty = (dutyResult.data ?? null) as Duty | null;
        const foundCols = (columnResult.data ?? []) as DutyColumn[];
        if (!foundDuty) throw new Error('업무를 찾을 수 없습니다.');

        const groupResult = await supabase.from('duty_groups').select('*').eq('id', foundDuty.group_id).maybeSingle();
        if (groupResult.error) throw groupResult.error;
        const foundGroup = (groupResult.data ?? null) as DutyGroup | null;
        if (!foundGroup) throw new Error('업무 묶음을 찾을 수 없습니다.');
        const foundTemplates = documentTemplatesFor(foundDuty.name, foundGroup.name);
        if (foundTemplates.length === 0) throw new Error('이 업무에 연결된 문서 양식이 없습니다.');

        let foundRow: DutyRow | null = null;
        let payload = null;
        if (requestedRowId) {
          const rowResult = await supabase
            .from('duty_rows')
            .select('*')
            .eq('id', requestedRowId)
            .eq('duty_id', dutyId)
            .maybeSingle();
          if (rowResult.error) throw rowResult.error;
          foundRow = (rowResult.data ?? null) as DutyRow | null;
          if (!foundRow) throw new Error('이 업무에 속한 문서를 찾을 수 없습니다.');
          payload = parseDutyDocument(foundRow.cells?.__document);
          if (!payload) throw new Error('이 항목은 문서 양식으로 작성된 자료가 아닙니다.');
        }

        const chosen = payload
          ? documentTemplateByKey(foundDuty.name, foundGroup.name, payload.templateKey)
          : documentTemplateByKey(foundDuty.name, foundGroup.name, requestedTemplate) ?? foundTemplates[0];
        if (!chosen) throw new Error('저장된 문서 양식을 찾을 수 없습니다.');

        const departmentResult = await supabase.from('departments').select('*').eq('id', foundGroup.dept_id).maybeSingle();
        if (!active) return;
        setDuty(foundDuty);
        setGroup(foundGroup);
        setDept((departmentResult.data ?? null) as Department | null);
        setCols(foundCols);
        setTemplates(foundTemplates);
        setTemplateKey(chosen.key);
        setValues(payload?.values ?? blankValues(chosen));
        setRow(foundRow);
        setSavedId(foundRow?.id ?? null);
      } catch (caught) {
        if (!active) return;
        setCols([]);
        setError(friendlyError(caught, '문서 양식을 불러오지 못했어요.'));
      }
    })();
    return () => { active = false; };
  }, [dutyId]);

  const template = useMemo(
    () => templates.find((item) => item.key === templateKey) ?? null,
    [templates, templateKey],
  );

  const setValue = (key: string, value: DocumentValues[string]) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    setSaved(false);
    setDriveState('idle');
  };

  const chooseTemplate = (next: DutyDocumentTemplate) => {
    if (savedId || next.key === templateKey) return;
    setTemplateKey(next.key);
    setValues(blankValues(next));
    setSaved(false);
    setDriveState('idle');
    setError('');
    window.history.replaceState(null, '', `/roles/${dutyId}/document?template=${encodeURIComponent(next.key)}`);
  };

  const validate = () => {
    if (!template) return '문서 양식을 찾을 수 없습니다.';
    for (const field of allDocumentFields(template)) {
      if (!field.required) continue;
      const value = values[field.key];
      if (field.kind === 'lineItems') {
        if (!Array.isArray(value) || !value.some((item) => item.item.trim())) return `${field.label}을 한 줄 이상 적어주세요.`;
      } else if (!stringValue(value).trim()) return `${field.label}을 적어주세요.`;
    }
    return '';
  };

  const syncDrive = async (rowId: string) => {
    if (!session?.id || !session.token) { setDriveState('skipped'); return; }
    setDriveState('syncing');
    try {
      const response = await fetch('/api/drive/duty-document', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-actor-id': session.id,
          'x-session-token': session.token,
        },
        body: JSON.stringify({ dutyId, rowId }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        status?: string;
        skipped?: string;
        error?: string | null;
      };
      if (!response.ok) throw new Error(result.error || '드라이브 전송 요청 실패');
      if (result.skipped) setDriveState('skipped');
      else if (result.status === 'done') setDriveState('synced');
      else if (result.status === 'failed') setDriveState('failed');
      else setDriveState('queued');
    } catch {
      // 앱 문서는 이미 저장됐다. Drive만 실패 상태로 보여주고 작성 작업은 막지 않는다.
      setDriveState('failed');
    }
  };

  const save = async () => {
    if (!duty || !template || !cols) return;
    const message = validate();
    if (message) { setError(message); return; }
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const documentCells = summaryCellsForDocument(template, values, cols);
      let savedRow: DutyRow;
      if (savedId) {
        const changedCells = Object.fromEntries(
          Object.entries(documentCells).filter(([key, value]) => key === '__document' || value !== null),
        );
        const cells = { ...(row?.cells ?? {}), ...changedCells };
        const result = await supabase
          .from('duty_rows')
          .update({ cells, updated_by: session?.id ?? null, updated_at: new Date().toISOString() })
          .eq('id', savedId)
          .eq('duty_id', dutyId)
          .select()
          .single();
        if (result.error) throw result.error;
        savedRow = result.data as DutyRow;
      } else {
        const lastResult = await supabase
          .from('duty_rows')
          .select('sort_order')
          .eq('duty_id', dutyId)
          .order('sort_order', { ascending: false })
          .limit(1)
          .maybeSingle();
        const result = await supabase.from('duty_rows').insert({
          duty_id: dutyId,
          cells: documentCells,
          sort_order: Number(lastResult.data?.sort_order ?? 0) + 1,
          updated_by: session?.id ?? null,
        }).select().single();
        if (result.error) throw result.error;
        savedRow = result.data as DutyRow;
        setSavedId(savedRow.id);
        window.history.replaceState(null, '', `/roles/${dutyId}/document?rowId=${savedRow.id}`);
        void logActivity(session?.id, `업무 문서 작성 — ${template.title}`, `duty:${dutyId}`);
      }
      setRow(savedRow);
      setSaved(true);
      void syncDrive(savedRow.id);
    } catch (caught) {
      setError(friendlyError(caught, '문서를 저장하지 못했어요.'));
    } finally {
      setSaving(false);
    }
  };

  const newDocument = () => {
    if (!template) return;
    setValues(blankValues(template));
    setRow(null);
    setSavedId(null);
    setSaved(false);
    setDriveState('idle');
    setError('');
    window.history.replaceState(null, '', `/roles/${dutyId}/document?template=${encodeURIComponent(template.key)}`);
  };

  const lineItems = Array.isArray(values.items) ? values.items : blankLineItems();
  const updateLineItem = (index: number, key: keyof DocumentLineItem, value: string) => {
    const next = lineItems.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item);
    setValue('items', next);
  };
  const addLineItem = () => setValue('items', [...lineItems, ...blankLineItems()]);
  const removeLineItem = (index: number) => {
    if (lineItems.length === 1) return;
    setValue('items', lineItems.filter((_, itemIndex) => itemIndex !== index));
  };

  const renderField = (field: DocumentField) => {
    const value = values[field.key];
    if (field.kind === 'lineItems') {
      return (
        <div className="sm:col-span-2" key={field.key}>
          <div className="mb-2 flex items-center justify-between">
            <label className="label mb-0">{field.label}{field.required && <span className="ml-1 text-brand">*</span>}</label>
            <button type="button" onClick={addLineItem} className="text-[12px] font-bold text-brand">+ 품목 추가</button>
          </div>
          <div className="space-y-2">
            {lineItems.map((item, index) => (
              <div key={index} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <b className="text-[12px] text-neutral-700">항목 {index + 1}</b>
                  {lineItems.length > 1 && <button type="button" onClick={() => removeLineItem(index)} className="text-[11px] font-bold text-red-500">삭제</button>}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                  <input aria-label={`품목 ${index + 1}`} placeholder="품목" value={item.item} onChange={(e) => updateLineItem(index, 'item', e.target.value)} className="field col-span-2 bg-white sm:col-span-2" />
                  <input aria-label={`세부내용 ${index + 1}`} placeholder="세부내용" value={item.detail} onChange={(e) => updateLineItem(index, 'detail', e.target.value)} className="field col-span-2 bg-white sm:col-span-2" />
                  <input aria-label={`수량 ${index + 1}`} type="number" placeholder="수량" value={item.quantity} onChange={(e) => updateLineItem(index, 'quantity', e.target.value)} className="field bg-white" />
                  <input aria-label={`단위 ${index + 1}`} placeholder="단위" value={item.unit} onChange={(e) => updateLineItem(index, 'unit', e.target.value)} className="field bg-white" />
                  <input aria-label={`단가 ${index + 1}`} type="number" placeholder="단가" value={item.unitPrice} onChange={(e) => updateLineItem(index, 'unitPrice', e.target.value)} className="field col-span-2 bg-white sm:col-span-2" />
                  <div className="col-span-2 flex items-center justify-end rounded-lg bg-white px-3 text-[13px] font-black text-neutral-800 sm:col-span-4">
                    {money((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0))}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-end rounded-lg bg-neutral-900 px-4 py-3 text-white">
            <span className="mr-6 text-[12px] text-neutral-300">합계</span><b>{money(quoteTotal(values))}</b>
          </div>
        </div>
      );
    }

    if (field.kind === 'check') {
      return (
        <label key={field.key} className="flex min-h-[52px] items-center justify-between gap-4 rounded-lg border border-neutral-300 px-3 py-2">
          <span className="text-[13px] font-bold text-neutral-700">{field.label}</span>
          <input type="checkbox" checked={Boolean(value)} onChange={(event) => setValue(field.key, event.target.checked)} className="h-5 w-5 accent-[#F26522]" />
        </label>
      );
    }

    return (
      <div key={field.key} className={field.full ? 'sm:col-span-2' : ''}>
        <label className="label" htmlFor={`document-${field.key}`}>
          {field.label}{field.required && <span className="ml-1 text-brand">*</span>}
        </label>
        {field.kind === 'textarea' ? (
          <textarea id={`document-${field.key}`} rows={4} placeholder={field.placeholder} value={stringValue(value)} onChange={(event) => setValue(field.key, event.target.value)} className="field min-h-[104px] resize-y bg-white" />
        ) : field.kind === 'select' ? (
          <select id={`document-${field.key}`} value={stringValue(value)} onChange={(event) => setValue(field.key, event.target.value)} className="field bg-white">
            <option value="">선택하세요</option>
            {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        ) : (
          <input id={`document-${field.key}`} type={field.kind === 'date' ? 'date' : field.kind === 'number' ? 'number' : 'text'} placeholder={field.placeholder} value={stringValue(value)} onChange={(event) => setValue(field.key, event.target.value)} className="field bg-white" />
        )}
      </div>
    );
  };

  if (cols === null) {
    return <div><PageHeader title="문서 양식" back={`/roles/${dutyId}`} /><div className="mx-auto max-w-3xl px-4 py-4"><CardSkeleton rows={6} /></div></div>;
  }

  if (!duty || !group || !template) {
    return <div><PageHeader title="문서 양식" back={`/roles/${dutyId}`} /><div className="mx-auto max-w-3xl px-4 py-4"><ErrorBanner message={error || '문서 양식을 찾을 수 없어요.'} /></div></div>;
  }

  const path = [dept?.name, group.name, duty.name].filter(Boolean).join(' › ');
  const printUrl = savedId
    ? `/print/duty-document/${dutyId}/${savedId}`
    : `/print/duty-document/${dutyId}/blank?template=${encodeURIComponent(template.key)}`;

  return (
    <div>
      <PageHeader
        title={template.title}
        subtitle={savedId ? '저장된 문서 수정' : '새 문서 작성'}
        back={`/roles/${dutyId}`}
        right={<a href={printUrl} target="_blank" rel="noopener noreferrer" aria-label="문서 인쇄" className="tap -mr-2 w-10 text-neutral-600"><Icon name="printer" size={17} /></a>}
      />

      <main className="mx-auto max-w-[850px] px-3 py-4 sm:px-4">
        {templates.length > 1 && !savedId && (
          <div className="mb-3 grid grid-cols-2 gap-2">
            {templates.map((item) => (
              <button key={item.key} type="button" onClick={() => chooseTemplate(item)} className={`rounded-xl border px-3 py-3 text-left text-[13px] font-black ${item.key === template.key ? 'border-brand bg-orange-50 text-brand' : 'border-neutral-200 bg-white text-neutral-600'}`}>
                {item.title}
              </button>
            ))}
          </div>
        )}

        {error && <div className="mb-3"><ErrorBanner message={error} /></div>}
        {template.reviewNotice && <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-bold leading-relaxed text-amber-800">검토용 초안 · {template.reviewNotice}</div>}
        {saved && (
          <div className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 text-[12px] font-bold ${driveState === 'failed' || driveState === 'skipped' ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-700'}`}>
            <span>{
              driveState === 'syncing' ? '앱에 저장됨 · 구글 드라이브 저장 중…'
                : driveState === 'synced' ? '앱·구글 드라이브에 저장됐어요.'
                  : driveState === 'queued' ? '앱에 저장됨 · 구글 드라이브 전송 대기 중'
                    : driveState === 'skipped' ? '앱에 저장됨 · 구글 드라이브 연결을 확인해주세요.'
                      : driveState === 'failed' ? '앱에 저장됨 · 관리 화면에서 드라이브 전송을 다시 시도해주세요.'
                        : '문서가 저장됐어요.'
            }</span>
            <a href={printUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">완성 문서 보기·PDF</a>
          </div>
        )}

        <article className="overflow-hidden rounded-2xl border border-neutral-300 bg-white shadow-sm">
          <header className="border-b-[3px] border-neutral-900 px-5 py-6 text-center sm:px-8">
            <p className="text-[10px] tracking-wide text-neutral-400">{path}</p>
            <h1 className="mt-2 text-[24px] font-black tracking-tight text-neutral-950 sm:text-[29px]">{template.title}</h1>
            <p className="mx-auto mt-2 max-w-xl text-[12px] leading-relaxed text-neutral-500">{template.purpose}</p>
          </header>

          <div className="space-y-7 px-5 py-6 sm:px-8 sm:py-8">
            {template.sections.map((section) => {
              const internal = section.fields.every((field) => field.internal);
              return (
                <section key={section.title} className={internal ? 'rounded-xl bg-neutral-100 p-4' : ''}>
                  <div className="mb-3 flex items-center gap-2 border-b border-neutral-300 pb-2">
                    <span className={`h-4 w-1 rounded-full ${internal ? 'bg-neutral-400' : 'bg-brand'}`} />
                    <h2 className="text-[15px] font-black text-neutral-900">{section.title}</h2>
                    {internal && <span className="ml-auto text-[10px] font-bold text-neutral-400">외부 출력에는 표시 안 됨</span>}
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{section.fields.map(renderField)}</div>
                </section>
              );
            })}
          </div>

          {(template.signatures?.length ?? 0) > 0 && (
            <footer className="grid gap-4 border-t border-neutral-200 px-5 py-5 sm:grid-cols-2 sm:px-8">
              {template.signatures?.map((signature) => <div key={signature} className="text-right text-[12px] text-neutral-500">{signature} __________________ (서명)</div>)}
            </footer>
          )}
        </article>

        <div className="sticky bottom-[72px] mt-3 grid grid-cols-[auto_1fr_auto] gap-2 rounded-2xl border border-neutral-200 bg-surface/95 p-2 shadow-lg backdrop-blur lg:bottom-3">
          <button type="button" onClick={newDocument} disabled={saving} className="btn-ghost px-3">새 문서</button>
          <button type="button" onClick={() => void save()} disabled={saving} className="btn-primary"><Icon name="check" size={15} />{saving ? '저장 중…' : savedId ? '수정 저장' : '문서 저장'}</button>
          <a href={printUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost px-3" aria-label="인쇄·PDF"><Icon name="printer" size={16} /></a>
        </div>
      </main>
    </div>
  );
}
