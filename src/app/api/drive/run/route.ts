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
  uploadGoogleDocument,
  type DriveMeta,
} from '@/lib/drive';
import { documentTemplateByKey, parseDutyDocument } from '@/lib/dutyDocument';
import { buildDutyDocumentHtml } from '@/lib/dutyDocumentExport';
import { actorFromToken, tokenOf } from '@/lib/chatServer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** 한 번에 처리할 줄 수. 서버리스 시간 제한 안에 끝나야 한다 */
const BATCH = 12;
/** 이만큼 실패하면 그만 시도한다 — 화면에서 원장이 직접 다시 누른다 */
const MAX_TRIES = 4;
/** 드라이브에 올릴 파일 크기 한도 (수업 사진 수백 장이 서버 메모리를 먹지 않게) */
const MAX_BYTES = 25 * 1024 * 1024;

function dutyDocumentIds(source: string): { dutyId: string; rowId: string } | null {
  if (!source.startsWith('duty-document:')) return null;
  const [dutyId, rowId, ...rest] = source.slice('duty-document:'.length).split(':');
  return dutyId && rowId && rest.length === 0 ? { dutyId, rowId } : null;
}

function grantFileId(source: string): string | null {
  const id = source.startsWith('grant-file:') ? source.slice('grant-file:'.length) : '';
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

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
  const actor = await actorFromToken(admin, tokenOf(req));
  if (!actor) return NextResponse.json({ error: '다시 로그인해주세요.' }, { status: 401 });
  if (retry && actor.role !== 'admin') {
    return NextResponse.json({ error: '원장만 다시 시도할 수 있어요.' }, { status: 403 });
  }

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
    /* 같은 pending 행을 서버 두 대가 동시에 집어 새 파일을 두 벌 만드는 일을 막는다.
       별도 processing 상태 없이 tries를 낙관적 잠금값으로 써서 기존 DB 구조를 유지한다. */
    const claimedTries = (row.tries ?? 0) + 1;
    const { data: claimed } = await admin
      .from('drive_uploads')
      .update({ status: 'failed', error: '드라이브로 보내는 중…', tries: claimedTries })
      .eq('id', row.id)
      .eq('status', row.status)
      .eq('tries', row.tries ?? 0)
      .select('id')
      .maybeSingle();
    if (!claimed) continue;

    const fin = async (patch: Record<string, unknown>) => {
      await admin
        .from('drive_uploads')
        .update(patch)
        .eq('id', row.id)
        .eq('status', 'failed')
        .eq('tries', claimedTries);
    };
    try {
      const folderId = await ensurePath(access, meta.rootId!, row.folder_path, meta.folders!);
      if (!folderId) {
        failed += 1;
        await fin({ status: 'failed', error: '드라이브에 폴더를 못 만들었어요.' });
        continue;
      }

      /*
       * 일반 첨부파일은 기존 URL에서 받고, 업무 문서는 DB의 최신 값을 서버에서 HTML로
       * 만든다. 계약서·연락처가 든 문서를 공개 Storage에 잠깐이라도 두지 않기 위해서다.
       */
      const documentIds = dutyDocumentIds(row.source_url);
      const privateGrantFileId = grantFileId(row.source_url);
      let blob: Blob;
      if (documentIds) {
        const [{ data: dutyRow }, { data: duty }] = await Promise.all([
          admin
            .from('duty_rows')
            .select('id,duty_id,cells')
            .eq('id', documentIds.rowId)
            .eq('duty_id', documentIds.dutyId)
            .maybeSingle(),
          admin.from('duties').select('id,name,group_id').eq('id', documentIds.dutyId).maybeSingle(),
        ]);
        if (!dutyRow || !duty) {
          failed += 1;
          await fin({ status: 'failed', error: '저장된 업무 문서를 찾을 수 없어요.' });
          continue;
        }
        const { data: group } = await admin
          .from('duty_groups')
          .select('id,name,dept_id')
          .eq('id', duty.group_id)
          .maybeSingle();
        const { data: department } = group
          ? await admin.from('departments').select('id,name').eq('id', group.dept_id).maybeSingle()
          : { data: null };
        const payload = parseDutyDocument((dutyRow.cells as Record<string, unknown> | null)?.__document);
        const template = payload && group
          ? documentTemplateByKey(duty.name, group.name, payload.templateKey)
          : null;
        if (!payload || !template || !group) {
          failed += 1;
          await fin({ status: 'failed', error: '업무 문서 양식을 읽을 수 없어요.' });
          continue;
        }
        const exported = buildDutyDocumentHtml(template, payload.values, {
          departmentName: department?.name,
          groupName: group.name,
          dutyName: duty.name,
          rowId: dutyRow.id,
        });
        blob = new Blob([exported.html], { type: exported.mediaType });
      } else if (privateGrantFileId) {
        const { data: grantFile } = await admin
          .from('grant_files')
          .select('file_path,mime_type')
          .eq('id', privateGrantFileId)
          .maybeSingle();
        if (!grantFile) {
          failed += 1;
          await fin({ status: 'failed', error: '저장된 정부지원사업 파일을 찾을 수 없어요.' });
          continue;
        }
        const downloaded = await admin.storage.from('moalab-grants').download(grantFile.file_path);
        if (downloaded.error || !downloaded.data) {
          failed += 1;
          await fin({ status: 'failed', error: '비공개 사업 파일을 읽지 못했어요.' });
          continue;
        }
        blob = downloaded.data;
      } else {
        const src = await fetch(row.source_url);
        if (!src.ok) {
          failed += 1;
          await fin({ status: 'failed', error: `앱에서 파일을 못 읽었어요 (${src.status})` });
          continue;
        }
        blob = await src.blob();
      }
      if (blob.size > MAX_BYTES) {
        failed += 1;
        await fin({ status: 'failed', error: `파일이 너무 커요 (${Math.round(blob.size / 1024 / 1024)}MB)` });
        continue;
      }

      const up = documentIds
        ? await uploadGoogleDocument(access, folderId, row.file_name, blob, row.drive_id)
        : await uploadFile(
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

  const actor = await actorFromToken(admin, tokenOf(req));
  if (!actor || actor.role !== 'admin') {
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
