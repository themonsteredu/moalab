/** 영업마케팅 업무에서 바로 작성하고 인쇄하는 실제 문서 양식 정의. */

export type DocumentFieldKind = 'text' | 'textarea' | 'date' | 'number' | 'select' | 'check' | 'lineItems';

export interface DocumentField {
  key: string;
  label: string;
  kind: DocumentFieldKind;
  placeholder?: string;
  options?: string[];
  required?: boolean;
  full?: boolean;
  /** 같은 값을 역할 목록에도 보여주기 위해 연결할 duty_columns 이름 */
  columnNames?: string[];
  /** 진행상태·내부메모처럼 외부 출력물에서 숨길 필드 */
  internal?: boolean;
}

export interface DutyDocumentSection {
  title: string;
  fields: DocumentField[];
}

export interface DutyDocumentTemplate {
  key: string;
  title: string;
  purpose: string;
  sections: DutyDocumentSection[];
  signatures?: string[];
  reviewNotice?: string;
}

export interface DocumentLineItem {
  item: string;
  detail: string;
  quantity: string;
  unit: string;
  unitPrice: string;
}

export type DocumentValue = string | number | boolean | DocumentLineItem[] | null;
export type DocumentValues = Record<string, DocumentValue>;

export interface DutyDocumentPayload {
  version: 1;
  templateKey: string;
  values: DocumentValues;
}

const text = (
  key: string,
  label: string,
  extra: Omit<DocumentField, 'key' | 'label' | 'kind'> = {},
): DocumentField => ({ key, label, kind: 'text', ...extra });
const area = (
  key: string,
  label: string,
  extra: Omit<DocumentField, 'key' | 'label' | 'kind'> = {},
): DocumentField => ({ key, label, kind: 'textarea', full: true, ...extra });
const date = (
  key: string,
  label: string,
  extra: Omit<DocumentField, 'key' | 'label' | 'kind'> = {},
): DocumentField => ({ key, label, kind: 'date', ...extra });
const number = (
  key: string,
  label: string,
  extra: Omit<DocumentField, 'key' | 'label' | 'kind'> = {},
): DocumentField => ({ key, label, kind: 'number', ...extra });
const select = (
  key: string,
  label: string,
  options: string[],
  columnNames?: string[],
  internal = false,
): DocumentField => ({ key, label, kind: 'select', options, columnNames, internal });

const proposal: DutyDocumentTemplate = {
  key: 'institution-proposal',
  title: '기관 프로그램 제안서',
  purpose: '기관에 제출할 교육 프로그램의 목적·운영내용·예산·기대효과를 작성합니다.',
  sections: [
    { title: '제안 기본정보', fields: [
      text('documentTitle', '제안서명', { required: true, columnNames: ['기관명', '학교·기관'] }),
      text('recipient', '수신 기관', { required: true }), text('recipientPerson', '수신 부서·담당자'),
      date('proposalDate', '제안일'), date('validUntil', '제안 유효기한'),
      text('program', '프로그램명', { required: true, columnNames: ['제안 프로그램', '프로그램'] }),
    ] },
    { title: '운영 계획', fields: [
      text('audience', '교육 대상'), number('headcount', '예상 인원'), text('sessions', '총 차시·회당 시간'),
      text('schedule', '운영 기간·희망일'), text('venue', '운영 장소'),
      area('purpose', '제안 목적', { placeholder: '기관의 필요와 이 프로그램을 제안하는 이유를 작성하세요.' }),
      area('overview', '프로그램 개요'), area('curriculum', '세부 수업 내용'),
      area('operation', '운영 방법'), area('provided', '제공 항목'), area('clientPrep', '기관 준비사항'),
      area('outcome', '기대효과'),
    ] },
    { title: '예산·문의', fields: [
      number('amount', '제안 금액', { columnNames: ['제안금액'] }),
      select('tax', '부가세', ['포함', '별도', '면세']), area('priceDetail', '금액 산출 내역'),
      text('writer', '작성자'), text('contact', '연락처', { columnNames: ['연락처'] }), text('email', '이메일'),
    ] },
    { title: '내부 관리', fields: [
      select('status', '진행상태', ['작성 전', '작성 중', '발송 완료', '답변 대기', '협의 중', '성사', '보류'], ['진행상태'], true),
      date('sentAt', '발송일', { columnNames: ['발송일'], internal: true }),
      text('nextAction', '다음 할 일', { columnNames: ['다음 할 일'], internal: true }),
      area('internalNotes', '내부 메모', { columnNames: ['메모'], internal: true }),
    ] },
  ],
  signatures: ['제안자'],
};

