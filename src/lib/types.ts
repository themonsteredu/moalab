export type Role = 'admin' | 'teacher';
export type AppStatus = 'pending' | 'fixing' | 'done';
export type CheckResult = 'none' | 'pass' | 'fail';
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
  creator_id: string | null;
  due_date: string | null;
  current_round: number;
  status: AppStatus;
  archived: boolean;
  /** 수업계획안 본문 */
  plan_body: string | null;
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

export interface CheckRow {
  id: string;
  round_id: string;
  member_id: string;
  item_no: number;
  result: CheckResult;
  note: string | null;
  updated_at: string;
  /** 제작자·원장이 남긴 답변 */
  response: string | null;
  response_state: ResponseState;
  responded_by: string | null;
  responded_at: string | null;
}

/** 지적사항에 대한 답변 상태 */
export type ResponseState = 'none' | 'fixed' | 'explained';

/** 지적사항 캡처 */
export interface CheckFile {
  id: string;
  check_id: string;
  file_url: string;
  file_name: string | null;
  created_at: string;
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

export interface PlanFile {
  id: string;
  app_id: string;
  file_url: string;
  file_name: string;
  file_size: number | null;
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

/** 고정 5항목 — 절대 늘리거나 줄이지 말 것 (DB check 제약과 맞물림) */
export const CHECK_ITEMS = [
  '폰에서 정상적으로 열린다',
  '게이트 코드 / 반코드 입력이 된다',
  'AI 응답이 정상이다 (오류·무응답 없음)',
  '학생 입력값이 저장된다',
  '오탈자·용어·학년 수준 확인',
] as const;

export const CHECK_ITEM_COUNT = CHECK_ITEMS.length;

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
