import { isOpenFinding, type AppStatus, type Finding } from './types';

export const STATUS_META: Record<AppStatus, { label: string; chip: string; dot: string }> = {
  done: { label: '검증 완료', chip: 'bg-green-100 text-green-800', dot: 'bg-green-500' },
  fixing: { label: '수정 필요', chip: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  // 지적 답변의 '다시확인' 과 같은 amber 로 맞춘다 (같은 것을 가리키니 색도 같아야 한다)
  recheck: { label: '다시확인', chip: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500' },
  pending: { label: '진행 중', chip: 'bg-neutral-200 text-neutral-700', dot: 'bg-neutral-400' },
};

/**
 * 앱 상태는 사람이 고르지 않는다. 현재 라운드의 지적 + 검증 완료 표시로만 결정된다.
 *
 *  - 답 안 한 지적(`open`)이 하나라도 있으면      → fixing  수정 필요   (제작자 차례)
 *  - `fixed`·`recheck` 만 남았으면                → recheck 다시확인   (검증자 차례)
 *  - 지적 0건 + 검증자 전원이 '검증 완료'         → done
 *  - 그 외                                        → pending
 *
 * **fixing 과 recheck 를 갈라놓는 이유**: 둘 다 "안 닫힌 지적이 있다" 는 같지만
 * 다음에 움직여야 할 사람이 다르다. 한 덩어리로 두면 목록에서 전부 '수정 필요' 로
 * 보여서, 이미 고쳐놓고 확인만 기다리는 것과 아직 손도 안 댄 것이 구분되지 않았다.
 *
 * 지적이 없다고 바로 done 이 되면 "아무도 안 봤다" 와 "다 봤는데 문제없다" 가
 * 구분되지 않는다. 그래서 검증자의 명시적인 '검증 완료' 를 요구한다.
 */
export function computeStatus(
  findings: Pick<Finding, 'status'>[],
  reviewerCount: number,
  signedCount: number,
): AppStatus {
  const alive = findings.filter((f) => isOpenFinding(f.status));
  if (alive.some((f) => f.status === 'open')) return 'fixing';
  if (alive.length > 0) return 'recheck';
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
