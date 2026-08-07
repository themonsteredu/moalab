'use client';

import { useSession } from '@/lib/session';
import { usePush } from '@/lib/push';
import { Icon } from '@/components/Icon';

/**
 * 푸시 알림 켜기/끄기.
 * 기기마다 따로 켜야 한다 (폰에서 켜도 PC 는 안 켜진다) — 그 사실을 화면에 적어둔다.
 */
export function PushToggle() {
  const { session } = useSession();
  const { state, busy, error, needsInstall, enable, disable } = usePush(session?.id ?? null);

  if (state === 'unsupported') {
    return (
      <div className="rounded-xl border border-neutral-200 bg-raised px-3.5 py-3">
        <p className="flex items-center gap-1.5 text-[13px] font-bold text-neutral-600">
          <Icon name="megaphone" size={14} />
          알림
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-neutral-500">
          {needsInstall ? (
            <>
              아이폰은 <b>사파리 하단 공유 → 홈 화면에 추가</b> 를 하고,
              <br />
              홈 화면 아이콘으로 열면 알림을 받을 수 있어요.
            </>
          ) : (
            '이 브라우저는 알림을 지원하지 않아요. 크롬이나 사파리로 열어주세요.'
          )}
        </p>
      </div>
    );
  }

  if (state === 'denied') {
    return (
      <div className="rounded-xl border border-neutral-200 bg-raised px-3.5 py-3">
        <p className="flex items-center gap-1.5 text-[13px] font-bold text-neutral-600">
          <Icon name="megaphone" size={14} />
          알림이 차단돼 있어요
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-neutral-500">
          브라우저 주소창 옆 자물쇠 → 알림 → 허용으로 바꿔주세요.
        </p>
      </div>
    );
  }

  const on = state === 'on';

  return (
    <div className="rounded-xl border border-neutral-200 bg-raised px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-bold text-neutral-600">
            <Icon name="megaphone" size={14} />
            푸시 알림 {on ? '켜짐' : '꺼짐'}
          </p>
          <p className="mt-0.5 text-[11.5px] text-neutral-400">
            새 공지 · 새 지적 · 답변이 오면 알려줘요 (기기마다 따로 켜요)
          </p>
        </div>
        <button
          onClick={() => void (on ? disable() : enable())}
          disabled={busy}
          aria-pressed={on}
          className={`tap shrink-0 rounded-xl border px-3 text-[13px] font-bold transition ${
            on
              ? 'border-neutral-300 bg-surface text-neutral-500'
              : 'border-green-600 bg-green-600 text-white'
          } disabled:opacity-40`}
        >
          {busy ? '…' : on ? '끄기' : '켜기'}
        </button>
      </div>
      {error && <p className="mt-2 text-[12px] text-red-600">{error}</p>}
    </div>
  );
}
