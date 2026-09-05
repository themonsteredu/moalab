/**
 * 앱 전역 아이콘. 이모지는 기기마다 모양·크기가 제각각이라 화면이 지저분해져서
 * 전부 이걸로 바꿨다. 선 굵기와 크기를 한곳에서 관리한다.
 */
export type IconName =
  | 'check'
  | 'checkCircle'
  | 'doc'
  | 'won'
  | 'image'
  | 'camera'
  | 'comment'
  | 'user'
  | 'users'
  | 'calendar'
  | 'link'
  | 'target'
  | 'cap'
  | 'plus'
  | 'close'
  | 'trash'
  | 'download'
  | 'cart'
  | 'copy'
  | 'refresh'
  | 'warning'
  | 'clip'
  | 'search'
  | 'wrench'
  | 'grid'
  | 'list'
  | 'board'
  | 'external'
  | 'chevronDown'
  | 'chevronUp'
  | 'puzzle'
  | 'receipt'
  | 'megaphone'
  | 'present'
  | 'dots'
  | 'tree'
  | 'printer';

const P: Record<IconName, React.ReactNode> = {
  check: <path d="m4.5 12.5 5 5 10-11" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.2 12.3 2.6 2.6 5-5.4" />
    </>
  ),
  doc: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  won: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M7 9.5 9.4 15 12 10l2.6 5L17 9.5M6.4 11.9h11.2" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 16.5 4.2-4.2a1.6 1.6 0 0 1 2.2 0L15 16.9M14 13.8l1.6-1.6a1.6 1.6 0 0 1 2.2 0L20 14.3" />
      <circle cx="9" cy="9.5" r="1.2" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13.5" r="3.4" />
    </>
  ),
  comment: <path d="M20 15a2 2 0 0 1-2 2H8l-4 3.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />,
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M2.8 19.5a6.2 6.2 0 0 1 12.4 0M16 5.6a3.2 3.2 0 0 1 0 6M17.5 13.6a6.2 6.2 0 0 1 3.7 5.9" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M3.5 9.5h17M8 3.2v3.4M16 3.2v3.4" />
    </>
  ),
  link: <path d="M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.6 1.6M14 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.6-1.6" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  cap: <path d="M12 4 2.5 9 12 14l9.5-5zM6.5 11.3V16c0 1.4 2.5 2.8 5.5 2.8s5.5-1.4 5.5-2.8v-4.7M21.5 9v5" />,
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  trash: <path d="M4 7h16M9.5 7V4.8h5V7M6.5 7l.9 12.3a1.8 1.8 0 0 0 1.8 1.7h5.6a1.8 1.8 0 0 0 1.8-1.7L17.5 7" />,
  download: <path d="M12 3.5v12M7.5 11l4.5 4.5L16.5 11M4.5 20.5h15" />,
  cart: (
    <>
      <path d="M2.5 4h2.2l2.4 11.2a1.6 1.6 0 0 0 1.6 1.3h8.4a1.6 1.6 0 0 0 1.6-1.2L21 8H6" />
      <circle cx="9.5" cy="20" r="1.3" />
      <circle cx="17.5" cy="20" r="1.3" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M15.5 5.5v-1a1 1 0 0 0-1-1h-9a2 2 0 0 0-2 2v9a1 1 0 0 0 1 1h1" />
    </>
  ),
  refresh: <path d="M20 12a8 8 0 1 1-2.5-5.8M20 3.5V9h-5.5" />,
  warning: (
    <>
      <path d="M12 4.2 2.8 20h18.4z" />
      <path d="M12 10v4M12 17.2v.1" />
    </>
  ),
  clip: <path d="M20 11.5 12.2 19.3a5 5 0 0 1-7.1-7.1l8.3-8.3a3.4 3.4 0 1 1 4.8 4.8l-8.2 8.2a1.8 1.8 0 0 1-2.5-2.5l7.4-7.4" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  wrench: <path d="M15.6 8.4a4.6 4.6 0 0 1-5.9 5.9L5 19a2.1 2.1 0 0 1-3-3l4.7-4.7a4.6 4.6 0 0 1 5.9-5.9l-2.7 2.7 2.1 2.1z" />,
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  list: <path d="M4 6.5h16M4 12h16M4 17.5h16" />,
  board: (
    <>
      <rect x="3.5" y="4" width="5.5" height="16" rx="1.5" />
      <rect x="11" y="4" width="5.5" height="11" rx="1.5" />
      <rect x="18.5" y="4" width="2" height="16" rx="1" />
    </>
  ),
  external: <path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  chevronUp: <path d="m6 14.5 6-6 6 6" />,
  puzzle: <path d="M10 4.5a1.8 1.8 0 1 1 3.6 0V6H17a1 1 0 0 1 1 1v3.4h1.5a1.8 1.8 0 1 1 0 3.6H18V18a1 1 0 0 1-1 1h-3.4v-1.5a1.8 1.8 0 1 0-3.6 0V19H6a1 1 0 0 1-1-1v-4h1.4a1.8 1.8 0 1 0 0-3.6H5V7a1 1 0 0 1 1-1h4z" />,
  receipt: (
    <>
      <path d="M5 3.5h14v17l-2.3-1.6-2.3 1.6-2.4-1.6-2.3 1.6L7.3 19 5 20.5z" />
      <path d="M9 8.5h6M9 12.5h6" />
    </>
  ),
  megaphone: (
    <>
      <path d="M4 10v4a1.5 1.5 0 0 0 1.5 1.5H8l8 4.5V5.5L8 10H5.5A1.5 1.5 0 0 0 4 11.5z" />
      <path d="M19 9.5a3.5 3.5 0 0 1 0 5M8 15.5V20" />
    </>
  ),
  present: (
    <>
      <path d="M3.5 4.5h17M4.5 4.5v9a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-9" />
      <path d="M12 15v4.5M8.5 20.5 12 19.5l3.5 1" />
    </>
  ),
  dots: (
    <>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </>
  ),
  tree: (
    <>
      <path d="M4 5.5h6M4 5.5v13M4 12h6M4 18.5h6" />
      <path d="M13 3.5h7v4h-7zM13 10h7v4h-7zM13 16.5h7v4h-7z" />
    </>
  ),
  printer: (
    <>
      <path d="M7 9V4h10v5" />
      <path d="M5 9h14a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 17h-2v3H7v-3H5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 5 9z" />
      <path d="M7 13.5h10" />
    </>
  ),
};

export function Icon({
  name,
  size = 16,
  className = '',
  strokeWidth = 1.8,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      className={`inline-block shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {P[name]}
    </svg>
  );
}