const quote: DutyDocumentTemplate = {
  key: 'quotation',
  title: '교육 프로그램 견적서',
  purpose: '기관에 제출할 품목·수량·단가·합계와 결제조건을 작성합니다.',
  sections: [
    { title: '견적 기본정보', fields: [
      text('documentTitle', '문서명', { required: true, columnNames: ['기관명'] }),
      text('quoteNo', '견적번호'), date('quoteDate', '견적일', { required: true }), date('validUntil', '유효기한'),
      text('recipient', '수신 기관', { required: true }), text('recipientPerson', '담당자'),
      text('program', '프로그램명', { columnNames: ['프로그램'] }), text('schedule', '운영일·기간'),
      number('headcount', '인원', { columnNames: ['인원'] }), number('sessions', '차시', { columnNames: ['차시'] }),
    ] },
    { title: '견적 내역', fields: [
      { key: 'items', label: '품목', kind: 'lineItems', required: true, full: true },
      select('tax', '부가세', ['포함', '별도', '면세']), area('included', '포함 내역'), area('notes', '비고'),
    ] },
    { title: '공급자 정보', fields: [
      text('providerName', '공급자 상호'), text('registrationNo', '사업자등록번호'), text('representative', '대표자'),
      text('providerAddress', '사업장 주소', { full: true }), text('providerContact', '공급자 연락처'),
      text('providerEmail', '이메일'), text('bankAccount', '입금 계좌', { full: true }),
    ] },
    { title: '내부 관리', fields: [
      select('status', '진행상태', ['견적 전', '견적 발송', '협의 중', '계약 완료', '취소'], ['진행상태'], true),
      select('paymentStatus', '입금상태', ['확인 전', '미입금', '일부 입금', '입금 완료'], ['입금상태'], true),
      area('internalNotes', '내부 메모', { columnNames: ['메모'], internal: true }),
    ] },
  ], signatures: ['공급자'],
};

const contract: DutyDocumentTemplate = {
  key: 'service-contract', title: '교육 프로그램 출강 계약서',
  purpose: '기관과 확정한 수업 범위·금액·역할·취소조건을 문서로 남깁니다.',
  reviewNotice: '계약 조항은 기관과 협의한 내용 및 보유 중인 공식 계약서에 맞춰 최종 검토하세요.',
  sections: [
    { title: '계약 기본정보', fields: [
      text('documentTitle', '계약명', { required: true, columnNames: ['기관명'] }), date('contractDate', '계약일', { columnNames: ['계약일'] }),
      text('contractPeriod', '계약기간'), text('clientName', '발주기관명', { required: true }),
      text('clientRepresentative', '발주기관 대표·담당자'), text('clientAddress', '발주기관 주소', { full: true }),
      text('providerName', '수행기관명', { required: true }), text('providerRepresentative', '수행기관 대표'),
      text('providerAddress', '수행기관 주소', { full: true }),
    ] },
    { title: '교육 내용', fields: [
      text('program', '프로그램명', { required: true, columnNames: ['프로그램'] }), text('audience', '교육 대상'),
      number('headcount', '인원', { columnNames: ['인원'] }), number('sessions', '차시', { columnNames: ['차시'] }),
      text('schedule', '수업 일정', { columnNames: ['수업일'] }), text('venue', '수업 장소'), area('scope', '수행 범위'),
    ] },
    { title: '금액·계약조건', fields: [
      number('amount', '계약 금액', { columnNames: ['계약금액'] }), text('paymentTerms', '지급 기한·방법'),
      area('clientDuties', '발주기관의 역할'), area('providerDuties', '수행기관의 역할'),
      area('cancellation', '일정 변경·취소'), area('safety', '안전·책임'),
      area('privacy', '개인정보·초상권'), area('copyright', '저작권·결과물'), area('specialTerms', '특약사항'),
    ] },
    { title: '내부 관리', fields: [
      select('status', '진행상태', ['계약 작성', '검토 중', '계약 완료', '취소'], ['진행상태'], true),
      select('paymentStatus', '입금상태', ['확인 전', '미입금', '일부 입금', '입금 완료'], ['입금상태'], true),
      area('internalNotes', '내부 메모', { columnNames: ['메모'], internal: true }),
    ] },
  ], signatures: ['발주기관(갑)', '수행기관(을)'],
};

