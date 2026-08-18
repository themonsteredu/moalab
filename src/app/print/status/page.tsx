'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/session';
import { useAppsOverview, type AppOverview } from '@/lib/useAppsOverview';
import { useMembers } from '@/lib/useMembers';
import { STATUS_META } from '@/lib/status';
import { korDateFull } from '@/lib/format';
import { Icon } from '@/components/Icon';
import { ErrorBanner } from '@/components/ui';

/**
 * 검증 현황 표 인쇄 — 프로그램을 **검증 완료 / 미완료**로 나눠 표로 뽑는다.
 *
 * 미완료 표에는 상태(수정 필요·다시확인·진행 중)를 같이 실어서
 * 다음에 누가 움직여야 하는지가 종이에서도 보인다.
 * 상태는 저장된 값이 아니라 지적·검증완료 표시로 그 자리에서 다시 계산한 것이다
 * (목록 화면과 같은 useAppsOverview).
 */
export default function StatusPrintPage() {
  const router = useRouter();
  // 이 화면은 (app) 레이아웃 밖이라 로그인 가드를 직접 붙인다
  const { session, loading: sessionLoading } = useSession();
  const { items, loading, error, reload } = useAppsOverview();
  const { nameOf } = useMembers(true);

  useEffect(() => {
    if (!sessionLoading && !session) router.replace('/login');
  }, [session, sessionLoading, router]);

  /** 목록 트리와 같은 순서 — 주제 이름 → 프로그램 이름 */
  const sortRows = (rows: AppOverview[]) =>
    [...rows].sort(
      (a, b) =>
        (a.topicName || '힣').localeCompare(b.topicName || '힣', 'ko') ||
        a.app.title_ko.localeCompare(b.app.title_ko, 'ko'),
    );

  const done = useMemo(() => sortRows(items.filter((i) => i.status === 'done')), [items]);
  const todo = useMemo(() => sortRows(items.filter((i) => i.status !== 'done')), [items]);

  if (sessionLoading || !session || loading) {
    return <p className="p-10 text-center text-[14px] text-neutral-500">인쇄할 내용을 준비하고 있어요…</p>;
  }
  if (error) {
    return (
      <div className="p-6">
        <ErrorBanner message={error} onRetry={() => void reload()} />
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-[820px] bg-white p-6 text-black print:p-0">
      {/* 화면에서만 보이는 조작 줄 */}
      <div className="no-print mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-raised p-3">
        <button onClick={() => window.print()} className="btn-primary px-3.5 text-[14px]">
          <Icon name="printer" size={15} />
          인쇄 / PDF 저장
        </button>
        <button onClick={() => window.close()} className="btn-ghost px-3 text-[13px]">
          닫기
        </button>
        <p className="w-full text-[12px] leading-relaxed text-neutral-500">
          아이폰은 <b>공유 → 프린트</b> 를 누른 뒤 미리보기를 두 손가락으로 벌리면 PDF 로 저장됩니다.
          <br />
          PC 는 인쇄 대화상자에서 대상을 <b>PDF로 저장</b> 으로 바꾸세요.
        </p>
      </div>

      <header className="print-block mb-5 border-b-2 border-black pb-3">
        <h1 className="text-[22px] font-black">프로그램 검증 현황</h1>
        <p className="mt-1 text-[12.5px] text-neutral-600">
          전체 {items.length}개 · 검증 완료 {done.length}개 · 미완료 {todo.length}개
          <span className="ml-3 text-[11px] text-neutral-400">
            출력일 {korDateFull(new Date().toISOString().slice(0, 10))}
          </span>
        </p>
      </header>

      <StatusTable title="검증 완료" rows={done} nameOf={nameOf} />
      <StatusTable title="검증 미완료" rows={todo} nameOf={nameOf} showStatus />

      <footer className="mt-8 border-t border-neutral-300 pt-2 text-[10.5px] text-neutral-500">
        모아킷 · 모아랩 업무 워크스페이스 — 프로그램 검증 현황
      </footer>
    </main>
  );
}

function StatusTable({
  title,
  rows,
  nameOf,
  showStatus = false,
}: {
  title: string;
  rows: AppOverview[];
  nameOf: (id: string | null) => string;
  /** 미완료 표에만 — 다음에 누가 움직여야 하는지 상태로 보여준다 */
  showStatus?: boolean;
}) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 border-b border-black pb-1 text-[15px] font-black">
        {title}
        <span className="ml-2 text-[11.5px] font-normal text-neutral-500">{rows.length}개</span>
      </h2>
      {rows.length === 0 ? (
        <p className="py-2 text-[12px] text-neutral-500">없습니다.</p>
      ) : (
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr className="border-y border-black">
              <th className="w-8 py-1.5 text-left font-bold">No.</th>
              <th className="py-1.5 text-left font-bold">프로그램</th>
              <th className="py-1.5 text-left font-bold">주제</th>
              <th className="py-1.5 text-left font-bold">제작자</th>
              <th className="py-1.5 text-center font-bold">라운드</th>
              <th className="py-1.5 text-center font-bold">검증</th>
              <th className="py-1.5 text-left font-bold">마감일</th>
              {showStatus && <th className="py-1.5 text-left font-bold">상태</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((it, i) => (
              <tr key={it.app.id} className="print-block border-b border-neutral-200">
                <td className="py-1.5 pr-1 tabular-nums text-neutral-500">{i + 1}</td>
                <td className="py-1.5 pr-2 font-semibold">{it.app.title_ko}</td>
                <td className="py-1.5 pr-2">{it.topicName || '-'}</td>
                <td className="py-1.5 pr-2">{it.app.creator_id ? nameOf(it.app.creator_id) : '-'}</td>
                <td className="py-1.5 text-center tabular-nums">{it.currentRound?.round_no ?? 1}차</td>
                <td className="py-1.5 text-center tabular-nums">
                  {it.reviewerIds.length === 0 ? '미배정' : `${it.signedIds.length}/${it.reviewerIds.length}`}
                </td>
                <td className="py-1.5 pr-2">{it.app.due_date ? korDateFull(it.app.due_date) : '-'}</td>
                {showStatus && (
                  <td className="py-1.5">
                    <span className="border border-neutral-400 px-1.5 py-0.5 font-bold">
                      {STATUS_META[it.status].label}
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
