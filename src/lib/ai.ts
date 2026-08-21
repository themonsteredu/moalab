/**
 * 말로 업무 넣기에 쓸 AI 모델.
 *
 * 이 일(한국어 지시 → 업무 목록)은 어려운 축이 아니라서 **가장 싼 것으로도 충분하다.**
 * 그래도 고르는 건 원장 몫이라 화면에서 바꿀 수 있게 해뒀다 (`관리 > AI 키`).
 *
 * 값은 `moalab.app_secrets.model` 에 키와 함께 저장된다.
 * 모르는 값이 들어와도 `resolveModel()` 이 기본값으로 되돌린다 —
 * 모델 이름이 바뀌어도 화면이 죽지 않게.
 */

export interface AiModel {
  value: string;
  label: string;
  /** 한 번 말할 때 대략 얼마 (입력 1천 · 출력 3백 토큰 기준, 1달러 1,450원) */
  cost: string;
  hint: string;
}

export const AI_MODELS: AiModel[] = [
  {
    value: 'claude-haiku-4-5',
    label: '빠르고 싼 것',
    cost: '한 번에 약 4원',
    hint: '말을 업무로 쪼개는 정도는 이걸로 충분해요.',
  },
  {
    value: 'claude-sonnet-5',
    label: '중간',
    cost: '한 번에 약 11원',
    hint: '말이 길고 복잡하게 얽힐 때 조금 더 잘 알아들어요.',
  },
  {
    value: 'claude-opus-5',
    label: '가장 똑똑한 것',
    cost: '한 번에 약 18원',
    hint: '가장 정확하지만, 이 용도로는 과해요.',
  },
];

/** 안 고르면 이것 */
export const AI_MODEL_DEFAULT = 'claude-opus-5';

/** 저장된 값이 지금 목록에 없으면 기본값으로 되돌린다 */
export function resolveModel(v: string | null | undefined): string {
  return AI_MODELS.some((m) => m.value === v) ? (v as string) : AI_MODEL_DEFAULT;
}

export function modelLabel(v: string | null | undefined): string {
  return AI_MODELS.find((m) => m.value === resolveModel(v))?.label ?? '기본';
}
