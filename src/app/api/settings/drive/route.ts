import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseAdmin';
import { DRIVE_KEY, loadConfig, type DriveMeta } from '@/lib/drive';
import { isDriveKind, type DriveKind } from '@/lib/drivePath';

export const dynamic = 'force-dynamic';

/**
 * 구글 드라이브 연결 상태·설정. **원장만.**
 *
 * 클라이언트 시크릿과 리프레시 토큰은 `app_secrets` 에 있고, 그 표는 PIN 과 똑같이
 * 잠겨 있다. 그래서 이 라우트도 **값을 절대 돌려주지 않는다** — 연결됐는지,
 * 어느 계정인지, 어떤 갈래를 켰는지만 알려준다.
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

export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if (!g.admin) return NextResponse.json({ error: g.error }, { status: g.status });

  const { data, error } = await g.admin
    .from('app_secrets')
    .select('value, meta, updated_at')
    .eq('key', DRIVE_KEY)
    .maybeSingle();

  if (error) return NextResponse.json({ connected: false, missing: true, detail: error.message });

  let hasKeys = false;
  let connected = false;
  try {
    const v = data?.value ? JSON.parse(data.value) : {};
    hasKeys = Boolean(v.clientId && v.clientSecret);
    connected = hasKeys && Boolean(v.refreshToken);
  } catch {
    /* 값이 깨졌으면 안 연결된 것으로 본다 */
  }
  const meta = (data?.meta ?? {}) as DriveMeta;

  // 아직 못 올린 것 / 실패한 것을 같이 알려준다 — 관리 화면이 이걸 보여준다
  const [pend, fail] = await Promise.all([
    g.admin.from('drive_uploads').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    g.admin.from('drive_uploads').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
  ]);

  return NextResponse.json({
    connected,
    hasKeys,
    email: meta.email ?? null,
    kinds: meta.kinds ?? null, // null = 전부 켜짐
    pending: pend.count ?? 0,
    failed: fail.count ?? 0,
    updated_at: data?.updated_at ?? null,
  });
}

/** 클라이언트 ID·시크릿 저장, 또는 켤 갈래 바꾸기 */
export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if (!g.admin) return NextResponse.json({ error: g.error }, { status: g.status });

  const body = (await req.json().catch(() => ({}))) as {
    clientId?: string;
    clientSecret?: string;
    kinds?: string[];
  };

  const { data: cur } = await g.admin
    .from('app_secrets')
    .select('value, meta')
    .eq('key', DRIVE_KEY)
    .maybeSingle();
  let value: Record<string, string> = {};
  try {
    value = cur?.value ? JSON.parse(cur.value) : {};
  } catch {
    value = {};
  }
  const meta = (cur?.meta ?? {}) as DriveMeta;

  // 갈래만 바꾸는 요청 — 열쇠는 그대로 둔다 (AI 키에서 모델만 바꾸는 것과 같은 꼴)
  if (body.kinds) {
    meta.kinds = body.kinds.filter(isDriveKind) as DriveKind[];
  }

  if (body.clientId && body.clientSecret) {
    const id = body.clientId.trim();
    const secret = body.clientSecret.trim();
    if (!id.endsWith('.apps.googleusercontent.com')) {
      return NextResponse.json(
        { error: '클라이언트 ID 가 아닌 것 같아요. `...apps.googleusercontent.com` 으로 끝나야 해요.' },
        { status: 400 },
      );
    }
    // 열쇠가 바뀌면 예전 토큰은 못 쓴다 — 다시 연결해야 한다
    if (value.clientId !== id) delete value.refreshToken;
    value.clientId = id;
    value.clientSecret = secret;
  }

  const { error } = await g.admin.from('app_secrets').upsert(
    {
      key: DRIVE_KEY,
      value: JSON.stringify(value),
      hint: value.clientId ? value.clientId.slice(0, 12) : null,
      meta,
      updated_by: g.actorId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  );
  if (error) return NextResponse.json({ error: '저장하지 못했어요. ' + error.message }, { status: 500 });
  return NextResponse.json({ ok: true, connected: Boolean(value.refreshToken) });
}

/** 연결 끊기 — 토큰만 지운다. 이미 올라간 파일은 드라이브에 그대로 남는다 */
export async function DELETE(req: Request) {
  const g = await requireAdmin(req);
  if (!g.admin) return NextResponse.json({ error: g.error }, { status: g.status });

  const cfg = await loadConfig(g.admin);
  // 구글 쪽에서도 권한을 거둔다 (실패해도 우리 쪽은 지운다)
  if (cfg) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(cfg.refreshToken)}`, {
        method: 'POST',
      });
    } catch {
      /* 무시 */
    }
  }
  await g.admin.from('app_secrets').delete().eq('key', DRIVE_KEY);
  return NextResponse.json({ ok: true });
}
