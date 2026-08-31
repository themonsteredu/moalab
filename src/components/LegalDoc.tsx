import Link from 'next/link';

/**
 * 개인정보처리방침·서비스약관 두 장이 함께 쓰는 조각.
 *
 * **page.tsx 안에 두면 안 된다** — Next.js 는 page 파일에서 컴포넌트 외의 export 를
 * 허용하지 않는다 (`src/lib/print.ts` 를 따로 뺀 것과 같은 이유).
 *
 * 이 두 장은 **로그인 없이 보여야 한다.** 구글이 OAuth 게시 심사에서 사람 없이
 * 열어보기 때문에, `(app)` 레이아웃 밖에 두고 가드를 붙이지 않았다.
 */

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="mb-2 text-[16px] font-bold">{title}</h2>
      <div className="text-[14px] leading-relaxed text-neutral-700">{children}</div>
    </section>
  );
}

export function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  );
}

export function LegalHeader({ title }: { title: string }) {
  return (
    <>
      <h1 className="text-[24px] font-black leading-tight">{title}</h1>
      <p className="mt-1.5 text-[13px] text-neutral-500">
        모아랩 업무 워크스페이스 · 마지막 수정 2026년 8월 31일
      </p>
    </>
  );
}

export function Foot() {
  return (
    <footer className="mt-10 border-t border-neutral-200 pt-4 text-[13px] text-neutral-400">
      <Link href="/" className="font-bold text-neutral-500 underline">
        모아랩 업무
      </Link>
      {' · '}
      <Link href="/privacy" className="underline">
        개인정보처리방침
      </Link>
      {' · '}
      <Link href="/terms" className="underline">
        서비스 약관
      </Link>
    </footer>
  );
}
