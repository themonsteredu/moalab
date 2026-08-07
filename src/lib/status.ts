import type { AppStatus, CheckRow } from './types';
import { CHECK_ITEM_COUNT } from './types';

export const STATUS_META: Record<AppStatus, { label: string; chip: string; dot: string }> = {
  done: { label: '검증 완료', chip: 'bg-green-100 text-green-800', dot: 'bg-green-500' },
  fixing: { label: '수정 필요', chip: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  pending: { label: '진행 중', chip: 'bg-neutral-200 text-neutral-700', dot: 'bg-neutral-400' },
};

/**
 * 앱 상태는 사람이 고르지 않는다. 현재 라운드의 체크 결과로만 결정된다.
 *  - 검증자 전원 × 5항목 전부 pass → done
 *  - 하나라도 fail                → fixing
 *  - 그 외                        → pending
 */
export function computeStatus(checks: Pick<CheckRow, 'result'>[], reviewerCount: number): AppStatus {
  if (checks.some((c) => c.result === 'fail')) return 'fixing';
  if (reviewerCount === 0) return 'pending';
  const need = reviewerCount * CHECK_ITEM_COUNT;
  const passed = checks.filter((c) => c.result === 'pass').length;
  return passed >= need ? 'done' : 'pending';
}

/** 진행률 0~100 (현재 라운드 기준, pass 한 칸 수 / 전체 칸 수) */
export function roundProgress(checks: Pick<CheckRow, 'result'>[], reviewerCount: number): number {
  const need = reviewerCount * CHECK_ITEM_COUNT;
  if (need === 0) return 0;
  const passed = checks.filter((c) => c.result === 'pass').length;
  return Math.min(100, Math.round((passed / need) * 100));
}
