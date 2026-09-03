import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseAdmin';
import { actorFromToken, tokenOf } from '@/lib/chatServer';

export const dynamic = 'force-dynamic';

const text = (value: unknown, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) || null : null;

export async function GET(req: Request) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: '서버 설정이 아직 안 됐어요.' }, { status: 500 });
  const actor = await actorFromToken(admin, tokenOf(req));
  if (!actor) return NextResponse.json({ error: '다시 로그인해주세요.' }, { status: 401 });

  const [projects, collaborators] = await Promise.all([
    admin.from('grant_projects').select('*').order('updated_at', { ascending: false }),
    admin.from('grant_collaborators').select('*'),
  ]);
  if (projects.error || collaborators.error) {
    return NextResponse.json({ error: '정부지원사업을 불러오지 못했어요.' }, { status: 500 });
  }
  return NextResponse.json({ projects: projects.data ?? [], collaborators: collaborators.data ?? [] });
}

export async function POST(req: Request) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: '서버 설정이 아직 안 됐어요.' }, { status: 500 });
  const actor = await actorFromToken(admin, tokenOf(req));
  if (!actor) return NextResponse.json({ error: '다시 로그인해주세요.' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const title = text(body.title, 200);
  if (!title) return NextResponse.json({ error: '공고명을 적어주세요.' }, { status: 400 });
  const { data, error } = await admin.from('grant_projects').insert({
    title,
    agency: text(body.agency, 200),
    announcement_url: text(body.announcementUrl, 2000),
    deadline: text(body.deadline, 10),
    item_name: text(body.itemName, 200),
    lead_id: actor.memberId,
    created_by: actor.memberId,
    updated_by: actor.memberId,
  }).select('*').single();
  if (error) return NextResponse.json({ error: error.message.slice(0, 160) }, { status: 500 });
  return NextResponse.json({ project: data }, { status: 201 });
}
