'use client';

import { useSession } from '@/lib/session';
import { usePush } from '@/lib/push';
import { Icon } from '@/components/Icon';

/**
 * 푸시 알림 켜기/끄기.
 * 기기마다 따로 켜야 한다 (폰에서 켜도 PC 는 안 켜진다) — 그 사실을 화면에 적어둔다.
 *
 * **홈에도 붙어 있다.** 예전엔 원장 전용 `관리` 화면에만 있어서
 * 강사는 알림을 켤 방법이 아예 없었다 (그래서 아무도 못 켰다).
 * 대신 **이미 켜져 있으면 한 줄로 접는다** — 다 켠 사람 홈에서
 * 큰 카드가 계속 자리를 먹으면 안 된다.
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

  // 켜져 있으면 한 줄. 껐다 켜는 길은 남겨두되 자리는 안 먹는다.
  if (on) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-raised px-3.5 py-2">
        <Icon name="megaphone" size={13} className="shrink-0 text-green-600" />
        <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-neutral-600">
          푸시 알림 켜짐
        </p>
        <button
          onClick={() => void disable()}
          disabled={busy}
          aria-pressed
          className="tap shrink-0 px-1 text-[12.5px] font-bold text-neutral-400 disabled:opacity-40"
        >
          {busy ? '…' : '끄기'}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-raised px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-bold text-neutral-600">
            <Icon name="megaphone" size={14} />
            푸시 알림 {on ? '켜짐' : '꺼짐'}
          </p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-neutral-400">
            새 공지 · 지적 · 답변이 오면 알려줘요
            <br />
            (폰·PC 따로 켜요)
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
