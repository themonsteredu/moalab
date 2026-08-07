import { NextResponse } from 'next/server';
import webpush from 'web-push';
import { getAdminClient } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

interface Body {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  memberIds?: string[];
  fromId?: string | null;
}

function configured(): boolean {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:moalab@example.com', pub, priv);
  return true;
}

/**
 * 푸시 발송. 구독 정보는 service_role 로만 읽는다.
 *
 * 알림은 "있으면 좋은 것"이라 실패해도 200 을 돌려준다 —
 * 호출한 쪽(공지 저장 등)이 알림 때문에 막히면 안 된다.
 */
export async function POST(req: Request) {
  if (!configured()) {
    return NextResponse.json({ sent: 0, skipped: 'VAPID 키가 없어요.' });
  }

  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ sent: 0, skipped: '서버 설정이 아직 안 됐어요.' });

  let payload: Body;
  try {
    payload = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: '요청을 읽지 못했어요.' }, { status: 400 });
  }

  const title = (payload.title ?? '').trim();
  if (!title) return NextResponse.json({ error: '제목이 없어요.' }, { status: 400 });

  let q = admin.from('push_subscriptions').select('id,member_id,endpoint,p256dh,auth');
  if (payload.memberIds && payload.memberIds.length > 0) {
    q = q.in('member_id', payload.memberIds);
  }
  const { data: subs, error } = await q;
  if (error) return NextResponse.json({ sent: 0, skipped: error.message });

  // 자기가 한 일이 자기 폰에 다시 울리면 성가시다
  const targets = (subs ?? []).filter((s) => !payload.fromId || s.member_id !== payload.fromId);
  if (targets.length === 0) return NextResponse.json({ sent: 0 });

  const message = JSON.stringify({
    title,
    body: (payload.body ?? '').slice(0, 300),
    url: payload.url ?? '/home',
    tag: payload.tag ?? 'moalab',
  });

  const dead: string[] = [];
  let sent = 0;

  await Promise.all(
    targets.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          message,
        );
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        // 404/410 = 구독이 죽었다 (앱 삭제, 브라우저 초기화 등) → 정리한다
        if (code === 404 || code === 410) dead.push(s.endpoint);
      }
    }),
  );

  if (dead.length > 0) {
    await admin.from('push_subscriptions').delete().in('endpoint', dead);
  }

  return NextResponse.json({ sent, removed: dead.length });
}
