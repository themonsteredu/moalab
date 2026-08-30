/**
 * 프로그램별 수익 배분 계산.
 *
 * 실제 수금액에서 직접비를 먼저 뺀 뒤, 성과 풀(창작·제안·영업·사용자 정의)을
 * 정해진 비율만큼 떼어 해당 참여자에게 똑같이 나눈다. 남은 금액은 기본 멤버
 * 전원에게 1/N로 나눈다. 성과 풀 참여자도 기본 멤버이므로 두 몫을 모두 받는다.
 *
 * 돈은 매 단계에서 정수 원으로만 다룬다. 성과 풀 비율에서 생긴 1원 미만은
 * 기본 풀에 남기고, 각 풀을 1/N로 나눌 때 남는 원은 멤버 id 순으로 배정한다.
 * 따라서 입력 배열 순서를 바꿔도 결과가 달라지지 않는다.
 */

export const DEFAULT_CREATOR_RATE_PERCENT = 15;
/** UI에서 짧게 가져갈 수 있는 같은 기본값 이름. */
export const CREATOR_DEFAULT_RATE = DEFAULT_CREATOR_RATE_PERCENT;

export type RevenuePoolKind = 'creator' | 'proposal' | 'sales' | 'custom';

export interface RevenuePoolInput {
  /** 한 프로그램 안에서 바뀌지 않는 고유 id. 잔여 1원의 결정적 배정에도 쓴다. */
  id: string;
  kind: RevenuePoolKind;
  label?: string;
  active: boolean;
  /** 수동 모드의 배분율. fixedAmount가 있으면 계산에는 쓰지 않는다. */
  ratePercent?: number;
  /** 추천 모드의 확정 성과금. 있으면 비율 대신 이 정수 원을 그대로 쓴다. */
  fixedAmount?: number;
  /** 이 풀을 똑같이 나눠 받을 사람. 활성 풀은 한 명 이상이어야 한다. */
  memberIds: string[];
}

/** 화면 쪽에서 더 짧은 이름이 필요할 때 쓰는 같은 타입. */
export type SharePoolInput = RevenuePoolInput;

export interface RevenueShareInput {
  /** 실제로 수금했거나 매출로 인정한 금액 */
  grossAmount: number;
  /** 재료비·강사비 등 먼저 빼는 직접비 */
  directCosts: number;
  /** 성과 풀을 떼고 남은 금액을 1/N로 받을 전체 멤버 */
  baseMemberIds: string[];
  pools: RevenuePoolInput[];
}

export interface PoolMemberShare {
  memberId: string;
  amount: number;
}

export interface RevenuePoolAllocation {
  id: string;
  kind: RevenuePoolKind;
  label?: string;
  mode: 'rate' | 'fixed';
  ratePercent?: number;
  fixedAmount?: number;
  amount: number;
  /** 실제 amount / contributionProfit × 100. 이익이 0원이면 0. */
  effectiveRate: number;
  memberShares: PoolMemberShare[];
}

export interface MemberRevenueShare {
  memberId: string;
  /** 남은 금액을 기본 멤버 전원에게 나눈 몫 */
  baseAmount: number;
  /** 풀 id별 성과 몫. 참여하지 않은 풀은 키가 없다. */
  poolAmounts: Record<string, number>;
  totalAmount: number;
}

export interface RevenueShareResult {
  grossAmount: number;
  directCosts: number;
  /** max(0, grossAmount - directCosts) */
  contributionProfit: number;
  /** 직접비가 매출보다 클 때 부족한 금액 */
  deficitAmount: number;
  hasLoss: boolean;
  /** 수동 비율 모드로 켜진 풀의 설정 비율 합 */
  totalRatePercent: number;
  /** 고정액까지 포함한 전체 성과금 / contributionProfit × 100 */
  totalEffectiveRate: number;
  baseRatePercent: number;
  baseAmount: number;
  pools: RevenuePoolAllocation[];
  members: MemberRevenueShare[];
  /** 항상 contributionProfit과 같아야 한다. */
  totalDistributed: number;
}

