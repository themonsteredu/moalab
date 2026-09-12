import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseAdmin';
import { actorFromToken, tokenOf } from '@/lib/chatServer';
import { DRIVE_KEY, type DriveMeta } from '@/lib/drive';
import { fileNameFor, planPath } from '@/lib/drivePath';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UUID = /^[0-9a-f-]{36}$/i;
const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: '서버 설정이 아직 안 됐어요.' }, { status: 500 });
  const actor = await actorFromToken(admin, tokenOf(req));
  if (!actor) return NextResponse.json({ error: '다시 로그인해주세요.' }, { status: 401 });
  if (!UUID.test(params.id)) return NextResponse.json({ error: '잘못된 사업 주소예요.' }, { status: 400 });

  const form = await req.formData().catch(() => null);
  const kind = String(form?.get('kind') ?? '');
  const file = form?.get('file');
  if (kind !== 'announcement' && kind !== 'final_plan') return NextResponse.json({ error: '파일 종류를 확인해주세요.' }, { status: 400 });
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: '파일을 골라주세요.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: '파일은 25MB까지 올릴 수 있어요.' }, { status: 400 });

  const project = await admin.from('grant_projects').select('id,title').eq('id', params.id).maybeSingle();
  if (!project.data) return NextResponse.json({ error: '사업을 찾을 수 없어요.' }, { status: 404 });
  const rawExt = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() ?? '' : '';
  const ext = /^[a-z0-9]{1,8}$/.test(rawExt) ? `.${rawExt}` : '';
  const path = `${params.id}/${kind}/${crypto.randomUUID()}${ext}`;
  const uploaded = await admin.storage.from('moalab-grants').upload(path, await file.arrayBuffer(), {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (uploaded.error) return NextResponse.json({ error: uploaded.error.message.slice(0, 160) }, { status: 500 });

  const inserted = await admin.from('grant_files').insert({
    grant_id: params.id,
    kind,
    file_path: path,
    file_name: file.name.slice(0, 240),
    file_size: file.size,
    mime_type: file.type || null,
    member_id: actor.memberId,
  }).select('*').single();
  if (inserted.error) {
    await admin.storage.from('moalab-grants').remove([path]);
    return NextResponse.json({ error: inserted.error.message.slice(0, 160) }, { status: 500 });
  }

  const signed = await admin.storage.from('moalab-grants').createSignedUrl(path, 60 * 60);

  // 구글 드라이브가 연결돼 있으면 공개 URL 없이 서버가 비공개 원본을 직접 복사한다.
  const secret = await admin.from('app_secrets').select('value,meta').eq('key', DRIVE_KEY).maybeSingle();
  let driveEnabled = false;
  try {
    const config = secret.data?.value ? JSON.parse(secret.data.value) as { refreshToken?: string } : null;
    const meta = (secret.data?.meta ?? {}) as DriveMeta;
    driveEnabled = Boolean(config?.refreshToken && (!meta.kinds || meta.kinds.includes('plan')));
  } catch { /* 연결 설정이 깨졌으면 앱 파일 저장만 유지한다 */ }
  if (driveEnabled) {
    await admin.from('drive_uploads').upsert({
      kind: 'plan',
      source_url: `grant-file:${inserted.data.id}`,
      folder_path: planPath('정부지원사업', project.data.title),
      file_name: fileNameFor(file.name, kind === 'announcement' ? '공고' : '최종제출'),
      mime_type: file.type || null,
      member_id: actor.memberId,
    }, { onConflict: 'source_url', ignoreDuplicates: true });
    void fetch(`${new URL(req.url).origin}/api/drive/run`, {
      method: 'POST',
      headers: { 'x-session-token': tokenOf(req) ?? '' },
    }).catch(() => null);
  }

  return NextResponse.json({ file: { ...inserted.data, signed_url: signed.data?.signedUrl ?? null } }, { status: 201 });
}
