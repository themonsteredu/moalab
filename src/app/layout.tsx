import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SessionProvider } from '@/lib/session';

export const metadata: Metadata = {
  title: '모아랩 업무',
  description: '모아킷/모아랩 내부 업무 워크스페이스',
  manifest: '/manifest.webmanifest',
  // 아이폰 '홈 화면에 추가' 아이콘. 아이콘은 scripts/make-icons.mjs 가 로고에서 뽑는다
  icons: { apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: '모아랩 업무' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#08090A',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* 에스코어드림 웹폰트를 조금이라도 빨리 받도록 */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
      </head>
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
