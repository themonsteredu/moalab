/**
 * Google Docs용 업무 문서 HTML 변환 테스트.
 *
 *   node scripts/duty-document-export.test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const out = mkdtempSync(join(tmpdir(), 'moalab-duty-document-export-'));
let D;
let E;
try {
  execFileSync(
    'npx',
    ['tsc', 'src/lib/dutyDocument.ts', 'src/lib/dutyDocumentExport.ts', 'src/lib/drivePath.ts',
      '--outDir', out, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { stdio: 'pipe' },
  );
  const req = createRequire(import.meta.url);
  D = req(join(out, 'dutyDocument.js'));
  E = req(join(out, 'dutyDocumentExport.js'));
} catch (error) {
  rmSync(out, { recursive: true, force: true });
  console.error('컴파일 실패:', error.stdout?.toString() || error.message);
  process.exit(1);
}

let passed = 0;
const failed = [];
const ok = (label, condition) => condition ? passed++ : failed.push(label);

const proposal = D.documentTemplateByKey('제안서 작성·발송', '학교·기관 영업', 'institution-proposal');
const proposalExport = E.buildDutyDocumentHtml(proposal, {
  documentTitle: '광주/중학교 <AI> 제안',
  recipient: '광주중학교',
  purpose: '첫 줄\n둘째 줄 <script>alert("x")</script>',
  curriculum: 'AI 창작 수업',
  amount: 880000,
  status: '발송 완료',
  internalNotes: '기관에는 절대 보이면 안 되는 메모 9917',
  nextAction: '다음 주 재연락 8826',
}, {
  departmentName: '영업마케팅부',
  groupName: '학교·기관 영업',
  dutyName: '제안서 작성·발송',
  rowId: '4ef3c612-6948-435e-9b1a-420d5fc6a059',
});

ok('완전한 UTF-8 HTML 문서다', proposalExport.html.startsWith('<!doctype html>') && proposalExport.html.includes('<meta charset="utf-8">'));
ok('Google Docs 변환용 MIME을 함께 준다', proposalExport.mediaType === 'text/html; charset=utf-8' && proposalExport.googleWorkspaceMimeType === 'application/vnd.google-apps.document');
ok('부서·중분류·업무 경로가 들어간다', proposalExport.html.includes('영업마케팅부 · 학교·기관 영업 · 제안서 작성·발송'));
ok('외부 본문과 금액이 들어간다', proposalExport.html.includes('AI 창작 수업') && proposalExport.html.includes('880,000원'));
ok('여러 줄 본문은 줄바꿈을 보존한다', proposalExport.html.includes('첫 줄<br>둘째 줄'));
ok('사용자 HTML을 실행하지 않고 escape한다', proposalExport.html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;') && !proposalExport.html.includes('<script>alert'));
ok('내부 관리 값은 완전히 빠진다', !proposalExport.html.includes('기관에는 절대 보이면 안 되는 메모 9917') && !proposalExport.html.includes('다음 주 재연락 8826') && !proposalExport.html.includes('내부 관리'));
ok('제안자 서명란이 있다', proposalExport.html.includes('제안자') && proposalExport.html.includes('서명 ____________________'));
ok('rowId가 있으면 파일 이름은 안정적이다', proposalExport.googleDocName === '기관 프로그램 제안서_4ef3c612');
ok('일반 HTML 저장용 확장자 이름도 준다', proposalExport.htmlFileName === '기관 프로그램 제안서_4ef3c612.html');

const sameRowRenamed = E.buildDutyDocumentHtml(proposal, { documentTitle: '완전히 바뀐 제목' }, { rowId: '4ef3c612-6948-435e-9b1a-420d5fc6a059' });
ok('문서 내용을 고쳐도 같은 Drive 이름을 유지한다', sameRowRenamed.googleDocName === proposalExport.googleDocName);

const quote = D.documentTemplateByKey('견적·계약', '학교·기관 영업', 'quotation');
const quoteExport = E.buildDutyDocumentHtml(quote, {
  documentTitle: 'AI 수업 견적',
  items: [
    { item: '강의', detail: '90분', quantity: '2', unit: '회', unitPrice: '120000' },
    { item: '재료', detail: '학생 키트', quantity: '25', unit: '명', unitPrice: '8000' },
  ],
  paymentStatus: '미입금',
}, { rowId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });

ok('견적 품목 표의 제목과 각 품목이 있다', quoteExport.html.includes('<th>품목</th>') && quoteExport.html.includes('학생 키트'));
ok('견적 수량×단가 합계가 맞다', quoteExport.html.includes('440,000원'));
ok('견적 공급자 서명란이 있다', quoteExport.html.includes('공급자'));
ok('견적 내부 입금상태는 빠진다', !quoteExport.html.includes('미입금'));

const contract = D.documentTemplateByKey('견적·계약', '학교·기관 영업', 'service-contract');
const contractExport = E.buildDutyDocumentHtml(contract, {
  documentTitle: '광주중 출강 계약',
  clientName: '광주중학교',
  providerName: '모아랩',
  internalNotes: '대표만 볼 문구',
}, { rowId: 'bbbbbbbb-1111-2222-3333-444444444444' });

ok('계약서는 검토용 초안으로 표시한다', contractExport.html.includes('검토용 초안'));
ok('계약 검토 안내를 싣는다', contractExport.html.includes('최종 확인 필요') && contractExport.html.includes('공식 계약서'));
ok('계약 양측 서명란이 있다', contractExport.html.includes('발주기관(갑)') && contractExport.html.includes('수행기관(을)'));
ok('계약 내부 메모는 빠진다', !contractExport.html.includes('대표만 볼 문구'));

const survey = D.documentTemplateByKey('만족도 조사', '고객 관리', 'satisfaction-survey');
const surveyExport = E.buildDutyDocumentHtml(survey, {
  documentTitle: 'AI 수업 만족도',
  program: 'AI 창작 수업',
  q1: '5 매우 그렇다',
  q2: '3 보통',
}, { rowId: 'cccccccc-1111-2222-3333-444444444444' });

ok('만족도는 1~5점 표로 나온다', surveyExport.html.includes('만족도 평가') && surveyExport.html.includes('<th>1</th>') && surveyExport.html.includes('<th>5</th>'));
ok('선택 점수는 체크 표시한다', surveyExport.html.includes('<td class="survey-check">☑</td>'));
ok('질문을 일반 필드로 중복 출력하지 않는다', (surveyExport.html.match(/전체적으로 수업에 만족하셨나요\?/g) || []).length === 1);

rmSync(out, { recursive: true, force: true });
console.log(`${passed}건 통과${failed.length ? `, ${failed.length}건 실패` : ''}`);
for (const label of failed) console.error(`  ✗ ${label}`);
if (failed.length) process.exit(1);
