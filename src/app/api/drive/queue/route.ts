import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseAdmin';
import { DRIVE_KEY, type DriveMeta } from '@/lib/drive';
import { fileNameFor, isDriveKind, pathFor, type DriveKind } from '@/lib/drivePath';

export const dynamic = 'force-dynamic';

/**
 * "이 파일도 드라이브에 올려줘" 하고 **줄만 세운다.** 실제 올리기는 /api/drive/run 이 한다.
 *
 * 화면은 이걸 **기다리지 않는다**(fire-and-forget). 드라이브가 느리거나 죽어도
 * 강사의 파일 올리기는 이미 끝나 있어야 한다 — 알림이 실패해도 공지가 올라가는 것과
 * 같은 규칙이다.
 */
export async function POST(req: Request) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ skipped: '서버 설정 없음' });

  const actorId = req.headers.get('x-actor-id');
  if (!actorId) return NextResponse.json({ skipped: '누구인지 모름' });

  const body = (await req.json().catch(() => ({}))) as {
    kind?: string;
    files?: { url: string; name: string; mime?: string }[];
    topic?: string | null;
    appTitle?: string | null;
    month?: string | null;
    date?: string | null;
    school?: string | null;
    deptName?: string | null;
    prefix?: string | null;
  };

  const kind = body.kind ?? '';
  if (!isDriveKind(kind)) return NextResponse.json({ skipped: '모르는 갈래' });
  const files = (body.files ?? []).filter((f) => f?.url && f?.name);
  if (files.length === 0) return NextResponse.json({ queued: 0 });

  /* 연결이 안 돼 있거나 이 갈래를 껐으면 **줄도 안 세운다.**
     세워두면 나중에 연결했을 때 옛날 파일이 한꺼번에 쏟아진다 */
  const { data: sec } = await admin.from('app_secrets').select('value, meta').eq('key', DRIVE_KEY).maybeSingle();
  if (!sec?.value) return NextResponse.json({ skipped: '드라이브 연결 안 됨' });
  try {
    if (!JSON.parse(sec.value).refreshToken) return NextResponse.json({ skipped: '드라이브 연결 안 됨' });
  } catch {
    return NextResponse.json({ skipped: '설정이 깨짐' });
  }
  const meta = (sec.meta ?? {}) as DriveMeta;
  if (meta.kinds && !meta.kinds.includes(kind as DriveKind)) {
    return NextResponse.json({ skipped: '이 갈래는 꺼져 있음' });
  }

  const folder = pathFor(kind as DriveKind, body);
  if (!folder) return NextResponse.json({ skipped: '어느 폴더로 갈지 모름' });

  /* source_url 이 unique 라 같은 파일을 두 번 눌러도 한 줄만 남는다 */
  const rows = files.map((f) => ({
    kind,
    source_url: f.url,
    folder_path: folder,
    file_name: fileNameFor(f.name, body.prefix ?? null),
    mime_type: f.mime ?? null,
    member_id: actorId,
  }));
  const { error } = await admin.from('drive_uploads').upsert(rows, { onConflict: 'source_url', ignoreDuplicates: true });
  if (error) return NextResponse.json({ skipped: error.message });

  // 바로 한 번 돌려본다 (기다리지 않는다). 실패해도 줄에 남아 있어 다시 시도된다
  void fetch(`${new URL(req.url).origin}/api/drive/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-actor-id': actorId },
  }).catch(() => null);

  return NextResponse.json({ queued: rows.length, folder });
}
