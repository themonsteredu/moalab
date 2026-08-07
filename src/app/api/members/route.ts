import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

/** 요청자가 admin 인지 확인 (내부 도구 수준의 최소 방어) */
async function requireAdmin(req: Request) {
  const admin = getAdminClient();
  if (!admin) return { error: '서버 설정이 아직 안 됐어요.', status: 500 as const, admin: null };

  const actorId = req.headers.get('x-actor-id');
  if (!actorId) return { error: '권한이 없어요.', status: 403 as const, admin: null };

  const { data } = await admin.from('members').select('id,role,active').eq('id', actorId).maybeSingle();
  if (!data || !data.active || data.role !== 'admin') {
    return { error: '관리 권한이 있어야 해요.', status: 403 as const, admin: null };
  }
  return { error: null, status: 200 as const, admin, actorId };
}

function badPin(pin: unknown): boolean {
  return typeof pin !== 'string' || !/^\d{4}$/.test(pin);
}

/** 멤버 추가 */
export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if (!g.admin) return NextResponse.json({ error: g.error }, { status: g.status });

  const body = (await req.json().catch(() => ({}))) as { name?: string; pin?: string; role?: string };
  const name = (body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: '이름을 입력해주세요.' }, { status: 400 });
  if (badPin(body.pin)) return NextResponse.json({ error: 'PIN은 숫자 4자리로 입력해주세요.' }, { status: 400 });

  const { data, error } = await g.admin
    .from('members')
    .insert({ name, pin: body.pin, role: body.role === 'admin' ? 'admin' : 'teacher' })
    .select('id,name,role,active')
    .single();

  if (error) {
    const msg = /duplicate|unique/i.test(error.message)
      ? '이미 같은 이름의 멤버가 있어요.'
      : '멤버를 추가하지 못했어요. 다시 눌러주세요.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  await g.admin.from('activity_logs').insert({ member_id: g.actorId, action: `멤버 추가 — ${name}` });
  return NextResponse.json({ member: data });
}

/** 멤버 수정 (이름 / PIN / 역할 / 활성) */
export async function PATCH(req: Request) {
  const g = await requireAdmin(req);
  if (!g.admin) return NextResponse.json({ error: g.error }, { status: g.status });

  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    pin?: string;
    role?: string;
    active?: boolean;
  };
  if (!body.id) return NextResponse.json({ error: '대상을 찾지 못했어요.' }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const n = body.name.trim();
    if (!n) return NextResponse.json({ error: '이름을 입력해주세요.' }, { status: 400 });
    patch.name = n;
  }
  if (body.pin !== undefined) {
    if (badPin(body.pin)) return NextResponse.json({ error: 'PIN은 숫자 4자리로 입력해주세요.' }, { status: 400 });
    patch.pin = body.pin;
  }
  if (body.role !== undefined) patch.role = body.role === 'admin' ? 'admin' : 'teacher';
  if (body.active !== undefined) patch.active = Boolean(body.active);

  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });

  // 마지막 남은 원장을 강등/비활성화하면 아무도 관리 화면에 못 들어간다.
  if (patch.role === 'teacher' || patch.active === false) {
    const { count } = await g.admin
      .from('members')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
      .eq('active', true);
    const { data: target } = await g.admin.from('members').select('role,active').eq('id', body.id).maybeSingle();
    if ((count ?? 0) <= 1 && target?.role === 'admin' && target?.active) {
      return NextResponse.json({ error: '원장 계정이 하나뿐이라 바꿀 수 없어요.' }, { status: 400 });
    }
  }

  const { data, error } = await g.admin
    .from('members')
    .update(patch)
    .eq('id', body.id)
    .select('id,name,role,active')
    .single();

  if (error) {
    const msg = /duplicate|unique/i.test(error.message)
      ? '이미 같은 이름의 멤버가 있어요.'
      : '수정하지 못했어요. 다시 눌러주세요.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const what = body.pin !== undefined ? 'PIN 변경' : '멤버 수정';
  await g.admin.from('activity_logs').insert({ member_id: g.actorId, action: `${what} — ${data.name}` });
  return NextResponse.json({ member: data });
}

/** 멤버 삭제 — 기록이 딸려 지워지므로 기본은 비활성 처리를 권한다. */
export async function DELETE(req: Request) {
  const g = await requireAdmin(req);
  if (!g.admin) return NextResponse.json({ error: g.error }, { status: g.status });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: '대상을 찾지 못했어요.' }, { status: 400 });
  if (id === g.actorId) return NextResponse.json({ error: '본인 계정은 지울 수 없어요.' }, { status: 400 });

  const { data: target } = await g.admin.from('members').select('name').eq('id', id).maybeSingle();
  const { error } = await g.admin.from('members').delete().eq('id', id);
  if (error) return NextResponse.json({ error: '삭제하지 못했어요. 다시 눌러주세요.' }, { status: 400 });

  await g.admin
    .from('activity_logs')
    .insert({ member_id: g.actorId, action: `멤버 삭제 — ${target?.name ?? id}` });
  return NextResponse.json({ ok: true });
}
