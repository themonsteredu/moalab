export type Role = 'admin' | 'teacher';
export type AppStatus = 'pending' | 'fixing' | 'done';
export type CostCategory = 'material' | 'api' | 'instructor' | 'transport' | 'etc';
export type PhotoTag = 'work' | 'activity' | 'board' | 'group';
export type ScheduleKind = 'meeting' | 'visit';

/** 로그인 이름 목록/멤버 표시에 쓰는 공개 정보 (PIN 없음) */
export interface MemberPublic {
  id: string;
  name: string;
  role: Role;
  active: boolean;
  sort_order: number;
  created_at: string;
}

export interface AppRow {
  id: string;
  slug: string;
  title_ko: string;
  url: string | null;
  purpose: string | null;
  target_grade: string | null;
  /** 주제 — 목록을 트리로 묶는 기준. moalab.topics 를 가리킨다 */
  topic_id: string | null;
  /** (구) 자유 입력 주제. topics 로 옮긴 뒤에는 안 쓴다 */
  topic: string | null;
  creator_id: string | null;
  due_date: string | null;
  current_round: number;
  status: AppStatus;
  archived: boolean;
  /** 수업계획안 본문 */
  plan_body: string | null;
  created_at: string;
}

/** 주제 — 한 곳에서 만들고 고치고 순서를 바꾼다 */
export interface Topic {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface AppReviewer {
  id: string;
  app_id: string;
  member_id: string;
}

export interface Round {
  id: string;
  app_id: string;
  round_no: number;
  change_note: string | null;
  opened_at: string;
  closed_at: string | null;
}

/* ------------------------------------------------------------------ 검증
   검증은 "고정 5항목에 O/X" 가 아니라
   **화면을 캡처해서 뭐가 이상한지 적고, 거기에 답을 다는 것**이다. */

/** 지적 한 건의 상태. open·fixed·recheck 는 아직 살아있는 것으로 센다 */
export type FindingStatus = 'open' | 'fixed' | 'recheck' | 'wontfix' | 'closed';

/** 답변에서 고를 수 있는 것 (글은 필수) */
export type ReplyState = 'fixed' | 'wontfix' | 'recheck';

export interface Finding {
  id: string;
  app_id: string;
  round_id: string | null;
  /** 지적한 사람 */
  member_id: string | null;
  body: string;
  status: FindingStatus;
  created_at: string;
  updated_at: string;
}

export interface FindingFile {
  id: string;
  finding_id: string;
  file_url: string;
  file_name: string | null;
  sort_order: number;
  created_at: string;
}

export interface FindingReply {
  id: string;
  finding_id: string;
  member_id: string | null;
  state: ReplyState;
  body: string;
  created_at: string;
}

export interface RoundSignoff {
  round_id: string;
  member_id: string;
  signed_at: string;
}

export const FINDING_META: Record<
  FindingStatus,
  { label: string; chip: string; box: string; open: boolean }
> = {
  open: { label: '지적됨', chip: 'bg-red-100 text-red-700', box: 'border-red-200', open: true },
  fixed: { label: '수정완료', chip: 'bg-blue-100 text-blue-700', box: 'border-blue-200', open: true },
  recheck: { label: '다시확인', chip: 'bg-amber-100 text-amber-800', box: 'border-amber-200', open: true },
  wontfix: { label: '수정불가', chip: 'bg-neutral-200 text-neutral-600', box: 'border-neutral-200', open: false },
  closed: { label: '확인완료', chip: 'bg-green-100 text-green-800', box: 'border-green-200', open: false },
};

/** 답변 버튼 3개 — 이 순서 그대로 화면에 나온다 */
export const REPLY_STATES: { value: ReplyState; label: string; on: string; hint: string }[] = [
  { value: 'fixed', label: '수정완료', on: 'bg-blue-600 text-white', hint: '무엇을 어떻게 고쳤는지 적어주세요.' },
  { value: 'wontfix', label: '수정불가', on: 'bg-neutral-600 text-white', hint: '왜 이대로 두는지 적어주세요.' },
  { value: 'recheck', label: '다시확인', on: 'bg-amber-500 text-white', hint: '무엇을 더 봐야 하는지 적어주세요.' },
];

/** 아직 살아있는 지적인가 (프로그램을 '수정 필요' 로 만드는 것) */
export function isOpenFinding(s: FindingStatus): boolean {
  return FINDING_META[s].open;
}

/**
 * '검증 완료' 를 눌렀을 때 같이 확인완료로 닫히는 지적.
 *
 * fixed(수정완료)는 "제작자가 고쳤다고 답한" 상태다. CLAUDE.md 에 적어둔 대로
 * **검증자가 확인해야** 진짜로 닫히는데, 그 확인이 바로 '검증 완료' 를 누르는 행동이다.
 * 예전엔 지적을 하나하나 '확인했어요' 로 닫은 다음에야 검증 완료를 누를 수 있어서,
 * 수정완료가 몇 건 쌓이면 버튼이 아예 안 눌렸다("먼저 확인완료로 닫아주세요").
 */
export function isConfirmableFinding(s: FindingStatus): boolean {
  return s === 'fixed';
}

/**
 * '검증 완료' 를 막는 지적 — 아직 손을 봐야 하는 것.
 * 지적됨(open)·다시확인(recheck)만 막는다. 둘 다 "무엇을 더 해야 한다" 가 남은 상태다.
 */
export function blocksSignoff(s: FindingStatus): boolean {
  return isOpenFinding(s) && !isConfirmableFinding(s);
}

export interface CommentRow {
  id: string;
  app_id: string;
  member_id: string | null;
  body: string;
  resolved: boolean;
  created_at: string;
}

export interface CommentFile {
  id: string;
  comment_id: string;
  file_url: string;
  file_name: string | null;
}

export interface CostSheet {
  id: string;
  app_id: string | null;
  title: string;
  headcount: number;
  sale_price: number;
  updated_at: string;
  created_at: string;
}

export interface CostItem {
  id: string;
  sheet_id: string;
  category: CostCategory;
  name: string;
  vendor: string | null;
  buy_url: string | null;
  spec: string | null;
  pack_qty: number;
  pack_price: number;
  qty_per_person: number;
  reusable: boolean;
  reuse_count: number | null;
  memo: string | null;
  sort_order: number;
}

export interface CostItemPhoto {
  id: string;
  item_id: string;
  photo_url: string;
}

/* -------------------------------------------------------- 강의계획서
   원장이 준 한글 양식(강의계획서.hwp) 그대로 화면에서 채우고 그대로 인쇄한다.
   양식 한 장 = 프로그램 하나라서 app_id 가 그대로 기본키다. */

/** 전개 칸의 항목 갈래 — 글 + 사진 한 장이 한 줄이다 */
export type PlanSlot = 'step' | 'order' | 'result';

export const PLAN_SLOTS: { value: PlanSlot; label: string; hint: string }[] = [
  { value: 'step', label: 'AI 웹앱활동', hint: '1. VR 문화유산 탐방 미션 안내' },
  { value: 'order', label: '만드는 순서', hint: '색지를 반으로 접어요' },
  { value: 'result', label: '결과 이미지', hint: '완성한 작품' },
];

export interface LessonPlan {
  app_id: string;
  /** 제목 오른쪽 배지 */
  category: string;
  goal: string | null;
  intro: string | null;
  dev_title: string;
  work_title: string;
  closing: string | null;
  /** 운영사항 > 교구 */
  tools: string | null;
  /** 운영사항 > 기타사항 */
  etc: string | null;
  /** 문서 맨 아래 로고 — 기관마다 다르고 언제든 바뀐다 */
  logo_url: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

export interface LessonPlanItem {
  id: string;
  app_id: string;
  slot: PlanSlot;
  label: string | null;
  url: string | null;
  sort_order: number;
  created_at: string;
}

export interface PlanFile {
  id: string;
  app_id: string;
  file_url: string;
  file_name: string;
  file_size: number | null;
  /** 올린 사람 */
  member_id: string | null;
  /** 이번 판에서 바꾼 것 */
  note: string | null;
  /** 같은 문서의 판들은 같은 group_id 를 갖는다 */
  group_id: string;
  /** 1판, 2판, … 클수록 최신 */
  version: number;
  created_at: string;
}

export interface AppSample {
  id: string;
  app_id: string;
  url: string;
  caption: string | null;
  sort_order: number;
  created_at: string;
}

export interface Album {
  id: string;
  school: string;
  class_date: string;
  app_id: string | null;
  teacher_id: string | null;
  grade: string | null;
  headcount: number | null;
  cover_photo_id: string | null;
  created_at: string;
}

export interface Photo {
  id: string;
  album_id: string;
  url: string;
  caption: string | null;
  tag: PhotoTag;
  has_face: boolean;
  created_at: string;
}

export interface Schedule {
  id: string;
  kind: ScheduleKind;
  title: string;
  date: string;
  start_time: string | null;
  place: string | null;
  memo: string | null;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  member_id: string | null;
  action: string;
  target: string | null;
  created_at: string;
}

export interface Notice {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  member_id: string | null;
  created_at: string;
}

export interface NoticeFile {
  id: string;
  notice_id: string;
  file_url: string;
  file_name: string;
  file_size: number | null;
  is_image: boolean;
  sort_order: number;
  created_at: string;
}

export interface NoticeRead {
  notice_id: string;
  member_id: string;
  read_at: string;
}

export interface MockLesson {
  id: string;
  app_id: string | null;
  title: string;
  lesson_date: string;
  start_time: string | null;
  place: string | null;
  presenter_id: string | null;
  memo: string | null;
  done: boolean;
  created_at: string;
}

export interface MockFeedback {
  id: string;
  mock_id: string;
  member_id: string | null;
  good: string | null;
  fix: string | null;
  created_at: string;
}

export type TrainingState = 'todo' | 'doing' | 'done';

export interface TrainingCourse {
  id: string;
  title: string;
  summary: string | null;
  sort_order: number;
  created_at: string;
}

export interface TrainingRecord {
  id: string;
  course_id: string;
  member_id: string;
  state: TrainingState;
  memo: string | null;
  done_at: string | null;
  updated_at: string;
}

export const TRAINING_STATES: { value: TrainingState; label: string; cls: string; on: string }[] = [
  { value: 'todo', label: '미이수', cls: 'bg-neutral-100 text-neutral-500', on: 'bg-neutral-500 text-white' },
  { value: 'doing', label: '진행 중', cls: 'bg-amber-100 text-amber-800', on: 'bg-amber-500 text-white' },
  { value: 'done', label: '이수', cls: 'bg-green-100 text-green-800', on: 'bg-green-600 text-white' },
];

export const COST_CATEGORIES: { value: CostCategory; label: string; color: string }[] = [
  { value: 'material', label: '재료비', color: '#F26522' },
  { value: 'api', label: 'AI API비', color: '#2E7DD1' },
  { value: 'instructor', label: '강사비', color: '#12A67A' },
  { value: 'transport', label: '교통비', color: '#A855F7' },
  { value: 'etc', label: '기타', color: '#8A8A8A' },
];

export const PHOTO_TAGS: { value: PhotoTag; label: string }[] = [
  { value: 'work', label: '작품' },
  { value: 'activity', label: '활동' },
  { value: 'board', label: '판서' },
  { value: 'group', label: '단체' },
];