/** 계산 화면에서 쓰기 좋은 결과 타입 별칭. */
export type RevenueShareCalculation = RevenueShareResult;

export interface IncentiveRecommendation {
  /** 누진 구간으로 계산한 추천 금액(정수 원, 1원 미만 버림) */
  amount: number;
  /** 추천 금액 / contributionProfit × 100. 0원이면 0. */
  effectiveRate: number;
}

export class RevenueShareValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join(' '));
    this.name = 'RevenueShareValidationError';
    this.issues = issues;
  }
}

const POOL_KINDS = new Set<RevenuePoolKind>(['creator', 'proposal', 'sales', 'custom']);

/** 비율은 백만분의 1%까지 정수화해 부동소수점 잔여가 결과를 흔들지 않게 한다. */
const RATE_SCALE = 1_000_000;
const HUNDRED_RATE_UNITS = 100 * RATE_SCALE;
const QUOTA_DENOMINATOR = BigInt(HUNDRED_RATE_UNITS);

function rateUnits(ratePercent: number): number {
  return Math.round(ratePercent * RATE_SCALE);
}

function cleanId(value: string): string {
  return value.trim();
}

function duplicated(values: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) dup.add(value);
    seen.add(value);
  }
  return [...dup].sort();
}

/** 화면에서 저장 버튼을 막을 때도 같은 검증 문구를 쓸 수 있다. */
export function validateRevenueShareInput(input: RevenueShareInput): string[] {
  const issues: string[] = [];

  if (!Number.isSafeInteger(input?.grossAmount) || input.grossAmount < 0) {
    issues.push('실제 수금액은 0 이상의 정수 원이어야 해요.');
  }
  if (!Number.isSafeInteger(input?.directCosts) || input.directCosts < 0) {
    issues.push('직접비는 0 이상의 정수 원이어야 해요.');
  }

  const rawBase = Array.isArray(input?.baseMemberIds) ? input.baseMemberIds : [];
  const baseIds = rawBase.map((id) => (typeof id === 'string' ? cleanId(id) : ''));
  if (baseIds.length === 0) issues.push('기본 배분 멤버를 한 명 이상 골라주세요.');
  if (baseIds.some((id) => !id)) issues.push('기본 배분 멤버 id는 비어 있을 수 없어요.');
  if (duplicated(baseIds).length > 0) issues.push('기본 배분 멤버가 중복되어 있어요.');
  const baseSet = new Set(baseIds);

  const pools = Array.isArray(input?.pools) ? input.pools : [];
  const poolIds: string[] = [];
  let totalUnits = 0;
  let fixedTotal = BigInt(0);
  let percentTotal = BigInt(0);
  const amountsValid =
    Number.isSafeInteger(input?.grossAmount) && input.grossAmount >= 0 &&
    Number.isSafeInteger(input?.directCosts) && input.directCosts >= 0;
  const contributionProfit = amountsValid ? Math.max(0, input.grossAmount - input.directCosts) : 0;

  pools.forEach((pool, index) => {
    const where = `${index + 1}번째 성과 풀`;
    const id = typeof pool?.id === 'string' ? cleanId(pool.id) : '';
    poolIds.push(id);
    if (!id) issues.push(`${where}의 id가 비어 있어요.`);
    if (!POOL_KINDS.has(pool?.kind)) issues.push(`${where}의 종류가 올바르지 않아요.`);
    const fixedAmount = pool?.fixedAmount;
    const usesFixed = fixedAmount !== undefined;
    if (usesFixed) {
      if (!Number.isSafeInteger(fixedAmount) || fixedAmount < 0) {
        issues.push(`${where}의 고정 성과금은 0 이상의 정수 원이어야 해요.`);
      }
    } else if (!Number.isFinite(pool?.ratePercent) || pool.ratePercent! < 0 || pool.ratePercent! > 100) {
      issues.push(`${where}의 배분율은 0% 이상 100% 이하여야 해요.`);
    }

    if (pool?.active) {
      if (usesFixed && Number.isSafeInteger(fixedAmount) && fixedAmount >= 0) {
        fixedTotal += BigInt(fixedAmount);
      } else if (Number.isFinite(pool.ratePercent) && pool.ratePercent! >= 0 && pool.ratePercent! <= 100) {
        const units = rateUnits(pool.ratePercent!);
        totalUnits += units;
        if (amountsValid) {
          percentTotal += (BigInt(contributionProfit) * BigInt(units)) / QUOTA_DENOMINATOR;
        }
      }
      const rawMembers = Array.isArray(pool.memberIds) ? pool.memberIds : [];
      const memberIds = rawMembers.map((memberId) =>
        typeof memberId === 'string' ? cleanId(memberId) : '',
      );
      if (memberIds.length === 0) issues.push(`${where}은 받을 멤버를 한 명 이상 골라야 해요.`);
      if (memberIds.some((memberId) => !memberId)) issues.push(`${where}의 멤버 id가 비어 있어요.`);
      if (duplicated(memberIds).length > 0) issues.push(`${where}에 같은 멤버가 중복되어 있어요.`);
      if (memberIds.some((memberId) => memberId && !baseSet.has(memberId))) {
        issues.push(`${where}의 멤버는 기본 배분 멤버에도 포함되어야 해요.`);
      }
    }
  });

  if (duplicated(poolIds.filter(Boolean)).length > 0) issues.push('성과 풀 id가 중복되어 있어요.');
  if (totalUnits > HUNDRED_RATE_UNITS) issues.push('활성 성과 풀의 배분율 합은 100%를 넘을 수 없어요.');
  if (amountsValid && fixedTotal + percentTotal > BigInt(contributionProfit)) {
    issues.push('활성 성과 풀의 성과금 합은 배분 가능한 이익을 넘을 수 없어요.');
  }

  return issues;
}

