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

/** 문서 갈래 — 제안서와 견적서는 **같은 입력**에서 나온다 (같은 기관·같은 프로그램·같은 값) */
export type DocKind = 'proposal' | 'quote';
export const DOC_KINDS: { key: DocKind; label: string; title: string }[] = [
  { key: 'proposal', label: '제안서', title: '프로그램 제안서' },
  { key: 'quote', label: '견적서', title: '견적서' },
];
export function docLabel(kind: DocKind): string {
  return kind === 'quote' ? '견적서' : '제안서';
}

/** 부가세를 어떻게 적나 — 회사 사정에 따라 다르므로 원장이 고른다 */
export type VatMode = 'separate' | 'included' | 'exempt';
export const VAT_MODES: { key: VatMode; label: string; hint: string }[] = [
  { key: 'separate', label: '부가세 별도', hint: '합계 = 공급가액 + 10%' },
  { key: 'included', label: '부가세 포함', hint: '적은 금액 안에 10% 가 들어 있다' },
  { key: 'exempt', label: '면세', hint: '부가세 없음' },
];
export function vatLabel(mode: VatMode): string {
  return VAT_MODES.find((v) => v.key === mode)?.label ?? '부가세 별도';
}

export interface ProposalInput {
  kind: DocKind;
  org: string;
  contact: string;
  tel: string;
  /** YYYY-MM-DD */
  date: string;
  greeting: string;
  closing: string;
  items: ProposalItem[];
  /* ---- 견적서에만 쓰는 칸 ---- */
  /** 견적 번호 — 기본은 날짜로 만들고 손으로 고칠 수 있다 */
  quoteNo: string;
  /** 유효기간(일) — 견적일로부터 */
  validDays: number;
  vat: VatMode;
  /** 비고·조건 */
  terms: string;
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

/**
 * 견적 조건 기본 문구 — **사실을 단정하지 않는다.** 재료비 포함 여부·결제 조건은 회사가 정하는
 * 것이라 기본값으로 박아두면 원장이 안 고치고 그대로 보낸다. 바뀔 수 있다는 말만 적어둔다
 */
export const DEFAULT_TERMS =
  '· 인원·차시가 바뀌면 금액이 달라질 수 있습니다.\n· 교구·재료 포함 여부와 결제 조건은 계약 시 확정합니다.';

/** 견적 번호 기본값 — 날짜로. 같은 날 두 번째부터는 원장이 뒤에 -2 처럼 붙인다 */
export function defaultQuoteNo(today: string): string {
  return `Q-${today.replace(/-/g, '')}`;
}

export function emptyProposal(today: string): ProposalInput {
  return {
    kind: 'proposal',
    org: '',
    contact: '',
    tel: '',
    date: today,
    greeting: defaultGreeting(''),
    closing: DEFAULT_CLOSING,
    items: [],
    quoteNo: defaultQuoteNo(today),
    validDays: 30,
    vat: 'separate',
    terms: DEFAULT_TERMS,
  };
}

/**
 * 저장소에서 읽은 초안을 **지금 모양으로** 맞춘다 — 견적 칸이 생기기 전에 남긴 초안도
 * 그대로 읽히고, 깨진 값(문자열 숫자·없는 갈래)이 화면을 죽이지 않는다
 */
export function normalizeInput(raw: unknown, today: string): ProposalInput {
  const base = emptyProposal(today);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<Record<keyof ProposalInput, unknown>>;
  const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
  const items: ProposalItem[] = Array.isArray(r.items)
    ? (r.items as Partial<ProposalItem>[])
        .filter((it) => it && typeof it.appId === 'string')
        .map((it) => ({
          appId: it.appId as string,
          title: str(it.title, ''),
          purpose: str(it.purpose, ''),
          goal: str(it.goal, ''),
          grade: str(it.grade, ''),
          sessions: Math.max(1, Math.round(toNumber(it.sessions ?? 1) || 1)),
          headcount: Math.max(1, Math.round(toNumber(it.headcount ?? 20) || 20)),
          unitPrice: Math.max(0, Math.round(toNumber(it.unitPrice ?? 0))),
          samples: Array.isArray(it.samples) ? it.samples.filter((u): u is string => typeof u === 'string') : [],
        }))
    : [];
  const validDays = toNumber((r.validDays as number | string | undefined) ?? base.validDays);
  return {
    kind: r.kind === 'quote' ? 'quote' : 'proposal',
    org: str(r.org, ''),
    contact: str(r.contact, ''),
    tel: str(r.tel, ''),
    date: /^\d{4}-\d{2}-\d{2}$/.test(str(r.date, '')) ? (r.date as string) : base.date,
    greeting: str(r.greeting, base.greeting),
    closing: str(r.closing, base.closing),
    items,
    quoteNo: str(r.quoteNo, '').trim() || base.quoteNo,
    validDays: validDays > 0 ? Math.round(validDays) : base.validDays,
    vat: VAT_MODES.some((v) => v.key === r.vat) ? (r.vat as VatMode) : base.vat,
    terms: str(r.terms, base.terms),
  };
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

/* ---------------------------------------------------------------- 견적 */

export interface VatSplit {
  /** 공급가액 */
  supply: number;
  vat: number;
  total: number;
}

/**
 * 부가세를 가른다. 원 단위로 반올림하고 **합계에서 역산해 1원이 안 어긋나게** 한다
 * (포함이면 공급가액을 반올림하고 부가세는 합계 − 공급가액).
 */
export function vatSplit(items: ProposalItem[], mode: VatMode): VatSplit {
  const sum = grandTotal(items);
  if (mode === 'exempt') return { supply: sum, vat: 0, total: sum };
  if (mode === 'included') {
    const supply = Math.round(sum / 1.1);
    return { supply, vat: sum - supply, total: sum };
  }
  const vat = Math.round(sum * 0.1);
  return { supply: sum, vat, total: sum + vat };
}

/** 유효기간 마지막 날 — 견적일 + N일. 날짜가 아니면 빈 문자열 */
export function validUntil(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return '';
  const x = new Date(y, m - 1, d + Math.max(0, Math.round(days)));
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

/**
 * 금액을 한글로 — 견적서의 `일금 ○○원정`.
 * 엑셀 `NUMBERSTRING(값,1)` 과 같은 꼴이다 (일십·일백·일만처럼 **'일' 을 빠뜨리지 않는다**) —
 * 한글 견적서 양식 대부분이 그 함수로 만든 글자라 같은 모양이어야 낯설지 않다.
 */
export function moneyInKorean(n: number): string {
  const v = Math.floor(Math.abs(n));
  if (v === 0) return '영';
  const DIG = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const SMALL = ['', '십', '백', '천'];
  const BIG = ['', '만', '억', '조', '경'];
  const groups: string[] = [];
  let rest = v;
  let g = 0;
  while (rest > 0 && g < BIG.length) {
    const part = rest % 10000;
    if (part > 0) {
      let s = '';
      for (let i = 3; i >= 0; i -= 1) {
        const digit = Math.floor(part / 10 ** i) % 10;
        if (digit > 0) s += DIG[digit] + SMALL[i];
      }
      groups.unshift(s + BIG[g]);
    }
    rest = Math.floor(rest / 10000);
    g += 1;
  }
  return groups.join('');
}

export function moneyInKoreanLine(n: number): string {
  return `일금 ${moneyInKorean(n)}원정`;
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
 * 견적서는 제안서보다 엄하다 — **가격이 없는 줄이 있으면 못 나간다.** 견적서의 쓸모가 곧 가격이다.
 * 제안서는 '협의' 로 나가도 되지만 견적서에 '협의' 가 있으면 견적이 아니다
 */
export function docProblems(p: ProposalInput): string[] {
  const out = proposalProblems(p);
  if (p.kind !== 'quote') return out;
  if (p.items.some((it) => it.unitPrice <= 0)) out.push('견적서는 모든 프로그램에 1인당 가격이 있어야 해요. 빈 가격을 적어주세요.');
  if (!p.quoteNo.trim()) out.push('견적 번호를 적어주세요.');
  if (!(p.validDays > 0)) out.push('유효기간(일)은 1 이상이어야 해요.');
  return out;
}

/**
 * 숫자 칸 입력 다듬기 — `4만5,000원` 도 45000 으로 (지출결의서 금액 칸과 같은 판단).
 * 숫자가 하나도 없으면 0
 */
export function toNumber(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  if (typeof raw !== 'string') return 0;
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

/** 파일 이름 — `제안서_광주중학교_2026-09-02` · `견적서_…` */
export function proposalFileName(p: ProposalInput): string {
  const org = p.org.trim().replace(/[\\/:*?"<>|]/g, '_') || '기관';
  return `${docLabel(p.kind ?? 'proposal')}_${org}_${p.date}`;
}
