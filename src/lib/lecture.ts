/**
 * 강의계획서(진로직업체험) 인쇄 서식의 기본 문구.
 *
 * 도입·마무리·교구는 프로그램이 달라도 거의 같은 진행 멘트라서 기본값으로 둔다.
 * 프로그램마다 다른 것(목표·활동·작품)은 앱 데이터에서 가져온다.
 * (Next.js page 파일은 컴포넌트 외의 export 를 허용하지 않아 따로 뺐다)
 */
export const LECTURE_BADGE = '진로직업체험';

export const LECTURE_INTRO = [
  '참석자 확인',
  '체험처 및 진행 강사 소개',
  '진행 프로그램 소개',
  '프로그램이 진행되는 장소에서의 안전 및 유의사항 전달',
];

export const LECTURE_CLOSING = '궁금한 점에 대해 질의응답 및 간단한 소감 발표';

export const LECTURE_DEV_TITLE = '[AI 웹앱활동]';
export const LECTURE_WORK_TITLE = '[활동작품]';

/** 도입 기본 문구를 번호 붙은 한 덩어리 글로 (작성 칸의 기본값 · 인쇄 대체값) */
export const lectureIntroText = () => LECTURE_INTRO.map((l, i) => `${i + 1}. ${l}`).join('\n');

export const LECTURE_TOOLS = '최소 2인 1조의 태블릿 1대 또는 휴대폰/노트북';

/** 활동작품 사진은 서식 한 장에 어울리게 최근 것 몇 장만 싣는다 */
export const LECTURE_PHOTO_LIMIT = 6;
