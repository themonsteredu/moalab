import { isOpenFinding, type AppStatus, type Finding } from './types';

export const STATUS_META: Record<AppStatus, { label: string; chip: string; dot: string }> = {
  done: { label: '검증 완료', chip: 'bg-green-100 text-green-800', dot: 'bg-green-500' },
  fixing: { label: '수정 필요', chip: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  pending: { label: '진행 중', chip: 'bg-neutral-200 text-neutral-700', dot: 'bg-neutral-400' },
};

/**
 * 앱 상태는 사람이 고르지 않는다. 현재 라운드의 지적 + 검증 완료 표시로만 결정된다.
 *  - 안 닫힌 지적이 하나라도 있으면          → fixing 수정 필요
 *  - 지적 0건 + 검증자 전원이 '검증 완료'    → done
 *  - 그 외                                   → pending
 *
 * 지적이 없다고 바로 done 이 되면 "아무도 안 봤다" 와 "다 봤는데 문제없다" 가
 * 구분되지 않는다. 그래서 검증자의 명시적인 '검증 완료' 를 요구한다.
 */
export function computeStatus(
  findings: Pick<Finding, 'status'>[],
  reviewerCount: number,
  signedCount: number,
): AppStatus {
  if (findings.some((f) => isOpenFinding(f.status))) return 'fixing';
  if (reviewerCount === 0) return 'pending';
  return signedCount >= reviewerCount ? 'done' : 'pending';
}

/** 진행률 0~100 — 검증자 중 몇 명이 '검증 완료' 를 눌렀나 */
export function roundProgress(reviewerCount: number, signedCount: number): number {
  if (reviewerCount === 0) return 0;
  return Math.min(100, Math.round((signedCount / reviewerCount) * 100));
}

/** 안 닫힌 지적만 */
export function openFindings<T extends Pick<Finding, 'status'>>(findings: T[]): T[] {
  return findings.filter((f) => isOpenFinding(f.status));
}
