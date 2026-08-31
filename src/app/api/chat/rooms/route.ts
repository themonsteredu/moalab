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
    /* 전체방·부서방 맞추기는 **화면에 들어올 때(sync=1)만** 한다.
       폴링마다 하면 부서·중분류·역할·부담당 네 표를 몇 초마다 다시 읽는다 —
       대화 화면이 느렸던 가장 큰 이유였다. 역할이 바뀌어 새 부서방이 생기는 것은
       다음에 대화 화면에 들어올 때 따라온다 (원래 정해둔 동작 그대로다). */
    if (new URL(req.url).searchParams.get('sync') === '1') {
      await ensureRooms(admin, me.memberId);
    }
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
