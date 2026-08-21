import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

const KEY = 'anthropic_api_key';

/**
 * AI 키 등록·삭제. **원장만.**
 *
 * 키는 `moalab.app_secrets` 에 들어가는데, 그 표는 PIN(`members`)과 똑같이
 * anon/authenticated 를 걷어내서 **브라우저에서는 아예 못 붙는다.**
 * 그래서 이 라우트도 값을 절대 돌려주지 않는다 — 끝 4자리(hint)만 알려준다.
 */
async function requireAdmin(req: Request) {
  const admin = getAdminClient();
  if (!admin) return { error: '서버 설정이 아직 안 됐어요.', status: 500 as const, admin: null };

  const actorId = req.headers.get('x-actor-id');
  if (!actorId) return { error: '권한이 없어요.', status: 403 as const, admin: null };

  const { data } = await admin.from('members').select('id,role,active').eq('id', actorId).maybeSingle();
  if (!data || !data.active || data.role !== 'admin') {
    return { error: '원장만 쓸 수 있어요.', status: 403 as const, admin: null };
  }
  return { error: null, status: 200 as const, admin, actorId };
}

/** 등록됐는지만 알려준다. 값은 절대 안 나간다 */
export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if (!g.admin) return NextResponse.json({ error: g.error }, { status: g.status });

  const { data, error } = await g.admin
    .from('app_secrets')
    .select('hint,updated_at')
    .eq('key', KEY)
    .maybeSingle();

  if (error) {
    // 표가 아직 없을 때가 대부분이다 — 그 사실을 그대로 알려준다
    return NextResponse.json({ configured: false, missing: true, detail: error.message });
  }
  return NextResponse.json({
    configured: Boolean(data),
    hint: data?.hint ?? null,
    updated_at: data?.updated_at ?? null,
  });
}

/** 등록 / 바꾸기 */
export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if (!g.admin) return NextResponse.json({ error: g.error }, { status: g.status });

  const body = (await req.json().catch(() => ({}))) as { key?: string };
  const key = (body.key ?? '').trim();

  if (!key) return NextResponse.json({ error: 'API 키를 붙여넣어 주세요.' }, { status: 400 });
  if (!key.startsWith('sk-ant-')) {
    return NextResponse.json(
      { error: 'Anthropic API 키가 아닌 것 같아요. sk-ant- 로 시작하는 키를 붙여넣어 주세요.' },
      { status: 400 },
    );
  }
  if (key.length < 20 || /\s/.test(key)) {
    return NextResponse.json({ error: '키가 잘린 것 같아요. 처음부터 끝까지 붙여넣어 주세요.' }, { status: 400 });
  }

  const { error } = await g.admin.from('app_secrets').upsert(
    {
      key: KEY,
      value: key,
      hint: key.slice(-4),
      updated_by: g.actorId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  );

  if (error) {
    return NextResponse.json(
      { error: `키를 저장하지 못했어요 — ${error.message.slice(0, 120)}` },
      { status: 400 },
    );
  }

  // 로그에는 키를 남기지 않는다 (활동 로그는 원장 화면에서 그대로 보인다)
  await g.admin.from('activity_logs').insert({ member_id: g.actorId, action: 'AI 키 등록' });
  return NextResponse.json({ configured: true, hint: key.slice(-4) });
}

/** 지우기 */
export async function DELETE(req: Request) {
  const g = await requireAdmin(req);
  if (!g.admin) return NextResponse.json({ error: g.error }, { status: g.status });

  const { error } = await g.admin.from('app_secrets').delete().eq('key', KEY);
  if (error) {
    return NextResponse.json({ error: '키를 지우지 못했어요. 다시 눌러주세요.' }, { status: 400 });
  }
  await g.admin.from('activity_logs').insert({ member_id: g.actorId, action: 'AI 키 삭제' });
  return NextResponse.json({ configured: false });
}
