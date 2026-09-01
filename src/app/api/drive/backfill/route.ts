import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseAdmin';
import { DRIVE_KEY, type DriveMeta } from '@/lib/drive';
import { fileNameFor, pathFor, type DriveKind } from '@/lib/drivePath';

export const dynamic = 'force-dynamic';

/**
 * **지금까지 앱에 쌓인 옛 파일을 한 번에 드라이브로 줄 세운다.** 원장만.
 *
 * 평소에는 파일을 올리는 그 순간에만 줄을 선다(`/api/drive/queue`). 그리고 연결이
 * 안 돼 있으면 **줄도 안 세운다** — 세워두면 나중에 연결했을 때 옛날 파일이
 * 한꺼번에 쏟아지기 때문이다. 그래서 **연결하기 전에 올린 것은 영영 안 올라간다.**
 * 그걸 원장이 직접 눌러서 한 번 훑는 자리가 여기다.
 *
 * · `source_url` 이 unique 라 **여러 번 눌러도 한 줄만** 선다 (이미 올라간 것도 그대로)
 * · 꺼둔 갈래는 건너뛴다 (관리 화면에서 고른 대로)
 * · 실제 업로드는 `/api/drive/run` 이 한다 — 여기서는 줄만 세우고 바로 돌아온다
 */

interface Row {
  kind: DriveKind;
  source_url: string;
  folder_path: string;
  file_name: string;
  mime_type: string | null;
  member_id: string | null;
}

