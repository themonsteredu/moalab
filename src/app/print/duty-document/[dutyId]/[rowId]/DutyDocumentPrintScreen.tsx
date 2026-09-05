'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ErrorBanner } from '@/components/ui';
import {
  blankLineItems,
  documentTemplateByKey,
  documentTemplatesFor,
  parseDutyDocument,
  quoteTotal,
  type DocumentField,
  type DocumentLineItem,
  type DocumentValue,
  type DocumentValues,
  type DutyDocumentSection,
  type DutyDocumentTemplate,
} from '@/lib/dutyDocument';
import { useSession } from '@/lib/session';
import { friendlyError, supabase } from '@/lib/supabase';
import type { Department, Duty, DutyGroup, DutyRow } from '@/lib/types';

interface LoadedDocument {
  duty: Duty;
  group: DutyGroup;
  department: Department | null;
  row: DutyRow | null;
  template: DutyDocumentTemplate;
  values: DocumentValues;
  blank: boolean;
}

const MONEY_KEYS = new Set([
  'amount',
  'previousAmount',
  'unitPrice',
]);

function textValue(value: DocumentValue | undefined): string {
  if (value === null || value === undefined || Array.isArray(value)) return '';
  if (typeof value === 'boolean') return value ? '확인' : '미확인';
  return String(value).trim();
}

function valueAt(values: DocumentValues, key: string): string {
  return textValue(values[key]);
}

function won(value: string | number | null | undefined): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return textValue(value);
  return `${new Intl.NumberFormat('ko-KR').format(amount)}원`;
}

function fieldValue(field: DocumentField, values: DocumentValues): string {
  const raw = values[field.key];
  if (field.kind === 'check') return raw === true ? '☑ 확인' : '□ 확인';
  const value = textValue(raw);
  if (!value) return '';
  return (field.kind === 'number' && MONEY_KEYS.has(field.key)) || /금액|단가/.test(field.label)
    ? won(value)
    : value;
}

function documentSections(template: DutyDocumentTemplate): DutyDocumentSection[] {
  return template.sections
    .map((section) => ({
      ...section,
      fields: section.fields.filter((field) => !field.internal),
    }))
    .filter((section) => section.fields.length > 0);
}

function EmptyLine({ tall = false }: { tall?: boolean }) {
  return <div className={`doc-writing-lines ${tall ? 'doc-writing-lines-tall' : ''}`} aria-hidden="true" />;
}

function DocumentHeader({ loaded, draft = false }: { loaded: LoadedDocument; draft?: boolean }) {
  const { department, group, template, values } = loaded;
  const customTitle = valueAt(values, 'documentTitle');

  return (
    <header className="doc-header print-block">
      <div className="doc-brand-row">
        <p className="doc-brand">MOALAB</p>
        <p className="doc-path">{[department?.name, group.name].filter(Boolean).join(' · ')}</p>
      </div>
      <div className="doc-title-row">
        <div>
          <h1>{template.title}</h1>
          {customTitle && customTitle !== template.title && <p className="doc-subtitle">{customTitle}</p>}
        </div>
        {draft && <span className="doc-draft-badge">검토용 초안</span>}
      </div>
    </header>
  );
}

function SignatureBlock({ labels }: { labels: string[] }) {
  return (
    <section className="doc-signatures print-block" aria-label="서명">
      {labels.map((label) => (
        <div className="doc-signature" key={label}>
          <span>{label}</span>
          <b>성명 ____________________</b>
          <b>서명 ____________________</b>
        </div>
      ))}
    </section>
  );
}

