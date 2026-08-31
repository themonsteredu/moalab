import type { AppRow, CollabRequest, Schedule, ScheduleKind } from './types';

/**
 * 일정·출강 달력 계산.
 *
 * 화면 코드에 계산을 흩어놓지 않는다 (task.ts · org.ts · collab.ts 와 같은 자리).
 * `scripts/schedule.test.mjs` 가 이 파일을 지킨다.
 *
 * **마감은 저장하지 않는다.** `apps.due_date` 와 `collab_requests.due_date` 에서
 * 달력이 스스로 만들어낸다 — 같은 날짜를 두 곳에 적게 하면 반드시 어긋난다
 * (원래 앱 마감이 그렇게 돼 있었고, 부서협업 기한도 같은 방식으로 얹었다).
 */

/* -------------------------------------------------------------------- 이름표 */

export const SCHEDULE_KINDS: { value: ScheduleKind; label: string }[] = [
  { value: 'class', label: '출강' },
  { value: 'meeting', label: '회의' },
  { value: 'etc', label: '기타' },
];

/** 달력에 뜨는 갈래 — 마감은 저장되는 게 아니라 만들어지는 것이라 따로 있다 */
export type EntryKind = 'due' | ScheduleKind;

export function scheduleKindLabel(k: string): string {
  return SCHEDULE_KINDS.find((x) => x.value === k)?.label ?? '기타';
}

/** 모르는 값이 흘러들어도 화면이 안 죽게 (DB check 와 같은 갈래) */
export function safeKind(k: string | null | undefined): ScheduleKind {
  return SCHEDULE_KINDS.some((x) => x.value === k) ? (k as ScheduleKind) : 'etc';
}

/* -------------------------------------------------------------------- 항목 */

export interface CalendarEntry {
  id: string;
  kind: EntryKind;
  title: string;
  date: string;
  time?: string | null;
  endTime?: string | null;
  place?: string | null;
  memo?: string | null;
  /** 눌렀을 때 갈 곳 */
  href?: string;
  /** 이 일정에 묶인 사람 (담당 강사·참석자·검증자). '내 일정' 의 기준이다 */
  who: string[];
  /** 이 일정에 묶인 부서. 협업 요청 기한만 갖는다 — 부서에서 부서로 가는 일이라서 */
  deptIds: string[];
  /** 고칠 수 있는 일정이면 그 id (마감은 없다 — 원래 자리에서 고쳐야 한다) */
  scheduleId?: string;
  school?: string | null;
  headcount?: number | null;
  periods?: number | null;
  program?: string | null;
}

export interface BuildInput {
  apps: AppRow[];
  /** 앱별 검증자 — 마감이 누구 것인지 알려면 필요하다 */
  reviewers?: Record<string, string[]>;
  collabs?: CollabRequest[];
  /** 부서 id → 이름. 협업 기한 제목에 쓴다 */
  deptName?: (id: string) => string;
  schedules: Schedule[];
  /** 일정별 참석자 */
  attendees?: Record<string, string[]>;
  /** 프로그램 id → 이름 */
  appTitle?: (id: string) => string;
}

/**
 * 달력에 실을 것을 한 곳에서 만든다.
 *
 * 마감 두 갈래(프로그램 제출 · 부서 협업 요청)를 같은 `due` 로 합친다.
 * 색을 나누면 마감이 세 색이 되어 정작 급한 게 안 보인다 — 제목으로 구분한다.
 * **id 앞에 갈래를 붙여** 두 곳에서 온 마감이 절대 안 겹치게 한다.
 */
export function buildEntries(input: BuildInput): CalendarEntry[] {
  const { apps, reviewers = {}, collabs = [], schedules, attendees = {} } = input;
  const deptName = input.deptName ?? (() => '');
  const appTitle = input.appTitle ?? (() => '');
  const out: CalendarEntry[] = [];

  for (const a of apps) {
    if (!a.due_date) continue;
    const who = [a.creator_id, ...(reviewers[a.id] ?? [])].filter((x): x is string => Boolean(x));
    out.push({
      id: `due-app-${a.id}`,
      kind: 'due',
      title: `${a.title_ko} 제출 마감`,
      date: a.due_date,
      href: `/apps/${a.id}`,
      who: [...new Set(who)],
      deptIds: [],
    });
  }

  for (const r of collabs) {
    // 끝난 요청의 기한은 안 싣는다 — 지난 마감이 쌓이면 오늘 급한 게 안 보인다
    if (!r.due_date || r.status === 'done') continue;
    const to = deptName(r.to_dept_id);
    out.push({
      id: `due-collab-${r.id}`,
      kind: 'due',
      title: `${r.project ? `${r.project} — ` : ''}${to || '부서'} 협업 기한`,
      date: r.due_date,
      memo: r.body,
      href: '/collab',
      who: [],
      // 보낸 쪽도 받는 쪽도 이 날짜를 봐야 한다
      deptIds: [r.to_dept_id, r.from_dept_id],
    });
  }

  for (const s of schedules) {
    const kind = safeKind(s.kind);
    out.push({
      id: s.id,
      scheduleId: s.id,
      kind,
      title: s.title,
      date: s.date,
      time: s.start_time,
      endTime: s.end_time,
      place: s.place,
      memo: s.memo,
      href: '/schedule',
      who: attendees[s.id] ?? [],
      deptIds: [],
      school: s.school,
      headcount: s.headcount,
      periods: s.periods,
      program: s.app_id ? appTitle(s.app_id) || null : null,
    });
  }

  return sortEntries(out);
}

