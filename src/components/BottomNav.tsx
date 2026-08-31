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
  /**
   * **아직 안 쓰는 것.** 화면은 만들어뒀지만 내용이 아직 없는 메뉴다
   * (모의수업·강사양성은 뼈대만, 갤러리는 앨범 0건).
   *
   * 지우지는 않는다 — 지우면 첫 한 건을 넣을 방법이 없어진다.
   * 대신 아래 묶음으로 내려서, 매일 쓰는 메뉴가 이것들에 밀리지 않게 한다.
   * 쓰기 시작하면 이 표시만 떼면 제자리로 올라온다.
   */
  quiet?: boolean;
}

/**
 * 왼쪽 메뉴 = 일하는 순서.
 * 공지 → 계획 → 검증 → 모의수업 → 강사양성 이 한 프로그램이 학교에 나가기까지의 흐름이다.
 * 그 끝에 역할분장 — 누가 무엇을 책임지는지의 틀이다.
 * 원가·갤러리·일정은 그 흐름에 딸린 '자료'라서 아래로 내렸다.
 */
export const WORK_NAV: NavItem[] = [
  { href: '/home', label: '홈', icon: 'grid' },
  { href: '/notice', label: '공지사항', icon: 'megaphone' },
  // 업무는 공지 바로 다음이다 — 알린 다음에 누가 무엇을 언제까지 할지가 정해진다
  { href: '/task', label: '업무', icon: 'list' },
  // 부서협업은 업무 바로 다음이다 — 업무가 '사람에게 나누는 것' 이면
  // 이건 '부서끼리 주고받는 것' 이라 같은 갈래의 한 칸 위다
  { href: '/collab', label: '부서협업', icon: 'users' },
  // 대화는 부서협업 바로 아래다 — 협업 요청이 '기록으로 남기는 것' 이면
  // 대화는 '그 자리에서 주고받는 것' 이라 같은 갈래의 짝이다
  { href: '/chat', label: '대화', icon: 'megaphone' },
  { href: '/apps', label: '프로그램계획', icon: 'doc' },
  { href: '/verify', label: '프로그램검증', icon: 'checkCircle' },
  { href: '/mock', label: '모의수업', icon: 'present', quiet: true },
  { href: '/training', label: '강사양성', icon: 'cap', quiet: true },
  // 역할분장은 강사양성 옆이다 — 둘 다 '사람' 쪽 일이고,
  // 한 번 정하면 오래 가는 화면이라 자주 쓰는 메뉴를 밀어내지 않는다
  { href: '/roles', label: '역할분장', icon: 'target' },
];

export const RESOURCE_NAV: NavItem[] = [
  { href: '/cost', label: '원가', icon: 'won' },
  { href: '/revenue', label: '수익배분', icon: 'won' },
  // 원가(계획) 바로 아래에 지출(실제)을 둔다 — 돈 얘기는 붙어 있어야 비교가 된다
  { href: '/expense', label: '지출결의서', icon: 'receipt' },
  { href: '/gallery', label: '갤러리', icon: 'image', quiet: true },
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

// 폰 하단 탭은 4개를 유지한다 — 5개로 늘리면 375px 에서 라벨이 뭉개진다.
// 업무는 일단 더보기에 두고, 홈에서 자기 업무가 다 보이게 한다.
const MORE_HREFS = [
  '/task',
  '/collab',
  '/chat',
  '/mock',
  '/training',
  '/roles',
  '/cost',
  '/revenue',
  '/expense',
  '/gallery',
  '/schedule',
  '/admin',
];

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

  const moreTile = (t: NavItem) => {
    const active = isActive(pathname, t.href);
    return (
      <Link
        key={t.href}
        href={t.href}
        className={`flex min-h-[74px] flex-col items-center justify-center gap-1.5 rounded-xl border transition ${
          active ? 'border-brand bg-brand-50 text-brand-700' : 'border-neutral-200 bg-surface text-neutral-600'
        }`}
      >
        <Icon name={t.icon} size={20} />
        <span className="text-[12px] font-bold">{t.label}</span>
      </Link>
    );
  };

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMoreOpen(false)}>
          <div
            className="absolute inset-x-0 bottom-[56px] rounded-t-2xl border-t border-neutral-200 bg-surface p-3 safe-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 쓰는 것 먼저, 아직 안 쓰는 것(모의수업·강사양성·갤러리)은 아래로.
                섞어두면 매일 쓰는 업무·지출이 빈 화면들 사이에 파묻힌다 */}
            <div className="grid grid-cols-3 gap-2">{more.filter((t) => !t.quiet).map(moreTile)}</div>
            {more.some((t) => t.quiet) && (
              <>
                <p className="mb-1.5 mt-3 px-1 text-[11px] font-bold text-neutral-400">아직 안 쓰는 것</p>
                <div className="grid grid-cols-3 gap-2 opacity-60">
                  {more.filter((t) => t.quiet).map(moreTile)}
                </div>
              </>
            )}
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
  const quiet = [...work, ...resource].filter((t) => t.quiet);
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
        {work.filter((t) => !t.quiet).map(link)}

        <p className="mb-1 mt-5 px-3 text-[10.5px] font-bold tracking-wide text-sidebar-text/70">자료</p>
        {resource.filter((t) => !t.quiet).map(link)}

        {/* 아직 내용이 없는 메뉴는 맨 아래로. 지우지 않는 이유는 NavItem.quiet 주석에 */}
        {quiet.length > 0 && (
          <>
            <p className="mb-1 mt-5 px-3 text-[10.5px] font-bold tracking-wide text-sidebar-text/50">
              아직 안 쓰는 것
            </p>
            <span className="opacity-60">{quiet.map(link)}</span>
          </>
        )}
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
