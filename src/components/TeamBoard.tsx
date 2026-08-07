'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { Avatar } from '@/components/Brand';
import { Icon } from '@/components/Icon';
import { relTime } from '@/lib/format';
import type { ActivityLog, MemberPublic } from '@/lib/types';
import type { AppOverview } from '@/lib/useAppsOverview';

export interface MemberWork {
  member: MemberPublic;
  /** 검증 배정 */
  reviewTotal: number;
  reviewDone: number;
  /** 손도 안 댄 검증 (5항목 중 0개) */
  reviewUntouched: { id: string; title: string }[];
  /** 하다 만 검증 */
  /** 지적은 남겼지만 아직 '검증 완료' 를 안 누른 것 */
  reviewPartial: { id: string; title: string; found: number }[];
  /** 내가 만든 프로그램 */
  madeTotal: number;
  /** 내가 만든 것 중 수정이 필요한 것 */
  needFix: { id: string; title: string }[];
  lastAction: ActivityLog | null;
}

/**
 * 누가 무엇을 했고 무엇을 안 했는지 한눈에.
 * 진행률 숫자만으로는 "누가 멈춰 있는지"가 안 보여서 사람 단위로 세운 화면이다.
 */
export function useTeamWork(
  members: MemberPublic[],
  items: AppOverview[],
  logs: ActivityLog[],
): MemberWork[] {
  return useMemo(() => {
    const lastByMember = new Map<string, ActivityLog>();
    for (const l of logs) {
      if (l.member_id && !lastByMember.has(l.member_id)) lastByMember.set(l.member_id, l);
    }

    return members
      .map((m) => {
        let reviewTotal = 0;
        let reviewDone = 0;
        const reviewUntouched: MemberWork['reviewUntouched'] = [];
        const reviewPartial: MemberWork['reviewPartial'] = [];
        let madeTotal = 0;
        const needFix: MemberWork['needFix'] = [];

        for (const it of items) {
          if (it.app.creator_id === m.id) {
            madeTotal++;
            if (it.status === 'fixing') needFix.push({ id: it.app.id, title: it.app.title_ko });
          }
          if (!it.reviewerIds.includes(m.id)) continue;
          reviewTotal++;
          // 검증 완료를 눌렀나 / 지적이라도 남겼나 / 아무것도 안 했나
          const signed = it.signedIds.includes(m.id);
          const found = it.findings.filter((f) => f.member_id === m.id).length;
          if (signed) reviewDone++;
          else if (found === 0) reviewUntouched.push({ id: it.app.id, title: it.app.title_ko });
          else reviewPartial.push({ id: it.app.id, title: it.app.title_ko, found });
        }

        return {
          member: m,
          reviewTotal,
          reviewDone,
          reviewUntouched,
          reviewPartial,
          madeTotal,
          needFix,
          lastAction: lastByMember.get(m.id) ?? null,
        };
      })
      // 손 놓은 사람이 위로 오게 (안 한 게 많은 순)
      .sort((a, b) => {
        const aStuck = a.reviewUntouched.length + a.needFix.length;
        const bStuck = b.reviewUntouched.length + b.needFix.length;
        return bStuck - aStuck || b.reviewTotal - a.reviewTotal;
      });
  }, [members, items, logs]);
}

export function TeamBoard({ work, meId }: { work: MemberWork[]; meId: string }) {
  const active = work.filter((w) => w.reviewTotal > 0 || w.madeTotal > 0);
  if (active.length === 0) {
    return (
      <p className="card px-4 py-4 text-center text-[13px] text-neutral-400">
        아직 아무에게도 배정된 일이 없어요.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {active.map((w) => {
        const stuck = w.reviewUntouched.length;
        const partial = w.reviewPartial.length;
        const pct = w.reviewTotal > 0 ? Math.round((w.reviewDone / w.reviewTotal) * 100) : 100;
        const allClear = stuck === 0 && partial === 0 && w.needFix.length === 0;

        return (
          <div key={w.member.id} className="card p-3">
            <div className="flex items-center gap-2.5">
              <Avatar name={w.member.name} size={32} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[14.5px] font-bold leading-tight">
                  {w.member.name}
                  {w.member.id === meId && <span className="text-[11px] font-semibold text-brand">나</span>}
                  {w.member.role === 'admin' && (
                    <span className="chip bg-brand-50 text-brand-700">원장</span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-[11.5px] text-neutral-400">
                  {w.lastAction ? `${relTime(w.lastAction.created_at)} · ${w.lastAction.action}` : '활동 기록 없음'}
                </p>
              </div>
              <span
                className={`chip shrink-0 ${
                  allClear ? 'bg-green-100 text-green-800' : stuck > 0 ? 'bg-red-100 text-red-700' : 'bg-brand-50 text-brand-700'
                }`}
              >
                {allClear ? '다 했어요' : stuck > 0 ? `미착수 ${stuck}` : `진행 ${partial}`}
              </span>
            </div>

            {/* 검증 진행 막대 */}
            {w.reviewTotal > 0 && (
              <div className="mt-2.5 flex items-center gap-2">
                <span className="w-[42px] shrink-0 text-[11px] text-neutral-400">검증</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className={`h-full rounded-full ${pct === 100 ? 'bg-green-500' : 'bg-brand'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-9 shrink-0 text-right text-[11px] font-bold tabular-nums text-neutral-500">
                  {w.reviewDone}/{w.reviewTotal}
                </span>
              </div>
            )}
            {w.madeTotal > 0 && (
              <div className="mt-1 flex items-center gap-2">
                <span className="w-[42px] shrink-0 text-[11px] text-neutral-400">제작</span>
                <span className="text-[11.5px] text-neutral-500">
                  {w.madeTotal}개
                  {w.needFix.length > 0 && (
                    <span className="ml-1.5 font-bold text-red-600">수정 필요 {w.needFix.length}</span>
                  )}
                </span>
              </div>
            )}

            {/* 안 한 것 — 이게 이 화면의 핵심 */}
            {(w.reviewUntouched.length > 0 || w.reviewPartial.length > 0 || w.needFix.length > 0) && (
              <div className="mt-2 flex flex-wrap gap-1">
                {w.reviewUntouched.slice(0, 3).map((a) => (
                  <Link
                    key={`u-${a.id}`}
                    href={`/apps/${a.id}`}
                    className="flex items-center gap-1 rounded-md bg-red-50 px-1.5 py-1 text-[11px] font-semibold text-red-700"
                  >
                    <Icon name="search" size={10} />
                    {a.title} 미착수
                  </Link>
                ))}
                {w.reviewPartial.slice(0, 2).map((a) => (
                  <Link
                    key={`p-${a.id}`}
                    href={`/apps/${a.id}`}
                    className="flex items-center gap-1 rounded-md bg-neutral-100 px-1.5 py-1 text-[11px] font-semibold text-neutral-600"
                  >
                    <Icon name="search" size={10} />
                    {a.title} 지적 {a.found}
                  </Link>
                ))}
                {w.needFix.slice(0, 2).map((a) => (
                  <Link
                    key={`f-${a.id}`}
                    href={`/apps/${a.id}`}
                    className="flex items-center gap-1 rounded-md bg-orange-50 px-1.5 py-1 text-[11px] font-semibold text-orange-700"
                  >
                    <Icon name="wrench" size={10} />
                    {a.title} 수정
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
