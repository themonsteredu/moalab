import type { ChatRoomKind, Message, RoomSummary } from './types';

/**
 * 대화 계산.
 *
 * 화면 코드에 계산을 흩어놓지 않는다 (task.ts · collab.ts · schedule.ts 와 같은 자리).
 * `scripts/chat.test.mjs` 가 이 파일을 지킨다.
 *
 * **여기에는 권한 판단이 없다.** "이 방을 볼 수 있나" 는 브라우저에서 정하면
 * 아무 뜻이 없다 — 서버(`/api/chat/*`)가 service_role 로 확인한다.
 * 이 파일은 *보여주는 방법* 만 다룬다.
 */

/* -------------------------------------------------------------------- 이름표 */

export const CHAT_KINDS: { value: ChatRoomKind; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'dept', label: '부서' },
  { value: 'dm', label: '1:1' },
];

export function chatKindLabel(k: string): string {
  return CHAT_KINDS.find((x) => x.value === k)?.label ?? '1:1';
}

/* ---------------------------------------------------------------------- 1:1
   같은 두 사람이 각자 방을 만들면 대화가 두 갈래로 갈라진다.
   그래서 **id 를 정렬해 이어붙인 값**을 열쇠로 두고 DB 에 unique 를 건다 —
   누가 먼저 열든 같은 방이 나온다. */

export function dmKey(a: string, b: string): string {
  return [a, b].sort().join(':');
}

/** 1:1 방에서 상대는 누구인가. 나 혼자만 남았으면 null */
export function otherOf(memberIds: string[], meId: string): string | null {
  return memberIds.find((m) => m !== meId) ?? null;
}

/* -------------------------------------------------------------------- 안 읽음
   **읽음은 메시지마다가 아니라 사람마다 한 줄**(`last_read_at`)이다.
   메시지 × 사람으로 두면 5명이 100줄만 주고받아도 500줄이 쌓인다. */

/** 내가 마지막으로 읽은 뒤에 **남이** 쓴 것만 센다 — 내 글은 안 읽은 게 아니다 */
export function unreadCount(
  messages: Pick<Message, 'member_id' | 'created_at'>[],
  lastReadAt: string,
  meId: string,
): number {
  return messages.filter((m) => m.member_id !== meId && m.created_at > lastReadAt).length;
}

/** 배지에 적을 글. 99 를 넘으면 자른다 (세 자리가 되면 칸이 밀린다) */
export function unreadLabel(n: number): string {
  return n > 99 ? '99+' : String(n);
}

/* -------------------------------------------------------------------- 미리보기 */

/** 목록에 한 줄로 적을 것. 사진만 보낸 것도 빈 줄로 두지 않는다 */
export function preview(m: Pick<Message, 'body' | 'image_path'> | null | undefined): string {
  if (!m) return '';
  const body = (m.body ?? '').trim();
  if (body) return body.replace(/\s+/g, ' ');
  return m.image_path ? '사진' : '';
}

/* -------------------------------------------------------------------- 정렬
   최근에 말이 오간 방이 위다. 아직 한 마디도 없는 방(부서방·전체방을 막 만든 때)은
   아래로 내리되 **지우지 않는다** — 첫 마디를 넣을 자리가 없어지면 안 된다
   (안 쓰는 메뉴를 지우지 않고 아래로 내린 것과 같은 판단). */

const KIND_RANK: Record<string, number> = { all: 0, dept: 1, dm: 2 };

export function sortRooms(list: RoomSummary[]): RoomSummary[] {
  return [...list].sort((a, b) => {
    if (!!a.lastAt !== !!b.lastAt) return a.lastAt ? -1 : 1;
    if (a.lastAt && b.lastAt && a.lastAt !== b.lastAt) return a.lastAt < b.lastAt ? 1 : -1;
    return (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9) || a.title.localeCompare(b.title, 'ko');
  });
}

/** 하단 탭·홈에 찍을 전체 안 읽은 수 */
export function totalUnread(list: RoomSummary[]): number {
  return list.reduce((s, r) => s + r.unread, 0);
}

/* -------------------------------------------------------------------- 묶기
   같은 사람이 잇달아 쓴 말은 이름표를 한 번만 그린다 — 줄마다 이름이 붙으면
   폰에서 화면의 절반이 이름이 된다. 5분이 지나면 다시 그린다(시간이 벌어졌으면
   다른 이야기로 읽힌다). */

const SAME_RUN_MS = 5 * 60 * 1000;

export interface Grouped<T> {
  msg: T;
  /** 이름표·아바타를 그릴 첫 줄인가 */
  head: boolean;
  /** 시각을 그릴 마지막 줄인가 */
  tail: boolean;
  /** 날짜 가름선을 위에 넣을까 */
  daybreak: boolean;
}

export function groupMessages<T extends Pick<Message, 'member_id' | 'created_at'>>(
  messages: T[],
): Grouped<T>[] {
  return messages.map((m, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const day = m.created_at.slice(0, 10);
    const sameRun = (a?: T, b?: T) =>
      !!a &&
      !!b &&
      a.member_id === b.member_id &&
      a.created_at.slice(0, 10) === b.created_at.slice(0, 10) &&
      Math.abs(Date.parse(b.created_at) - Date.parse(a.created_at)) < SAME_RUN_MS;

    return {
      msg: m,
      daybreak: !prev || prev.created_at.slice(0, 10) !== day,
      head: !sameRun(prev, m),
      tail: !sameRun(m, next),
    };
  });
}

/* -------------------------------------------------------------------- 알림 문구 */

/** 잠금화면에서 한 줄로 읽힌다. 방 이름을 앞세운다 — 누가 어디서 말했는지가 먼저다 */
export function chatNotice(roomTitle: string, fromName: string, body: string): { title: string; body: string } {
  return { title: roomTitle, body: `${fromName}: ${body}`.slice(0, 120) };
}
