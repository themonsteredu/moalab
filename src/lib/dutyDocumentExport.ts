import {
  quoteTotal,
  type DocumentField,
  type DocumentLineItem,
  type DocumentValue,
  type DocumentValues,
  type DutyDocumentTemplate,
} from './dutyDocument';
import { safeSeg } from './drivePath';

/**
 * 업무 문서를 Google Docs가 가져올 수 있는 HTML로 만든다.
 *
 * 브라우저 API나 React에 기대지 않는 순수 함수라 Vercel 서버와 테스트에서 그대로
 * 쓸 수 있다. Drive에는 media `text/html; charset=utf-8`, metadata mimeType
 * `application/vnd.google-apps.document`로 보내면 편집 가능한 Google 문서가 된다.
 */

export const DUTY_DOCUMENT_MEDIA_TYPE = 'text/html; charset=utf-8';
export const GOOGLE_DOCUMENT_MIME_TYPE = 'application/vnd.google-apps.document';

export interface DutyDocumentExportContext {
  departmentName?: string | null;
  groupName?: string | null;
  dutyName?: string | null;
  /** 같은 제목의 서로 다른 문서가 Drive에서 덮어써지지 않게 붙이는 안정 식별자 */
  rowId?: string | null;
}

export interface DutyDocumentHtmlExport {
  html: string;
  /** Google Docs 변환 업로드에 쓰는 이름(확장자 없음) */
  googleDocName: string;
  /** 변환하지 않고 일반 파일로 올릴 때 쓰는 이름 */
  htmlFileName: string;
  mediaType: typeof DUTY_DOCUMENT_MEDIA_TYPE;
  googleWorkspaceMimeType: typeof GOOGLE_DOCUMENT_MIME_TYPE;
}

export function escapeDocumentHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function rawText(value: DocumentValue | undefined): string {
  if (value === null || value === undefined || Array.isArray(value)) return '';
  if (typeof value === 'boolean') return value ? '확인' : '미확인';
  return String(value).trim();
}

function richText(value: DocumentValue | undefined): string {
  return escapeDocumentHtml(rawText(value)).replace(/\r?\n/g, '<br>');
}

function won(value: string | number): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? `${new Intl.NumberFormat('ko-KR').format(amount)}원` : String(value);
}

function displayedValue(field: DocumentField, values: DocumentValues): string {
  const value = values[field.key];
  if (field.kind === 'check') return value === true ? '☑ 확인' : '□ 미확인';
  const raw = rawText(value);
  if (!raw) return '';
  if ((field.kind === 'number' && /금액|단가/.test(field.label)) || ['amount', 'previousAmount', 'unitPrice'].includes(field.key)) {
    return escapeDocumentHtml(won(raw));
  }
  return richText(value);
}

function lineItems(values: DocumentValues, key: string): DocumentLineItem[] {
  const value = values[key];
  return Array.isArray(value) ? value : [];
}