const lead: DutyDocumentTemplate = {
  key: 'sales-lead', title: '신규 기관 영업 기록지',
  purpose: '기관을 처음 찾은 경로부터 연락 결과와 다음 조치까지 기록합니다.',
  sections: [
    { title: '기관 정보', fields: [
      text('institution', '기관명', { required: true, columnNames: ['기관명', '기관 이름', '학교·기관'] }),
      select('institutionType', '기관유형', ['학교', '청소년기관', '아동·돌봄', '청년·대학', '공공·문화·복지', '기타'], ['기관유형']),
      text('region', '지역', { columnNames: ['지역'] }), text('source', '발굴 경로'),
      text('department', '담당부서', { columnNames: ['담당자·부서'] }), text('person', '담당자'),
      text('contact', '연락처', { columnNames: ['연락처'] }), text('email', '이메일·홈페이지', { columnNames: ['이메일·홈페이지'] }),
    ] },
    { title: '영업 내용', fields: [
      area('needs', '기관의 필요·관심 내용'), text('program', '제안할 프로그램', { columnNames: ['관심 프로그램', '프로그램'] }),
      number('headcount', '예상 인원', { columnNames: ['예상 인원', '인원'] }), number('amount', '예상 금액', { columnNames: ['예상 금액', '금액'] }),
      area('contactHistory', '연락 내용·반응'),
    ] },
    { title: '다음 조치', fields: [
      select('status', '진행상태', ['연락 전', '연락함', '제안서 발송', '미팅', '견적·계약', '진행 중', '완료', '보류'], ['진행상태', '진행 상태', '상태']),
      text('nextAction', '다음 할 일', { columnNames: ['다음 할 일'] }), date('nextContact', '다음 연락일', { columnNames: ['다음 연락일'] }),
      area('notes', '메모', { columnNames: ['메모'] }),
    ] },
  ], signatures: ['작성자'],
};

const sns: DutyDocumentTemplate = {
  key: 'content-copy', title: 'SNS·블로그 게시물 원고',
  purpose: '발행 목적과 독자, 제목, 본문, 이미지 문구까지 실제 게시 원고를 작성합니다.',
  sections: [
    { title: '게시물 기획', fields: [
      text('documentTitle', '원고명', { required: true, columnNames: ['콘텐츠 주제'] }),
      select('channel', '발행 채널', ['인스타그램', '네이버 블로그', '유튜브·숏츠', '홈페이지', '카카오', '기타'], ['채널']),
      text('author', '작성자', { columnNames: ['작성자'] }), text('audience', '대상 독자'), area('goal', '발행 목적'),
      area('keyMessage', '핵심 메시지'),
    ] },
    { title: '실제 원고', fields: [
      text('headline', '게시 제목'), area('body', '본문 원고', { placeholder: '게시할 내용을 그대로 작성하세요.' }),
      area('imageCopy', '이미지·썸네일 문구'), area('cta', '마무리 안내·신청 문구'), text('hashtags', '해시태그'),
    ] },
    { title: '발행 관리', fields: [
      date('scheduledAt', '발행예정일', { columnNames: ['발행예정일'] }), date('publishedAt', '발행일', { columnNames: ['발행일'] }),
      text('url', '발행주소', { columnNames: ['발행주소'] }),
      select('status', '진행상태', ['아이디어', '작성 중', '검수', '발행 예약', '발행 완료', '보류'], ['진행상태'], true),
      area('internalNotes', '내부 메모', { columnNames: ['메모'], internal: true }),
    ] },
  ], signatures: ['작성', '검수'],
};

