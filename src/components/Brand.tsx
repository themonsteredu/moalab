/**
 * 모아킷 심볼 (M 마크).
 * 원본 로고 PNG 에서 검정 배경만 알파로 빼낸 것 — 밝은 배경·어두운 배경 양쪽에서 쓴다.
 * (전체 로고 moakit-logo.png 는 흰 'moa' 가 있어서 어두운 배경에서만 쓸 수 있다)
 * 다시 만들 땐 scripts/make-icons.mjs
 */
export function BrandMark({ size = 56 }: { size?: number }) {
  // 원본 심볼 비율 431 x 273
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/moakit-symbol.png"
      alt=""
      aria-hidden
      width={size}
      height={Math.round((size * 273) / 431)}
      style={{ width: size, height: 'auto' }}
      className="shrink-0 select-none"
    />
  );
}

/**
 * 로고 (심볼 + moakit 워드마크). **어두운 배경에서만** — 'moa' 가 흰색이다.
 *
 * `tagline` 을 켜면 'EMPOWER LEARNING…' 까지 들어간다. 150px 아래로 내려가면
 * 태그라인 글씨가 뭉개져서 기본값은 끈 상태다.
 */
export function BrandLogo({ width = 150, tagline = false }: { width?: number; tagline?: boolean }) {
  const ratio = tagline ? 557 / 1017 : 498 / 1017;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={tagline ? '/moakit-logo.png' : '/moakit-mark.png'}
      alt="모아킷"
      width={width}
      height={Math.round(width * ratio)}
      style={{ width, height: 'auto' }}
      className="shrink-0 select-none"
    />
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
                  ${avatarColor(name, index)} ${ring ? 'ring-4 ring-neutral-300/70' : ''}`}
    >
      {name.slice(0, 1)}
    </span>
  );
}
