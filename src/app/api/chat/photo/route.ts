import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseAdmin';
import { actorFromToken, isMember, tokenOf } from '@/lib/chatServer';

export const dynamic = 'force-dynamic';

const BUCKET = 'moalab-chat';
/** 서명 URL 이 살아있는 시간. 짧게 두고 볼 때마다 새로 받는다 */
const SIGNED_SECONDS = 60 * 60;
/** 브라우저가 이미 1600px WebP 로 줄여서 보낸다. 그보다 크면 뭔가 잘못된 것이다 */
const MAX_BYTES = 8 * 1024 * 1024;

/** 경로 앞머리가 방 id 다 — `${roomId}/${uuid}.webp`.
 *  이렇게 두면 사진을 볼 때도 그 방 멤버인지 확인할 수 있다 */
function roomOf(path: string): string {
  return path.split('/')[0] ?? '';
}

/**
 * 대화 사진 올리기.
 *
 * 버킷이 **비공개**라 브라우저가 직접 못 올린다 — 다른 화면들이 `uploadFile()` 로
 * 바로 Storage 에 넣는 것과 다른 점이다. 표를 잠가놓고 사진만 공개 URL 이면
 * 잠근 의미가 없어서 이렇게 했다.
 */
export async function POST(req: Request) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: '서버 설정이 아직 안 됐어요.' }, { status: 500 });

  const me = await actorFromToken(admin, tokenOf(req));
  if (!me) return NextResponse.json({ error: '다시 로그인해주세요.' }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: '사진을 읽지 못했어요.' }, { status: 400 });
  }

  const roomId = String(form.get('roomId') ?? '');
  const file = form.get('file');
  if (!(file instanceof Blob)) return NextResponse.json({ error: '사진을 골라주세요.' }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: '사진이 너무 커요. 다시 골라주세요.' }, { status: 400 });
  }
  if (!(await isMember(admin, roomId, me.memberId))) {
    return NextResponse.json({ error: '보낼 수 없는 대화방이에요.' }, { status: 403 });
  }

  const path = `${roomId}/${crypto.randomUUID()}.webp`;
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: file.type || 'image/webp', upsert: false });
  if (error) {
    return NextResponse.json(
      { error: `사진을 못 올렸어요. (${error.message.slice(0, 80)})` },
      { status: 500 },
    );
  }
  return NextResponse.json({ path });
}

/** 사진 보기 — 그 방 멤버에게만 서명 URL 을 내준다 */
export async function GET(req: Request) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: '서버 설정이 아직 안 됐어요.' }, { status: 500 });

  const me = await actorFromToken(admin, tokenOf(req));
  if (!me) return NextResponse.json({ error: '다시 로그인해주세요.' }, { status: 401 });

  const path = new URL(req.url).searchParams.get('path') ?? '';
  if (!path || path.includes('..')) return NextResponse.json({ error: '잘못된 사진이에요.' }, { status: 400 });

  if (!(await isMember(admin, roomOf(path), me.memberId))) {
    return NextResponse.json({ error: '볼 수 없는 사진이에요.' }, { status: 403 });
  }

  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, SIGNED_SECONDS);
  if (error || !data) return NextResponse.json({ error: '사진을 불러오지 못했어요.' }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl });
}