/** 한 금액을 id 순으로 정확히 1/N 배분한다. */
function splitEqually(total: number, memberIds: string[]): PoolMemberShare[] {
  const ids = [...memberIds].sort((a, b) => a.localeCompare(b));
  const each = Math.floor(total / ids.length);
  const left = total % ids.length;
  return ids.map((memberId, index) => ({ memberId, amount: each + (index < left ? 1 : 0) }));
}

export function calculateRevenueShare(input: RevenueShareInput): RevenueShareResult {
  const issues = validateRevenueShareInput(input);
  if (issues.length > 0) throw new RevenueShareValidationError(issues);

  const baseMemberIds = input.baseMemberIds.map(cleanId).sort((a, b) => a.localeCompare(b));
  const contributionProfit = Math.max(0, input.grossAmount - input.directCosts);
  const deficitAmount = Math.max(0, input.directCosts - input.grossAmount);
  const activePools = input.pools
    .filter((pool) => pool.active)
    .map((pool) => ({
      ...pool,
      id: cleanId(pool.id),
      memberIds: pool.memberIds.map(cleanId).sort((a, b) => a.localeCompare(b)),
      mode: pool.fixedAmount === undefined ? ('rate' as const) : ('fixed' as const),
      units: pool.fixedAmount === undefined ? rateUnits(pool.ratePercent!) : 0,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const totalRateUnits = activePools.reduce((sum, pool) => sum + pool.units, 0);
  const poolAmount = (pool: (typeof activePools)[number]): number =>
    pool.mode === 'fixed'
      ? pool.fixedAmount!
      : Number((BigInt(contributionProfit) * BigInt(pool.units)) / QUOTA_DENOMINATOR);
  const actualPoolTotal = activePools.reduce((sum, pool) => sum + poolAmount(pool), 0);
  // 각 성과 풀을 먼저 정수 원으로 확정하고, 비율에서 남은 1원까지 전부 기본 풀로 보낸다.
  const baseAmount = contributionProfit - actualPoolTotal;
  const baseShares = splitEqually(baseAmount, baseMemberIds);
  const memberMap = new Map<string, MemberRevenueShare>(
    baseShares.map((share) => [
      share.memberId,
      { memberId: share.memberId, baseAmount: share.amount, poolAmounts: {}, totalAmount: share.amount },
    ]),
  );

  const pools: RevenuePoolAllocation[] = activePools.map((pool) => {
    const amount = poolAmount(pool);
    const memberShares = splitEqually(amount, pool.memberIds);
    for (const share of memberShares) {
      const member = memberMap.get(share.memberId)!;
      member.poolAmounts[pool.id] = share.amount;
      member.totalAmount += share.amount;
    }
    return {
      id: pool.id,
      kind: pool.kind,
      label: pool.label,
      mode: pool.mode,
      ratePercent: pool.mode === 'rate' ? pool.units / RATE_SCALE : undefined,
      fixedAmount: pool.mode === 'fixed' ? pool.fixedAmount : undefined,
      amount,
      effectiveRate: contributionProfit > 0 ? (amount / contributionProfit) * 100 : 0,
      memberShares,
    };
  });

  const members = [...memberMap.values()].sort((a, b) => a.memberId.localeCompare(b.memberId));
  const totalDistributed = members.reduce((sum, member) => sum + member.totalAmount, 0);

  return {
    grossAmount: input.grossAmount,
    directCosts: input.directCosts,
    contributionProfit,
    deficitAmount,
    hasLoss: deficitAmount > 0,
    totalRatePercent: totalRateUnits / RATE_SCALE,
    totalEffectiveRate: contributionProfit > 0 ? (actualPoolTotal / contributionProfit) * 100 : 0,
    baseRatePercent: contributionProfit > 0 ? (baseAmount / contributionProfit) * 100 : 0,
    baseAmount,
    pools,
    members,
    totalDistributed,
  };
}

interface IncentiveTier {
  /** 이 구간까지의 누적 상한. null이면 그 위 전부. */
  upTo: number | null;
  ratePercent: number;
}

const SALES_TIERS: readonly IncentiveTier[] = [
  { upTo: 3_000_000, ratePercent: 15 },
  { upTo: 10_000_000, ratePercent: 10 },
  { upTo: 30_000_000, ratePercent: 7 },
  { upTo: null, ratePercent: 5 },
];

const PROPOSAL_TIERS: readonly IncentiveTier[] = [
  { upTo: 3_000_000, ratePercent: 10 },
  { upTo: 10_000_000, ratePercent: 7 },
  { upTo: 30_000_000, ratePercent: 5 },
  { upTo: null, ratePercent: 3 },
];

function recommendProgressiveIncentive(
  contributionProfit: number,
  tiers: readonly IncentiveTier[],
): IncentiveRecommendation {
  if (!Number.isSafeInteger(contributionProfit) || contributionProfit < 0) {
    throw new RevenueShareValidationError(['추천 기준 금액은 0 이상의 정수 원이어야 해요.']);
  }
  if (contributionProfit === 0) return { amount: 0, effectiveRate: 0 };

  let previous = 0;
  let numerator = BigInt(0);
  for (const tier of tiers) {
    const end = tier.upTo == null ? contributionProfit : Math.min(contributionProfit, tier.upTo);
    const width = Math.max(0, end - previous);
    numerator += BigInt(width) * BigInt(tier.ratePercent);
    previous = end;
    if (previous >= contributionProfit) break;
  }

  // percent 분모 100. 합산한 뒤 마지막 1원 미만만 버린다.
  const amount = Number(numerator / BigInt(100));
  return { amount, effectiveRate: (amount / contributionProfit) * 100 };
}

/**
 * 영업 성과 추천: 첫 300만원 15% + 다음 700만원 10% +
 * 다음 2,000만원 7% + 3,000만원 초과분 5%.
 */
export function recommendSalesIncentive(contributionProfit: number): IncentiveRecommendation {
  return recommendProgressiveIncentive(contributionProfit, SALES_TIERS);
}

/**
 * 제안서 성과 추천: 첫 300만원 10% + 다음 700만원 7% +
 * 다음 2,000만원 5% + 3,000만원 초과분 3%.
 */
export function recommendProposalIncentive(contributionProfit: number): IncentiveRecommendation {
  return recommendProgressiveIncentive(contributionProfit, PROPOSAL_TIERS);
}
