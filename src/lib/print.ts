/**
 * 인쇄 / PDF 저장에 넣을 묶음.
 *
 * PDF 라이브러리를 쓰지 않고 **브라우저 인쇄**를 그대로 쓴다.
 * 아이폰은 사파리 공유 → 프린트 → 'PDF로 저장', PC 는 인쇄 대화상자에서 저장한다.
 * 라이브러리로 그리면 한글 폰트를 따로 심어야 하고 표가 깨진다.
 *
 * (Next.js page 파일에서는 이런 상수를 export 할 수 없어서 따로 뺐다)
 */
export const PRINT_PARTS = [
  { key: 'verify', label: '검증 (지적·답변)' },
  // 한글 양식 그대로의 A4 한 장. 늘 새 쪽에서 시작한다
  { key: 'plan', label: '강의계획서 (양식 그대로)' },
  { key: 'planfile', label: '문서 첨부 목록' },
  { key: 'cost', label: '원가표' },
  { key: 'sample', label: '샘플 이미지' },
  { key: 'photo', label: '수업 사진' },
] as const;

export type PrintPart = (typeof PRINT_PARTS)[number]['key'];

/** 순서와 이름이 실제 인쇄물 순서와 같다 */
export function parsePrintParts(raw: string | null): Set<PrintPart> {
  if (!raw) return new Set(PRINT_PARTS.map((p) => p.key));
  const keys = raw.split(',').filter((k): k is PrintPart => PRINT_PARTS.some((p) => p.key === k));
  return new Set(keys);
}