const brochure: DutyDocumentTemplate = {
  key: 'brochure-copy', title: 'A4 브로셔 원고·제작서',
  purpose: '브로셔에 들어갈 표지 문구와 면별 원고, 인쇄조건을 작성합니다.',
  sections: [
    { title: '제작 개요', fields: [
      text('documentTitle', '브로셔명', { required: true, columnNames: ['자료명'] }), text('audience', '배포 대상', { columnNames: ['대상'] }),
      text('owner', '담당자', { columnNames: ['담당자'] }), area('goal', '제작 목적'), text('size', '규격·면수'), number('quantity', '인쇄 수량'),
    ] },
    { title: '실제 원고', fields: [
      area('coverCopy', '표지 제목·핵심 문구'), area('insideCopy', '본문·면별 원고'),
      area('programs', '소개할 프로그램·내용'), area('contactCopy', '문의·신청 안내 문구'),
      area('designDirection', '사진·디자인 방향'),
    ] },
    { title: '제작 관리', fields: [
      date('dueDate', '마감일', { columnNames: ['마감일'] }), text('file', '파일·링크', { columnNames: ['파일·링크'] }),
      select('review', '검수상태', ['검수 전', '수정 필요', '승인'], ['검수상태']),
      select('status', '진행상태', ['기획', '제작 중', '검수', '완료', '보류'], ['진행상태'], true),
      area('internalNotes', '수정사항·내부 메모', { columnNames: ['메모'], internal: true }),
    ] },
  ], signatures: ['담당', '검수'],
};

const video: DutyDocumentTemplate = {
  key: 'video-storyboard', title: '홍보영상 스토리보드·대본',
  purpose: '영상의 장면 순서, 화면, 내레이션·자막을 실제 제작용으로 작성합니다.',
  sections: [
    { title: '영상 개요', fields: [
      text('documentTitle', '영상명', { required: true, columnNames: ['영상명'] }), text('audience', '시청 대상', { columnNames: ['대상'] }),
      text('owner', '담당자', { columnNames: ['담당자'] }), text('duration', '예상 길이'), area('goal', '영상 목적·핵심 메시지'),
    ] },
    { title: '스토리보드·대본', fields: [
      area('scene1', '장면 1 — 화면·내레이션·자막'), area('scene2', '장면 2 — 화면·내레이션·자막'),
      area('scene3', '장면 3 — 화면·내레이션·자막'), area('scene4', '장면 4 — 화면·내레이션·자막'),
      area('materials', '필요한 촬영·사진·음원'),
    ] },
    { title: '제작 관리', fields: [
      date('dueDate', '마감일', { columnNames: ['마감일'] }), text('url', '영상 링크', { columnNames: ['영상 링크'] }),
      select('review', '검수상태', ['검수 전', '수정 필요', '승인'], ['검수상태']),
      select('status', '진행상태', ['기획', '촬영', '편집', '검수', '완료', '보류'], ['진행상태'], true),
      area('internalNotes', '수정사항·내부 메모', { columnNames: ['메모'], internal: true }),
    ] },
  ], signatures: ['담당', '검수'],
};

const linkCopy: DutyDocumentTemplate = {
  key: 'landing-copy', title: '홍보 링크·랜딩페이지 원고',
  purpose: '링크를 눌렀을 때 보일 제목·소개·신청 문구와 점검 결과를 작성합니다.',
  sections: [
    { title: '링크 정보', fields: [
      text('documentTitle', '링크명', { required: true, columnNames: ['링크명'] }), text('target', '연결 대상', { columnNames: ['연결 대상'] }),
      text('url', 'URL', { columnNames: ['URL'] }), text('owner', '담당자', { columnNames: ['담당자'] }), area('goal', '사용 목적·배포 위치'),
    ] },
    { title: '실제 화면 원고', fields: [
      text('headline', '첫 화면 제목'), area('intro', '소개 문구'), area('details', '프로그램·서비스 상세 내용'),
      area('cta', '신청·문의 버튼 문구와 안내'),
    ] },
    { title: '점검', fields: [
      { key: 'desktop', label: 'PC에서 열림', kind: 'check' }, { key: 'mobile', label: '휴대폰에서 열림', kind: 'check' },
      { key: 'contentCheck', label: '내용·이미지 확인', kind: 'check' }, { key: 'privacy', label: '개인정보 노출 확인', kind: 'check' },
      date('dueDate', '마감일', { columnNames: ['마감일'] }), select('review', '검수상태', ['검수 전', '수정 필요', '승인'], ['검수상태']),
      select('status', '진행상태', ['준비 전', '연결 중', '검수', '완료', '보류'], ['진행상태'], true),
      area('internalNotes', '문제·내부 메모', { columnNames: ['메모'], internal: true }),
    ] },
  ], signatures: ['작성', '점검'],
};