function LineItemsTable({ items, blank }: { items: DocumentLineItem[]; blank: boolean }) {
  const visibleItems = items.length > 0 ? items : blankLineItems();
  const rows = blank
    ? [...visibleItems, ...Array.from({ length: Math.max(0, 6 - visibleItems.length) }, blankLineItems).flat()]
    : visibleItems;

  return (
    <table className="doc-line-items">
      <thead>
        <tr>
          <th className="doc-no">No.</th>
          <th>품목</th>
          <th>세부 내용</th>
          <th className="doc-number">수량</th>
          <th className="doc-unit">단위</th>
          <th className="doc-money">단가</th>
          <th className="doc-money">금액</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((item, index) => {
          const amount = (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
          return (
            <tr key={`${index}-${item.item}-${item.detail}`}>
              <td className="doc-no">{index + 1}</td>
              <td>{item.item}</td>
              <td>{item.detail}</td>
              <td className="doc-number">{item.quantity}</td>
              <td className="doc-unit">{item.unit}</td>
              <td className="doc-money">{item.unitPrice ? new Intl.NumberFormat('ko-KR').format(Number(item.unitPrice)) : ''}</td>
              <td className="doc-money">{amount > 0 ? new Intl.NumberFormat('ko-KR').format(amount) : ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function QuoteDocument({ loaded }: { loaded: LoadedDocument }) {
  const { values, template, blank } = loaded;
  const rawItems = values.items;
  const items = Array.isArray(rawItems) ? rawItems : [];
  const total = quoteTotal(values);

  return (
    <>
      <DocumentHeader loaded={loaded} />

      <section className="doc-quote-meta print-block">
        <div className="doc-quote-recipient">
          <p><span>수신</span><b>{valueAt(values, 'recipient') || '____________________________'} 귀중</b></p>
          <p><span>담당</span>{valueAt(values, 'recipientPerson') || '____________________________'}</p>
          <p className="doc-quote-message">아래와 같이 교육 프로그램 견적을 제출합니다.</p>
        </div>
        <dl>
          <div><dt>견적번호</dt><dd>{valueAt(values, 'quoteNo')}</dd></div>
          <div><dt>견적일</dt><dd>{valueAt(values, 'quoteDate')}</dd></div>
          <div><dt>유효기한</dt><dd>{valueAt(values, 'validUntil')}</dd></div>
        </dl>
      </section>

      <section className="doc-section print-block">
        <h2>교육 개요</h2>
        <div className="doc-key-grid">
          <div><span>프로그램명</span><b>{valueAt(values, 'program')}</b></div>
          <div><span>운영일·기간</span><b>{valueAt(values, 'schedule')}</b></div>
          <div><span>예상 인원</span><b>{valueAt(values, 'headcount')}</b></div>
          <div><span>차시</span><b>{valueAt(values, 'sessions')}</b></div>
        </div>
      </section>

      <section className="doc-section print-block">
        <h2>견적 내역</h2>
        <LineItemsTable items={items} blank={blank} />
        <div className="doc-quote-total">
          <span>공급가 합계</span>
          <strong>{total > 0 ? won(total) : '________________ 원'}</strong>
        </div>
        <div className="doc-tax-row">
          <span>부가세</span><b>{valueAt(values, 'tax') || '□ 포함  □ 별도  □ 면세'}</b>
        </div>
      </section>

      <section className="doc-section doc-two-column print-block">
        <div>
          <h2>포함 내역</h2>
          <div className="doc-prose">{valueAt(values, 'included') || <EmptyLine tall />}</div>
        </div>
        <div>
          <h2>비고·결제 안내</h2>
          <div className="doc-prose">{valueAt(values, 'notes') || <EmptyLine tall />}</div>
        </div>
      </section>

      <section className="doc-provider print-block">
        <h2>공급자 정보</h2>
        <dl>
          <div><dt>상호</dt><dd>{valueAt(values, 'providerName')}</dd></div>
          <div><dt>사업자등록번호</dt><dd>{valueAt(values, 'registrationNo')}</dd></div>
          <div><dt>대표자</dt><dd>{valueAt(values, 'representative')} <span className="doc-seal">(인)</span></dd></div>
          <div><dt>연락처</dt><dd>{valueAt(values, 'providerContact')}</dd></div>
          <div className="doc-wide"><dt>주소</dt><dd>{valueAt(values, 'providerAddress')}</dd></div>
          <div><dt>이메일</dt><dd>{valueAt(values, 'providerEmail')}</dd></div>
          <div><dt>입금 계좌</dt><dd>{valueAt(values, 'bankAccount')}</dd></div>
        </dl>
      </section>
    </>
  );
}

interface ContractClause {
  article: string;
  title: string;
  keys: string[];
  fallback: string;
}

const CONTRACT_CLAUSES: ContractClause[] = [
  { article: '제1조', title: '목적 및 수행 범위', keys: ['scope'], fallback: '교육 프로그램의 내용과 수행 범위를 기재합니다.' },
  { article: '제2조', title: '교육 일정 및 장소', keys: ['schedule', 'venue', 'contractPeriod'], fallback: '교육 일정, 장소 및 계약기간을 기재합니다.' },
  { article: '제3조', title: '계약 금액 및 지급', keys: ['amount', 'paymentTerms'], fallback: '계약 금액과 지급 기한·방법을 기재합니다.' },
  { article: '제4조', title: '당사자의 역할', keys: ['clientDuties', 'providerDuties'], fallback: '발주기관과 수행기관의 준비 및 협조 사항을 기재합니다.' },
  { article: '제5조', title: '일정 변경 및 취소', keys: ['cancellation'], fallback: '일정 변경·취소 기준과 비용 정산 방법을 기재합니다.' },
  { article: '제6조', title: '안전 및 책임', keys: ['safety'], fallback: '수업 중 안전관리와 사고 발생 시 책임 범위를 기재합니다.' },
  { article: '제7조', title: '개인정보 및 초상권', keys: ['privacy'], fallback: '참여자 개인정보와 촬영물의 수집·이용 범위를 기재합니다.' },
  { article: '제8조', title: '저작권 및 결과물', keys: ['copyright'], fallback: '교안·사진·영상 등 결과물의 이용 범위를 기재합니다.' },
  { article: '제9조', title: '특약사항', keys: ['specialTerms'], fallback: '추가로 합의한 사항을 기재합니다.' },
];

function ContractDocument({ loaded }: { loaded: LoadedDocument }) {
  const { values, template, blank } = loaded;
  const client = valueAt(values, 'clientName') || '____________________________';
  const provider = valueAt(values, 'providerName') || '____________________________';

  return (
    <>
      <DocumentHeader loaded={loaded} draft />
      <p className="doc-review-notice print-block">
        <b>최종 확인 필요</b> {template.reviewNotice}
      </p>

      <section className="doc-contract-summary print-block">
        <p>
          발주기관 <b>“갑” {client}</b>과 수행기관 <b>“을” {provider}</b>은 아래 교육 프로그램의 원활한
          운영을 위해 다음과 같이 계약을 체결합니다.
        </p>
        <div className="doc-key-grid">
          <div><span>프로그램명</span><b>{valueAt(values, 'program')}</b></div>
          <div><span>교육 대상</span><b>{valueAt(values, 'audience')}</b></div>
          <div><span>인원·차시</span><b>{[valueAt(values, 'headcount') && `${valueAt(values, 'headcount')}명`, valueAt(values, 'sessions') && `${valueAt(values, 'sessions')}차시`].filter(Boolean).join(' · ')}</b></div>
          <div><span>계약일</span><b>{valueAt(values, 'contractDate')}</b></div>
        </div>
      </section>

      <section className="doc-contract-clauses">
        {CONTRACT_CLAUSES.map((clause) => {
          const lines = clause.keys
            .map((key) => {
              const value = valueAt(values, key);
              if (!value) return '';
              if (key === 'amount') return `계약 금액: ${won(value)}`;
              if (key === 'clientDuties') return `갑의 역할: ${value}`;
              if (key === 'providerDuties') return `을의 역할: ${value}`;
              return value;
            })
            .filter(Boolean);
          return (
            <article className="doc-clause print-block" key={clause.article}>
              <h2><span>{clause.article}</span> {clause.title}</h2>
              {lines.length > 0 ? lines.map((line, index) => <p key={index}>{line}</p>) : (
                blank ? <EmptyLine /> : <p className="doc-empty-guidance">{clause.fallback}</p>
              )}
            </article>
          );
        })}
      </section>

      <section className="doc-contract-agreement print-block">
        <p>위 계약의 내용을 확인하고 성실히 이행할 것을 합의하며, 계약서 2부를 작성하여 갑과 을이 각각 1부씩 보관합니다.</p>
        <b>{valueAt(values, 'contractDate') || '20____년 ____월 ____일'}</b>
      </section>

      <section className="doc-party-signatures print-block">
        <div>
          <h2>발주기관(갑)</h2>
          <p><span>기관명</span>{valueAt(values, 'clientName')}</p>
          <p><span>주소</span>{valueAt(values, 'clientAddress')}</p>
          <p><span>대표·담당</span>{valueAt(values, 'clientRepresentative')}</p>
          <strong>서명 ____________________ (인)</strong>
        </div>
        <div>
          <h2>수행기관(을)</h2>
          <p><span>기관명</span>{valueAt(values, 'providerName')}</p>
          <p><span>주소</span>{valueAt(values, 'providerAddress')}</p>
          <p><span>대표자</span>{valueAt(values, 'providerRepresentative')}</p>
          <strong>서명 ____________________ (인)</strong>
        </div>
      </section>
    </>
  );
}

function surveyChecked(value: string, score: number): boolean {
  return value.trim().startsWith(String(score));
}

function SurveyDocument({ loaded }: { loaded: LoadedDocument }) {
  const { values, template } = loaded;
  const questions = template.sections
    .flatMap((section) => section.fields)
    .filter((field) => /^q\d+$/.test(field.key));
  const openFields = template.sections
    .find((section) => section.title === '의견')
    ?.fields.filter((field) => !field.internal) ?? [];

  return (
    <>
      <DocumentHeader loaded={loaded} />
      <section className="doc-survey-intro print-block">
        <p>더 좋은 교육을 만들기 위한 의견입니다. 해당하는 칸에 체크(✓)해 주세요.</p>
        <p>응답 내용은 프로그램 개선 목적으로만 활용합니다.</p>
      </section>

      <section className="doc-survey-meta print-block">
        <div><span>기관명</span><b>{valueAt(values, 'institution')}</b></div>
        <div><span>프로그램명</span><b>{valueAt(values, 'program')}</b></div>
        <div><span>수업일</span><b>{valueAt(values, 'classDate')}</b></div>
        <div><span>교육 대상</span><b>{valueAt(values, 'audience')}</b></div>
        <div className="doc-wide"><span>응답자</span><b>{valueAt(values, 'respondent') || '□ 담당교사  □ 학생  □ 보호자  □ 기관 담당자'}</b></div>
      </section>

      <section className="doc-section print-block">
        <h2>만족도 평가</h2>
        <table className="doc-survey-table">
          <thead>
            <tr>
              <th rowSpan={2}>평가 문항</th>
              <th colSpan={5}>매우 그렇지 않다 ← 만족도 → 매우 그렇다</th>
            </tr>
            <tr>{[1, 2, 3, 4, 5].map((score) => <th key={score}>{score}</th>)}</tr>
          </thead>
          <tbody>
            {questions.map((field) => {
              const selected = valueAt(values, field.key);
              return (
                <tr key={field.key}>
                  <td>{field.label}</td>
                  {[1, 2, 3, 4, 5].map((score) => (
                    <td className="doc-survey-check" key={score}>{surveyChecked(selected, score) ? '☑' : '□'}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="doc-survey-open">
        {openFields.map((field) => {
          const answer = valueAt(values, field.key);
          return (
            <article className="doc-survey-answer print-block" key={field.key}>
              <h2>{field.label}</h2>
              {answer ? <p>{answer}</p> : <EmptyLine tall />}
            </article>
          );
        })}
      </section>

      <p className="doc-survey-thanks print-block">소중한 의견 감사합니다.</p>
    </>
  );
}

function GenericField({ field, values, blank }: { field: DocumentField; values: DocumentValues; blank: boolean }) {
  if (field.kind === 'lineItems') {
    const rawItems = values[field.key];
    return (
      <div className="doc-field doc-field-full">
        <p className="doc-field-label">{field.label}</p>
        <LineItemsTable items={Array.isArray(rawItems) ? rawItems : []} blank={blank} />
      </div>
    );
  }

  const shown = fieldValue(field, values);
  const long = field.full || field.kind === 'textarea';
  return (
    <div className={`doc-field ${long ? 'doc-field-full doc-field-long' : ''}`}>
      <p className="doc-field-label">{field.label}</p>
      {shown ? <p className="doc-field-value">{shown}</p> : (long ? <EmptyLine tall /> : <div className="doc-single-line" />)}
    </div>
  );
}

function GenericDocument({ loaded }: { loaded: LoadedDocument }) {
  const sections = useMemo(() => documentSections(loaded.template), [loaded.template]);

  return (
    <>
      <DocumentHeader loaded={loaded} />
      {sections.map((section) => (
        <section className="doc-section" key={section.title}>
          <h2>{section.title}</h2>
          <div className="doc-fields">
            {section.fields.map((field) => (
              <GenericField field={field} values={loaded.values} blank={loaded.blank} key={field.key} />
            ))}
          </div>
        </section>
      ))}
      {loaded.template.signatures && loaded.template.signatures.length > 0 && (
        <SignatureBlock labels={loaded.template.signatures} />
      )}
    </>
  );
}

function PrintableDocument({ loaded }: { loaded: LoadedDocument }) {
  switch (loaded.template.key) {
    case 'quotation':
      return <QuoteDocument loaded={loaded} />;
    case 'service-contract':
      return <ContractDocument loaded={loaded} />;
    case 'satisfaction-survey':
      return <SurveyDocument loaded={loaded} />;
    default:
      return <GenericDocument loaded={loaded} />;
  }
}

export default function DutyDocumentPrintScreen() {
  const { dutyId, rowId } = useParams<{ dutyId: string; rowId: string }>();
  const router = useRouter();
  const { session, loading: sessionLoading } = useSession();
  const [loaded, setLoaded] = useState<LoadedDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sessionLoading && !session) router.replace('/login');
  }, [session, sessionLoading, router]);

  useEffect(() => {
    if (sessionLoading || !session) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError('');
      try {
        const blank = rowId === 'blank';
        const requestedTemplate = new URLSearchParams(window.location.search).get('template') ?? '';
        const [dutyResult, rowResult] = await Promise.all([
          supabase.from('duties').select('*').eq('id', dutyId).maybeSingle(),
          blank
            ? Promise.resolve({ data: null, error: null })
            : supabase.from('duty_rows').select('*').eq('id', rowId).eq('duty_id', dutyId).maybeSingle(),
        ]);
        if (dutyResult.error) throw dutyResult.error;
        if (rowResult.error) throw rowResult.error;

        const duty = (dutyResult.data ?? null) as Duty | null;
        if (!duty) throw new Error('없는 업무예요.');
        const row = (rowResult.data ?? null) as DutyRow | null;
        if (!blank && !row) throw new Error('이 업무에 속한 문서를 찾을 수 없어요.');

        const groupResult = await supabase.from('duty_groups').select('*').eq('id', duty.group_id).maybeSingle();
        if (groupResult.error) throw groupResult.error;
        const group = (groupResult.data ?? null) as DutyGroup | null;
        if (!group) throw new Error('업무 분류를 찾을 수 없어요.');

        const departmentResult = await supabase
          .from('departments')
          .select('*')
          .eq('id', group.dept_id)
          .maybeSingle();
        if (departmentResult.error) throw departmentResult.error;
        const department = (departmentResult.data ?? null) as Department | null;

        let template: DutyDocumentTemplate | null = null;
        let values: DocumentValues = {};
        if (blank) {
          template = documentTemplateByKey(duty.name, group.name, requestedTemplate)
            ?? documentTemplatesFor(duty.name, group.name)[0]
            ?? null;
        } else {
          const payload = parseDutyDocument(row?.cells?.__document);
          if (!payload) throw new Error('이 줄에는 아직 인쇄할 문서 양식이 없어요.');
          template = documentTemplateByKey(duty.name, group.name, payload.templateKey);
          values = payload.values;
        }
        if (!template) throw new Error('이 업무에 연결된 문서 양식이 없어요.');

        if (!cancelled) setLoaded({ duty, group, department, row, template, values, blank });
      } catch (reason) {
        if (!cancelled) setError(friendlyError(reason, '문서를 불러오지 못했어요.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dutyId, rowId, session, sessionLoading]);

  if (sessionLoading || loading || !session) {
    return <p className="p-10 text-center text-[14px] text-neutral-500">문서를 준비하고 있어요…</p>;
  }

  if (error || !loaded) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <ErrorBanner message={error || '문서를 찾을 수 없어요.'} />
        <button className="btn-ghost mt-3" onClick={() => router.back()}>돌아가기</button>
      </div>
    );
  }

  return (
    <main className="doc-print-screen">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm 13mm; }
          .doc-print-screen { padding: 0 !important; background: #fff !important; }
          .doc-sheet { width: auto !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; box-shadow: none !important; }
        }
        .doc-print-screen { min-height: 100vh; padding: 24px 16px 56px; background: #e9e9e5; color: #171717; }
        .doc-toolbar { position: sticky; top: 10px; z-index: 10; display: flex; flex-wrap: wrap; gap: 8px; width: min(100%, 184mm); margin: 0 auto 14px; padding: 10px; border: 1px solid #ddd; border-radius: 12px; background: rgba(255,255,255,.96); box-shadow: 0 4px 16px rgba(0,0,0,.08); }
        .doc-toolbar button { min-height: 40px; padding: 0 16px; border: 1px solid #d4d4d4; border-radius: 9px; background: #fff; font-size: 14px; font-weight: 700; }
        .doc-toolbar .doc-print-button { border-color: #171717; background: #171717; color: #fff; }
        .doc-sheet { width: min(100%, 210mm); min-height: 297mm; margin: 0 auto; padding: 14mm 13mm 16mm; background: #fff; box-shadow: 0 8px 32px rgba(0,0,0,.12); font-family: Arial, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; font-size: 10.5pt; line-height: 1.55; }
        .doc-header { margin-bottom: 8mm; border-bottom: 2px solid #171717; padding-bottom: 4mm; }
        .doc-brand-row, .doc-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
        .doc-brand, .doc-path { margin: 0; color: #666; font-size: 8.5pt; letter-spacing: .08em; }
        .doc-brand { color: #171717; font-weight: 900; letter-spacing: .18em; }
        .doc-title-row { align-items: center; margin-top: 5mm; }
        .doc-title-row h1 { margin: 0; font-size: 23pt; line-height: 1.2; letter-spacing: -.04em; }
        .doc-subtitle { margin: 2mm 0 0; color: #555; font-size: 11pt; }
        .doc-draft-badge { flex: none; padding: 1.5mm 3mm; border: 1px solid #9a6d00; border-radius: 999px; color: #765300; font-size: 9pt; font-weight: 800; }
        .doc-section { margin-top: 7mm; }
        .doc-section > h2, .doc-provider > h2 { margin: 0 0 2.5mm; padding-bottom: 1.5mm; border-bottom: 1.5px solid #222; font-size: 12pt; }
        .doc-section > h2 { break-after: avoid; page-break-after: avoid; }
        .doc-fields { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid #bbb; border-left: 1px solid #bbb; }
        .doc-field { min-height: 15mm; padding: 2.5mm 3mm; border-right: 1px solid #bbb; border-bottom: 1px solid #bbb; break-inside: avoid; page-break-inside: avoid; }
        .doc-field-full { grid-column: 1 / -1; }
        .doc-field-long { min-height: 27mm; }
        .doc-field-label { margin: 0 0 1mm; color: #555; font-size: 8.5pt; font-weight: 700; }
        .doc-field-value { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
        .doc-single-line { height: 7mm; border-bottom: 1px solid #777; }
        .doc-writing-lines { min-height: 12mm; background: repeating-linear-gradient(to bottom, transparent 0, transparent 6mm, #aaa 6.15mm, #aaa 6.4mm); }
        .doc-writing-lines-tall { min-height: 21mm; }
        .doc-signatures { display: flex; justify-content: flex-end; gap: 10mm; margin-top: 12mm; }
        .doc-signature { min-width: 57mm; padding-top: 3mm; border-top: 1.5px solid #222; }
        .doc-signature span, .doc-signature b { display: block; margin-bottom: 2mm; }
        .doc-signature span { font-weight: 800; }
        .doc-signature b { font-size: 9pt; font-weight: 500; }
        .doc-key-grid { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid #bbb; border-left: 1px solid #bbb; }
        .doc-key-grid > div { display: grid; grid-template-columns: 30mm 1fr; min-height: 11mm; border-right: 1px solid #bbb; border-bottom: 1px solid #bbb; }
        .doc-key-grid span, .doc-key-grid b { padding: 2.2mm 2.5mm; }
        .doc-key-grid span { background: #f3f3f1; font-size: 9pt; font-weight: 700; }
        .doc-key-grid b { font-weight: 500; }
        .doc-quote-meta { display: grid; grid-template-columns: 1fr 65mm; gap: 10mm; align-items: start; }
        .doc-quote-recipient p { margin: 0 0 2mm; }
        .doc-quote-recipient span { display: inline-block; width: 15mm; color: #555; font-size: 9pt; font-weight: 700; }
        .doc-quote-message { margin-top: 6mm !important; font-size: 11pt; }
        .doc-quote-meta dl { margin: 0; border-top: 1px solid #bbb; border-left: 1px solid #bbb; }
        .doc-quote-meta dl div { display: grid; grid-template-columns: 24mm 1fr; min-height: 10mm; border-right: 1px solid #bbb; border-bottom: 1px solid #bbb; }
        .doc-quote-meta dt, .doc-quote-meta dd { margin: 0; padding: 2mm; }
        .doc-quote-meta dt { background: #f3f3f1; font-size: 9pt; font-weight: 700; }
        .doc-line-items { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 9pt; }
        .doc-line-items th, .doc-line-items td { height: 10mm; padding: 1.5mm 2mm; border: 1px solid #aaa; vertical-align: middle; overflow-wrap: anywhere; }
        .doc-line-items th { background: #f3f3f1; font-weight: 800; text-align: center; }
        .doc-line-items .doc-no { width: 12mm; text-align: center; }
        .doc-line-items .doc-number { width: 16mm; text-align: right; }
        .doc-line-items .doc-unit { width: 15mm; text-align: center; }
        .doc-line-items .doc-money { width: 27mm; text-align: right; }
        .doc-quote-total { display: flex; justify-content: flex-end; align-items: center; min-height: 14mm; border: 1.5px solid #222; border-top: 0; }
        .doc-quote-total span { width: 35mm; font-weight: 800; text-align: center; }
        .doc-quote-total strong { min-width: 55mm; padding: 0 4mm; font-size: 14pt; text-align: right; }
        .doc-tax-row { display: flex; justify-content: flex-end; gap: 10mm; margin-top: 2mm; font-size: 9pt; }
        .doc-two-column { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
        .doc-prose { min-height: 22mm; margin: 0; white-space: pre-wrap; }
        .doc-provider { margin-top: 7mm; }
        .doc-provider dl { display: grid; grid-template-columns: 1fr 1fr; margin: 0; border-top: 1px solid #bbb; border-left: 1px solid #bbb; }
        .doc-provider dl div { display: grid; grid-template-columns: 30mm 1fr; min-height: 10mm; border-right: 1px solid #bbb; border-bottom: 1px solid #bbb; }
        .doc-provider dl .doc-wide { grid-column: 1 / -1; }
        .doc-provider dt, .doc-provider dd { margin: 0; padding: 2mm; }
        .doc-provider dt { background: #f3f3f1; font-size: 9pt; font-weight: 700; }
        .doc-seal { float: right; color: #555; }
        .doc-review-notice { margin: -3mm 0 6mm; padding: 3mm 4mm; border: 1px solid #c99a2e; background: #fff9e8; color: #604a16; font-size: 9pt; }
        .doc-review-notice b { margin-right: 2mm; }
        .doc-contract-summary > p { margin: 0 0 5mm; font-family: serif; font-size: 11pt; line-height: 1.9; text-align: justify; }
        .doc-contract-clauses { margin-top: 7mm; counter-reset: contract; }
        .doc-clause { margin-bottom: 5mm; }
        .doc-clause h2 { margin: 0 0 1.5mm; font-family: serif; font-size: 11pt; }
        .doc-clause h2 span { display: inline-block; min-width: 14mm; }
        .doc-clause p { margin: 0 0 1mm; padding-left: 3mm; white-space: pre-wrap; font-family: serif; font-size: 10pt; text-align: justify; }
        .doc-empty-guidance { color: #777; }
        .doc-contract-agreement { margin-top: 9mm; text-align: center; font-family: serif; line-height: 1.9; }
        .doc-contract-agreement b { display: block; margin-top: 5mm; }
        .doc-party-signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 7mm; margin-top: 8mm; }
        .doc-party-signatures > div { min-height: 48mm; padding: 4mm; border: 1px solid #999; }
        .doc-party-signatures h2 { margin: 0 0 3mm; font-size: 11pt; }
        .doc-party-signatures p { display: grid; grid-template-columns: 21mm 1fr; margin: 1.5mm 0; }
        .doc-party-signatures p span { color: #555; font-size: 9pt; }
        .doc-party-signatures strong { display: block; margin-top: 6mm; text-align: right; }
        .doc-survey-intro { margin: -2mm 0 6mm; padding: 3mm 4mm; background: #f3f3f1; }
        .doc-survey-intro p { margin: 0; }
        .doc-survey-meta { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid #aaa; border-left: 1px solid #aaa; }
        .doc-survey-meta > div { display: grid; grid-template-columns: 25mm 1fr; min-height: 11mm; border-right: 1px solid #aaa; border-bottom: 1px solid #aaa; }
        .doc-survey-meta > .doc-wide { grid-column: 1 / -1; }
        .doc-survey-meta span, .doc-survey-meta b { padding: 2mm; }
        .doc-survey-meta span { background: #f3f3f1; font-size: 9pt; font-weight: 700; }
        .doc-survey-meta b { font-weight: 500; }
        .doc-survey-table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
        .doc-survey-table th, .doc-survey-table td { padding: 2mm; border: 1px solid #999; }
        .doc-survey-table th { background: #f3f3f1; }
        .doc-survey-table th:not(:first-child), .doc-survey-table td:not(:first-child) { width: 12mm; text-align: center; }
        .doc-survey-check { font-size: 14pt; }
        .doc-survey-open { margin-top: 7mm; }
        .doc-survey-answer { margin-bottom: 6mm; }
        .doc-survey-answer h2 { margin: 0 0 1.5mm; font-size: 11pt; }
        .doc-survey-answer p { min-height: 17mm; margin: 0; padding: 2.5mm; border: 1px solid #aaa; white-space: pre-wrap; }
        .doc-survey-thanks { margin-top: 10mm; font-weight: 800; text-align: center; }
        @media screen and (max-width: 680px) {
          .doc-print-screen { padding: 12px 0 40px; }
          .doc-toolbar { top: 4px; width: calc(100% - 16px); }
          .doc-sheet { width: 100%; min-height: 0; padding: 8mm 5mm 12mm; box-shadow: none; }
          .doc-title-row h1 { font-size: 20pt; }
          .doc-two-column { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="doc-toolbar no-print">
        <button className="doc-print-button" onClick={() => window.print()}>인쇄 / PDF 저장</button>
        <button onClick={() => router.back()}>작성 화면으로 돌아가기</button>
      </div>

      <article className="doc-sheet">
        <PrintableDocument loaded={loaded} />
      </article>
    </main>
  );
}
