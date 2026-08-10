'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/lib/session';
import { Avatar, BrandLogo } from '@/components/Brand';
import { Icon, type IconName } from '@/components/Icon';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** 원장만 보이는 메뉴 */
  admin?: boolean;
}

/**
 * 왼쪽 메뉴 = 일하는 순서.
 * 공지 → 계획 → 검증 → 모의수업 → 강사양성 이 한 프로그램이 학교에 나가기까지의 흐름이다.
 * 원가·갤러리·일정은 그 흐름에 딸린 '자료'라서 아래로 내렸다.
 */
export const WORK_NAV: NavItem[] = [
  { href: '/home', label: '홈', icon: 'grid' },
  { href: '/notice', label: '공지사항', icon: 'megaphone' },
  { href: '/apps', label: '프로그램계획', icon: 'doc' },
  { href: '/verify', label: '프로그램검증', icon: 'checkCircle' },
  { href: '/mock', label: '모의수업', icon: 'present' },
  { href: '/training', label: '강사양성', icon: 'cap' },
];

export const RESOURCE_NAV: NavItem[] = [
  { href: '/cost', label: '원가', icon: 'won' },
  // 원가(계획) 바로 아래에 지출(실제)을 둔다 — 돈 얘기는 붙어 있어야 비교가 된다
  { href: '/expense', label: '지출결의서', icon: 'receipt' },
  { href: '/gallery', label: '갤러리', icon: 'image' },
  { href: '/schedule', label: '일정', icon: 'calendar' },
  { href: '/admin', label: '관리', icon: 'users', admin: true },
];

/** 폰 하단에 고정으로 두는 4개. 나머지는 '더보기' 안에 넣는다 */
const PHONE_TABS: NavItem[] = [
  { href: '/home', label: '홈', icon: 'grid' },
  { href: '/notice', label: '공지', icon: 'megaphone' },
  { href: '/apps', label: '프로그램', icon: 'doc' },
  { href: '/verify', label: '검증', icon: 'checkCircle' },
];

const MORE_HREFS = ['/mock', '/training', '/cost', '/expense', '/gallery', '/schedule', '/admin'];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + '/');
}

function useVisible(items: NavItem[]) {
  const { isAdmin } = useSession();
  return items.filter((t) => !t.admin || isAdmin);
}

/** 폰 — 하단 탭 4개 + 더보기 */
export function BottomNav() {
  const pathname = usePathname();
  const { isAdmin } = useSession();
  const [moreOpen, setMoreOpen] = useState(false);

  const more = [...WORK_NAV, ...RESOURCE_NAV].filter(
    (t) => MORE_HREFS.includes(t.href) && (!t.admin || isAdmin),
  );
  const moreActive = more.some((t) => isActive(pathname, t.href));

  // 화면을 옮기면 시트는 닫는다
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMoreOpen(false)}>
          <div
            className="absolute inset-x-0 bottom-[56px] rounded-t-2xl border-t border-neutral-200 bg-surface p-3 safe-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-3 gap-2">
              {more.map((t) => {
                const active = isActive(pathname, t.href);
                return (
                  <Link
                    key={t.href}
                    href={t.href}
                    className={`flex min-h-[74px] flex-col items-center justify-center gap-1.5 rounded-xl border transition ${
                      active
                        ? 'border-brand bg-brand-50 text-brand-700'
                        : 'border-neutral-200 bg-surface text-neutral-600'
                    }`}
                  >
                    <Icon name={t.icon} size={20} />
                    <span className="text-[12px] font-bold">{t.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-surface/95 backdrop-blur safe-bottom lg:hidden"
        aria-label="주요 메뉴"
      >
        <div className="mx-auto flex max-w-3xl">
          {PHONE_TABS.map((t) => {
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
          <button
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 pt-1 transition ${
              moreActive || moreOpen ? 'text-brand' : 'text-neutral-400'
            }`}
          >
            <Icon name="dots" size={19} strokeWidth={moreActive ? 2.2 : 1.8} />
            <span className="text-[10.5px] font-bold">더보기</span>
          </button>
        </div>
      </nav>
    </>
  );
}

/** PC — 왼쪽 사이드바 */
export function SideNav() {
  const pathname = usePathname();
  const work = useVisible(WORK_NAV);
  const resource = useVisible(RESOURCE_NAV);
  const { session, signOut } = useSession();

  const link = (t: NavItem) => {
    const active = isActive(pathname, t.href);
    return (
      <Link
        key={t.href}
        href={t.href}
        aria-current={active ? 'page' : undefined}
        className={`flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] font-bold transition ${
          active
            ? 'bg-brand text-white shadow-[0_8px_20px_-10px_rgba(242,101,34,.9)]'
            : 'text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-bright'
        }`}
      >
        <Icon name={t.icon} size={17} strokeWidth={active ? 2.2 : 1.8} />
        {t.label}
      </Link>
    );
  };

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 hidden w-[232px] flex-col overflow-y-auto border-r border-sidebar-line bg-sidebar px-4 py-5 lg:flex"
      aria-label="주요 메뉴"
    >
      {/* 사이드바는 어두워서 전체 로고를 그대로 쓸 수 있다 */}
      <Link href="/home" className="mb-6 block px-1">
        <BrandLogo width={132} />
        <span className="mt-1.5 block text-[12px] font-bold tracking-wide text-sidebar-text">
          모아랩 업무
        </span>
      </Link>

      <nav className="flex flex-1 flex-col gap-1">
        {work.map(link)}

        <p className="mb-1 mt-5 px-3 text-[10.5px] font-bold tracking-wide text-sidebar-text/70">자료</p>
        {resource.map(link)}
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
