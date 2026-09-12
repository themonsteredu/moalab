/**
 * 서버 껍데기 — 내용은 전부 ProgramPrintScreen(클라이언트) 이 그린다.
 *
 * 이 껍데기가 있어야 화면이 **정적 파일**이 된다. 예전엔 화면 자체가
 * `'use client'` 라서 `generateStaticParams` 를 붙일 수가 없었고
 * (클라이언트 파일에서는 못 내보낸다), 그래서 한 건을 열 때마다 서울의
 * 서버 함수가 깨어나 **id 와 무관하게 늘 같은 껍데기**를 다시 그렸다.
 * 폰에서는 그 대기가 곧 '느림' 이었다.
 *
 * ※ 안쪽에서 `useSearchParams()` 를 쓰니 **`Suspense` 로 감싸야** 정적으로 그려진다
 *   (`/print/expense` 와 같은 방식). 안 감싸면 이 화면만 500 이 난다.
 */
export const dynamicParams = true;

/** 미리 만들어 둘 주소는 없다 — 처음 열릴 때 만들어져 그대로 캐시된다 */
export function generateStaticParams() {
  return [];
}

import { Suspense } from 'react';
import ProgramPrintScreen from './ProgramPrintScreen';

export default function Page() {
  return (
    <Suspense fallback={<p className="p-10 text-center text-[14px] text-neutral-500">문서를 준비하고 있어요…</p>}>
      <ProgramPrintScreen />
    </Suspense>
  );
}
