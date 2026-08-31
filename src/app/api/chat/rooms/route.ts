import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseAdmin';
import { actorFromToken, ensureRooms, myRooms, openDm, tokenOf } from '@/lib/chatServer';

export const dynamic = 'force-dynamic';

/**
 * 내가 든 방 목록.
 *
 * 브라우저는 대화 표에 아예 못 붙는다 — 여기가 유일한 통로다.
 * 들어올 때마다 전체방·부서방을 맞춰준다 (역할이 바뀌면 저절로 따라온다).
 */
export async function GET(req: Request) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: '서버 설정이 아직 안 됐어요.' }, { status: 500 });

  const me = await actorFromToken(admin, tokenOf(req));
  if (!me) return NextResponse.json({ error: '다시 로그인해주세요.' }, { status: 401 });

  try {
    await ensureRooms(admin, me.memberId);
    return NextResponse.json({ rooms: await myRooms(admin, me.memberId) });
  } catch {
    return NextResponse.json({ error: '대화를 불러오지 못했어요. 다시 시도해주세요.' }, { status: 500 });
  }
}

/** 1:1 방 열기 — 없으면 만들고, 있으면 그 방을 준다 */
export async function POST(req: Request) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: '서버 설정이 아직 안 됐어요.' }, { status: 500 });

  const me = await actorFromToken(admin, tokenOf(req));
  if (!me) return NextResponse.json({ error: '다시 로그인해주세요.' }, { status: 401 });

  let body: { memberId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '요청을 읽지 못했어요.' }, { status: 400 });
  }
  if (!body.memberId) return NextResponse.json({ error: '대화할 사람을 골라주세요.' }, { status: 400 });
  if (body.memberId === me.memberId) {
    return NextResponse.json({ error: '자기 자신과는 대화할 수 없어요.' }, { status: 400 });
  }

  const roomId = await openDm(admin, me.memberId, body.memberId);
  if (!roomId) return NextResponse.json({ error: '대화방을 열지 못했어요.' }, { status: 500 });
  return NextResponse.json({ roomId });
}
