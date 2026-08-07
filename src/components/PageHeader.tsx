'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

export function PageHeader({
  title,
  subtitle,
  back,
  right,
}: {
  title: string;
  subtitle?: string;
  /** true = 뒤로가기, 문자열 = 그 경로로 이동 */
  back?: boolean | string;
  right?: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-30 border-b border-neutral-200 bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-2.5">
        {back &&
          (typeof back === 'string' ? (
            <Link href={back} aria-label="뒤로" className="tap -ml-2 w-9 shrink-0 text-neutral-500">
              ‹
            </Link>
          ) : (
            <button
              onClick={() => router.back()}
              aria-label="뒤로"
              className="tap -ml-2 w-9 shrink-0 text-2xl leading-none text-neutral-500"
            >
              ‹
            </button>
          ))}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-bold leading-tight">{title}</h1>
          {subtitle && <p className="truncate text-[12px] text-neutral-500">{subtitle}</p>}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
    </header>
  );
}
