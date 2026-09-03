import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseAdmin';
import { actorFromToken, tokenOf } from '@/lib/chatServer';
import type { GrantStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

const STATUSES = new Set<GrantStatus>(['discovered', 'concept_shared', 'writing', 'submitted', 'selected', 'not_selected', 'paused']);
const UUID = /^[0-9a-f-]{36}$/i;
const text = (value: unknown, max = 5000) => typeof value === 'string' ? value.trim().slice(0, max) || null : null;

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: '서버 설정이 아직 안 됐어요.' }, { status: 500 });
  const actor = await actorFromToken(admin, tokenOf(req));
  if (!actor) return NextResponse.json({ error: '다시 로그인해주세요.' }, { status: 401 });
  if (!UUID.test(params.id)) return NextResponse.json({ error: '잘못된 사업 주소예요.' }, { status: 400 });

  const [project, collaborators, files] = await Promise.all([
    admin.from('grant_projects').select('*').eq('id', params.id).maybeSingle(),
    admin.from('grant_collaborators').select('*').eq('grant_id', params.id),
    admin.from('grant_files').select('*').eq('grant_id', params.id).order('created_at', { ascending: false }),
  ]);
  if (project.error || collaborators.error || files.error) return NextResponse.json({ error: '사업 내용을 불러오지 못했어요.' }, { status: 500 });
  if (!project.data) return NextResponse.json({ error: '사업을 찾을 수 없어요.' }, { status: 404 });

  const signedFiles = await Promise.all((files.data ?? []).map(async (file) => {
    const signed = await admin.storage.from('moalab-grants').createSignedUrl(file.file_path, 60 * 60);
    return { ...file, signed_url: signed.data?.signedUrl ?? null };
  }));
  return NextResponse.json({ project: project.data, collaborators: collaborators.data ?? [], files: signedFiles });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: '서버 설정이 아직 안 됐어요.' }, { status: 500 });
  const actor = await actorFromToken(admin, tokenOf(req));
  if (!actor) return NextResponse.json({ error: '다시 로그인해주세요.' }, { status: 401 });
  if (!UUID.test(params.id)) return NextResponse.json({ error: '잘못된 사업 주소예요.' }, { status: 400 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const title = text(body.title, 200);
  const status = typeof body.status === 'string' && STATUSES.has(body.status as GrantStatus) ? body.status : null;
  if (!title || !status) return NextResponse.json({ error: '공고명과 진행상태를 확인해주세요.' }, { status: 400 });
  const itemName = text(body.itemName, 200);
  const conceptSummary = text(body.conceptSummary, 12000);
  const conceptReady = Boolean(itemName && conceptSummary);
  const current = await admin.from('grant_projects').select('lead_id, concept_shared_at').eq('id', params.id).maybeSingle();
  if (current.error) return NextResponse.json({ error: '사업 내용을 확인하지 못했어요.' }, { status: 500 });
  if (!current.data) return NextResponse.json({ error: '사업을 찾을 수 없어요.' }, { status: 404 });

  const now = new Date().toISOString();
  const sharedFields = {
    title,
    agency: text(body.agency, 200),
    announcement_url: text(body.announcementUrl, 2000),
    deadline: text(body.deadline, 10),
    item_name: itemName,
    target_audience: text(body.targetAudience, 500),
    concept_summary: conceptSummary,
    differentiation: text(body.differentiation, 6000),
    support_needed: text(body.supportNeeded, 6000),
    duplicate_checked: body.duplicateChecked === true,
    submitted_at: text(body.submittedAt, 10),
    result_note: text(body.resultNote, 8000),
    updated_by: actor.memberId,
    updated_at: now,
  };

  let leadClaimed = false;
  let data;
  if (!current.data.lead_id && conceptReady) {
    // 조건부 UPDATE라 동시에 제출해도 한 사람만 lead_id를 가져간다.
    const claimed = await admin.from('grant_projects').update({
      ...sharedFields,
      lead_id: actor.memberId,
      status: 'concept_shared',
      concept_shared_at: now,
    }).eq('id', params.id).is('lead_id', null).select('*').maybeSingle();
    if (claimed.error) return NextResponse.json({ error: claimed.error.message.slice(0, 160) }, { status: 500 });
    if (!claimed.data) {
      return NextResponse.json({ error: '다른 팀원이 먼저 기획안을 제출했어요. 새 담당자를 확인해주세요.' }, { status: 409 });
    }
    data = claimed.data;
    leadClaimed = true;
  } else {
    let saveQuery = admin.from('grant_projects').update({
      ...sharedFields,
      status: current.data.lead_id ? status : 'discovered',
      ...(current.data.lead_id && conceptReady && !current.data.concept_shared_at ? { concept_shared_at: now } : {}),
    }).eq('id', params.id);
    // 담당자 없는 화면을 오래 열어둔 저장이 방금 제출된 첫 기획안을 덮지 못하게 한다.
    if (!current.data.lead_id) saveQuery = saveQuery.is('lead_id', null);
    const saved = await saveQuery.select('*').maybeSingle();
    if (saved.error) return NextResponse.json({ error: saved.error.message.slice(0, 160) }, { status: 500 });
    if (!saved.data) {
      return NextResponse.json({ error: '기획 담당자가 방금 정해졌어요. 새 내용을 다시 확인해주세요.' }, { status: 409 });
    }
    data = saved.data;
  }

  const ids = Array.isArray(body.collaboratorIds)
    ? [...new Set(body.collaboratorIds.filter((id): id is string => typeof id === 'string' && UUID.test(id) && Boolean(data.lead_id) && id !== data.lead_id))]
    : [];
  const cleared = await admin.from('grant_collaborators').delete().eq('grant_id', params.id);
  if (cleared.error) return NextResponse.json({ error: '협업자 저장에 실패했어요.' }, { status: 500 });
  if (ids.length > 0) {
    const inserted = await admin.from('grant_collaborators').insert(ids.map((memberId) => ({ grant_id: params.id, member_id: memberId })));
    if (inserted.error) return NextResponse.json({ error: '협업자 저장에 실패했어요.' }, { status: 500 });
  }
  return NextResponse.json({ project: data, collaboratorIds: ids, leadClaimed });
}
