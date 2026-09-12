import type { Message, Room, RoomSummary } from './types';
import { dmKey, preview, sortRooms, unreadCount } from './chat';

/**
 * 대화 — **서버 전용**. 절대 클라이언트에서 import 하지 말 것.
 *
 * 대화 표 넷은 anon 키로 아예 못 붙는다(정책 없음 + 권한 회수). 그래서 읽기·쓰기가
 * 전부 여기를 거치고, **"이 사람이 이 방 멤버인가" 를 여기서 확인한다.**
 * 이게 요청받은 "자기가 속한 대화방만" 의 실제 구현이다 —
 * 이 앱은 Supabase Auth 를 안 써서 DB 가 auth.uid() 를 모르기 때문에
 * RLS 정책으로는 같은 것을 쓸 수 없다 (schema.sql 22번 참고).
 */

/** getAdminClient() 가 돌려주는 것. 스키마 타입을 생성해 쓰지 않으므로 느슨하게 받는다 */
type Admin = ReturnType<typeof import('./supabaseAdmin').getAdminClient> extends infer T
  ? Exclude<T, null>
  : never;

export interface Actor {
  memberId: string;
  name: string;
  role: string;
}

/**
 * 세션 토큰으로 신원을 확인한다.
 *
 * **`x-actor-id` 헤더는 여기서 쓰지 않는다.** 브라우저가 아무 값이나 넣을 수 있어서,
 * 그걸 믿으면 남의 1:1 대화를 그대로 읽을 수 있다. 토큰은 로그인할 때만 발급되고
 * 잠긴 표(moalab.sessions)에 있어 브라우저가 지어낼 수 없다.
 */
export async function actorFromToken(admin: Admin, token: string | null): Promise<Actor | null> {
  if (!token) return null;
  // uuid 가 아니면 DB 에 물어볼 것도 없다 (형식이 틀리면 postgres 가 에러를 낸다)
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;

  // 세션과 멤버를 따로 읽으면 모든 보호 API가 DB 왕복을 두 번 기다리게 된다.
  // FK 임베드로 한 번에 확인해 첫 화면 로딩의 직렬 대기를 줄인다.
  const { data } = await admin
    .from('sessions')
    .select('member_id, expires_at, member:members!sessions_member_id_fkey(id, name, role, active)')
    .eq('token', token)
    .maybeSingle();
  if (!data || new Date(data.expires_at).getTime() < Date.now()) return null;
  const m = Array.isArray(data.member) ? data.member[0] : data.member;
  if (!m || !m.active) return null;

  // 마지막으로 쓴 시각만 조용히 갱신한다 (실패해도 로그인을 막지 않는다)
  void admin.from('sessions').update({ last_seen_at: new Date().toISOString() }).eq('token', token);

  return { memberId: m.id, name: m.name, role: m.role };
}

/** 요청 헤더에서 토큰 꺼내기 */
export function tokenOf(req: Request): string | null {
  return req.headers.get('x-session-token');
}

/* -------------------------------------------------------------------- 부서 */

/**
 * 이 사람이 속한 부서 — 부서업무에서 파생한다.
 * 팀장이거나 그 부서 역할의 주담당·부담당이면 그 부서 사람이다
 * (부서협업·일정 화면과 같은 규칙 — 새 소속 표를 만들지 않는다).
 */
export async function deptsOfMember(admin: Admin, memberId: string): Promise<string[]> {
  const [dRes, gRes, uRes, hRes] = await Promise.all([
    admin.from('departments').select('id, head_id'),
    admin.from('duty_groups').select('id, dept_id'),
    admin.from('duties').select('id, group_id, owner_id'),
    admin.from('duty_helpers').select('duty_id, member_id'),
  ]);

  const groupDept = new Map<string, string>();
  for (const g of gRes.data ?? []) groupDept.set(g.id, g.dept_id);

  const myDuties = new Set<string>();
  for (const u of uRes.data ?? []) if (u.owner_id === memberId) myDuties.add(u.id);
  for (const h of hRes.data ?? []) if (h.member_id === memberId) myDuties.add(h.duty_id);

  const out = new Set<string>();
  for (const d of dRes.data ?? []) if (d.head_id === memberId) out.add(d.id);
  for (const u of uRes.data ?? []) {
    if (!myDuties.has(u.id)) continue;
    const dept = groupDept.get(u.group_id);
    if (dept) out.add(dept);
  }
  return [...out];
}