const businessCard: DutyDocumentTemplate = {
  key: 'business-card-proof', title: '명함 제작 요청·교정지',
  purpose: '명함에 실제 인쇄될 앞·뒷면 정보와 교정 여부를 확인합니다.',
  sections: [
    { title: '앞면 인쇄정보', fields: [
      text('documentTitle', '교정지명', { required: true, columnNames: ['대상자'] }), text('person', '성명'),
      text('position', '직함·역할', { columnNames: ['직함·역할'] }), text('organization', '기관·브랜드명'),
      text('phone', '연락처', { columnNames: ['연락처'] }), text('email', '이메일', { columnNames: ['이메일'] }),
      text('address', '주소', { full: true }),
    ] },
    { title: '뒷면·제작정보', fields: [
      area('backCopy', '뒷면 문구·QR 연결주소'), number('quantity', '수량', { columnNames: ['수량'] }),
      text('owner', '담당자', { columnNames: ['담당자'] }), date('dueDate', '희망 완료일', { columnNames: ['마감일'] }),
      text('file', '시안 파일·링크', { columnNames: ['파일·링크'] }), area('designNotes', '디자인 요청사항'),
      { key: 'spellingChecked', label: '이름·직함 철자 확인', kind: 'check' },
      { key: 'contactChecked', label: '연락처·이메일 확인', kind: 'check' },
      select('status', '진행상태', ['요청', '디자인 중', '검수', '발주', '수령', '보류'], ['진행상태'], true),
      area('internalNotes', '내부 메모', { columnNames: ['메모'], internal: true }),
    ] },
  ], signatures: ['요청자', '교정 확인'],
};

const photoLog: DutyDocumentTemplate = {
  key: 'photo-log', title: '수업 사진 정리·활용 기록지',
  purpose: '촬영 자료의 초상권 확인, 사용 범위, 보관 위치를 기록합니다.',
  sections: [
    { title: '수업·촬영 정보', fields: [
      text('institution', '기관', { required: true, columnNames: ['기관'] }), text('program', '프로그램', { columnNames: ['프로그램'] }),
      date('classDate', '수업일', { columnNames: ['수업일'] }), text('photographer', '촬영자', { columnNames: ['촬영자'] }),
    ] },
    { title: '활용·보관', fields: [
      { key: 'portraitConsent', label: '초상권 확인 완료', kind: 'check', columnNames: ['초상권 확인'] },
      area('allowedUse', '사용 가능한 범위'), text('storage', '보관 위치', { columnNames: ['보관 위치'] }), text('retention', '보관 기한'),
      select('status', '정리상태', ['정리 전', '선별 중', '정리 완료', '공유 완료'], ['정리상태']),
      area('notes', '제외 사진·주의사항', { columnNames: ['메모'] }),
    ] },
  ], signatures: ['정리', '확인'],
};

const contactLog: DutyDocumentTemplate = {
  key: 'contact-log', title: '기관 문의·응대 기록지',
  purpose: '기관 담당자의 요청과 답변, 후속 조치를 빠짐없이 기록합니다.',
  sections: [
    { title: '문의자 정보', fields: [
      text('institution', '기관', { required: true, columnNames: ['기관'] }), text('person', '담당자', { columnNames: ['담당자'] }),
      text('contact', '연락처', { columnNames: ['연락처'] }), text('program', '관련 프로그램', { columnNames: ['프로그램'] }),
      date('receivedAt', '문의 받은 날', { columnNames: ['받은날'] }),
    ] },
    { title: '문의·답변', fields: [
      area('question', '문의·요청 내용', { required: true, columnNames: ['문의내용'] }), area('answer', '답변 내용', { columnNames: ['답변내용'] }),
      date('answeredAt', '답변일', { columnNames: ['답변일'] }),
      select('status', '처리상태', ['답변 대기', '답변 완료', '일정 확정', '종료'], ['처리상태']),
      text('nextAction', '후속 조치'), area('notes', '메모', { columnNames: ['메모'] }),
    ] },
  ], signatures: ['응대자'],
};

