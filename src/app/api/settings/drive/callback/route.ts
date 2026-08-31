import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseAdmin';
import { DRIVE_KEY, type DriveMeta } from '@/lib/drive';

export const dynamic = 'force-dynamic';

/**
 * 구글 동의 화면에서 돌아오는 자리.
 *
 * 여기는 **구글이 브라우저를 직접 보내는 곳**이라 `x-actor-id` 헤더가 없다.
 * 그래서 원장인지는 `state` 로 확인한다 — 시작할 때 서버가 만들어 저장해둔
 * 한 번짜리 값이다 (남이 주소를 흉내내도 state 가 안 맞으면 아무것도 안 한다).
 *
 * 끝나면 화면(관리)으로 돌려보낸다. 여기서 JSON 을 뿌리면 원장이 흰 화면에 갇힌다.
 */
function back(origin: string, msg: string, ok = false) {
  const url = new URL('/admin', origin);
  url.searchParams.set('tab', 'drive');
  url.searchParams.set(ok ? 'driveOk' : 'driveError', msg);
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const admin = getAdminClient();
  if (!admin) return back(origin, '서버 설정이 아직 안 됐어요.');

  const err = url.searchParams.get('error');
  if (err) {
    return back(origin, err === 'access_denied' ? '구글에서 연결을 취소했어요.' : `구글이 거절했어요 (${err})`);
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    console.error('[drive/callback] E1 값 모자람', { hasCode: Boolean(code), hasState: Boolean(state) });
    return back(origin, '구글이 보낸 값이 모자라요. 다시 눌러주세요. (E1)');
  }

  const { data } = await admin.from('app_secrets').select('value, meta').eq('key', DRIVE_KEY).maybeSingle();
  if (!data?.value) return back(origin, '먼저 클라이언트 ID·시크릿을 저장해주세요.');

  let value: Record<string, string>;
  try {
    value = JSON.parse(data.value);
  } catch {
    return back(origin, '저장된 값이 깨졌어요. 클라이언트 ID 를 다시 저장해주세요.');
  }
  const meta = (data.meta ?? {}) as DriveMeta;

  /* 확인값은 **여러 개를 같이 본다.** 폰에서 구글 창을 닫지 않고 관리 화면에서 한 번 더
     누르면 확인값이 새로 생기는데, 그래도 앞 창을 끝까지 진행할 수 있어야 한다 */
  const known = [
    ...(meta.oauthStates ?? []),
    ...(meta.oauthState ? [{ s: meta.oauthState, until: meta.oauthUntil ?? 0 }] : []),
  ];
  const hit = known.find((x) => x?.s === state);
  if (!hit) {
    /* 어느 값이 왔고 우리가 뭘 들고 있었는지 남긴다 — 확인값 자체는 비밀이 아니지만
       앞 8자만 적는다 (로그로 그대로 쓰이지 않게) */
    console.error('[drive/callback] E2 확인값 없음', {
      got: state.slice(0, 8),
      known: known.map((x) => x?.s?.slice(0, 8)),
    });
    return back(
      origin,
      '이 연결 창은 이미 만료됐어요. 열려 있는 구글 창을 모두 닫고, 관리 화면에서 한 번만 다시 눌러주세요. (E2)',
    );
  }
  if (hit.until < Date.now()) {
    console.error('[drive/callback] E3 시간 지남', { got: state.slice(0, 8), late: Date.now() - hit.until });
    return back(origin, '연결 시간이 지났어요. 관리 화면에서 다시 눌러주세요. (E3)');
  }

  /* 코드를 리프레시 토큰으로 바꾼다 */
  let refreshToken = '';
  let accessToken = '';
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: value.clientId,
        client_secret: value.clientSecret,
        redirect_uri: `${origin}/api/settings/drive/callback`,
        grant_type: 'authorization_code',
      }),
    });
    const j = (await res.json()) as {
      refresh_token?: string;
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!res.ok) {
      console.error('[drive/callback] E4 토큰 교환 거절', {
        status: res.status,
        error: j.error,
        detail: j.error_description,
        redirect: `${origin}/api/settings/drive/callback`,
      });
      return back(origin, `구글이 거절했어요 — ${j.error_description ?? j.error ?? res.status} (E4)`);
    }
    if (!j.refresh_token) {
      /* 이미 동의한 계정이면 구글이 리프레시 토큰을 다시 안 준다.
         start 라우트가 prompt=consent 를 붙이므로 보통은 안 생기는 일이다 */
      console.error('[drive/callback] E5 갱신 토큰 없음', { hasAccess: Boolean(j.access_token) });
      return back(
        origin,
        '구글이 갱신 토큰을 안 줬어요. 구글 계정 > 보안 > 타사 앱에서 모아랩을 지우고 다시 해주세요. (E5)',
      );
    }
    refreshToken = j.refresh_token;
    accessToken = j.access_token ?? '';
  } catch {
    return back(origin, '구글에 닿지 못했어요. 잠시 후 다시 눌러주세요.');
  }

  /* 어느 계정에 연결됐는지 적어둔다 — 화면에 보여줘야 원장이 헷갈리지 않는다 */
  let email: string | null = null;
  if (accessToken) {
    try {
      const who = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (who.ok) email = ((await who.json()) as { user?: { emailAddress?: string } }).user?.emailAddress ?? null;
    } catch {
      /* 이름을 못 읽어도 연결 자체는 됐다 */
    }
  }

  value.refreshToken = refreshToken;
  // 다 쓴 확인값은 하나도 남기지 않는다 (같은 것으로 두 번 들어올 수 없게)
  delete meta.oauthStates;
  delete meta.oauthState;
  delete meta.oauthUntil;
  if (email) meta.email = email;
  // 열쇠가 바뀌었을 수 있으니 폴더 캐시는 버린다
  delete meta.folders;
  delete meta.rootId;

  const { error } = await admin
    .from('app_secrets')
    .update({ value: JSON.stringify(value), meta, updated_at: new Date().toISOString() })
    .eq('key', DRIVE_KEY);
  if (error) {
    console.error('[drive/callback] E6 저장 실패', error.message);
    return back(origin, '토큰을 저장하지 못했어요. ' + error.message + ' (E6)');
  }
  console.log('[drive/callback] 연결 성공', { email });

  return back(origin, email ? `${email} 계정으로 연결됐어요.` : '연결됐어요.', true);
}
