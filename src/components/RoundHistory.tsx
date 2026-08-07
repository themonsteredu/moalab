'use client';

import { useState } from 'react';
import { CHECK_ITEMS, type CheckRow, type Round } from '@/lib/types';
import { shortTime } from '@/lib/format';

const MARK: Record<string, { text: string; cls: string }> = {
  pass: { text: '통과', cls: 'bg-green-100 text-green-800' },
  fail: { text: '실패', cls: 'bg-red-100 text-red-700' },
  none: { text: '미확인', cls: 'bg-neutral-100 text-neutral-500' },
};

/**
 * 지난 라운드 기록. 기본은 접힌 상태.
 * "누가 언제 뭘 지적했는지"가 남아야 재검증이 의미가 있다.
 */
export function RoundHistory({
  rounds,
  checksByRound,
  nameOf,
}: {
  rounds: Round[];
  checksByRound: Map<string, CheckRow[]>;
  nameOf: (id: string | null) => string;
}) {
  const [openIds, setOpenIds] = useState<string[]>([]);
  if (rounds.length === 0) return null;

  const toggle = (id: string) =>
    setOpenIds((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));

  return (
    <div className="space-y-2">
      {rounds.map((r) => {
        const open = openIds.includes(r.id);
        const checks = checksByRound.get(r.id) ?? [];
        const fails = checks.filter((c) => c.result === 'fail');
        const byMember = new Map<string, CheckRow[]>();
        for (const c of checks) {
          const list = byMember.get(c.member_id) ?? [];
          list.push(c);
          byMember.set(c.member_id, list);
        }

        return (
          <div key={r.id} className="card overflow-hidden">
            <button
              onClick={() => toggle(r.id)}
              aria-expanded={open}
              className="tap w-full justify-between gap-3 px-4 py-3 text-left"
            >
              <span className="min-w-0">
                <span className="block text-[14px] font-bold text-neutral-700">{r.round_no}차 검증</span>
                <span className="mt-0.5 block truncate text-[12px] text-neutral-400">
                  {shortTime(r.opened_at)} 시작
                  {fails.length > 0 && (
                    <span className="ml-1.5 font-semibold text-red-500">지적 {fails.length}건</span>
                  )}
                </span>
              </span>
              <span className={`shrink-0 text-neutral-400 transition ${open ? 'rotate-180' : ''}`}>⌄</span>
            </button>

            {open && (
              <div className="border-t border-neutral-100 px-4 py-3">
                {r.change_note && (
                  <div className="mb-3 rounded-xl bg-brand-50 px-3 py-2.5">
                    <p className="text-[11.5px] font-bold text-brand-700">수정 내용</p>
                    <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-700">
                      {r.change_note}
                    </p>
                  </div>
                )}

                {byMember.size === 0 ? (
                  <p className="text-[13px] text-neutral-400">기록이 없어요.</p>
                ) : (
                  <div className="space-y-3">
                    {[...byMember.entries()].map(([memberId, rows]) => (
                      <div key={memberId}>
                        <p className="mb-1.5 text-[13px] font-bold text-neutral-600">{nameOf(memberId)}</p>
                        <ul className="space-y-1">
                          {CHECK_ITEMS.map((label, i) => {
                            const row = rows.find((x) => x.item_no === i + 1);
                            const m = MARK[row?.result ?? 'none'];
                            return (
                              <li key={i} className="flex items-start gap-2">
                                <span className={`chip mt-0.5 shrink-0 ${m.cls}`}>{m.text}</span>
                                <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-neutral-600">
                                  {label}
                                  {row?.note && (
                                    <span className="mt-0.5 block text-[12px] text-red-600">↳ {row.note}</span>
                                  )}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
