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
  const leadId = typeof body.leadId === 'string' && UUID.test(body.leadId) ? body.leadId : null;
  const conceptShared = body.conceptShared === true;
  const current = await admin.from('grant_projects').select('concept_shared_at').eq('id', params.id).maybeSingle();
  if (!current.data) return NextResponse.json({ error: '사업을 찾을 수 없어요.' }, { status: 404 });

  const { data, error } = await admin.from('grant_projects').update({
    title,
    agency: text(body.agency, 200),
    announcement_url: text(body.announcementUrl, 2000),
    deadline: text(body.deadline, 10),
    item_name: text(body.itemName, 200),
    target_audience: text(body.targetAudience, 500),
    concept_summary: text(body.conceptSummary, 12000),
    differentiation: text(body.differentiation, 6000),
    support_needed: text(body.supportNeeded, 6000),
    lead_id: leadId,
    status: conceptShared && status === 'discovered' ? 'concept_shared' : status,
    duplicate_checked: body.duplicateChecked === true,
    concept_shared_at: conceptShared ? (current.data.concept_shared_at || new Date().toISOString()) : null,
    submitted_at: text(body.submittedAt, 10),
    result_note: text(body.resultNote, 8000),
    updated_by: actor.memberId,
    updated_at: new Date().toISOString(),
  }).eq('id', params.id).select('*').single();
  if (error) return NextResponse.json({ error: error.message.slice(0, 160) }, { status: 500 });

  const ids = Array.isArray(body.collaboratorIds)
    ? [...new Set(body.collaboratorIds.filter((id): id is string => typeof id === 'string' && UUID.test(id) && id !== leadId))]
    : [];
  const cleared = await admin.from('grant_collaborators').delete().eq('grant_id', params.id);
  if (cleared.error) return NextResponse.json({ error: '협업자 저장에 실패했어요.' }, { status: 500 });
  if (ids.length > 0) {
    const inserted = await admin.from('grant_collaborators').insert(ids.map((memberId) => ({ grant_id: params.id, member_id: memberId })));
    if (inserted.error) return NextResponse.json({ error: '협업자 저장에 실패했어요.' }, { status: 500 });
  }
  return NextResponse.json({ project: data, collaboratorIds: ids });
}