function renderLineItems(values: DocumentValues, field: DocumentField): string {
  const items = lineItems(values, field.key);
  const rows = items.map((item, index) => {
    const amount = (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
    return `<tr>
      <td class="number">${index + 1}</td>
      <td>${escapeDocumentHtml(item.item)}</td>
      <td>${escapeDocumentHtml(item.detail)}</td>
      <td class="number">${escapeDocumentHtml(item.quantity)}</td>
      <td class="number">${escapeDocumentHtml(item.unit)}</td>
      <td class="money">${item.unitPrice ? escapeDocumentHtml(new Intl.NumberFormat('ko-KR').format(Number(item.unitPrice) || 0)) : ''}</td>
      <td class="money">${amount ? escapeDocumentHtml(new Intl.NumberFormat('ko-KR').format(amount)) : ''}</td>
    </tr>`;
  }).join('');

  return `<div class="wide line-items">
    <p class="field-label">${escapeDocumentHtml(field.label)}</p>
    <table>
      <thead><tr><th>No.</th><th>품목</th><th>세부 내용</th><th>수량</th><th>단위</th><th>단가</th><th>금액</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="empty">작성된 품목이 없습니다.</td></tr>'}</tbody>
      <tfoot><tr><th colspan="6">합계</th><th class="money">${escapeDocumentHtml(won(quoteTotal(values)))}</th></tr></tfoot>
    </table>
  </div>`;
}

function renderSurvey(template: DutyDocumentTemplate, values: DocumentValues): string {
  const questions = template.sections
    .flatMap((section) => section.fields)
    .filter((field) => /^q\d+$/.test(field.key) && !field.internal);
  if (questions.length === 0) return '';

  const rows = questions.map((field) => {
    const selected = rawText(values[field.key]);
    const checks = [1, 2, 3, 4, 5]
      .map((score) => `<td class="survey-check">${selected.startsWith(String(score)) ? '☑' : '□'}</td>`)
      .join('');
    return `<tr><td>${escapeDocumentHtml(field.label)}</td>${checks}</tr>`;
  }).join('');

  return `<section class="section survey-section">
    <h2>만족도 평가</h2>
    <table class="survey-table">
      <thead><tr><th>평가 문항</th><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

function renderField(field: DocumentField, values: DocumentValues): string {
  if (field.kind === 'lineItems') return renderLineItems(values, field);
  const shown = displayedValue(field, values);
  const wide = field.full || field.kind === 'textarea';
  return `<div class="field${wide ? ' wide' : ''}">
    <p class="field-label">${escapeDocumentHtml(field.label)}</p>
    <div class="field-value${shown ? '' : ' empty'}">${shown || '&nbsp;'}</div>
  </div>`;
}

function renderSections(template: DutyDocumentTemplate, values: DocumentValues): string {
  const survey = template.key === 'satisfaction-survey' ? renderSurvey(template, values) : '';
  return template.sections.map((section) => {
    // 설문 점수표도 양식에 정의된 원래 위치(기본정보와 의견 사이)에 둔다.
    if (survey && section.fields.some((field) => /^q\d+$/.test(field.key))) return survey;
    // 진행상태·내부메모 등은 편집 화면에만 있고 외부 문서에는 절대 싣지 않는다.
    const fields = section.fields.filter((field) => !field.internal);
    if (fields.length === 0) return '';
    return `<section class="section">
      <h2>${escapeDocumentHtml(section.title)}</h2>
      <div class="fields">${fields.map((field) => renderField(field, values)).join('')}</div>
    </section>`;
  }).join('');
}

function renderSignatures(signatures: string[] | undefined): string {
  if (!signatures?.length) return '';
  return `<section class="signatures">${signatures.map((label) => `<div>
    <b>${escapeDocumentHtml(label)}</b>
    <span>성명 ____________________</span>
    <span>서명 ____________________</span>
  </div>`).join('')}</section>`;
}

function primaryName(template: DutyDocumentTemplate, values: DocumentValues): string {
  const preferred = [
    values.documentTitle,
    values.institution,
    values.recipient,
    values.program,
    values.clientName,
  ].map(rawText).find(Boolean);
  return preferred ? `${preferred}_${template.title}` : template.title;
}

export function dutyDocumentGoogleName(
  template: DutyDocumentTemplate,
  values: DocumentValues,
  rowId?: string | null,
): string {
  const suffix = rowId ? `_${rowId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}` : '';
  // 저장된 문서는 제목·기관명을 고쳐도 같은 Drive 파일을 계속 덮어써야 한다.
  // 따라서 rowId가 있으면 내용값이 아닌 양식명+rowId만으로 이름을 고정한다.
  const base = rowId ? template.title : primaryName(template, values);
  return safeSeg(`${base}${suffix}`, template.title);
}

export function buildDutyDocumentHtml(
  template: DutyDocumentTemplate,
  values: DocumentValues,
  context: DutyDocumentExportContext = {},
): DutyDocumentHtmlExport {
  const googleDocName = dutyDocumentGoogleName(template, values, context.rowId);
  const path = [context.departmentName, context.groupName, context.dutyName]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(' · ');
  const customTitle = rawText(values.documentTitle);
  const isContractDraft = Boolean(template.reviewNotice);

  const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeDocumentHtml(googleDocName)}</title>
  <style>
    @page { size: A4 portrait; margin: 15mm 14mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #171717; font-family: "S-Core Dream", "Noto Sans KR", Arial, sans-serif; font-size: 10.5pt; line-height: 1.55; }
    .document { width: 100%; max-width: 182mm; margin: 0 auto; }
    .brand-row { display: flex; justify-content: space-between; align-items: baseline; color: #737373; font-size: 8.5pt; letter-spacing: .02em; }
    .brand { color: #f26522; font-weight: 800; letter-spacing: .12em; }
    .title { margin: 8mm 0 7mm; padding: 0 0 5mm; border-bottom: 2px solid #171717; text-align: center; }
    .title h1 { margin: 0; font-size: 22pt; line-height: 1.25; }
    .title p { margin: 2mm 0 0; color: #666; }
    .badge { display: inline-block; margin-left: 3mm; padding: 1mm 2mm; border: 1px solid #b45309; color: #92400e; background: #fffbeb; font-size: 8pt; vertical-align: middle; }
    .review { margin: -2mm 0 6mm; padding: 3mm 4mm; border: 1px solid #f3cf83; background: #fffbeb; color: #78350f; }
    .section { margin: 0 0 7mm; break-inside: avoid; }
    .section h2 { margin: 0 0 3mm; padding: 0 0 2mm; border-bottom: 1px solid #a3a3a3; font-size: 12pt; }
    .fields { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid #d4d4d4; border-left: 1px solid #d4d4d4; }
    .field { min-height: 17mm; padding: 3mm; border-right: 1px solid #d4d4d4; border-bottom: 1px solid #d4d4d4; break-inside: avoid; }
    .field.wide, .wide { grid-column: 1 / -1; }
    .field-label { margin: 0 0 1.5mm; color: #666; font-size: 8.5pt; font-weight: 700; }
    .field-value { min-height: 5mm; white-space: normal; overflow-wrap: anywhere; }
    .field-value.empty, td.empty { color: #aaa; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { padding: 2.2mm 1.5mm; border: 1px solid #a3a3a3; vertical-align: top; overflow-wrap: anywhere; }
    th { background: #f5f5f5; text-align: center; font-size: 8.5pt; }
    .line-items { padding: 3mm; border-right: 1px solid #d4d4d4; border-bottom: 1px solid #d4d4d4; }
    .line-items th:nth-child(1) { width: 8mm; }
    .line-items th:nth-child(4), .line-items th:nth-child(5) { width: 13mm; }
    .line-items th:nth-child(6), .line-items th:nth-child(7) { width: 23mm; }
    .number { text-align: center; }
    .money { text-align: right; white-space: nowrap; }
    tfoot th { font-size: 10pt; }
    .survey-table th:not(:first-child), .survey-table td:not(:first-child) { width: 10mm; }
    .survey-check { text-align: center; vertical-align: middle; font-size: 12pt; }
    .signatures { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8mm; margin-top: 12mm; page-break-inside: avoid; }
    .signatures > div { display: grid; gap: 5mm; padding: 5mm 3mm; border-top: 1px solid #737373; }
    .signatures span { text-align: right; }
    .footer { margin-top: 10mm; padding-top: 3mm; border-top: 1px solid #e5e5e5; color: #999; font-size: 8pt; text-align: center; }
  </style>
</head>
<body>
  <main class="document">
    <div class="brand-row"><span class="brand">MOALAB</span><span>${escapeDocumentHtml(path)}</span></div>
    <header class="title">
      <h1>${escapeDocumentHtml(template.title)}${isContractDraft ? '<span class="badge">검토용 초안</span>' : ''}</h1>
      ${customTitle && customTitle !== template.title ? `<p>${escapeDocumentHtml(customTitle)}</p>` : ''}
    </header>
    ${template.reviewNotice ? `<div class="review"><b>최종 확인 필요</b> · ${escapeDocumentHtml(template.reviewNotice)}</div>` : ''}
    ${renderSections(template, values)}
    ${renderSignatures(template.signatures)}
    <footer class="footer">모아랩 부서업무에서 작성한 문서</footer>
  </main>
</body>
</html>`;

  return {
    html,
    googleDocName,
    htmlFileName: `${googleDocName}.html`,
    mediaType: DUTY_DOCUMENT_MEDIA_TYPE,
    googleWorkspaceMimeType: GOOGLE_DOCUMENT_MIME_TYPE,
  };
}
