import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseAdmin';
import { actorFromToken, isMember, pingRoom, roomTitle, tokenOf } from '@/lib/chatServer';
import { chatNotice, preview } from '@/lib/chat';
import type { Message, Room } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** 한 번에 가져올 최대 줄 수. 폰에서 위로 올리면 더 불러온다 */
const PAGE = 60;

/**
 * 한 방의 말들.
 *
 * **먼저 멤버인지 확인한다.** 이 한 줄이 "자기가 속한 대화방만" 의 실제 구현이다 —
 * 남의 방 id 를 알아내도 여기서 403 이 난다.
 */
export async function GET(req: Request) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: '서버 설정이 아직 안 됐어요.' }, { status: 500 });

  const me = await actorFromToken(admin, tokenOf(req));
  if (!me) return NextResponse.json({ error: '다시 로그인해주세요.' }, { status: 401 });

  const url = new URL(req.url);
  const roomId = url.searchParams.get('roomId') ?? '';
  const before = url.searchParams.get('before'); // 위로 올려 지난 말 더 보기
  const after = url.searchParams.get('after');   // 폴링 — 그 뒤로 새로 온 것만

  if (!(await isMember(admin, roomId, me.memberId))) {
    return NextResponse.json({ error: '볼 수 없는 대화방이에요.' }, { status: 403 });
  }

  /* `after` 가 오면 **새 줄만** 돌려준다 (보통 0건이라 응답이 거의 비어 있다).
     예전엔 폴링마다 60줄을 통째로 보내서 화면이 말풍선을 전부 다시 그렸다. */
  let q = admin.from('messages').select('*').eq('room_id', roomId).limit(PAGE);
  q = after
    ? q.gt('created_at', after).order('created_at', { ascending: true })
    : q.order('created_at', { ascending: false });
  if (before) q = q.lt('created_at', before);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: '대화를 불러오지 못했어요.' }, { status: 500 });

  const rows = (data ?? []) as Message[];
  const list = after ? rows : [...rows].reverse(); // 화면은 오래된 것부터 그린다

  /* 방 사람 목록은 폴링마다 다시 읽을 이유가 없다 — 처음 받을 때만 싣는다 */
  if (after) return NextResponse.json({ messages: list, hasMore: false });

  const mRes = await admin.from('room_members').select('member_id').eq('room_id', roomId);
  return NextResponse.json({
    messages: list,
    memberIds: (mRes.data ?? []).map((r) => r.member_id),
    hasMore: rows.length === PAGE,
  });
}

/** 한 마디 보내기 */
export async function POST(req: Request) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: '서버 설정이 아직 안 됐어요.' }, { status: 500 });

  const me = await actorFromToken(admin, tokenOf(req));
  if (!me) return NextResponse.json({ error: '다시 로그인해주세요.' }, { status: 401 });

  let body: { roomId?: string; body?: string; imagePath?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '요청을 읽지 못했어요.' }, { status: 400 });
  }

  const roomId = body.roomId ?? '';
  const text = (body.body ?? '').trim();
  const imagePath = body.imagePath ?? null;
  if (!text && !imagePath) return NextResponse.json({ error: '할 말을 적어주세요.' }, { status: 400 });

  if (!(await isMember(admin, roomId, me.memberId))) {
    return NextResponse.json({ error: '보낼 수 없는 대화방이에요.' }, { status: 403 });
  }

  const { data, error } = await admin
    .from('messages')
    .insert({ room_id: roomId, member_id: me.memberId, body: text || null, image_path: imagePath })
    .select('*')
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: '말을 못 보냈어요. 다시 눌러주세요.' }, { status: 500 });

  /* 보낸 사람은 그 줄까지 읽은 것이다 — 내 글이 내 안 읽음으로 잡히면 안 된다.
     **기다리지 않는다** — 이걸 기다리면 말이 화면에 뜨는 게 그만큼 늦는다 */
  void admin
    .from('room_members')
    .update({ last_read_at: data.created_at })
    .eq('room_id', roomId)
    .eq('member_id', me.memberId);

  // 실시간 — **방 id 만** 보낸다 (내용은 절대 안 싣는다, chatServer.pingRoom 참고)
  void pingRoom(roomId);

  /* 알림은 그 방 사람들에게만. 자기가 한 말은 자기한테 안 울린다(fromId).
     발송이 실패해도 말은 이미 올라갔다 — 알림 때문에 대화가 막히면 더 나쁘다 */
  void (async () => {
    try {
      const [rRes, mRes, depRes, memRes] = await Promise.all([
        admin.from('rooms').select('*').eq('id', roomId).maybeSingle(),
        admin.from('room_members').select('member_id').eq('room_id', roomId),
        admin.from('departments').select('id, name'),
        admin.from('members').select('id, name'),
      ]);
      if (!rRes.data) return;
      const memberIds = (mRes.data ?? []).map((r) => r.member_id);
      const title = roomTitle(
        rRes.data as Room,
        memberIds,
        me.memberId,
        new Map((depRes.data ?? []).map((d) => [d.id, d.name as string])),
        new Map((memRes.data ?? []).map((m) => [m.id, m.name as string])),
      );
      const notice = chatNotice(
        // 1:1 은 받는 사람 입장에서 '보낸 사람 이름' 이 방 이름이다
        rRes.data.kind === 'dm' ? me.name : title,
        me.name,
        preview(data as Message),
      );
      const origin = new URL(req.url).origin;
      await fetch(`${origin}/api/push/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...notice,
          url: `/chat/${roomId}`,
          tag: `chat-${roomId}`,
          memberIds: memberIds.filter((m) => m !== me.memberId),
          fromId: me.memberId,
        }),
      });
    } catch {
      /* 무시 */
    }
  })();

  return NextResponse.json({ message: data });
}
