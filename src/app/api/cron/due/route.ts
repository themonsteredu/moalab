import { NextResponse } from 'next/server';
import webpush from 'web-push';
import { getAdminClient } from '@/lib/supabaseAdmin';
import { kstDateStr, remindBody, remindTargets, remindTitle, shiftDate } from '@/lib/task';
import type { Task } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 기한 알림 — 매일 아침 한 번 (`vercel.json` 의 cron 이 부른다).
 *
 * 오늘·내일 마감인 업무를 **담당자별로 묶어 그 사람에게만** 보낸다.
 * Vercel 무료 플랜은 cron 이 하루 1회라 저녁/아침 두 번을 못 쓴다.
 * 그래서 아침 한 통에 '오늘 N건 · 내일 M건' 을 같이 담는다.
 *
 * ⚠️ 서버의 '오늘' 은 한국 날짜가 아니다 (Vercel 은 UTC 로 돈다).
 *    `kstDateStr()` 를 안 쓰면 한국 시간 아침 9시 전까지 어제 날짜가 나와서
 *    **알림이 하루씩 밀린다.** 이 기능에서 가장 흔한 버그다.
 *
 * 보낸 뒤 `reminded_on` 에 오늘 날짜를 적어둔다 — cron 이 두 번 돌거나
 * 손으로 한 번 더 불러도 같은 사람에게 두 통이 가지 않는다.
 */

function vapidReady(): boolean {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:moalab@example.com', pub, priv);
  return true;
}

/** Vercel Cron 은 CRON_SECRET 이 있으면 Authorization 헤더를 붙여준다 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // 비밀키가 없으면 열어두지 않는다 — 이 주소는 누구나 부를 수 있다
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

async function run(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: '권한이 없어요.' }, { status: 401 });
  }

  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ sent: 0, skipped: '서버 설정이 아직 안 됐어요.' });
  if (!vapidReady()) return NextResponse.json({ sent: 0, skipped: 'VAPID 키가 없어요.' });

  const today = kstDateStr(new Date());
  const tomorrow = shiftDate(today, 1);

  const { data, error } = await admin
    .from('tasks')
    .select('*')
    .neq('state', 'done')
    .in('due_date', [today, tomorrow]);
  if (error) return NextResponse.json({ sent: 0, skipped: error.message });

  const groups = remindTargets((data ?? []) as Task[], today, tomorrow);
  if (groups.length === 0) return NextResponse.json({ today, sent: 0, people: 0 });

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id,member_id,endpoint,p256dh,auth')
    .in('member_id', groups.map((g) => g.memberId));

  const dead: string[] = [];
  let sent = 0;
  const remindedIds: string[] = [];

  for (const g of groups) {
    const mine = (subs ?? []).filter((s) => s.member_id === g.memberId);
    // 알림을 안 켠 사람도 '보낸 것' 으로 표시한다 — 안 그러면 매일 같은 줄을 다시 시도한다
    remindedIds.push(...g.today.map((t) => t.id), ...g.tomorrow.map((t) => t.id));
    if (mine.length === 0) continue;

    const message = JSON.stringify({
      title: remindTitle(g),
      body: remindBody(g),
      url: '/task',
      tag: `due-${today}`,
    });

    await Promise.all(
      mine.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            message,
          );
          sent++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) dead.push(s.endpoint);
        }
      }),
    );
  }

  if (dead.length > 0) {
    await admin.from('push_subscriptions').delete().in('endpoint', dead);
  }
  if (remindedIds.length > 0) {
    await admin.from('tasks').update({ reminded_on: today }).in('id', remindedIds);
  }

  return NextResponse.json({
    today,
    people: groups.length,
    tasks: remindedIds.length,
    sent,
    removed: dead.length,
  });
}

/** Vercel Cron 이 부르는 쪽 */
export async function GET(req: Request) {
  return run(req);
}

/** 손으로 확인할 때 (curl -X POST -H "authorization: Bearer ...") */
export async function POST(req: Request) {
  return run(req);
}
