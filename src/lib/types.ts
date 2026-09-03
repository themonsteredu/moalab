export type Role = 'admin' | 'teacher';
/**
 * 앱 상태. 사람이 고르지 않고 지적 상태로만 계산된다 (src/lib/status.ts).
 * `recheck` 다시확인 = 답변은 달렸고 **검증자가 다시 봐야 하는** 것.
 * 예전엔 이것도 `fixing` 수정 필요로 뭉쳐 있어서, 공을 누가 갖고 있는지
 * (제작자가 고칠 차례인지 / 검증자가 확인할 차례인지) 목록에서 구분되지 않았다.
 */
export type AppStatus = 'pending' | 'fixing' | 'recheck' | 'done';
export type CostCategory = 'material' | 'api' | 'instructor' | 'transport' | 'etc';
export type PhotoTag = 'work' | 'activity' | 'board' | 'group';
/** 일정 갈래 — 셋에서 멈춘다. 마감은 여기 없다(apps·collab 에서 저절로 만들어진다) */
export type ScheduleKind = 'class' | 'meeting' | 'etc';

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
  /** (구) 계획안 본문. 지금은 문서 첨부(plan_files)로 올린다 */
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
  { value: 'fixed', label: '수정완료', on: 'border-blue-600 bg-blue-100 text-blue-800', hint: '무엇을 어떻게 고쳤는지 적어주세요.' },
  { value: 'wontfix', label: '수정불가', on: 'border-neutral-500 bg-neutral-100 text-neutral-700', hint: '왜 이대로 두는지 적어주세요.' },
  { value: 'recheck', label: '다시확인', on: 'border-amber-500 bg-amber-100 text-amber-800', hint: '무엇을 더 봐야 하는지 적어주세요.' },
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

/* ------------------------------------------------------------- 수익배분
   직접비를 먼저 빼고, 역할별 성과몫을 뺀 나머지를 참여자 1/N로 나눈다.
   한 사람이 여러 역할을 맡으면 각 성과몫과 기본 1/N을 모두 받는다. */

export type RevenueFundingType = 'private' | 'public_contract' | 'grant';
export type RevenueSharePoolKind = 'creator' | 'proposal' | 'sales' | 'custom';
export type RevenueShareRateMode = 'manual' | 'recommended';
export type RevenueShareRateStatus = 'undecided' | 'draft' | 'agreed';

export interface RevenueSharePoolRule {
  id: string;
  kind: RevenueSharePoolKind;
  label: string;
  active: boolean;
  /** recommended는 사업 규모별 누진 추천액을 자동으로 쓴다. */
  rate_mode: RevenueShareRateMode;
  rate_percent: number;
  member_ids: string[];
}

/** 학교·기관·지원사업처럼 수익과 비용을 따로 정산하는 사업 단위. */
export interface RevenueProject {
  id: string;
  name: string;
  /** 창작자·원가표를 가져올 교육 프로그램. 프로젝트와 프로그램은 같은 개념이 아니다. */
  linked_app_id: string | null;
  archived: boolean;
  created_by: string | null;
  updated_at: string;
  created_at: string;
}

