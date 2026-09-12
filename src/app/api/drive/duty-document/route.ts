import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseAdmin';
import { loadConfig } from '@/lib/drive';
import { deptPath } from '@/lib/drivePath';
import { documentTemplateByKey, parseDutyDocument } from '@/lib/dutyDocument';
import { buildDutyDocumentHtml } from '@/lib/dutyDocumentExport';
import { actorFromToken, tokenOf } from '@/lib/chatServer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const sourceKey = (dutyId: string, rowId: string) => `duty-document:${dutyId}:${rowId}`;

/**
 * 저장된 업무 문서를 Drive 대기열에 넣고 바로 한 번 전송한다.
 *
 * HTML을 클라이언트에서 받지 않고 DB의 최신 문서를 서버에서 다시 읽는다. 그래야 다른
 * 행을 가장하거나 내부 관리값을 외부 문서에 섞어 보내는 요청을 막을 수 있다.
 */
export async function POST(req: Request) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ skipped: '서버 설정 없음' });

  const actor = await actorFromToken(admin, tokenOf(req));
  if (!actor) return NextResponse.json({ error: '다시 로그인해주세요.' }, { status: 401 });
  const actorId = actor.memberId;

  const body = (await req.json().catch(() => ({}))) as { dutyId?: string; rowId?: string };
  const dutyId = body.dutyId?.trim() ?? '';
  const rowId = body.rowId?.trim() ?? '';
  if (!dutyId || !rowId) return NextResponse.json({ error: '문서 정보가 부족해요.' }, { status: 400 });

  const [{ data: row }, { data: duty }] = await Promise.all([
    admin.from('duty_rows').select('id,duty_id,cells').eq('id', rowId).eq('duty_id', dutyId).maybeSingle(),
    admin.from('duties').select('id,name,group_id').eq('id', dutyId).maybeSingle(),
  ]);
  if (!row || !duty) return NextResponse.json({ error: '저장된 업무 문서를 찾을 수 없어요.' }, { status: 404 });

  const { data: group } = await admin.from('duty_groups').select('id,name,dept_id').eq('id', duty.group_id).maybeSingle();
  if (!group) return NextResponse.json({ error: '업무 분류를 찾을 수 없어요.' }, { status: 404 });
  const { data: department } = await admin.from('departments').select('id,name').eq('id', group.dept_id).maybeSingle();
  if (!department) return NextResponse.json({ error: '부서를 찾을 수 없어요.' }, { status: 404 });

  const payload = parseDutyDocument((row.cells as Record<string, unknown> | null)?.__document);
  const template = payload && documentTemplateByKey(duty.name, group.name, payload.templateKey);
  if (!payload || !template) return NextResponse.json({ error: 'Google 문서로 만들 수 없는 자료예요.' }, { status: 400 });

  const cfg = await loadConfig(admin);
  if (!cfg) return NextResponse.json({ skipped: '드라이브 연결 안 됨' });
  if (cfg.meta.kinds && !cfg.meta.kinds.includes('dept')) {
    return NextResponse.json({ skipped: '역할 자료 자동 저장이 꺼져 있음' });
  }

  const exported = buildDutyDocumentHtml(template, payload.values, {
    departmentName: department.name,
    groupName: group.name,
    dutyName: duty.name,
    rowId: row.id,
  });
  const source = sourceKey(duty.id, row.id);
  const queuedAt = new Date().toISOString();
  const { error: queueError } = await admin.from('drive_uploads').upsert({
    kind: 'dept',
    source_url: source,
    folder_path: deptPath(department.name, group.name),
    file_name: exported.googleDocName,
    mime_type: exported.googleWorkspaceMimeType,
    status: 'pending',
    error: null,
    tries: 0,
    member_id: actorId,
    created_at: queuedAt,
    done_at: null,
  }, { onConflict: 'source_url' });
  if (queueError) return NextResponse.json({ status: 'failed', error: queueError.message });

  // 앱 저장은 이미 끝났다. 앞에 오래된 대기행이 있어도 현재 문서까지 도달하도록 몇 묶음 돌린다.
  let upload: { status: string; error: string | null; drive_id: string | null } | null = null;
  let runError: string | null = null;
  for (let pass = 0; pass < 4; pass += 1) {
    try {
      const run = await fetch(`${new URL(req.url).origin}/api/drive/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-session-token': tokenOf(req) ?? '' },
      });
      const runResult = (await run.json().catch(() => ({}))) as { error?: string };
      if (!run.ok) {
        runError = runResult.error ?? '구글 드라이브 전송을 시작하지 못했어요.';
        break;
      }
    } catch {
      runError = '구글 드라이브 전송 서버에 닿지 못했어요.';
      break;
    }
    const statusResult = await admin
      .from('drive_uploads')
      .select('status,error,drive_id')
      .eq('source_url', source)
      .maybeSingle();
    upload = statusResult.data;
    if (upload?.status !== 'pending') break;
  }

  return NextResponse.json({
    queued: true,
    status: runError ? 'failed' : upload?.status ?? 'pending',
    error: runError ?? upload?.error ?? null,
    driveId: upload?.drive_id ?? null,
  });
}