/** 날짜 → 시간 → 제목. 시간 없는 것은 그날 맨 뒤 (하루 종일 짜리라서) */
export function sortEntries(list: CalendarEntry[]): CalendarEntry[] {
  return [...list].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.time ?? '99').localeCompare(b.time ?? '99') ||
      a.title.localeCompare(b.title, 'ko'),
  );
}

/* -------------------------------------------------------------------- 거르기 */

export type ScopeMode = 'mine' | 'dept' | 'all';

export interface Scope {
  /** 이 사람들 것만 (내 일정이면 나 하나, 부서별이면 그 부서 사람 전부) */
  memberIds: string[];
  /** 이 부서에 걸린 것도 함께 (협업 기한) */
  deptIds: string[];
}

/**
 * 달력에 실을 것을 좁힌다.
 *
 * `all` 은 그대로 전부다. **거르는 축이 두 개**인 이유:
 * 일정은 *사람*(참석자)에 붙고 협업 기한은 *부서*에 붙는다.
 * 하나로 뭉치면 부서별 보기에서 그 부서가 받은 협업 기한이 통째로 사라진다.
 */
export function filterEntries(list: CalendarEntry[], mode: ScopeMode, scope: Scope): CalendarEntry[] {
  if (mode === 'all') return list;
  const mem = new Set(scope.memberIds);
  const dep = new Set(scope.deptIds);
  return list.filter(
    (e) => e.who.some((w) => mem.has(w)) || e.deptIds.some((d) => dep.has(d)),
  );
}

/* -------------------------------------------------------------------- 달 */

/** 'YYYY-MM-DD' → 'YYYY-MM'. Date 로 왔다갔다 하면 시간대 때문에 1일이 앞 달로 샌다 */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function inMonth(date: string, month: string): boolean {
  return monthOf(date) === month;
}

/* ---------------------------------------------------------------- 정산 집계 */

export interface ClassLoad {
  memberId: string;
  /** 출강 건수 */
  classes: number;
  /** 강의 타임 수 합계 */
  periods: number;
  /** 그중 타임 수를 안 적은 건수 — 합계가 왜 작은지 화면에서 짚어줘야 한다 */
  missing: number;
}

/**
 * 달별 강사 출강 부하 — 정산의 기준이다.
 *
 * **타임 수를 안 적은 건을 조용히 0 으로 묻지 않는다.** 그러면 합계만 작아지고
 * 왜 작은지 알 방법이 없다 (영수증 없는 지출을 빨간 칸으로 따로 싣는 것과 같은 판단).
 * 많이 나간 사람부터 — 정산에서 먼저 보는 순서다.
 */
export function classLoad(
  schedules: Schedule[],
  attendees: Record<string, string[]>,
  month: string,
): ClassLoad[] {
  const m = new Map<string, ClassLoad>();
  for (const s of schedules) {
    if (safeKind(s.kind) !== 'class' || !inMonth(s.date, month)) continue;
    for (const who of attendees[s.id] ?? []) {
      const cur = m.get(who) ?? { memberId: who, classes: 0, periods: 0, missing: 0 };
      cur.classes += 1;
      if (s.periods == null) cur.missing += 1;
      else cur.periods += s.periods;
      m.set(who, cur);
    }
  }
  return [...m.values()].sort(
    (a, b) => b.periods - a.periods || b.classes - a.classes || a.memberId.localeCompare(b.memberId),
  );
}

/**
 * 출강 제목 — **사람이 짓지 않는다.**
 *
 * 출강은 늘 "어느 학교에서 무슨 프로그램" 이라 제목 칸을 따로 두면
 * 같은 것을 두 번 적게 된다. 폰에서 필수 칸을 늘리면 아무도 안 쓴다
 * (지출결의서에서 필수를 넷으로 줄인 것과 같은 판단).
 */
export function classTitle(school: string | null | undefined, program?: string | null): string {
  const s = (school ?? '').trim();
  const p = (program ?? '').trim();
  if (s && p) return `${s} · ${p}`;
  return s || p || '출강';
}

/** 출강 한 건을 한 줄로 — 알림·목록 부제에 쓴다 */
export function classLine(s: Pick<Schedule, 'school' | 'headcount' | 'periods'>, program?: string | null): string {
  const bits: string[] = [];
  if (s.school) bits.push(s.school);
  if (program) bits.push(program);
  if (s.headcount != null) bits.push(`${s.headcount}명`);
  if (s.periods != null) bits.push(`${s.periods}타임`);
  return bits.join(' · ');
}
