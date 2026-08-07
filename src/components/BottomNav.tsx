'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/lib/session';

const TABS = [
  { href: '/home', label: '홈', icon: HomeIcon },
  { href: '/apps', label: '검증', icon: CheckIcon },
  { href: '/cost', label: '원가', icon: WonIcon },
  { href: '/gallery', label: '갤러리', icon: PhotoIcon },
  { href: '/schedule', label: '일정', icon: CalendarIcon },
];

const ADMIN_TAB = { href: '/admin', label: '관리', icon: GearIcon };

export function BottomNav() {
  const pathname = usePathname();
  const { isAdmin } = useSession();
  const tabs = isAdmin ? [...TABS, ADMIN_TAB] : TABS;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white/95 backdrop-blur safe-bottom"
      aria-label="주요 메뉴"
    >
      <div className="mx-auto flex max-w-3xl">
        {tabs.map((t) => {
          const active = pathname === t.href || pathname.startsWith(t.href + '/');
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 pt-1 transition ${
                active ? 'text-brand' : 'text-neutral-400'
              }`}
            >
              <Icon active={active} />
              <span className="text-[10.5px] font-bold">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/* --------------------------------------------------------------- 아이콘 (인라인 SVG) */

type IconProps = { active?: boolean };
const base = 'h-[21px] w-[21px]';
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

function HomeIcon({ active }: IconProps) {
  return (
    <svg className={base} viewBox="0 0 24 24" aria-hidden>
      <path {...stroke} fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.13 : 0} d="M3 10.5 12 3.5l9 7V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
    </svg>
  );
}
function CheckIcon({ active }: IconProps) {
  return (
    <svg className={base} viewBox="0 0 24 24" aria-hidden>
      <rect {...stroke} fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.13 : 0} x="4" y="3" width="16" height="18" rx="2.5" />
      <path {...stroke} d="m8.5 12 2.3 2.3L16 9.2" />
    </svg>
  );
}
function WonIcon({ active }: IconProps) {
  return (
    <svg className={base} viewBox="0 0 24 24" aria-hidden>
      <circle {...stroke} fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.13 : 0} cx="12" cy="12" r="9" />
      <path {...stroke} d="M7 9.5 9.4 15 12 10l2.6 5L17 9.5M6.4 11.7h11.2" />
    </svg>
  );
}
function PhotoIcon({ active }: IconProps) {
  return (
    <svg className={base} viewBox="0 0 24 24" aria-hidden>
      <rect {...stroke} fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.13 : 0} x="3" y="5" width="18" height="14" rx="2.5" />
      <path {...stroke} d="m4 16 4.2-4.2a1.6 1.6 0 0 1 2.2 0L15 16.4M14 13.5l1.6-1.6a1.6 1.6 0 0 1 2.2 0L20 14" />
      <circle cx="9" cy="9.5" r="1.3" fill="currentColor" />
    </svg>
  );
}
function CalendarIcon({ active }: IconProps) {
  return (
    <svg className={base} viewBox="0 0 24 24" aria-hidden>
      <rect {...stroke} fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.13 : 0} x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path {...stroke} d="M3.5 9.5h17M8 3.2v3.4M16 3.2v3.4" />
    </svg>
  );
}
function GearIcon({ active }: IconProps) {
  return (
    <svg className={base} viewBox="0 0 24 24" aria-hidden>
      <circle {...stroke} cx="12" cy="12" r="3.1" fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.2 : 0} />
      <path {...stroke} d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" />
    </svg>
  );
}
