import type { GrantStatus } from './types';

export const GRANT_STEPS: GrantStatus[] = [
  'discovered',
  'concept_shared',
  'writing',
  'submitted',
  'selected',
];

export const GRANT_STATUS: Record<GrantStatus, { label: string; chip: string }> = {
  discovered: { label: '공고 검토', chip: 'bg-neutral-100 text-neutral-700' },
  concept_shared: { label: '기획 공유', chip: 'bg-violet-100 text-violet-800' },
  writing: { label: '작성 중', chip: 'bg-blue-100 text-blue-800' },
  submitted: { label: '제출 완료', chip: 'bg-amber-100 text-amber-800' },
  selected: { label: '선정', chip: 'bg-green-100 text-green-800' },
  not_selected: { label: '미선정', chip: 'bg-red-100 text-red-700' },
  paused: { label: '보류', chip: 'bg-neutral-200 text-neutral-600' },
};

export function grantProgress(status: GrantStatus) {
  if (status === 'not_selected' || status === 'paused') return 100;
  const at = GRANT_STEPS.indexOf(status);
  return at < 0 ? 0 : Math.round(((at + 1) / GRANT_STEPS.length) * 100);
}

export function daysUntil(date: string | null, now = new Date()) {
  if (!date) return null;
  const end = new Date(`${date}T23:59:59`);
  return Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
}

/** 아이템과 핵심 내용이 있어야 '기획안 제출'로 본다. */
export function isGrantConceptReady(itemName: string | null, conceptSummary: string | null) {
  return Boolean(itemName?.trim() && conceptSummary?.trim());
}