/* -------------------------------------------------------------------- 방 */

/**
 * 이 사람에게 있어야 할 방을 만들고 넣어준다 — 전체 공지방 + 내 부서 단톡방.
 *
 * 미리 다 만들어두지 않고 **들어올 때 맞춘다.** 부서가 바뀌거나 역할을 맡으면
 * 다음에 대화를 열 때 저절로 따라온다 (조직이 데이터라서 코드를 안 고치는 것과 같은 결).
 */
export async function ensureRooms(admin: Admin, memberId: string): Promise<void> {
  // 1) 전체 공지방 — 딱 하나. 있으면 그대로 쓴다
  let allRoom = (await admin.from('rooms').select('id').eq('kind', 'all').maybeSingle()).data;
  if (!allRoom) {
    const ins = await admin.from('rooms').insert({ kind: 'all', title: '전체 공지방' }).select('id').maybeSingle();
    // 동시에 두 사람이 들어오면 unique 에 걸린다 — 그때는 남이 만든 것을 읽어온다
    allRoom = ins.data ?? (await admin.from('rooms').select('id').eq('kind', 'all').maybeSingle()).data;
  }

  const wanted: string[] = [];
  if (allRoom) wanted.push(allRoom.id);

  // 2) 내 부서 단톡방 — 부서마다 하나
  for (const deptId of await deptsOfMember(admin, memberId)) {
    let room = (await admin.from('rooms').select('id').eq('dept_id', deptId).maybeSingle()).data;
    if (!room) {
      const ins = await admin.from('rooms').insert({ kind: 'dept', dept_id: deptId }).select('id').maybeSingle();
      room = ins.data ?? (await admin.from('rooms').select('id').eq('dept_id', deptId).maybeSingle()).data;
    }
    if (room) wanted.push(room.id);
  }

  if (wanted.length === 0) return;
  // 이미 있으면 그대로 둔다 — last_read_at 을 되돌리면 다 읽은 게 안 읽음으로 되살아난다
  await admin
    .from('room_members')
    .upsert(
      wanted.map((room_id) => ({ room_id, member_id: memberId })),
      { onConflict: 'room_id,member_id', ignoreDuplicates: true },
    );
}

/** 1:1 방을 찾거나 만든다. 누가 먼저 열든 같은 방이 나온다 (dm_key 가 unique) */
export async function openDm(admin: Admin, meId: string, otherId: string): Promise<string | null> {
  if (meId === otherId) return null;
  const key = dmKey(meId, otherId);

  let room = (await admin.from('rooms').select('id').eq('dm_key', key).maybeSingle()).data;
  if (!room) {
    const ins = await admin.from('rooms').insert({ kind: 'dm', dm_key: key }).select('id').maybeSingle();
    room = ins.data ?? (await admin.from('rooms').select('id').eq('dm_key', key).maybeSingle()).data;
  }
  if (!room) return null;

  await admin.from('room_members').upsert(
    [
      { room_id: room.id, member_id: meId },
      { room_id: room.id, member_id: otherId },
    ],
    { onConflict: 'room_id,member_id', ignoreDuplicates: true },
  );
  return room.id;
}

/** **이 확인이 대화 격리의 전부다.** 모든 읽기·쓰기가 이걸 지나야 한다 */
export async function isMember(admin: Admin, roomId: string, memberId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(roomId)) return false;
  const { data } = await admin
    .from('room_members')
    .select('member_id')
    .eq('room_id', roomId)
    .eq('member_id', memberId)
    .maybeSingle();
  return Boolean(data);
}