const satisfaction: DutyDocumentTemplate = {
  key: 'satisfaction-survey', title: '교육 프로그램 만족도 조사지',
  purpose: '참여자가 직접 표시할 수 있는 5점 척도와 서술형 의견 양식입니다.',
  sections: [
    { title: '조사 기본정보', fields: [
      text('documentTitle', '조사서명', { required: true, columnNames: ['기관'] }), text('institution', '기관명'),
      text('program', '프로그램명', { required: true, columnNames: ['프로그램'] }), date('classDate', '수업일', { columnNames: ['수업일'] }),
      text('audience', '교육 대상'), select('respondent', '응답자 구분', ['담당교사', '학생', '보호자', '기관 담당자']),
    ] },
    { title: '만족도 평가', fields: [
      select('q1', '1. 전체적으로 수업에 만족하셨나요?', ['1 매우 그렇지 않다', '2', '3 보통', '4', '5 매우 그렇다']),
      select('q2', '2. 수업 내용은 대상에게 적절했나요?', ['1 매우 그렇지 않다', '2', '3 보통', '4', '5 매우 그렇다']),
      select('q3', '3. 강사의 설명과 진행은 만족스러웠나요?', ['1 매우 그렇지 않다', '2', '3 보통', '4', '5 매우 그렇다']),
      select('q4', '4. 참여도와 흥미가 높았나요?', ['1 매우 그렇지 않다', '2', '3 보통', '4', '5 매우 그렇다']),
      select('q5', '5. 준비와 안전관리는 적절했나요?', ['1 매우 그렇지 않다', '2', '3 보통', '4', '5 매우 그렇다']),
      select('q6', '6. 재출강 또는 추천 의향이 있나요?', ['1 매우 그렇지 않다', '2', '3 보통', '4', '5 매우 그렇다']),
    ] },
    { title: '의견', fields: [
      area('good', '가장 좋았던 점', { columnNames: ['좋았던 점'] }), area('improve', '개선하면 좋을 점', { columnNames: ['개선점'] }),
      area('request', '희망 프로그램·시기'),
    ] },
    { title: '내부 관리', fields: [
      select('status', '조사상태', ['조사 전', '발송', '응답 완료', '정리 완료'], ['조사상태'], true),
      area('internalNotes', '내부 메모', { columnNames: ['메모'], internal: true }),
    ] },
  ],
};

const renewal: DutyDocumentTemplate = {
  key: 'renewal-proposal', title: '재출강·재계약 제안서',
  purpose: '지난 수업 성과와 다음 운영안을 함께 제시하는 후속 제안서입니다.',
  sections: [
    { title: '제안 기본정보', fields: [
      text('documentTitle', '제안서명', { required: true, columnNames: ['기관'] }), text('recipient', '수신 기관'),
      text('person', '담당자·부서', { columnNames: ['담당자·부서'] }), text('contact', '연락처', { columnNames: ['연락처'] }),
    ] },
    { title: '지난 운영', fields: [
      text('previousProgram', '지난 프로그램', { columnNames: ['지난 프로그램'] }), date('previousDate', '지난 수업일', { columnNames: ['지난 수업일'] }),
      number('previousHeadcount', '지난 참여 인원'), number('previousAmount', '지난 계약금액', { columnNames: ['지난 계약금액'] }),
      area('results', '지난 운영 결과·피드백'),
    ] },
    { title: '새 제안', fields: [
      text('nextProgram', '새 제안 프로그램'), text('preferredPeriod', '희망 기간', { columnNames: ['희망 시기'] }),
      number('headcount', '예상 인원'), number('sessions', '차시'), area('changes', '개선·변경 내용'),
      area('outcome', '기대효과'), number('amount', '제안 금액'), text('writer', '작성자'), text('writerContact', '작성자 연락처'),
    ] },
    { title: '내부 관리', fields: [
      date('nextContact', '다음 연락일', { columnNames: ['다음 연락일'], internal: true }),
      select('status', '진행상태', ['연락 전', '연락함', '제안 발송', '재계약', '보류', '종료'], ['진행상태'], true),
      area('result', '협의 결과', { columnNames: ['결과'], internal: true }), area('internalNotes', '내부 메모', { columnNames: ['메모'], internal: true }),
    ] },
  ], signatures: ['제안자'],
};

