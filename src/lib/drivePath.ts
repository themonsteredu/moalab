/**
 * 앱에 올린 파일이 **드라이브 어느 폴더로 갈지**. 순수 계산이라 여기 모아두고
 * `scripts/drive-path.test.mjs` 가 지킨다 (브라우저·서버 양쪽에서 쓴다).
 *
 * 폴더 구조를 사람이 매번 고르게 하지 않는다 — 앱이 이미 아는 것(주제·프로그램명·
 * 학교·날짜)으로 만든다. 고르게 하면 아무도 안 고르고 전부 한 폴더에 쌓인다
 * (출강 제목을 `학교 · 프로그램` 으로 만든 것과 같은 판단).
 */

export type DriveKind = 'plan' | 'receipt' | 'photo' | 'lecture' | 'dept';

export const DRIVE_KINDS: { value: DriveKind; label: string; where: string; hint: string }[] = [
  {
    value: 'plan',
    label: '프로그램 문서',
    where: '프로그램 / {주제} / {프로그램명}',
    hint: '계획안 · 교육안 · 양식 · 기타',
  },
  {
    value: 'receipt',
    label: '지출 영수증',
    where: '00_회사공통 / 정산자료 / {연-월}',
    hint: '지출결의서에 붙인 영수증 사진',
  },
  {
    value: 'photo',
    label: '수업 사진',
    where: '{학기} / {학교} / 수업사진',
    hint: '갤러리 앨범의 사진 — 장수가 많아 용량을 제일 빨리 먹어요',
  },
  {
    value: 'lecture',
    label: '강의계획서',
    where: '프로그램 / {주제} / {프로그램명}',
    hint: '한글(.hwpx) 파일',
  },
  {
    value: 'dept',
    label: '역할 자료',
    where: '업무분장 / {부서} / {중분류}',
    hint: '역할분장에서 그 일을 열고 올린 결과물',
  },
];

export function isDriveKind(v: string): v is DriveKind {
  return DRIVE_KINDS.some((k) => k.value === v);
}

export function driveKindLabel(v: string): string {
  return DRIVE_KINDS.find((k) => k.value === v)?.label ?? v;
}

/**
 * 폴더·파일 이름으로 쓸 수 있게 다듬는다.
 *
 * `/` 는 **반드시** 지운다 — 경로 구분자라 그대로 두면 프로그램 이름 하나가
 * 폴더 두 개로 갈라진다. 구글이 싫어하는 글자와 앞뒤 점·공백도 정리한다.
 */
export function safeSeg(raw: string | null | undefined, fallback = '기타'): string {
  const s = (raw ?? '')
    .replace(/[/\\]/g, '·')
    // 구글·윈도가 못 쓰는 글자와 제어문자만 걷어낸다.
    // **공백과 하이픈은 남긴다** — 지우면 '광주 중학교'·'2026-2학기' 가 뭉개진다
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
  return s.length > 0 ? s.slice(0, 100) : fallback;
}

/** '2026-08-31' → '2026-2학기'. 3~8월이 1학기, 9~2월이 2학기다 */
export function termOf(date: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(date ?? '');
  if (!m) return '기타';
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month >= 3 && month <= 8) return `${year}-1학기`;
  // 1·2월은 **지난해** 2학기다 — 9월에 시작한 학기가 해를 넘긴 것이다
  return month >= 9 ? `${year}-2학기` : `${year - 1}-2학기`;
}

/** 프로그램 문서·강의계획서 — 주제별로 묶는다 (/apps 트리와 같은 순서) */
export function planPath(topic: string | null | undefined, appTitle: string): string {
  return `프로그램/${safeSeg(topic, '주제 없음')}/${safeSeg(appTitle, '이름 없는 프로그램')}`;
}

/** 영수증 — 달마다. 연말에 폴더째로 회계에 넘긴다 */
export function receiptPath(month: string): string {
  return `00_회사공통/정산자료/${/^\d{4}-\d{2}$/.test(month ?? '') ? month : '기타'}`;
}

/** 수업 사진 — 학기 › 학교. 앨범에 이미 학교·날짜가 있어서 사람이 안 고른다 */
export function photoPath(date: string, school: string | null | undefined): string {
  return `${termOf(date)}/${safeSeg(school, '학교 미정')}/수업사진`;
}

/**
 * 역할 자료 — 손으로 만들어둔 `업무분장/{부서}/{중분류}` 폴더로 그대로 간다.
 *
 * 역할마다 폴더를 또 파지 않는다 — 역할이 63개라 폴더가 63개가 된다.
 * 대신 파일 이름 앞에 역할명을 붙여 무엇을 하다 나온 자료인지 알아보게 한다.
 */
export function deptPath(deptName: string | null | undefined, groupName?: string | null): string {
  const base = `업무분장/${safeSeg(deptName, '부서 미정')}`;
  return groupName ? `${base}/${safeSeg(groupName, '기타')}` : base;
}

/** 갈래에 맞는 폴더 경로. 필요한 값이 없으면 null — 줄을 안 세운다 */
export function pathFor(
  kind: DriveKind,
  ctx: {
    topic?: string | null;
    appTitle?: string | null;
    month?: string | null;
    date?: string | null;
    school?: string | null;
    deptName?: string | null;
    groupName?: string | null;
  },
): string | null {
  if (kind === 'dept') {
    if (!ctx.deptName) return null;
    return deptPath(ctx.deptName, ctx.groupName);
  }
  if (kind === 'plan' || kind === 'lecture') {
    if (!ctx.appTitle) return null;
    return planPath(ctx.topic, ctx.appTitle);
  }
  if (kind === 'receipt') {
    if (!ctx.month) return null;
    return receiptPath(ctx.month);
  }
  if (!ctx.date) return null;
  return photoPath(ctx.date, ctx.school);
}

/**
 * 드라이브에 쓸 파일 이름.
 *
 * 앱에서는 `abc123.webp` 처럼 뜻 없는 이름으로 저장돼 있는 게 많다. 그대로 올리면
 * 드라이브에서 아무것도 못 알아본다. **앞에 뜻을 붙이고 확장자는 살린다.**
 */
export function fileNameFor(original: string, prefix?: string | null): string {
  const raw = original.split('/').pop() ?? original;

  /* 확장자를 **먼저** 떼어둔다. safeSeg 가 길이를 자르기 때문에, 나중에 지키려 하면
     이미 `.hwpx` 가 날아간 뒤다 (실제로 그렇게 짰다가 테스트에서 잡혔다).
     확장자 없이 받으면 한글도 엑셀도 파일을 못 연다 */
  const dot = raw.lastIndexOf('.');
  const ext = dot > 0 && raw.length - dot <= 9 ? raw.slice(dot).toLowerCase() : '';
  const stem = ext ? raw.slice(0, dot) : raw;

  const base = safeSeg(stem, '파일');
  const p = prefix ? safeSeg(prefix, '') : '';
  const named = p && !base.startsWith(p) ? `${p}_${base}` : base;

  const room = Math.max(1, 120 - ext.length);
  return named.slice(0, room) + ext;
}
