import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseAdmin';
import {
  DRIVE_KEY,
  ensurePath,
  ensureRoot,
  getAccessToken,
  loadConfig,
  saveMeta,
  uploadFile,
  type DriveMeta,
} from '@/lib/drive';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** 한 번에 처리할 줄 수. 서버리스 시간 제한 안에 끝나야 한다 */
const BATCH = 12;
/** 이만큼 실패하면 그만 시도한다 — 화면에서 원장이 직접 다시 누른다 */
const MAX_TRIES = 4;
/** 드라이브에 올릴 파일 크기 한도 (수업 사진 수백 장이 서버 메모리를 먹지 않게) */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * 줄 서 있는 파일을 실제로 드라이브에 올린다.
 *
 * `/api/drive/queue` 가 부르고, 관리 화면의 `다시 시도` 도 부른다.
 * **여기서 나는 어떤 실패도 앱의 본 작업을 막지 않는다** — 이미 끝난 일의 뒤처리라서다.
 */
export async function POST(req: Request) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ skipped: '서버 설정 없음' });

  const retry = new URL(req.url).searchParams.get('retry') === '1';

  const cfg = await loadConfig(admin);
  if (!cfg) return NextResponse.json({ skipped: '드라이브 연결 안 됨' });

  const access = await getAccessToken(cfg);
  if (!access) {
    return NextResponse.json({ error: '구글 연결이 만료됐어요. 관리 화면에서 다시 연결해주세요.' }, { status: 502 });
  }

  const meta: DriveMeta = { ...cfg.meta };
  meta.folders = { ...(meta.folders ?? {}) };

  /* 최상위 '모아랩' 폴더. 원장이 손으로 만든 그 폴더를 그대로 쓴다 */
  if (!meta.rootId) {
    const root = await ensureRoot(access);
    if (!root) return NextResponse.json({ error: '드라이브에서 모아랩 폴더를 못 찾았어요.' }, { status: 502 });
    meta.rootId = root;
  }

  // 실패한 것까지 다시 볼지 (관리 화면의 '다시 시도')
  let q = admin.from('drive_uploads').select('*').lt('tries', MAX_TRIES).order('created_at').limit(BATCH);
  q = retry ? q.in('status', ['pending', 'failed']) : q.eq('status', 'pending');
  const { data: rows } = await q;
  if (!rows || rows.length === 0) {
    await saveMeta(admin, meta);
    return NextResponse.json({ done: 0, failed: 0, left: 0 });
  }

  let done = 0;
  let failed = 0;

  for (const row of rows) {
    const fin = async (patch: Record<string, unknown>) => {
      await admin.from('drive_uploads').update({ ...patch, tries: (row.tries ?? 0) + 1 }).eq('id', row.id);
    };
    try {
      const folderId = await ensurePath(access, meta.rootId!, row.folder_path, meta.folders!);
      if (!folderId) {
        failed += 1;
        await fin({ status: 'failed', error: '드라이브에 폴더를 못 만들었어요.' });
        continue;
      }

      /* 수파베이스에서 파일을 받아 그대로 드라이브로 넘긴다 */
      const src = await fetch(row.source_url);
      if (!src.ok) {
        failed += 1;
        await fin({ status: 'failed', error: `앱에서 파일을 못 읽었어요 (${src.status})` });
        continue;
      }
      const blob = await src.blob();
      if (blob.size > MAX_BYTES) {
        failed += 1;
        await fin({ status: 'failed', error: `파일이 너무 커요 (${Math.round(blob.size / 1024 / 1024)}MB)` });
        continue;
      }

      const up = await uploadFile(
        access,
        folderId,
        row.file_name,
        row.mime_type || blob.type || 'application/octet-stream',
        blob,
      );
      if ('error' in up) {
        failed += 1;
        await fin({ status: 'failed', error: up.error });
        continue;
      }
      done += 1;
      await fin({ status: 'done', drive_id: up.id, error: null, done_at: new Date().toISOString() });
    } catch (e) {
      failed += 1;
      await fin({ status: 'failed', error: e instanceof Error ? e.message.slice(0, 200) : '알 수 없는 문제' });
    }
  }

  // 이번에 알아낸 폴더 id 를 적어둔다 — 다음에 같은 길을 다시 묻지 않는다
  await saveMeta(admin, meta);

  const { count } = await admin
    .from('drive_uploads')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');

  return NextResponse.json({ done, failed, left: count ?? 0 });
}

/** 관리 화면이 목록을 볼 때 — 못 올린 것 몇 개, 왜 실패했는지 */
export async function GET(req: Request) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: '서버 설정이 아직 안 됐어요.' }, { status: 500 });

  const actorId = req.headers.get('x-actor-id');
  if (!actorId) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 });
  const { data: me } = await admin.from('members').select('role,active').eq('id', actorId).maybeSingle();
  if (!me || !me.active || me.role !== 'admin') {
    return NextResponse.json({ error: '원장만 볼 수 있어요.' }, { status: 403 });
  }

  const { data } = await admin
    .from('drive_uploads')
    .select('id,kind,file_name,folder_path,status,error,tries,created_at')
    .in('status', ['pending', 'failed'])
    .order('created_at', { ascending: false })
    .limit(50);
  return NextResponse.json({ rows: data ?? [] });
}
