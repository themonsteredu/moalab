import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseAdmin';
import { DRIVE_KEY, OAUTH_KEEP, OAUTH_TTL_MS, type DriveMeta } from '@/lib/drive';

export const dynamic = 'force-dynamic';

/**
 * 구글 동의 화면으로 보낸다. **원장만.**
 *
 * · `access_type=offline` + `prompt=consent` 를 반드시 붙인다 —
 *   없으면 구글이 **리프레시 토큰을 안 준다.** 그러면 한 시간 뒤에 연결이 끊긴다
 * · scope 는 `drive`(전체)다. `drive.file` 은 이 앱이 만든 파일만 볼 수 있어서
 *   원장이 이미 손으로 만들어둔 `모아랩` 폴더 안에 못 넣는다
 * · 한 번짜리 `state` 를 만들어 저장해둔다 — 돌아오는 자리에서 이걸로 확인한다
 *   (그 자리는 구글이 브라우저를 직접 보내는 곳이라 우리 헤더가 없다)
 * · **앞서 만든 것을 덮어쓰지 않고 몇 개를 같이 들고 있는다.** 폰에서 구글 창을
 *   닫지 않고 여기서 한 번 더 누르면, 앞 창을 끝내도 확인값이 안 맞아 튕긴다
 */
export async function GET(req: Request) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: '서버 설정이 아직 안 됐어요.' }, { status: 500 });

  const actorId = new URL(req.url).searchParams.get('actor');
  if (!actorId) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 });
  const { data: me } = await admin.from('members').select('role,active').eq('id', actorId).maybeSingle();
  if (!me || !me.active || me.role !== 'admin') {
    return NextResponse.json({ error: '원장만 쓸 수 있어요.' }, { status: 403 });
  }

  const { data } = await admin.from('app_secrets').select('value, meta').eq('key', DRIVE_KEY).maybeSingle();
  let value: Record<string, string> = {};
  try {
    value = data?.value ? JSON.parse(data.value) : {};
  } catch {
    value = {};
  }
  if (!value.clientId || !value.clientSecret) {
    return NextResponse.json({ error: '먼저 클라이언트 ID·시크릿을 저장해주세요.' }, { status: 400 });
  }

  const state = crypto.randomUUID();
  const now = Date.now();
  const prev = ((data?.meta ?? {}) as DriveMeta).oauthStates ?? [];
  const meta: DriveMeta = {
    ...((data?.meta ?? {}) as DriveMeta),
    oauthStates: [...prev.filter((x) => x?.s && x.until > now), { s: state, until: now + OAUTH_TTL_MS }].slice(
      -OAUTH_KEEP,
    ),
  };
  // 옛 한 개짜리 칸은 새 목록으로 옮겨 담고 지운다
  if (meta.oauthState && (meta.oauthUntil ?? 0) > now) {
    meta.oauthStates = [{ s: meta.oauthState, until: meta.oauthUntil ?? 0 }, ...meta.oauthStates!].slice(-OAUTH_KEEP);
  }
  delete meta.oauthState;
  delete meta.oauthUntil;
  const { error: saveErr } = await admin.from('app_secrets').update({ meta }).eq('key', DRIVE_KEY);
  console.log('[drive/start] 확인값 발급', {
    made: state.slice(0, 8),
    keeping: meta.oauthStates?.map((x) => x.s.slice(0, 8)),
    saveErr: saveErr?.message ?? null,
  });

  const origin = new URL(req.url).origin;
  const go = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  go.searchParams.set('client_id', value.clientId);
  go.searchParams.set('redirect_uri', `${origin}/api/settings/drive/callback`);
  go.searchParams.set('response_type', 'code');
  go.searchParams.set('scope', 'https://www.googleapis.com/auth/drive');
  go.searchParams.set('access_type', 'offline');
  go.searchParams.set('prompt', 'consent');
  go.searchParams.set('state', state);
  return NextResponse.redirect(go);
}