const institutionCard: DutyDocumentTemplate = {
  key: 'institution-card', title: '기관 관리카드',
  purpose: '한 기관의 담당자, 출강 이력, 누적 실적과 다음 연락 계획을 관리합니다.',
  sections: [
    { title: '기관 정보', fields: [
      text('institution', '기관명', { required: true, columnNames: ['기관명'] }), text('type', '기관유형', { columnNames: ['기관유형'] }),
      text('region', '지역', { columnNames: ['지역'] }), select('relation', '관계상태', ['첫 거래', '재출강', '단골', '중단'], ['관계상태']),
      text('person', '담당자·부서', { columnNames: ['담당자·부서'] }), text('contact', '연락처', { columnNames: ['연락처'] }),
      text('email', '이메일·홈페이지', { columnNames: ['이메일·홈페이지'] }),
    ] },
    { title: '출강 이력', fields: [
      text('program', '진행 프로그램', { columnNames: ['진행 프로그램'] }), date('lastDate', '마지막 수업일', { columnNames: ['마지막 수업일'] }),
      number('count', '출강 횟수', { columnNames: ['출강 횟수'] }), number('headcount', '누적 인원', { columnNames: ['누적 인원'] }),
      number('amount', '누적 계약금액', { columnNames: ['누적 계약금액'] }), area('results', '운영 결과·기관 반응'),
    ] },
    { title: '후속 관리', fields: [
      date('nextContact', '다음 연락일', { columnNames: ['다음 연락일'] }), text('nextAction', '다음 할 일'), area('notes', '메모', { columnNames: ['메모'] }),
    ] },
  ], signatures: ['담당자'],
};

const BY_DUTY: Record<string, DutyDocumentTemplate[]> = {
  '제안서 작성·발송': [proposal], '견적·계약': [quote, contract], '신규 기관 발굴': [lead],
  'SNS·블로그 운영': [sns], '브로셔만들기[A4버전]': [brochure], '브로셔만들기[영상]': [video],
  '브로셔만들기[링크]': [linkCopy], '명함제작': [businessCard], '수업 사진 정리': [photoLog],
  '담당 교사 응대': [contactLog], '만족도 조사': [satisfaction], '재출강·재계약': [renewal],
  '기관리스트관리': [institutionCard],
};

export function documentTemplatesFor(dutyName: string, groupName = ''): DutyDocumentTemplate[] {
  if (BY_DUTY[dutyName]) return BY_DUTY[dutyName];
  if (groupName.startsWith('신규발굴')) return [{ ...lead, key: `sales-lead-${dutyName}`, title: `${dutyName} 기관 영업 기록지` }];
  return [];
}

export function documentTemplateByKey(dutyName: string, groupName: string, key: string) {
  return documentTemplatesFor(dutyName, groupName).find((template) => template.key === key) ?? null;
}

export function allDocumentFields(template: DutyDocumentTemplate) {
  return template.sections.flatMap((section) => section.fields);
}

export function blankLineItems(): DocumentLineItem[] {
  return [{ item: '', detail: '', quantity: '1', unit: '회', unitPrice: '' }];
}

export function quoteTotal(values: DocumentValues) {
  const items = Array.isArray(values.items) ? values.items : [];
  return items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0);
}

export function parseDutyDocument(raw: unknown): DutyDocumentPayload | null {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    const parsed = JSON.parse(raw) as DutyDocumentPayload;
    return parsed?.version === 1 && typeof parsed.templateKey === 'string' && parsed.values ? parsed : null;
  } catch {
    return null;
  }
}

export function summaryCellsForDocument(
  template: DutyDocumentTemplate,
  values: DocumentValues,
  columns: { id: string; name: string }[],
) {
  const cells: Record<string, string | number | boolean | null> = {};
  for (const column of columns) cells[column.id] = null;
  for (const field of allDocumentFields(template)) {
    const value = values[field.key];
    if (Array.isArray(value) || value === undefined) continue;
    for (const name of field.columnNames ?? []) {
      const column = columns.find((candidate) => candidate.name === name);
      if (column) { cells[column.id] = value; break; }
    }
  }
  cells.__document = JSON.stringify({ version: 1, templateKey: template.key, values } satisfies DutyDocumentPayload);
  return cells;
}
