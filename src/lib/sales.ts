import type { Duty, DutyColumn, DutyRow } from './types';

/**
 * **영업 한 판** — 기관 표 여럿을 한 화면에 모은다.
 *
 * 신규 기관 발굴을 갈래 15개로 나누면서(37단계) 표가 15개가 됐다. 갈래마다 파는 말이
 * 달라 나눈 것은 맞는데, *"오늘 연락할 곳이 어디지"* · *"제안서 보낸 데가 몇 군데지"* 를
 * 보려면 **15개를 하나씩 열어야** 했다. 그래서 읽어서 합치기만 하는 판을 얹는다.
 *
 * **새 표를 하나도 안 만든다.** 이미 있는 `duty_columns`·`duty_rows` 를 읽어 계산만 한다
 * (`/verify` 가 새 표 없이 만들어진 것과 같은 방식). 표를 또 만들면 데이터가 두 벌이 된다.
 *
 * 어떤 표를 모으나 — **`연락` 이 들어간 날짜 칸이 있는 표.** `다음 연락일` 이 그것이다.
 * 역할 이름으로 고르지 않는다 (원장이 언제든 바꾼다). 칸으로 고르면 나중에 만드는 표도
 * 그 칸만 있으면 저절로 이 판에 올라온다. 견적·계약(계약일)·만족도 조사(수업 날)처럼
 * *다음에 연락할 날* 이 없는 표는 성격이 달라 안 섞는다.
 *
 * 이름은 **첫 칸**, 상태는 **첫 고르기 칸** — 역할 표 화면(`rowTitle`·`statusCounts`)과
 * 같은 규칙이다. 여기서 다르게 읽으면 화면마다 숫자가 어긋난다.
 */

export interface SalesInput {
  duty: Duty;
  groupName: string;
}

export interface StatusCount {
  label: string;
  n: number;
}

export interface SalesTableSummary {
  /**
   * 이 줄을 눌렀을 때 표에 **걸어둘 검색어**. 갈래로 가른 줄이면 그 갈래 값이다.
   * 비어 있으면 표 전체를 연다.
   */
  q?: string;
  dutyId: string;
  dutyName: string;
  groupName: string;
  /** 기관 몇 곳 */
  total: number;
  /** 오늘·지난 연락일이 남은 곳 */
  due: number;
  /** 많은 순 상태 두 개 */
  top: StatusCount[];
}

export interface DueItem {
  dutyId: string;
  dutyName: string;
  rowId: string;
  title: string;
  status: string | null;
  date: string;
  /** 0 = 오늘, 3 = 사흘 지남 */
  daysLate: number;
}

export interface SalesBoard {
  tables: SalesTableSummary[];
  /** 전체 합산 상태별 개수 — 보기(option) 순서대로, 0 건은 뺀다 */
  status: StatusCount[];
  /** 오늘·지난 연락일 — 오래 지난 것부터 */
  due: DueItem[];
  /** 기관 전부 몇 곳 */
  total: number;
}

/**
 * 끝난 것에는 연락 알림을 안 붙인다. `완료`·`보류` 는 원장의 실제 보기 이름이다 —
 * 보류해둔 곳이 매일 '오늘 연락할 곳' 에 뜨면 그날로 이 판을 안 본다.
 */
export const CLOSED_STATES = ['완료', '보류', '취소', '종료'];

/** 영업 판에 모을 표인가 — `연락` 이 들어간 날짜 칸 (`다음 연락일`) */
/**
 * **갈래 칸** — `기관 갈래` 처럼 *무슨 종류인가* 를 담은 고르기 칸.
 *
 * 예전엔 갈래마다 표를 따로 뒀는데(37단계) 원장이 *"합쳐"* 라고 해서 표 하나 +
 * 갈래 칸 하나가 됐다. 그러면 이 판의 `갈래별` 이 한 줄로 뭉개지므로,
 * **표가 아니라 이 칸의 값으로** 가른다 — 보이는 것은 예전과 같고 표만 하나다.
 *
 * ⚠️ **상태 칸은 제외한다.** 첫 고르기 칸은 진행 상태(상태 칩)라서, 그걸 갈래로
 * 잡으면 `연락 전 12곳` 이 갈래 이름 자리에 온다.
 */
export function kindCol(cols: DutyColumn[], statusCol: DutyColumn | null): DutyColumn | null {
  return (
    cols.find(
      (c) =>
        c.kind === 'select' &&
        c.id !== statusCol?.id &&
        /갈래|유형|종류/.test(c.name.replace(/\s/g, '')),
    ) ?? null
  );
}

export function contactCol(cols: DutyColumn[]): DutyColumn | null {
  return cols.find((c) => c.kind === 'date' && c.name.replace(/\s/g, '').includes('연락')) ?? null;
}

/** `YYYY-MM-DD` 두 날짜의 차이(일). 날짜가 아니면 null */
export function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