/** 프로젝트별 현재 배분 기본안. 실제 지급 내역은 아니다. */
export interface RevenueProjectPlan {
  project_id: string;
  funding_type: RevenueFundingType;
  gross_amount: number;
  direct_costs: number;
  base_member_ids: string[];
  pools: RevenueSharePoolRule[];
  note: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

export interface RevenueShareMemberSnapshot {
  id: string;
  name: string;
}

/* ------------------------------------------------------------- 정부지원사업 */

export type GrantStatus =
  | 'discovered'
  | 'concept_shared'
  | 'writing'
  | 'submitted'
  | 'selected'
  | 'not_selected'
  | 'paused';

export interface GrantProject {
  id: string;
  title: string;
  agency: string | null;
  announcement_url: string | null;
  deadline: string | null;
  item_name: string | null;
  target_audience: string | null;
  concept_summary: string | null;
  differentiation: string | null;
  support_needed: string | null;
  lead_id: string | null;
  status: GrantStatus;
  duplicate_checked: boolean;
  concept_shared_at: string | null;
  submitted_at: string | null;
  result_note: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface GrantCollaborator {
  grant_id: string;
  member_id: string;
  created_at: string;
}

export type GrantFileKind = 'announcement' | 'final_plan';

export interface GrantFile {
  id: string;
  grant_id: string;
  kind: GrantFileKind;
  file_path: string;
  /** API가 짧게 발급한 비공개 열람 주소 */
  signed_url?: string | null;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  member_id: string | null;
  created_at: string;
}

/** 프로젝트 한 개의 한 달 수익배분 계산 스냅샷. */
export interface RevenueProjectMonth {
  id: string;
  project_id: string;
  /** 해당 월의 첫날, YYYY-MM-01. DATE라 시간대 영향을 받지 않는다. */
  settlement_month: string;
  rate_status: RevenueShareRateStatus;
  funding_type: RevenueFundingType;
  gross_amount: number;
  direct_costs: number;
  base_member_ids: string[];
  pools: RevenueSharePoolRule[];
  member_snapshot: RevenueShareMemberSnapshot[];
  calculation: import('./revenueShare').RevenueShareCalculation;
  note: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
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

/**
 * 문서 갈래 — 무엇을 올린 건지.
 * 형식(한글이냐 PPT냐)이 아니라 **누가 읽는가**로 가른다.
 * 형식으로 가르면 확장자 라벨(FileBadge)과 겹치기만 하고 아무것도 안 알려준다.
 */
export type PlanKind = 'plan' | 'guide' | 'form' | 'etc';

/**
 * 이 순서 그대로 화면에 나온다. 넷에서 멈춘다 —
 * 갈래를 늘리면 올릴 때마다 고민이 늘고 375px 에서 칩이 두 줄로 접힌다.
 * 색은 전부 tailwind.config.ts 에 이미 있는 것만 쓴다 (새 색을 안 만든다).
 */
export const PLAN_KINDS: { value: PlanKind; label: string; chip: string; hint: string }[] = [
  { value: 'plan', label: '계획안', chip: 'bg-neutral-100 text-neutral-600', hint: '프로그램 계획 문서' },
  { value: 'guide', label: '교육안', chip: 'bg-brand-50 text-brand-700', hint: '이 수업을 어떻게 진행하는지 — 강사가 읽어요' },
  { value: 'form', label: '양식', chip: 'bg-accent-50 text-accent-600', hint: '활동지·학습지 — 인쇄해 나눠줘요' },
  { value: 'etc', label: '기타', chip: 'bg-neutral-100 text-neutral-400', hint: 'PPT·영상·참고자료' },
];

export function planKindMeta(k: PlanKind | null | undefined) {
  // 칸이 생기기 전에 올린 파일(kind 없음)은 전부 계획안이다
  return PLAN_KINDS.find((x) => x.value === k) ?? PLAN_KINDS[0];
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
  /** 문서 갈래. DB 에 칸이 아직 없을 수도 있어서 optional 이다 */
  kind?: PlanKind;
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
  end_time: string | null;
  place: string | null;
  memo: string | null;
  /** 아래 넷은 출강(class)에서만 쓴다 */
  app_id: string | null;
  school: string | null;
  headcount: number | null;
  /** 강의 타임 수 — 정산의 기준 */
  periods: number | null;
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
  { value: 'todo', label: '미이수', cls: 'bg-neutral-100 text-neutral-500', on: 'border-neutral-400 bg-neutral-100 text-neutral-700' },
  { value: 'doing', label: '진행 중', cls: 'bg-amber-100 text-amber-800', on: 'border-amber-500 bg-amber-100 text-amber-800' },
  { value: 'done', label: '이수', cls: 'bg-green-100 text-green-800', on: 'border-green-600 bg-green-100 text-green-800' },
];

/* ------------------------------------------------------------- 지출결의서
   원가(cost_sheets)는 '앞으로 얼마 들까'(계획),
   지출(expenses)은 '실제로 얼마 썼나'(증빙)다. 섞으면 둘 다 못 쓴다. */

export type ExpenseCategory =
  | 'material'
  | 'transport'
  | 'meal'
  | 'book'
  | 'supply'
  | 'outsource'
  | 'etc';

export type PayMethod = 'card' | 'cash' | 'transfer';

export interface Expense {
  id: string;
  /** 지출일 — 날짜별·월별로 묶는 기준 */
  spent_on: string;
  amount: number;
  category: ExpenseCategory;
  /** 사용 내용 — 회계가 읽는 칸이라 필수 */
  purpose: string;
  vendor: string | null;
  pay_method: PayMethod;
  /** 결의자(쓴 사람) */
  member_id: string | null;
  app_id: string | null;
  school: string | null;
  note: string | null;
  approved: boolean;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface ExpenseFile {
  id: string;
  expense_id: string;
  file_url: string;
  file_name: string;
  file_size: number | null;
  /** 사진이면 인쇄물에 그대로 실린다 (한글·PDF 는 이름만) */
  is_image: boolean;
  sort_order: number;
  created_at: string;
}

/** 회계에서 쓰는 계정 이름에 맞췄다. 색은 소계 그래프·배지에 쓴다 */
export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string; color: string }[] = [
  { value: 'material', label: '재료비', color: '#F26522' },
  { value: 'transport', label: '교통비', color: '#A855F7' },
  { value: 'meal', label: '식비', color: '#E0483A' },
  { value: 'book', label: '도서·교구', color: '#2E7DD1' },
  { value: 'supply', label: '사무·소모품', color: '#12A67A' },
  { value: 'outsource', label: '외주·용역비', color: '#C2871B' },
  { value: 'etc', label: '기타', color: '#8A8A8A' },
];

export const PAY_METHODS: { value: PayMethod; label: string }[] = [
  { value: 'card', label: '카드' },
  { value: 'cash', label: '현금' },
  { value: 'transfer', label: '계좌이체' },
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

/* ------------------------------------------------------------------ 업무
   강사양성(training_*)과 축이 다르다.
   저쪽은 '전원 × 고정 커리큘럼'(기한 없음, 목록이 영구적),
   이쪽은 '1건 × 담당자 1명 × 기한'(끝나면 지나간다).
   값은 todo/doing/done 으로 같지만 라벨이 달라서 상수를 따로 둔다 —
   TrainingState 를 그대로 쓰면 한쪽 문구를 고칠 때 다른 쪽이 끌려온다. */

export type TaskState = 'todo' | 'doing' | 'done';

export interface Task {
  id: string;
  title: string;
  detail: string | null;
  assignee_id: string | null;
  due_date: string | null;
  state: TaskState;
  app_id: string | null;
  /** 한 번에 뿌린 묶음 (체크리스트로 만든 것) */
  batch_id: string | null;
  batch_title: string | null;
  created_by: string | null;
  sort_order: number;
  /** 기한 알림을 보낸 날 — 같은 알림이 두 번 울리는 걸 막는다 */
  reminded_on: string | null;
  done_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskTemplate {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface TaskTemplateItem {
  id: string;
  template_id: string;
  title: string;
  detail: string | null;
  default_assignee_id: string | null;
  /** 기준일 대비 며칠. 음수 = 미리 */
  day_offset: number;
  sort_order: number;
}

export const TASK_STATES: { value: TaskState; label: string; cls: string; on: string }[] = [
  { value: 'todo', label: '할 일', cls: 'bg-neutral-100 text-neutral-500', on: 'border-neutral-400 bg-neutral-100 text-neutral-700' },
  { value: 'doing', label: '하는 중', cls: 'bg-amber-100 text-amber-800', on: 'border-amber-500 bg-amber-100 text-amber-800' },
  { value: 'done', label: '완료', cls: 'bg-green-100 text-green-800', on: 'border-green-600 bg-green-100 text-green-800' },
];

/* ------------------------------------------------------------ 부서업무
   부서 › 중분류 › 소분류. 소분류 하나가 사람이 실제로 맡는 단위다.

   **업무(tasks)와 축이 다르다.** 저쪽은 *1건 × 담당자 1명 × 기한* 이고 끝나면
   지나간다. 이쪽은 기한이 없고 계속 남는 '이 일은 누구 담당' 이다.
   합치면 기한 알림도 못 쓰고 역할표도 못 쓴다
   (원가 vs 지출 · 업무 vs 강사양성 을 나눈 것과 같은 이유).

   ※ 이름을 `Role` 로 못 쓴다 — 위의 `Role`('admin' | 'teacher')이 이미 있다.
     같은 낱말이 두 뜻이 되면 반드시 사고가 난다. 그래서 Duty 로 부른다. */

export interface Department {
  id: string;
  name: string;
  /** 부서장 = 팀장 */
  head_id: string | null;
  sort_order: number;
  /**
   * 업무 흐름에서 몇 번째인가 (영업마케팅 1 → 기획개발 2 → 생산운영 3 → 인사관리 4).
   * 협업 요청에서 **다음 단계 부서를 먼저 보여주는 데만** 쓴다 — 막지는 않는다.
   */
  flow_order: number | null;
  /** 흐름 밖에서 전 부서를 지원하는 부서 (경영지원) */
  is_support: boolean;
  created_at: string;
}

/** 중분류 */
export interface DutyGroup {
  id: string;
  dept_id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

/** 소분류 = 역할 한 줄 */
export interface Duty {
  id: string;
  group_id: string;
  name: string;
  /** 무슨 일인지 한 줄 */
  note: string | null;
  /** 주담당 — 책임은 한 사람에게 지운다 (tasks 의 assignee_id 와 같은 판단) */
  owner_id: string | null;
  /**
   * 이 일로 **바로 가는 곳** — `/apps/<id>` · `/cost/<id>` 같은 앱 안 주소.
   *
   * 자료를 부서로 옮기는 게 아니다. 프로그램 페이지 한 장에 계획안·원가·샘플이
   * 모여 있는 게 이 앱의 핵심 설계라 쪼개면 '따로국밥' 으로 되돌아간다.
   * 대신 `원가·판매가 설계` 역할을 열면 그 원가표로 가게 **길만** 낸다.
   */
  link: string | null;
  sort_order: number;
  created_at: string;
}

/** 부담당 — 같이 하는 사람 (app_reviewers 와 같은 꼴) */
export interface DutyHelper {
  duty_id: string;
  member_id: string;
}

/* ------------------------------------------------ 역할마다 붙는 표(문서 양식)
   원장: *"각각 해야 할 일에 맞는 문서 양식이 구현이 되어 있어야 다들 일하기
   편할 것 같음. 예를 들어 학교기관관리 → 리스트 업하고 관리하는 페이지."*

   **역할이 63개라 화면을 63개 만들 수는 없다.** 그래서 프로그램을 코드 수정 없이
   데이터로 늘리는 것과 같은 방식을 쓴다 — **열(칼럼)을 데이터로 둔다.**
   새 역할에 표를 붙일 때 고칠 파일은 없다.

   ⚠️ `duty_files`(만든 자료)와 축이 다르다. 저쪽은 *결과물 파일*이고
   이쪽은 *계속 고쳐가며 관리하는 목록*이다 (학교 명단·교구 재고처럼).
   합치면 파일 목록에 줄이 섞이고 검색도 못 한다. */

/** 열 하나 — 이름과 갈래만 있으면 된다 */
export interface DutyColumn {
  id: string;
  duty_id: string;
  name: string;
  /** 'text' | 'number' | 'date' | 'select' | 'check' — 값 검사는 dutyTable.ts 의 safeKind */
  kind: string;
  /** 고르기 칸의 보기들. 다른 갈래면 null */
  options: string[] | null;
  sort_order: number;
  created_at: string;
}

/**
 * 줄 하나. 값은 **열 id 를 열쇠로 한 jsonb**(`cells`) 다.
 *
 * 열마다 진짜 컬럼을 만들면 열을 더할 때마다 `alter table` 이 필요하다 —
 * "코드를 안 건드린다" 를 지키려면 스키마도 안 건드려야 한다.
 */
export interface DutyRow {
  id: string;
  duty_id: string;
  /** ⚠️ 이름이 `values` 가 아니다 — SQL 예약어라 따옴표 없이는 컬럼을 만들 수 없다 */
  cells: Record<string, string | number | boolean | null>;
  sort_order: number;
  /** 마지막으로 고친 사람 — 여럿이 같은 목록을 만지므로 누가 바꿨는지 남는다 */
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/* ------------------------------------------------- 부서 간 협업 요청 / 지시
   업무(tasks)와 축이 다르다 — 저쪽은 1건 × 담당자 1명이고,
   이쪽은 **부서 → 부서**라 받아들일지 말지가 상대에게 있다. */

export type CollabStatus = 'requested' | 'doing' | 'done';
export type CollabPriority = 'high' | 'normal' | 'low';

/** 상태 3단 — 업무(TASK_STATES)와 같은 꼴이라 화면도 같은 버튼을 쓴다 */
export const COLLAB_STATES: { value: CollabStatus; label: string; on: string }[] = [
  { value: 'requested', label: '요청', on: 'border-neutral-400 bg-neutral-100 text-neutral-700' },
  { value: 'doing', label: '진행중', on: 'border-amber-500 bg-amber-100 text-amber-800' },
  { value: 'done', label: '완료', on: 'border-green-600 bg-green-100 text-green-800' },
];

/** 중요도 — 셋에서 멈춘다. 늘리면 고를 때마다 고민이 늘고 뜻이 흐려진다 */
export const COLLAB_PRIORITIES: {
  value: CollabPriority;
  label: string;
  chip: string;
}[] = [
  { value: 'high', label: '급함', chip: 'bg-red-100 text-red-700' },
  { value: 'normal', label: '보통', chip: 'bg-neutral-100 text-neutral-500' },
  { value: 'low', label: '나중에', chip: 'bg-neutral-100 text-neutral-400' },
];

export interface CollabRequest {
  id: string;
  from_dept_id: string;
  to_dept_id: string;
  /** "○○중 3학년 4차시" 처럼 자유 입력 */
  project: string | null;
  body: string;
  due_date: string | null;
  priority: CollabPriority;
  status: CollabStatus;
  created_by: string | null;
  /** 받아서 '진행중' 을 누른 사람 */
  accepted_by: string | null;
  done_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CollabComment {
  id: string;
  request_id: string;
  member_id: string | null;
  body: string;
  created_at: string;
}

/* ------------------------------------------------------------------ 대화
   ⚠️ 이 표들은 members(PIN)·app_secrets(API 키) 와 같은 취급이다.
   브라우저는 아예 못 붙고, 읽기·쓰기는 전부 /api/chat/* 서버 라우트를 거친다. */

/** 방 갈래 — 셋에서 멈춘다 */
export type ChatRoomKind = 'dm' | 'dept' | 'all';

export interface Room {
  id: string;
  kind: ChatRoomKind;
  dept_id: string | null;
  /** 1:1 은 두 사람 id 를 정렬해 이어붙인 값 — 같은 짝이 두 방이 되지 않게 */
  dm_key: string | null;
  title: string | null;
  created_at: string;
}

export interface RoomMemberRow {
  room_id: string;
  member_id: string;
  last_read_at: string;
  joined_at: string;
}

export interface Message {
  id: string;
  room_id: string;
  member_id: string | null;
  body: string | null;
  /** 비공개 버킷 안의 경로. 공개 URL 이 아니다 */
  image_path: string | null;
  created_at: string;
}

/** 목록 화면이 받는 모양 — 서버가 만들어서 내려준다 */
export interface RoomSummary {
  id: string;
  kind: ChatRoomKind;
  /** 화면에 그대로 쓰는 이름 (1:1 은 상대 이름) */
  title: string;
  memberIds: string[];
  unread: number;
  lastBody: string | null;
  lastAt: string | null;
  lastFrom: string | null;
}
