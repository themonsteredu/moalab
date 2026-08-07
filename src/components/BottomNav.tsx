'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/lib/session';
import { Avatar, BrandMark } from '@/components/Brand';
import { Icon, type IconName } from '@/components/Icon';

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: '/home', label: '홈', icon: 'grid' },
  { href: '/apps', label: '프로그램', icon: 'checkCircle' },
  { href: '/cost', label: '원가', icon: 'won' },
  { href: '/gallery', label: '갤러리', icon: 'image' },
  { href: '/schedule', label: '일정', icon: 'calendar' },
];

const ADMIN_TAB: { href: string; label: string; icon: IconName } = {
  href: '/admin',
  label: '관리',
  icon: 'users',
};

function useTabs() {
  const { isAdmin } = useSession();
  return isAdmin ? [...TABS, ADMIN_TAB] : TABS;
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + '/');
}

/** 폰 — 하단 탭 */
export function BottomNav() {
  const pathname = usePathname();
  const tabs = useTabs();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-surface/95 backdrop-blur safe-bottom lg:hidden"
      aria-label="주요 메뉴"
    >
      <div className="mx-auto flex max-w-3xl">
        {tabs.map((t) => {
          const active = isActive(pathname, t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 pt-1 transition ${
                active ? 'text-brand' : 'text-neutral-400'
              }`}
            >
              <Icon name={t.icon} size={19} strokeWidth={active ? 2.2 : 1.8} />
              <span className="text-[10.5px] font-bold">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** PC — 왼쪽 사이드바 */
export function SideNav() {
  const pathname = usePathname();
  const tabs = useTabs();
  const { session, signOut } = useSession();

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 hidden w-[232px] flex-col border-r border-sidebar-line bg-sidebar px-4 py-5 lg:flex"
      aria-label="주요 메뉴"
    >
      <Link href="/home" className="mb-7 flex items-center gap-2.5 px-1">
        <BrandMark size={34} />
        <span className="text-[19px] font-black tracking-tight text-sidebar-bright">모아랩</span>
      </Link>

      <nav className="flex flex-1 flex-col gap-1">
        {tabs.map((t) => {
          const active = isActive(pathname, t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={`flex h-11 items-center gap-3 rounded-xl px-3 text-[14.5px] font-bold transition ${
                active
                  ? 'bg-brand text-white shadow-[0_8px_20px_-10px_rgba(242,101,34,.9)]'
                  : 'text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-bright'
              }`}
            >
              <Icon name={t.icon} size={18} strokeWidth={active ? 2.2 : 1.8} />
              {t.label}
            </Link>
          );
        })}
      </nav>

      {session && (
        <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-sidebar-hover px-3 py-2.5">
          <Avatar name={session.name} size={30} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold text-sidebar-bright">{session.name}</p>
            <p className="text-[11px] text-sidebar-text">{session.role === 'admin' ? '원장' : '강사'}</p>
          </div>
          <button
            onClick={signOut}
            aria-label="로그아웃"
            className="shrink-0 text-sidebar-text transition hover:text-sidebar-bright"
          >
            <Icon name="external" size={15} />
          </button>
        </div>
      )}
    </aside>
  );
}