/** 목록 화면이 받을 모양으로 — 내가 든 방만 */
export async function myRooms(admin: Admin, meId: string): Promise<RoomSummary[]> {
  const mine = await admin.from('room_members').select('room_id, last_read_at').eq('member_id', meId);
  const ids = (mine.data ?? []).map((r) => r.room_id);
  if (ids.length === 0) return [];

  const [rRes, mRes, msgRes, depRes, memRes] = await Promise.all([
    admin.from('rooms').select('*').in('id', ids),
    admin.from('room_members').select('room_id, member_id').in('room_id', ids),
    // 목록에는 최근 것만 필요하다 — 방마다 전부 읽으면 5명 × 수천 줄이 된다
    admin.from('messages').select('*').in('room_id', ids).order('created_at', { ascending: false }).limit(400),
    admin.from('departments').select('id, name'),
    admin.from('members').select('id, name'),
  ]);

  const deptName = new Map((depRes.data ?? []).map((d) => [d.id, d.name as string]));
  const memName = new Map((memRes.data ?? []).map((m) => [m.id, m.name as string]));
  const readAt = new Map((mine.data ?? []).map((r) => [r.room_id, r.last_read_at as string]));

  const membersOf = new Map<string, string[]>();
  for (const rm of mRes.data ?? []) {
    const list = membersOf.get(rm.room_id) ?? [];
    list.push(rm.member_id);
    membersOf.set(rm.room_id, list);
  }

  const msgsOf = new Map<string, Message[]>();
  for (const m of (msgRes.data ?? []) as Message[]) {
    const list = msgsOf.get(m.room_id) ?? [];
    list.push(m);
    msgsOf.set(m.room_id, list);
  }

  const out: RoomSummary[] = ((rRes.data ?? []) as Room[]).map((room) => {
    const memberIds = membersOf.get(room.id) ?? [];
    const msgs = msgsOf.get(room.id) ?? [];
    const last = msgs[0] ?? null; // created_at desc 라 첫 줄이 최신이다
    return {
      id: room.id,
      kind: room.kind,
      title: roomTitle(room, memberIds, meId, deptName, memName),
      memberIds,
      unread: unreadCount(msgs, readAt.get(room.id) ?? '1970-01-01T00:00:00Z', meId),
      lastBody: last ? preview(last) : null,
      lastAt: last?.created_at ?? null,
      lastFrom: last?.member_id ? (memName.get(last.member_id) ?? null) : null,
    };
  });

  return sortRooms(out);
}

/** 방 이름 — 1:1 은 상대 이름, 부서방은 부서 이름, 전체방은 고정 */
export function roomTitle(
  room: Room,
  memberIds: string[],
  meId: string,
  deptName: Map<string, string>,
  memName: Map<string, string>,
): string {
  if (room.kind === 'all') return room.title || '전체 공지방';
  if (room.kind === 'dept') return `${(room.dept_id && deptName.get(room.dept_id)) || '부서'} 단톡방`;
  const other = memberIds.find((m) => m !== meId);
  return (other && memName.get(other)) || '나와의 대화';
}

/* ---------------------------------------------------------------- 실시간
   Realtime **broadcast** 를 쓴다. postgres_changes 는 anon 이 그 표를 읽을 수
   있어야 하는데 우리는 표를 통째로 잠갔으니 쓸 수 없다.

   ⚠️ 보내는 것은 **방 id 하나뿐이다 — 말 내용은 절대 싣지 않는다.**
   채널 인가(Realtime Authorization)도 auth.uid() 를 요구해서 못 쓰기 때문에
   토픽만 알면 누구나 들을 수 있다. 그래서 "그 방에 새 말이 있다" 만 알리고,
   내용은 서버 라우트가 멤버를 확인한 뒤에 내려준다. */

export async function pingRoom(roomId: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: key, authorization: `Bearer ${key}` },
      body: JSON.stringify({
        messages: [{ topic: 'moalab-chat', event: 'ping', payload: { roomId } }],
      }),
    });
  } catch {
    /* 알림이 안 갔다고 말이 안 올라가면 더 나쁘다 — 화면은 폴링으로도 따라잡는다 */
  }
}
