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

export interface NavGroup {
  /** 펼침 기억·키 용도 */
  key: string;
  /** 사이드바·더보기의 묶음 머리글 */
  label: string;
  items: NavItem[];
  /**
   * **아직 안 쓰는 것.** 화면은 만들어뒀지만 내용이 아직 없다
   * (모의수업·강사양성은 뼈대만, 갤러리는 앨범 0건).
   *
   * 지우지는 않는다 — 지우면 첫 한 건을 넣을 방법이 없어진다.
   * 대신 맨 아래 묶음으로 내려서, 매일 쓰는 메뉴가 이것들에 밀리지 않게 한다.
   * 쓰기 시작하면 이 묶음에서 꺼내 제자리로 올리면 된다.
   */
  quiet?: boolean;
}

/**
 * 메뉴 = **묶음 여섯.**
 *
 * 예전엔 열여섯 개가 묶음 없이 한 층에 나란히 있었다. 폰 더보기에서 열두 줄을
 * 훑어야 했고, 이름이 겹치는 짝(`업무`·`부서업무` / `부서업무`·`부서협업` /
 * 돈 셋)이 붙어 있어 375px 에서 앞 두 글자만 보고 헛짚기 일쑤였다.
 *
 * 묶는 축은 **누가 언제 쓰는가**다:
 * · `내 일` — 사람마다 매일 여는 곳. 강사는 사실상 여기만 본다
 * · `함께` — 전원이 주고받는 것 (알림·대화·부서 요청)
 * · `프로그램` — 한 프로그램이 학교에 나가기까지
 * · `조직과 돈` — 부서가 맡아서 하는 것
 * · `원장만` — 나눠주고 관리하는 쪽
 * · `아직 안 쓰는 것` — 데이터 0건
 *
 * 아이콘도 같이 정리했다 — `대화`와 `공지사항`이 둘 다 확성기였고
 * `관리`와 `부서협업`이 둘 다 사람이었다. 라벨이 뭉개지는 폰에서는
 * 아이콘이 유일한 단서라 겹치면 안 된다.
 */
export const NAV: NavGroup[] = [
  {
    key: 'me',
    label: '내 일',
    items: [
      { href: '/home', label: '홈', icon: 'grid' },
      { href: '/mywork', label: '내 업무', icon: 'list' },
    ],
  },
  {
    key: 'together',
    label: '함께',
    items: [
      { href: '/notice', label: '공지사항', icon: 'megaphone' },
      { href: '/chat', label: '대화', icon: 'comment' },
      { href: '/collab', label: '부서협업', icon: 'users' },
    ],
  },
  {
    key: 'program',
    label: '프로그램',
    items: [
      { href: '/apps', label: '프로그램계획', icon: 'doc' },
      { href: '/verify', label: '프로그램검증', icon: 'checkCircle' },
    ],
  },
  {
    key: 'org',
    label: '조직과 돈',
    items: [
      { href: '/roles', label: '부서업무', icon: 'target' },
      // 원가·수익배분·지출결의서는 `돈` 한 문 뒤에 있다. 표도 계산도 그대로 따로다
      { href: '/money', label: '돈', icon: 'won' },
      { href: '/schedule', label: '일정', icon: 'calendar' },
    ],
  },
  {
    key: 'boss',
    label: '원장만',
    items: [
      /* 강사에게 `업무` 는 이미 '내 것만' 보이는 화면이라 `내 업무` 와 겹쳤다.
         나눠주는 쪽(전체·사람별·나눠주기)만 남겨 이름을 `업무배분` 으로 옮겼다.
         주소는 `/task` 그대로다 — 바꾸면 링크와 지난 기록이 깨진다 */
      { href: '/task', label: '업무배분', icon: 'board', admin: true },
      { href: '/admin', label: '관리', icon: 'wrench', admin: true },
    ],
  },
  {
    key: 'quiet',
    label: '아직 안 쓰는 것',
    quiet: true,
    items: [
      { href: '/mock', label: '모의수업', icon: 'present' },
      { href: '/training', label: '강사양성', icon: 'cap' },
      { href: '/gallery', label: '갤러리', icon: 'image' },
    ],
  },
];

/** 모든 메뉴를 한 줄로 (묶음을 신경 안 쓰는 곳에서 쓴다) */
export const ALL_NAV: NavItem[] = NAV.flatMap((g) => g.items);

/**
 * 폰 하단에 고정으로 두는 4개. 나머지는 '더보기' 안에 넣는다.
 *
 * **5개로 늘리지 않는다** — 375px 에서 라벨이 뭉개진다.
 * `내 업무` 가 생기면서 `검증` 과 자리를 바꿨다. 검증은 하루에 몇 번 여는
 * 화면이지만 `내 업무` 는 강사가 하루 종일 여는 곳이다.
 */
const PHONE_TABS: NavItem[] = [
  { href: '/home', label: '홈', icon: 'grid' },
  { href: '/mywork', label: '내 업무', icon: 'list' },
  { href: '/notice', label: '공지', icon: 'megaphone' },
  { href: '/apps', label: '프로그램', icon: 'doc' },
];

const TAB_HREFS = new Set(PHONE_TABS.map((t) => t.href));

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + '/');
}

/** 원장 전용 메뉴를 걸러낸 묶음들 (빈 묶음은 아예 안 준다) */
function useGroups(only?: (t: NavItem) => boolean) {
  const { isAdmin } = useSession();
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((t) => (!t.admin || isAdmin) && (!only || only(t))),
  })).filter((g) => g.items.length > 0);
}

/** 폰 — 하단 탭 4개 + 더보기 */
export function BottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  // 더보기 = 하단 탭에 없는 것 전부. 묶음은 그대로 유지한다
  const groups = useGroups((t) => !TAB_HREFS.has(t.href));
  const moreActive = groups.some((g) => g.items.some((t) => isActive(pathname, t.href)));

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
        className={`flex min-h-[68px] flex-col items-center justify-center gap-1.5 rounded-xl border transition ${
          active ? 'pick-on' : 'border-neutral-200 bg-surface text-neutral-600'
        }`}
      >
        <Icon name={t.icon} size={19} />
        <span className="text-[12px] font-bold">{t.label}</span>
      </Link>
    );
  };

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMoreOpen(false)}>
          <div
            className="absolute inset-x-0 bottom-[56px] max-h-[70vh] overflow-y-auto rounded-t-2xl border-t border-neutral-200 bg-surface p-3 safe-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 묶음 머리글을 그대로 싣는다 — 열두 개를 한 판에 깔면 매번 처음부터 읽게 된다 */}
            {groups.map((g) => (
              <div key={g.key} className={g.quiet ? 'opacity-60' : ''}>
                <p className="mb-1.5 mt-3 px-1 text-[11px] font-bold text-neutral-400 first:mt-0">
                  {g.label}
                </p>
                <div className="grid grid-cols-3 gap-2">{g.items.map(moreTile)}</div>
              </div>
            ))}
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
  const groups = useGroups();
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
            ? 'bg-brand text-white shadow-[0_4px_12px_-8px_rgba(242,101,34,.45)]'
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
        {groups.map((g, i) => (
          <div key={g.key} className={`flex flex-col gap-1 ${g.quiet ? 'opacity-60' : ''}`}>
            <p
              className={`mb-1 px-3 text-[10.5px] font-bold tracking-wide ${
                g.quiet ? 'text-sidebar-text/50' : 'text-sidebar-text/70'
              } ${i === 0 ? '' : 'mt-4'}`}
            >
              {g.label}
            </p>
            {g.items.map(link)}
          </div>
        ))}
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
