import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getAdminClient } from '@/lib/supabaseAdmin';
import { kstDateStr } from '@/lib/task';
import { normalizeParsed, parsePrompt, PARSE_SCHEMA } from '@/lib/taskParse';
import { resolveModel } from '@/lib/ai';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const KEY = 'anthropic_api_key';

/**
 * 말로 던진 지시를 업무 목록으로 쪼갠다. **원장만.**
 *
 * 여기서 만드는 건 **미리보기용 목록일 뿐이고 저장하지 않는다.**
 * 저장은 원장이 화면에서 확인하고 고친 뒤에 한다 — 잘못 알아들은 걸
 * 그대로 넣으면 엉뚱한 사람에게 엉뚱한 알림이 간다.
 *
 * 멤버 목록과 오늘 날짜는 **서버에서** 넣는다. 브라우저가 보낸 걸 그대로 쓰면
 * 남의 이름으로 업무를 만들 수 있다.
 */
export async function POST(req: Request) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: '서버 설정이 아직 안 됐어요.' }, { status: 500 });

  const actorId = req.headers.get('x-actor-id');
  if (!actorId) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 });

  const { data: me } = await admin.from('members').select('id,role,active').eq('id', actorId).maybeSingle();
  if (!me || !me.active || me.role !== 'admin') {
    return NextResponse.json({ error: '원장만 쓸 수 있어요.' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = (body.text ?? '').trim();
  if (!text) return NextResponse.json({ error: '무슨 일을 시킬지 말하거나 적어주세요.' }, { status: 400 });
  if (text.length > 4000) {
    return NextResponse.json({ error: '한 번에 너무 길어요. 나눠서 넣어주세요.' }, { status: 400 });
  }

  // 키 꺼내기 — 이 표는 service_role 만 붙을 수 있다
  const { data: secret } = await admin.from('app_secrets').select('value,model').eq('key', KEY).maybeSingle();
  if (!secret?.value) {
    return NextResponse.json(
      { error: 'AI 키가 아직 등록되지 않았어요. 관리 > AI 키에서 등록해주세요.' },
      { status: 400 },
    );
  }

  const { data: members } = await admin
    .from('members')
    .select('id,name')
    .eq('active', true)
    .order('sort_order');
  const roster = (members ?? []) as { id: string; name: string }[];

  try {
    const client = new Anthropic({ apiKey: secret.value });
    const res = await client.messages.create({
      // 원장이 관리 화면에서 고른 모델. 모르는 값이면 기본값으로 되돌아간다
      model: resolveModel(secret.model),
      max_tokens: 8000,
      system: parsePrompt(kstDateStr(new Date()), roster),
      messages: [{ role: 'user', content: text }],
      output_config: { format: { type: 'json_schema', schema: PARSE_SCHEMA } },
    });

    // 안전 장치를 거부당했을 때 — 이 용도로는 거의 없지만 조용히 죽지는 않게
    if (res.stop_reason === 'refusal') {
      return NextResponse.json(
        { error: 'AI 가 이 내용은 정리하지 못했어요. 말을 바꿔서 다시 해보세요.' },
        { status: 400 },
      );
    }

    const block = res.content.find((b) => b.type === 'text');
    const raw = block && block.type === 'text' ? JSON.parse(block.text) : null;

    // AI 가 준 것을 그대로 믿지 않는다 — 실제 멤버 id 와 날짜를 다시 검사한다
    const tasks = normalizeParsed(
      raw,
      roster.map((m) => m.id),
    );

    if (tasks.length === 0) {
      return NextResponse.json(
        { error: '할 일을 못 찾았어요. "누가 · 무엇을 · 언제까지" 가 들어가게 말해보세요.' },
        { status: 400 },
      );
    }
    return NextResponse.json({ tasks });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { error: 'AI 키가 맞지 않아요. 관리 > AI 키에서 다시 등록해주세요.' },
        { status: 400 },
      );
    }
    if (e instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: '조금 뒤에 다시 눌러주세요. (요청이 몰렸어요)' }, { status: 429 });
    }
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: `AI 를 부르지 못했어요 — ${String(e.message).slice(0, 120)}` },
        { status: 502 },
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `정리하지 못했어요 — ${msg.slice(0, 120)}` }, { status: 500 });
  }
}
