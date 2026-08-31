import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseAdmin';
import { actorFromToken, isMember, tokenOf } from '@/lib/chatServer';

export const dynamic = 'force-dynamic';

/**
 * 여기까지 읽었다고 표시.
 *
 * **읽음은 메시지마다가 아니라 사람마다 한 줄**(`last_read_at`)이다.
 * 메시지 × 사람으로 두면 5명이 100줄만 주고받아도 500줄이 쌓인다.
 */
export async function POST(req: Request) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: '서버 설정이 아직 안 됐어요.' }, { status: 500 });

  const me = await actorFromToken(admin, tokenOf(req));
  if (!me) return NextResponse.json({ error: '다시 로그인해주세요.' }, { status: 401 });

  let body: { roomId?: string; at?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '요청을 읽지 못했어요.' }, { status: 400 });
  }

  const roomId = body.roomId ?? '';
  if (!(await isMember(admin, roomId, me.memberId))) {
    return NextResponse.json({ error: '볼 수 없는 대화방이에요.' }, { status: 403 });
  }

  const at = body.at ?? new Date().toISOString();
  /* 뒤로 되돌리지 않는다 — 늦게 도착한 요청이 읽음을 과거로 밀면 안 읽음이 되살아난다.
     '읽어보고 → 더 최신이면 쓴다' 를 **조건부 update 한 번**으로 합쳤다.
     쿼리가 절반이 되고, 두 요청이 겹쳐도 DB 가 알아서 걸러준다 (읽고 쓰는 사이의 틈이 없다) */
  await admin
    .from('room_members')
    .update({ last_read_at: at })
    .eq('room_id', roomId)
    .eq('member_id', me.memberId)
    .lt('last_read_at', at);

  return NextResponse.json({ ok: true, at });
}
