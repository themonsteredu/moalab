/** 모아랩 마크 — 브랜드 컬러 라운드 사각형 + '모' */
export function BrandMark({ size = 56 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.52, borderRadius: size * 0.28 }}
      className="inline-flex shrink-0 items-center justify-center bg-brand font-black leading-none text-white
                 shadow-[0_8px_22px_-6px_rgba(242,101,34,.65)]"
    >
      모
    </span>
  );
}

/** 이름 첫 글자 아바타. 이름마다 색이 고정된다. */
const AVATAR_COLORS = [
  'bg-[#F26522]',
  'bg-[#2E7DD1]',
  'bg-[#12A67A]',
  'bg-[#A855F7]',
  'bg-[#E0397A]',
  'bg-[#0EA5B7]',
  'bg-[#C2801B]',
];

/**
 * 색 고르기.
 * 멤버 목록에서 쓸 때는 index 를 넘긴다 — 7명 이하면 전원 다른 색이 보장된다.
 * (이름 해시는 '이서은'/'원장' 처럼 충돌이 잦아 같은 색이 여러 명 나온다)
 * index 가 없으면 이름 해시로 떨어진다.
 */
export function avatarColor(name: string, index?: number): string {
  if (index != null) return AVATAR_COLORS[index % AVATAR_COLORS.length];
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function Avatar({
  name,
  index,
  size = 44,
  ring = false,
}: {
  name: string;
  index?: number;
  size?: number;
  ring?: boolean;
}) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold leading-none text-white
                  ${avatarColor(name, index)} ${ring ? 'ring-4 ring-white/70' : ''}`}
    >
      {name.slice(0, 1)}
    </span>
  );
}