export function buildSalesBoard(
  inputs: SalesInput[],
  cols: DutyColumn[],
  rows: DutyRow[],
  today: string,
): SalesBoard {
  const colsBy = new Map<string, DutyColumn[]>();
  for (const c of [...cols].sort((x, y) => x.sort_order - y.sort_order)) {
    colsBy.set(c.duty_id, [...(colsBy.get(c.duty_id) ?? []), c]);
  }
  const rowsBy = new Map<string, DutyRow[]>();
  for (const r of [...rows].sort((x, y) => x.sort_order - y.sort_order)) {
    rowsBy.set(r.duty_id, [...(rowsBy.get(r.duty_id) ?? []), r]);
  }

  const tables: SalesTableSummary[] = [];
  const due: DueItem[] = [];
  const status = new Map<string, number>();
  let total = 0;

  for (const { duty, groupName } of inputs) {
    const c = colsBy.get(duty.id) ?? [];
    const dateCol = contactCol(c);
    if (!dateCol) continue;
    const nameCol = c[0];
    const statusCol = c.find((x) => x.kind === 'select') ?? null;

    /* 상태 순서는 **보기(option) 순서**를 따른다 — 값이 나온 순서로 두면 표마다 달라진다 */
    for (const o of statusCol?.options ?? []) if (!status.has(o)) status.set(o, 0);

    /* 갈래 칸이 있으면 **표가 아니라 갈래로** 가른다 (표를 합쳤기 때문) */
    const kind = kindCol(c, statusCol);
    const perKind = new Map<string, { total: number; due: number; local: Map<string, number> }>();
    const bucket = (k: string) => {
      const b = perKind.get(k) ?? { total: 0, due: 0, local: new Map<string, number>() };
      perKind.set(k, b);
      return b;
    };

    const local = new Map<string, number>();
    const list = rowsBy.get(duty.id) ?? [];
    let dueHere = 0;
    for (const r of list) {
      const cells = r.cells ?? {};
      const rawTitle = nameCol ? cells[nameCol.id] : null;
      const title = String(rawTitle ?? '').trim() || '이름 없음';
      const rawStatus = statusCol ? cells[statusCol.id] : null;
      const st = typeof rawStatus === 'string' && rawStatus.trim() !== '' ? rawStatus : null;
      if (st) {
        local.set(st, (local.get(st) ?? 0) + 1);
        status.set(st, (status.get(st) ?? 0) + 1);
      }

      /* 갈래를 안 고른 줄도 세어야 한다 — 안 세면 갈래별 합이 전체와 안 맞는다 */
      const rawKind = kind ? cells[kind.id] : null;
      const kv =
        typeof rawKind === 'string' && rawKind.trim() !== '' ? rawKind : kind ? '갈래 없음' : '';
      if (kind) {
        const b = bucket(kv);
        b.total += 1;
        if (st) b.local.set(st, (b.local.get(st) ?? 0) + 1);
      }
      const date = typeof cells[dateCol.id] === 'string' ? (cells[dateCol.id] as string) : null;
      if (!date || (st && CLOSED_STATES.includes(st))) continue;
      const late = daysBetween(date, today);
      if (late === null || late < 0) continue;
      dueHere += 1;
      if (kind) bucket(kv).due += 1;
      due.push({ dutyId: duty.id, dutyName: duty.name, rowId: r.id, title, status: st, date, daysLate: late });
    }

    total += list.length;

    const top2 = (m: Map<string, number>) =>
      [...m.entries()]
        .map(([label, n]) => ({ label, n }))
        .sort((a, b) => b.n - a.n)
        .slice(0, 2);

    if (kind && perKind.size > 0) {
      /* 갈래 순서는 **보기(option) 순서**를 따른다 — 값이 나온 순서로 두면 달에 따라 바뀐다.
         보기에 없는 값('갈래 없음' 포함)은 뒤에 붙인다 */
      const order = [...(kind.options ?? []), ...[...perKind.keys()].filter((k) => !(kind.options ?? []).includes(k))];
      for (const k of order) {
        const b = perKind.get(k);
        if (!b || b.total === 0) continue;
        tables.push({
          dutyId: duty.id,
          dutyName: k,
          groupName: duty.name,
          // 누르면 그 갈래로 **검색해둔 채** 표를 연다 (22줄에 떨어뜨리지 않는다)
          q: k === '갈래 없음' ? undefined : k,
          total: b.total,
          due: b.due,
          top: top2(b.local),
        });
      }
    } else {
      tables.push({
        dutyId: duty.id,
        dutyName: duty.name,
        groupName,
        total: list.length,
        due: dueHere,
        top: top2(local),
      });
    }
  }

  due.sort((a, b) => b.daysLate - a.daysLate || a.title.localeCompare(b.title, 'ko'));

  return {
    tables,
    status: [...status.entries()].map(([label, n]) => ({ label, n })).filter((s) => s.n > 0),
    due,
    total,
  };
}

/** 연락일 표기 — `오늘` / `3일 지남` */
export function lateLabel(daysLate: number): string {
  return daysLate === 0 ? '오늘' : `${daysLate}일 지남`;
}