export async function POST(req: Request) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: '서버 설정이 아직 안 됐어요.' }, { status: 500 });

  const actorId = req.headers.get('x-actor-id');
  if (!actorId) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 });
  const { data: me } = await admin.from('members').select('role,active').eq('id', actorId).maybeSingle();
  if (!me || !me.active || me.role !== 'admin') {
    return NextResponse.json({ error: '원장만 쓸 수 있어요.' }, { status: 403 });
  }

  /* 연결이 안 돼 있으면 아무것도 안 한다 — 줄만 쌓여도 올라가지 않는다 */
  const { data: sec } = await admin.from('app_secrets').select('value, meta').eq('key', DRIVE_KEY).maybeSingle();
  let connected = false;
  try {
    connected = Boolean(sec?.value && JSON.parse(sec.value).refreshToken);
  } catch {
    connected = false;
  }
  if (!connected) {
    return NextResponse.json({ error: '먼저 구글 계정을 연결해주세요.' }, { status: 400 });
  }
  const meta = (sec?.meta ?? {}) as DriveMeta;
  const on = (k: DriveKind) => !meta.kinds || meta.kinds.includes(k);

  const rows: Row[] = [];
  const byKind: Record<string, number> = {};
  const push = (r: Row | null) => {
    if (!r) return;
    rows.push(r);
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
  };

  /* ---------------------------------------------------- 프로그램 문서 */
  if (on('plan')) {
    const [{ data: files }, { data: apps }, { data: topics }] = await Promise.all([
      admin.from('plan_files').select('app_id, file_url, file_name, version, member_id'),
      admin.from('apps').select('id, title_ko, topic_id, topic'),
      admin.from('topics').select('id, name'),
    ]);
    const topicName = new Map(((topics ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
    const appOf = new Map(
      ((apps ?? []) as { id: string; title_ko: string; topic_id: string | null; topic: string | null }[]).map((a) => [
        a.id,
        { title: a.title_ko, topic: (a.topic_id && topicName.get(a.topic_id)) || a.topic || null },
      ]),
    );
    for (const f of (files ?? []) as {
      app_id: string;
      file_url: string;
      file_name: string;
      version: number;
      member_id: string | null;
    }[]) {
      const app = appOf.get(f.app_id);
      if (!app) continue;
      const folder = pathFor('plan', { topic: app.topic, appTitle: app.title });
      if (!folder) continue;
      // 판 번호를 이름 앞에 붙인다 — 안 붙이면 드라이브에서 같은 이름이라 안 올라간다
      const name = f.version > 1 ? `${f.version}판_${f.file_name}` : f.file_name;
      push({
        kind: 'plan',
        source_url: f.file_url,
        folder_path: folder,
        file_name: fileNameFor(name, app.title),
        mime_type: null,
        member_id: f.member_id,
      });
    }
  }

  /* -------------------------------------------------------- 영수증 */
  if (on('receipt')) {
    const [{ data: files }, { data: expenses }] = await Promise.all([
      admin.from('expense_files').select('expense_id, file_url, file_name'),
      admin.from('expenses').select('id, spent_on, member_id'),
    ]);
    const exp = new Map(
      ((expenses ?? []) as { id: string; spent_on: string; member_id: string | null }[]).map((e) => [e.id, e]),
    );
    for (const f of (files ?? []) as { expense_id: string; file_url: string; file_name: string }[]) {
      const e = exp.get(f.expense_id);
      if (!e?.spent_on) continue;
      const folder = pathFor('receipt', { month: e.spent_on.slice(0, 7) });
      if (!folder) continue;
      push({
        kind: 'receipt',
        source_url: f.file_url,
        folder_path: folder,
        file_name: fileNameFor(f.file_name, e.spent_on),
        mime_type: null,
        member_id: e.member_id,
      });
    }
  }

  /* ------------------------------------------------------ 수업 사진 */
  if (on('photo')) {
    const [{ data: photos }, { data: albums }] = await Promise.all([
      admin.from('photos').select('album_id, url, caption'),
      admin.from('albums').select('id, school, class_date, teacher_id'),
    ]);
    const album = new Map(
      ((albums ?? []) as { id: string; school: string; class_date: string; teacher_id: string | null }[]).map((a) => [
        a.id,
        a,
      ]),
    );
    for (const p of (photos ?? []) as { album_id: string; url: string; caption: string | null }[]) {
      const a = album.get(p.album_id);
      if (!a?.class_date) continue;
      const folder = pathFor('photo', { date: a.class_date, school: a.school });
      if (!folder) continue;
      push({
        kind: 'photo',
        source_url: p.url,
        folder_path: folder,
        // 앨범 사진은 이름이 없다 — 학교·날짜로 뜻을 만들어준다
        file_name: fileNameFor(p.url, `${a.school ?? '학교'}_${a.class_date}`),
        mime_type: null,
        member_id: a.teacher_id,
      });
    }
  }

  /* ------------------------------------------------------ 역할 자료 */
  if (on('dept')) {
    const [{ data: files }, { data: duties }, { data: groups }, { data: depts }] = await Promise.all([
      admin.from('duty_files').select('duty_id, file_url, file_name, member_id'),
      admin.from('duties').select('id, name, group_id'),
      admin.from('duty_groups').select('id, name, dept_id'),
      admin.from('departments').select('id, name'),
    ]);
    const deptName = new Map(((depts ?? []) as { id: string; name: string }[]).map((d) => [d.id, d.name]));
    const groupOf = new Map(
      ((groups ?? []) as { id: string; name: string; dept_id: string }[]).map((g) => [g.id, g]),
    );
    const dutyOf = new Map(
      ((duties ?? []) as { id: string; name: string; group_id: string }[]).map((d) => [d.id, d]),
    );
    for (const f of (files ?? []) as {
      duty_id: string;
      file_url: string;
      file_name: string;
      member_id: string | null;
    }[]) {
      const duty = dutyOf.get(f.duty_id);
      const group = duty && groupOf.get(duty.group_id);
      if (!duty || !group) continue;
      const folder = pathFor('dept', {
        deptName: deptName.get(group.dept_id) ?? null,
        groupName: group.name,
      });
      if (!folder) continue;
      push({
        kind: 'dept',
        source_url: f.file_url,
        folder_path: folder,
        file_name: fileNameFor(f.file_name, duty.name),
        mime_type: null,
        member_id: f.member_id,
      });
    }
  }

  if (rows.length === 0) {
    return NextResponse.json({ found: 0, queued: 0, byKind });
  }

  /* 이미 줄에 있는 것은 빼고 센다 — "몇 개 새로 세웠나" 를 정확히 알려주려고.
     (upsert 가 알아서 걸러주지만 그러면 몇 개가 새로 들어갔는지 알 수 없다) */
  const urls = rows.map((r) => r.source_url);
  const already = new Set<string>();
  for (let i = 0; i < urls.length; i += 500) {
    const { data } = await admin
      .from('drive_uploads')
      .select('source_url')
      .in('source_url', urls.slice(i, i + 500));
    for (const r of (data ?? []) as { source_url: string }[]) already.add(r.source_url);
  }
  const fresh = rows.filter((r) => !already.has(r.source_url));

  // 한 번에 다 밀어넣으면 요청이 너무 커진다 — 500 줄씩 나눠 넣는다
  for (let i = 0; i < fresh.length; i += 500) {
    const { error } = await admin
      .from('drive_uploads')
      .upsert(fresh.slice(i, i + 500), { onConflict: 'source_url', ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: '줄을 세우지 못했어요. ' + error.message }, { status: 500 });
  }

  // 바로 한 번 돌려본다 (기다리지 않는다). 실패해도 줄에 남아 다시 시도된다
  if (fresh.length > 0) {
    void fetch(`${new URL(req.url).origin}/api/drive/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-actor-id': actorId },
    }).catch(() => null);
  }

  return NextResponse.json({ found: rows.length, queued: fresh.length, already: already.size, byKind });
}
