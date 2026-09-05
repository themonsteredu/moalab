/**
 * 영업마케팅 문서 양식 — 매핑·저장값 계산 테스트.
 *
 *   node scripts/duty-document.test.mjs
 *
 * src/lib/dutyDocument.ts 를 임시로 컴파일해서 실제 코드 그대로 돌린다.
 *
 * 여기서 막고 싶은 것:
 *   · 영업마케팅 업무나 신규발굴 갈래에 문서 양식이 붙지 않는 것
 *   · 견적 품목의 수량 × 단가 합계가 잘못되는 것
 *   · 망가진 __document JSON 때문에 화면이 죽는 것
 *   · 문서 요약값이 역할 표의 엉뚱한 칸에 저장되는 것
 *   · 진행상태·내부메모가 기관에 내보내는 문서에 섞이는 것
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const out = mkdtempSync(join(tmpdir(), 'moalab-duty-document-'));
let D;
try {
  execFileSync(
    'npx',
    ['tsc', 'src/lib/dutyDocument.ts', '--outDir', out,
      '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { stdio: 'pipe' },
  );
  D = createRequire(import.meta.url)(join(out, 'dutyDocument.js'));
} catch (e) {
  rmSync(out, { recursive: true, force: true });
  console.error('컴파일 실패:', e.stdout?.toString() || e.message);
  process.exit(1);
}

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) console.log(`  ok  ${label}`);
  else {
    fail++;
    console.log(`FAIL  ${label}\n      기대 ${w}\n      실제 ${g}`);
  }
};

const keysFor = (dutyName, groupName = '') =>
  D.documentTemplatesFor(dutyName, groupName).map((template) => template.key);

console.log('\n[영업마케팅 업무별 실제 문서]');
{
  const duties = [
    ['제안서 작성·발송', '학교·기관 영업', ['one-page-proposal', 'school-proposal', 'public-proposal', 'institution-proposal']],
    ['견적·계약', '학교·기관 영업', ['simple-quotation', 'quotation', 'service-contract', 'cooperation-mou']],
    ['신규 기관 발굴', '학교·기관 영업', ['institution-research', 'first-call-script', 'visit-consultation', 'sales-lead']],
    ['SNS·블로그 운영', '홍보', ['instagram-copy', 'naver-blog-copy', 'content-copy', 'press-release']],
    ['브로셔만들기[A4버전]', '홍보', ['one-page-flyer', 'brochure-copy', 'print-production-checklist']],
    ['수업 사진 정리', '홍보', ['class-photo-shot-list', 'photo-log', 'photo-selection-delivery']],
    ['브로셔만들기[영상]', '홍보', ['shorts-script', 'video-storyboard', 'interview-video']],
    ['브로셔만들기[링크]', '홍보', ['landing-copy', 'campaign-link-checklist', 'qr-tracking-sheet']],
    ['명함제작', '홍보', ['business-card-proof', 'business-card-order']],
    ['담당 교사 응대', '고객 관리', ['contact-log', 'teacher-meeting-minutes', 'complaint-response']],
    ['만족도 조사', '고객 관리', ['satisfaction-survey', 'student-satisfaction-survey', 'satisfaction-result-report']],
    ['재출강·재계약', '고객 관리', ['renewal-followup', 'institution-performance-summary', 'renewal-proposal']],
    ['기관리스트관리', '고객 관리', ['institution-card', 'institution-contact-history', 'sales-pipeline-review']],
  ];

  for (const [dutyName, groupName, keys] of duties) {
    eq(`${dutyName} 문서`, keysFor(dutyName, groupName), keys);
  }
  eq('견적·계약은 상황별 문서를 따로 고른다',
    D.documentTemplatesFor('견적·계약', '학교·기관 영업').map((t) => t.title),
    ['간편 견적서', '교육 프로그램 견적서', '교육 프로그램 출강 계약서', '업무협약서(MOU)']);
  const allTemplates = duties.flatMap(([dutyName, groupName]) => D.documentTemplatesFor(dutyName, groupName));
  eq('핵심 업무 양식은 총 42개다', allTemplates.length, 42);
  eq('핵심 업무 안에서 양식 키가 겹치지 않는다', new Set(allTemplates.map((template) => template.key)).size, 42);
  eq('각 업무에는 상황별 양식이 2개 이상 있다', duties.every(([dutyName, groupName]) => keysFor(dutyName, groupName).length >= 2), true);
  eq('모르는 업무에는 임의 양식을 붙이지 않는다', keysFor('외부 자문 회의록', '기타'), []);
  eq('직접 지정된 업무가 신규발굴 규칙보다 우선한다',
    keysFor('제안서 작성·발송', '신규발굴 학교'), ['one-page-proposal', 'school-proposal', 'public-proposal', 'institution-proposal']);
}

console.log('\n[신규발굴 15개 갈래]');
{
  const outreach = [
    ['신규발굴 학교', ['초등학교', '중학교', '고등학교·특수·대안학교']],
    ['신규발굴 청소년기관', ['청소년문화의집', '청소년수련관·수련원', '청소년상담복지센터·꿈드림']],
    ['신규발굴 아동·돌봄', ['지역아동센터', '다함께돌봄센터·방과후아카데미', '아동복지시설·그룹홈']],
    ['신규발굴 청년·대학', ['청년센터', '대학·평생교육원']],
    ['신규발굴 공공·문화·복지', ['교육청·교육지원청·진로교육원', '공공도서관·평생학습관', '문화재단·과학관·체험관', '복지관·지자체']],
  ];

  eq('신규발굴 갈래 수', outreach.reduce((n, [, duties]) => n + duties.length, 0), 15);
  for (const [groupName, duties] of outreach) {
    for (const dutyName of duties) {
      const templates = D.documentTemplatesFor(dutyName, groupName);
      eq(`${groupName} › ${dutyName} 양식 수`, templates.length, 4);
      eq(`${groupName} › ${dutyName} 키`, templates.map((t) => t.key), [
        `institution-research-${dutyName}`,
        `first-call-script-${dutyName}`,
        `visit-consultation-${dutyName}`,
        `sales-lead-${dutyName}`,
      ]);
      eq(`${groupName} › ${dutyName} 제목`, templates[0]?.title, `${dutyName} 기관 사전조사표`);
      eq(`${groupName} › ${dutyName} 키로 다시 찾기`,
        D.documentTemplateByKey(dutyName, groupName, `sales-lead-${dutyName}`)?.key,
        `sales-lead-${dutyName}`);
    }
  }
  eq('없는 문서 키는 null',
    D.documentTemplateByKey('초등학교', '신규발굴 학교', '없는-키'), null);
}

console.log('\n[견적 합계]');
{
  eq('빈 견적은 0원', D.quoteTotal({}), 0);
  eq('한 품목은 수량 × 단가', D.quoteTotal({ items: [
    { item: 'AI 수업', detail: '2시간', quantity: '3', unit: '회', unitPrice: '150000' },
  ] }), 450000);
  eq('여러 품목을 합한다', D.quoteTotal({ items: [
    { item: '강의', detail: '', quantity: '2', unit: '회', unitPrice: '120000' },
    { item: '재료', detail: '', quantity: '25', unit: '명', unitPrice: '8000' },
  ] }), 440000);
  eq('빈 수량·잘못된 단가는 0원으로 넘긴다', D.quoteTotal({ items: [
    { item: '미정', detail: '', quantity: '', unit: '회', unitPrice: '100000' },
    { item: '확인 중', detail: '', quantity: '2', unit: '회', unitPrice: '미정' },
  ] }), 0);
  eq('품목이 배열이 아니어도 0원', D.quoteTotal({ items: '잘못 저장된 값' }), 0);
  eq('새 견적은 빈 품목 한 줄로 시작한다', D.blankLineItems(), [
    { item: '', detail: '', quantity: '1', unit: '회', unitPrice: '' },
  ]);
}

console.log('\n[저장 문서 읽기]');
{
  const payload = {
    version: 1,
    templateKey: 'institution-proposal',
    values: { documentTitle: '광주중학교 AI 교육 제안', amount: 750000, tax: '포함' },
  };
  eq('정상 JSON은 그대로 읽는다', D.parseDutyDocument(JSON.stringify(payload)), payload);
  eq('빈 문자열은 문서가 아니다', D.parseDutyDocument(''), null);
  eq('문자열 아닌 값은 문서가 아니다', D.parseDutyDocument(payload), null);
  eq('깨진 JSON은 문서가 아니다', D.parseDutyDocument('{"version":'), null);
  eq('다른 버전은 문서가 아니다', D.parseDutyDocument(JSON.stringify({ ...payload, version: 2 })), null);
  eq('문서 키가 없으면 문서가 아니다',
    D.parseDutyDocument(JSON.stringify({ version: 1, values: {} })), null);
  eq('값 묶음이 없으면 문서가 아니다',
    D.parseDutyDocument(JSON.stringify({ version: 1, templateKey: 'institution-proposal' })), null);
  eq('값 묶음이 null이면 문서가 아니다',
    D.parseDutyDocument(JSON.stringify({ version: 1, templateKey: 'institution-proposal', values: null })), null);
}

console.log('\n[문서 요약값 → 역할 표]');
{
  const proposal = D.documentTemplateByKey('제안서 작성·발송', '학교·기관 영업', 'institution-proposal');
  const columns = [
    { id: 'c1', name: '기관명' },
    { id: 'c2', name: '제안 프로그램' },
    { id: 'c3', name: '제안금액' },
    { id: 'c4', name: '진행상태' },
    { id: 'c5', name: '연락처' },
    { id: 'c6', name: '메모' },
    { id: 'c7', name: '답변기한' },
  ];
  const values = {
    documentTitle: '광주중학교 제안', program: 'AI 창작 교실', amount: 880000,
    status: '발송 완료', contact: '062-000-0000', internalNotes: '금요일 재연락',
    validUntil: '2026-09-30', bodyNotMapped: '표에는 없는 본문',
  };
  const cells = D.summaryCellsForDocument(proposal, values, columns);

  eq('연결된 표 칸에 요약값을 넣는다',
    [cells.c1, cells.c2, cells.c3, cells.c4, cells.c5, cells.c6],
    ['광주중학교 제안', 'AI 창작 교실', 880000, '발송 완료', '062-000-0000', '금요일 재연락']);
  eq('연결되지 않은 표 칸은 null로 둔다', cells.c7, null);
  eq('문서 본문을 임의의 표 칸으로 만들지 않는다', cells.bodyNotMapped, undefined);
  eq('__document에는 본문 전체를 보존한다', D.parseDutyDocument(cells.__document), {
    version: 1, templateKey: 'institution-proposal', values,
  });

  const aliasCells = D.summaryCellsForDocument(proposal, { documentTitle: '대안학교 제안' }, [
    { id: 'school', name: '학교·기관' }, { id: 'blank', name: '메모' },
  ]);
  eq('첫 이름이 없어도 연결 후보 이름으로 찾는다', aliasCells.school, '대안학교 제안');
  eq('값 없는 기존 칸도 빠뜨리지 않는다', aliasCells.blank, null);

  const photo = D.documentTemplateByKey('수업 사진 정리', '홍보', 'photo-log');
  const checkCells = D.summaryCellsForDocument(photo, { portraitConsent: false }, [
    { id: 'consent', name: '초상권 확인' },
  ]);
  eq('체크하지 않음(false)도 값으로 보존한다', checkCells.consent, false);
}

console.log('\n[외부 문서와 내부 관리 필드]');
{
  const outward = [
    ['제안서 작성·발송', '학교·기관 영업', 'institution-proposal'],
    ['견적·계약', '학교·기관 영업', 'quotation'],
    ['견적·계약', '학교·기관 영업', 'service-contract'],
    ['만족도 조사', '고객 관리', 'satisfaction-survey'],
    ['재출강·재계약', '고객 관리', 'renewal-proposal'],
  ];

  for (const [dutyName, groupName, key] of outward) {
    const template = D.documentTemplateByKey(dutyName, groupName, key);
    const fields = D.allDocumentFields(template);
    const externalKeys = fields.filter((field) => !field.internal).map((field) => field.key);
    const internalSections = template.sections.filter((section) => section.title === '내부 관리');
    eq(`${template.title} — 외부에 쓸 본문이 있다`, externalKeys.length > 0, true);
    eq(`${template.title} — 내부 관리 칸은 모두 숨김 표시`,
      internalSections.flatMap((section) => section.fields).every((field) => field.internal === true), true);
    eq(`${template.title} — 내부 관리 칸이 외부 목록에 없다`,
      internalSections.flatMap((section) => section.fields).some((field) => externalKeys.includes(field.key)), false);
  }

  const proposal = D.documentTemplateByKey('제안서 작성·발송', '학교·기관 영업', 'institution-proposal');
  const externalKeys = D.allDocumentFields(proposal).filter((field) => !field.internal).map((field) => field.key);
  eq('제안서 외부 출력에는 진행상태·내부메모·다음 할 일이 없다',
    ['status', 'internalNotes', 'nextAction'].some((key) => externalKeys.includes(key)), false);
  eq('제안서 외부 출력에는 목적·교육내용·예산이 있다',
    ['purpose', 'curriculum', 'amount'].every((key) => externalKeys.includes(key)), true);

  const contract = D.documentTemplateByKey('견적·계약', '학교·기관 영업', 'service-contract');
  eq('계약서는 최종 검토 안내가 있다', typeof contract.reviewNotice === 'string' && contract.reviewNotice.length > 0, true);
}

rmSync(out, { recursive: true, force: true });
console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
