import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

/**
 * PIN 검증은 반드시 서버에서 한다.
 * members 테이블은 RLS 로 anon 접근을 막아뒀기 때문에
 * 브라우저에서는 PIN 을 읽을 수 없다.
 */
export async function POST(req: Request) {
  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: '서버 설정이 아직 안 됐어요. 관리자에게 알려주세요.' },
      { status: 500 },
    );
  }

  let body: { memberId?: string; pin?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '요청을 읽지 못했어요.' }, { status: 400 });
  }

  const { memberId, pin } = body;
  if (!memberId || !pin) {
    return NextResponse.json({ error: '이름과 PIN을 확인해주세요.' }, { status: 400 });
  }

  const { data, error } = await admin
    .from('members')
    .select('id,name,role,pin,active')
    .eq('id', memberId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: '로그인 중 문제가 생겼어요. 다시 눌러주세요.' }, { status: 500 });
  }
  if (!data || !data.active) {
    return NextResponse.json({ error: '사용할 수 없는 계정이에요.' }, { status: 403 });
  }
  if (String(data.pin) !== String(pin)) {
    return NextResponse.json({ error: 'PIN이 맞지 않아요.' }, { status: 401 });
  }

  await admin.from('activity_logs').insert({ member_id: data.id, action: '로그인', target: null });

  /* 대화 격리에 쓸 세션 토큰을 발급한다.
     `x-actor-id` 헤더는 브라우저가 아무 값이나 넣을 수 있어서 남의 1:1 대화를
     읽는 데 쓸 수 있다 — 그래서 대화만은 이 토큰으로 신원을 확인한다
     (moalab.sessions 는 PIN 과 똑같이 잠겨 있어 브라우저가 지어낼 수 없다).

     ※ 토큰 발급이 실패해도 **로그인은 그대로 된다.** 대화만 다시 로그인을 요구한다 —
       알림 발송이 실패해도 공지가 올라가는 것과 같은 판단이다. */
  let token: string | null = null;
  try {
    const { data: sess } = await admin
      .from('sessions')
      .insert({
        member_id: data.id,
        user_agent: (req.headers.get('user-agent') ?? '').slice(0, 300),
      })
      .select('token')
      .maybeSingle();
    token = sess?.token ?? null;
  } catch {
    /* 표가 아직 없는 DB 여도 로그인은 막지 않는다 */
  }

  return NextResponse.json({ member: { id: data.id, name: data.name, role: data.role }, token });
}
