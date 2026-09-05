import type { AppRow, AppSample, CostSheet, LessonPlan, OrgProfile } from './types';

/**
 * **제안서** — 기관에 보내는 "이런 수업을 이 값에 할 수 있습니다" 한 벌.
 *
 * 원장이 물었다: *"양식들 잘 쓸 법한 거는 구축이 낫지 않아?"* — 기관에 **보내는** 문서 중
 * 제일 먼저 나가는 것이 제안서다. 강의계획서처럼 **앱 안에서 채워서 A4·한글로 뽑는다.**
 * 한글을 열어 프로그램 이름·가격을 옮겨 적는 왕복이 없어진다.
 *
 * **새 표를 안 만든다.** 프로그램(`apps`)·강의계획서 목표(`lesson_plans.goal`)·
 * 원가표 판매가(`cost_sheets.sale_price`)·샘플 사진(`app_samples`)을 **읽어서** 채우고,
 * 원장이 이 화면에서 학년·차시·인원·가격을 고친다 — 실제 DB 에 학년이 적힌 프로그램이
 * 0개, 판매가가 있는 원가표가 1개라(38단계) 자동으로만 채우면 빈칸투성이 문서가 된다.
 * 고친 값은 **문서에만** 들어가고 프로그램 정보를 바꾸지는 않는다 (제안마다 값이 다르다).
 *
 * 회사 정보(`OrgProfile`)만 `settings` 표에 저장한다 — 매번 치게 두면 아무도 안 친다.
 */

export interface ProposalItem {
  appId: string;
  title: string;
  /** 프로그램 한 줄 소개 (`apps.purpose`) */
  purpose: string;
  /** 강의계획서 목표 (`lesson_plans.goal`) */
  goal: string;
  grade: string;
  /** 차시 */
  sessions: number;
  headcount: number;
  /** 1인당 · 1차시 가격 (원). 0 이면 문서에 '협의' 로 적는다 */
  unitPrice: number;
  /** 샘플 사진 (최대 3) */
  samples: string[];
}

export interface ProposalInput {
  org: string;
  contact: string;
  tel: string;
  /** YYYY-MM-DD */
  date: string;
  greeting: string;
  closing: string;
  items: ProposalItem[];
}

/** 이 기기에 남겨두는 초안 (다시 열면 이어 쓴다) */
export const DRAFT_KEY = 'moalab.proposal.draft';
/** 인쇄 화면에 넘겨주는 자리 — 주소창에 싣기엔 너무 길어서 저장소로 넘긴다 */
export const PRINT_DRAFT_KEY = 'moalab.proposal.print';

/** 문서에 몇 장을 싣나 — 4장부터는 작아져서 안 보인다 */
export const MAX_SAMPLES = 3;
/** 한 제안서에 프로그램 몇 개까지 — 그 이상이면 제안이 아니라 카탈로그다 */
export const MAX_ITEMS = 8;

/* ---------------------------------------------------------------- 기본값 */

/**
 * 프로그램 하나를 제안 줄로. **있는 값만** 채우고 없는 것은 비워둔다 —
 * 지어내면 원장이 안 고치고 그대로 보낸다.
 */
export function itemFromApp(
  app: AppRow,
  plan: LessonPlan | null | undefined,
  cost: CostSheet | null | undefined,
  samples: AppSample[],
): ProposalItem {
  return {
    appId: app.id,
    title: app.title_ko,
    purpose: (app.purpose ?? '').trim(),
    goal: (plan?.goal ?? '').trim(),
    grade: (app.target_grade ?? '').trim(),
    sessions: 1,
    headcount: cost && cost.headcount > 0 ? cost.headcount : 20,
    unitPrice: cost && cost.sale_price > 0 ? cost.sale_price : 0,
    samples: [...samples]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((s) => s.url)
      .slice(0, MAX_SAMPLES),
  };
}

export function defaultGreeting(org: string): string {
  const who = org.trim() || '귀 기관';
  return `${who}의 무궁한 발전을 기원합니다.\n저희는 AI 웹앱을 직접 만들어 학생들이 결과물을 손에 쥐고 돌아가는 체험 수업을 운영하고 있습니다.\n아래와 같이 프로그램을 제안드리오니 검토 부탁드립니다.`;
}

export const DEFAULT_CLOSING =
  '일정·인원·차시는 기관 사정에 맞춰 조정할 수 있습니다.\n궁금하신 점은 아래 연락처로 편하게 문의해 주세요.';

export function emptyProposal(today: string): ProposalInput {
  return { org: '', contact: '', tel: '', date: today, greeting: defaultGreeting(''), closing: DEFAULT_CLOSING, items: [] };
}

/* ---------------------------------------------------------------- 계산 */

/** 프로그램 한 줄 금액 = 1인당 × 인원 × 차시. 가격이 0 이면 0 (문서에는 '협의') */
export function lineTotal(it: ProposalItem): number {
  if (it.unitPrice <= 0) return 0;
  return Math.round(it.unitPrice * Math.max(0, it.headcount) * Math.max(0, it.sessions));
}

export function grandTotal(items: ProposalItem[]): number {
  return items.reduce((s, it) => s + lineTotal(it), 0);
}

/** 가격을 안 적은 줄이 하나라도 있으면 합계 옆에 '일부 협의' 를 붙인다 */
export function hasUnpriced(items: ProposalItem[]): boolean {
  return items.some((it) => it.unitPrice <= 0);
}

/** 문서에 적는 금액 — 0 은 '협의' */
export function priceText(n: number): string {
  return n > 0 ? `${n.toLocaleString('ko-KR')}원` : '협의';
}

/* ---------------------------------------------------------- 검사·다듬기 */

/** 저장 전 검사 — 무엇이 비었는지 한글로. 빈 배열이면 보내도 된다 */
export function proposalProblems(p: ProposalInput): string[] {
  const out: string[] = [];
  if (!p.org.trim()) out.push('받는 곳(기관 이름)을 적어주세요.');
  if (p.items.length === 0) out.push('프로그램을 하나 이상 골라주세요.');
  if (p.items.length > MAX_ITEMS) out.push(`프로그램은 ${MAX_ITEMS}개까지만 넣을 수 있어요.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) out.push('제안일이 날짜가 아니에요.');
  return out;
}

/**
 * 숫자 칸 입력 다듬기 — `4만5,000원` 도 45000 으로 (지출결의서 금액 칸과 같은 판단).
 * 숫자가 하나도 없으면 0
 */
export function toNumber(raw: string | number): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  const digits = raw.replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

/** 회사 정보가 문서에 실릴 만큼 채워졌나 — 이름은 있어야 한다 */
export function orgReady(o: OrgProfile): boolean {
  return o.name.trim() !== '';
}

/** 회사 정보 한 줄 — 있는 것만 잇는다 */
export function orgLine(o: OrgProfile): string {
  return [o.name, o.ceo && `대표 ${o.ceo}`, o.tel, o.email, o.address].filter(Boolean).join(' · ');
}

/** 파일 이름 — `제안서_광주중학교_2026-09-02` */
export function proposalFileName(p: ProposalInput): string {
  const org = p.org.trim().replace(/[\\/:*?"<>|]/g, '_') || '기관';
  return `제안서_${org}_${p.date}`;
}
