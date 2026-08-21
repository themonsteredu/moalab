/**
 * 말로 한 지시를 업무 목록으로 바꿀 때, **AI 가 준 것을 그대로 믿지 않는다.**
 *
 * 여기 있는 것은 전부 순수 함수라 `scripts/task-parse.test.mjs` 가 그대로 돌린다.
 * 실제 멤버 id 와 날짜 형식을 우리가 다시 검사해서, 이상한 값은 조용히 비운다.
 * (없는 사람에게 배정되거나 2월 30일이 기한으로 박히는 게 제일 나쁘다)
 */

export interface ParsedTask {
  title: string;
  assignee_id: string | null;
  due_date: string | null;
  detail: string | null;
}

/** 한 번에 만들 수 있는 최대 건수. 응답이 폭주해도 500건이 생기지 않게 */
export const PARSE_MAX = 20;

/** 제목이 길어지면 목록에서 못 읽는다. 넘치는 건 자세히로 내린다 */
const TITLE_MAX = 60;

function asText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** 'YYYY-MM-DD' 이고 **실제로 있는 날짜**인지. 2026-02-30 같은 걸 걸러낸다 */
export function isRealDate(s: unknown): boolean {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const last = new Date(y, m, 0).getDate();
  return d <= last;
}

/**
 * AI 응답을 화면에 올릴 수 있는 모양으로 정리한다.
 *
 * - 제목이 없는 줄은 버린다 (무엇을 할 일인지 없으면 업무가 아니다)
 * - 모르는 사람에게 배정된 줄은 **담당자 미정**으로 돌린다 (버리지 않는다 —
 *   원장이 미리보기에서 고르면 된다)
 * - 날짜가 형식에 안 맞거나 없는 날이면 **기한 없음**으로 돌린다
 * - 너무 긴 제목은 잘라서 자세히 칸으로 내린다
 */
export function normalizeParsed(raw: unknown, memberIds: string[]): ParsedTask[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { tasks?: unknown })?.tasks)
      ? ((raw as { tasks: unknown[] }).tasks)
      : [];

  const out: ParsedTask[] = [];
  for (const row of list) {
    if (out.length >= PARSE_MAX) break;
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;

    const full = asText(r.title);
    if (!full) continue;

    const over = full.length > TITLE_MAX;
    const title = over ? `${full.slice(0, TITLE_MAX)}…` : full;
    const extra = asText(r.detail);
    const detail = over ? [full, extra].filter(Boolean).join('\n') : extra;

    const who = asText(r.assignee_id);
    const due = asText(r.due_date);

    out.push({
      title,
      assignee_id: memberIds.includes(who) ? who : null,
      due_date: isRealDate(due) ? due : null,
      detail: detail || null,
    });
  }
  return out;
}

/**
 * AI 에게 줄 지시문. 오늘 날짜와 멤버 목록을 **서버에서** 박아 넣는다 —
 * 브라우저가 보낸 값을 그대로 쓰면 남의 이름으로 업무를 만들 수 있다.
 *
 * `today` 는 반드시 한국 날짜(`kstDateStr`)여야 한다. 서버는 UTC 로 돌아서
 * 그냥 넣으면 '내일' 이 하루씩 밀린다.
 */
export function parsePrompt(today: string, members: { id: string; name: string }[]): string {
  const roster = members.map((m) => `- ${m.name}: ${m.id}`).join('\n');
  return [
    '너는 학원 원장이 말로 던진 지시를 업무 목록으로 정리하는 역할이다.',
    '',
    `오늘은 ${today} (한국 날짜) 이다.`,
    '',
    '팀 멤버 (이름: id):',
    roster,
    '',
    '규칙:',
    '- 지시 하나에 업무 하나. 한 문장에 여러 일이 섞여 있으면 나눈다.',
    '- title 은 무엇을 할 일인지 한 줄로. 담당자 이름이나 날짜는 title 에 넣지 않는다.',
    '- assignee_id 는 위 목록의 id 를 그대로 쓴다. 누구인지 안 나오면 빈 문자열로 둔다.',
    '  이름이 비슷하게 들려도 목록에 없는 사람이면 빈 문자열이다.',
    '- due_date 는 YYYY-MM-DD. "내일" "다음 주 화요일" "이번 달 말" 같은 말을 오늘 기준으로 계산한다.',
    '  기한이 안 나오면 빈 문자열로 둔다. 없는 기한을 지어내지 않는다.',
    '- detail 은 조건이나 부연이 있을 때만. 없으면 빈 문자열.',
    '- 지시가 아닌 말(인사, 혼잣말)은 업무로 만들지 않는다.',
    `- 최대 ${PARSE_MAX}건까지만 만든다.`,
  ].join('\n');
}

/** 응답 모양 — output_config.format 에 그대로 넣는다 */
export const PARSE_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          assignee_id: { type: 'string' },
          due_date: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['title', 'assignee_id', 'due_date', 'detail'],
        additionalProperties: false,
      },
    },
  },
  required: ['tasks'],
  additionalProperties: false,
} as const;
