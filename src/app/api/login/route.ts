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

  return NextResponse.json({ member: { id: data.id, name: data.name, role: data.role } });
}
