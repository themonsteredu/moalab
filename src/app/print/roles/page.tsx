'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { korDateFull } from '@/lib/format';
import { buildOrg, groupByPerson, orgTotals, type DeptNode, type DutyRef } from '@/lib/org';
import { mergeRuns, parseRoleParts, type RolePrintPart } from '@/lib/print';
import { Icon } from '@/components/Icon';
import { ErrorBanner } from '@/components/ui';
import type { Department, Duty, DutyGroup, DutyHelper } from '@/lib/types';

/**
 * 부서업무 인쇄 — 한꺼번에 뽑아서 종이로 본다.
 *
 * `?parts=dept,person,unassigned` 로 무엇을 넣을지 정한다 (`src/lib/print.ts`).
 *   · `dept`       부서별 통합 — 조직 전체가 한 문서에 (부서 › 중분류 › 역할 › 담당)
 *   · `person`     사람별 — **한 사람 = 한 쪽.** 뽑아서 그대로 건넨다
 *   · `unassigned` 담당자 미정만 — 지금 48건이 미정이라 이것만 뽑는 일이 잦다
 *
 * **설명(`note`)은 인쇄물에 안 싣는다.** 줄마다 회색 글씨가 따라붙으면 표가
 * 시끄러워서 정작 역할 이름이 안 읽힌다. 설명은 화면에서 보면 된다 —
 * 종이는 "누가 무엇을 맡았나" 만 한눈에 들어오면 된다.
 *
 * 프로그램·지출결의서 인쇄와 같이 **PDF 라이브러리를 쓰지 않는다** (브라우저 인쇄).
 * 고정 경로라 빌드 때 미리 그려보므로 `useSearchParams` 를 Suspense 로 감싼다.
 * 이 화면은 `(app)` 레이아웃 밖이라 로그인 가드를 직접 붙였다.
 */
export default function RolesPrintPage() {
  return (
    <Suspense fallback={<p className="p-10 text-center text-[14px] text-neutral-500">준비하고 있어요…</p>}>
      <RolesPrint />
    </Suspense>
  );
}

function RolesPrint() {
  const router = useRouter();
  const params = useSearchParams();
  const { session, loading: sessionLoading } = useSession();
  const { members, nameOf } = useMembers(true);

  const [depts, setDepts] = useState<Department[] | null>(null);
  const [groups, setGroups] = useState<DutyGroup[]>([]);
  const [duties, setDuties] = useState<Duty[]>([]);
  const [helpers, setHelpers] = useState<DutyHelper[]>([]);
  const [error, setError] = useState('');

  const parts = useMemo(() => parseRoleParts(params.get('parts')), [params]);

  useEffect(() => {
    if (!sessionLoading && !session) router.replace('/login');
  }, [session, sessionLoading, router]);

  useEffect(() => {
    (async () => {
      try {
        const [d, g, u, h] = await Promise.all([
          supabase.from('departments').select('*'),
          supabase.from('duty_groups').select('*'),
          supabase.from('duties').select('*'),
          supabase.from('duty_helpers').select('*'),
        ]);
        if (d.error) throw d.error;
        setDepts((d.data ?? []) as Department[]);
        setGroups((g.data ?? []) as DutyGroup[]);
        setDuties((u.data ?? []) as Duty[]);
        setHelpers((h.data ?? []) as DutyHelper[]);
      } catch (e) {
        setError(friendlyError(e, '부서업무를 불러오지 못했어요.'));
        setDepts([]);
      }
    })();
  }, []);

  const tree = useMemo(
    () => buildOrg(depts ?? [], groups, duties, helpers),
    [depts, groups, duties, helpers],
  );
  const totals = useMemo(() => orgTotals(tree), [tree]);
  const people = useMemo(() => groupByPerson(tree, members), [tree, members]);

  /* 사람별 장에 실을 사람. **`담당자 미정` 은 미정 표를 같이 뽑을 때만 뺀다** —
     그쪽에 서명란까지 있어서 같은 목록을 두 번 싣게 된다.
     미정 표를 안 뽑을 때는 여기 남겨야 미정이 어디에도 안 실리는 일이 없다. */
  const forPerson = useMemo(
    () => (parts.has('unassigned') ? people.filter((p) => p.memberId !== null) : people),
    [people, parts],
  );
  const withRoles = useMemo(
    () => forPerson.filter((p) => p.own.length + p.help.length > 0),
    [forPerson],
  );
  const idle = useMemo(
    () => forPerson.filter((p) => p.own.length + p.help.length === 0),
    [forPerson],
  );

  /** 담당자 미정 — 부서·중분류 이름을 달고 평평하게 편다 */
  const unassigned = useMemo(
    () =>
      tree.flatMap((d) =>
        d.groups.flatMap((g) =>
          g.duties
            .filter((n) => !n.duty.owner_id)
            .map((n) => ({ duty: n.duty, deptName: d.dept.name, groupName: g.group.name })),
        ),
      ),
    [tree],
  );

  /* 미정 표도 같은 규칙 — 부서·중분류가 이어지면 한 칸으로 */
  const noneDeptSpans = useMemo(() => mergeRuns(unassigned.map((r) => r.deptName)), [unassigned]);
  const noneGroupSpans = useMemo(
    () => mergeRuns(unassigned.map((r) => `${r.deptName} › ${r.groupName}`)),
    [unassigned],
  );

  if (sessionLoading || !session || depts === null) {
    return <p className="p-10 text-center text-[14px] text-neutral-500">인쇄할 내용을 준비하고 있어요…</p>;
  }
  if (error) {
    return (
      <div className="p-6">
        <ErrorBanner message={error} />
      </div>
    );
  }

  const today = korDateFull(new Date().toISOString().slice(0, 10));
  /* 한 묶음만 뽑을 때는 표지를 안 붙인다 — 강의계획서 한 장 인쇄와 같은 판단.
     표지는 여러 묶음을 한 문서로 묶을 때 쓰는 머리다 */
  const onlyOne = parts.size === 1;

  return (
    <main className="mx-auto max-w-[820px] bg-white p-6 text-black print:p-0">
      <div className="no-print mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-raised p-3">
        <button onClick={() => window.print()} className="btn-primary px-3.5 text-[14px]">
          <Icon name="printer" size={15} />
          인쇄 / PDF 저장
        </button>
        <button onClick={() => window.close()} className="btn-ghost px-3 text-[13px]">
          닫기
        </button>
        <p className="w-full text-[12px] leading-relaxed text-neutral-500">
          아이폰은 <b>공유 → 프린트</b> 를 누른 뒤 미리보기를 두 손가락으로 벌리면 PDF 로 저장됩니다.
          <br />
          PC 는 인쇄 대화상자에서 대상을 <b>PDF로 저장</b> 으로 바꾸세요.
        </p>
      </div>

      {!onlyOne && (
        <header className="print-block mb-6 border-b-2 border-black pb-3">
          <h1 className="text-[22px] font-black">부서업무</h1>
          <p className="mt-1 text-[12.5px] text-neutral-600">
            부서 {totals.depts} · 역할 {totals.duties}
            {totals.unassigned > 0 && ` · 담당자 미정 ${totals.unassigned}`}
            <span className="ml-3 text-[11px] text-neutral-400">출력일 {today}</span>
          </p>
        </header>
      )}

      {parts.has('dept') && <DeptDoc tree={tree} nameOf={nameOf} bare={onlyOne} today={today} />}

      {parts.has('person') && (
        <section className={parts.has('dept') ? 'print-page-break' : ''}>
          {!onlyOne && (
            <h2 className="mb-3 border-b border-black pb-1 text-[16px] font-black">사람별 역할</h2>
          )}
          {/* 맡은 게 있는 사람만 한 쪽씩. 0건인 사람에게 빈 쪽을 한 장씩 내주면
              나눠주려고 뽑은 문서에 백지가 섞인다 — 대신 아래에 한 줄로 모은다.
              (화면에서는 0건인 사람도 그대로 그린다. 종이는 장수가 곧 비용이라 다르다) */}
          {withRoles.map((p, i) => (
            <PersonSheet
              key={p.memberId ?? 'none'}
              name={p.name}
              own={p.own}
              help={p.help}
              today={today}
              /* 첫 사람 앞에는 안 가른다 — 빈 쪽이 딸려 나온다 */
              breakBefore={i > 0}
            />
          ))}
          {idle.length > 0 && (
            <p className="mt-4 border-t border-neutral-300 pt-2 text-[11.5px] text-neutral-600">
              <b>아직 아무 역할도 안 맡은 사람</b> — {idle.map((p) => p.name).join(', ')}
            </p>
          )}
        </section>
      )}

      {parts.has('unassigned') && (
        <section className={parts.size > 1 ? 'print-page-break' : ''}>
          <h2 className="mb-2 border-b border-black pb-1 text-[16px] font-black">
            담당자 미정
            <span className="ml-2 text-[11.5px] font-normal text-neutral-500">{unassigned.length}건</span>
          </h2>
          {unassigned.length === 0 ? (
            <p className="py-2 text-[12px] text-neutral-500">담당자가 다 정해졌습니다.</p>
          ) : (
            <table className="w-full border-collapse text-[11.5px]">
              <thead>
                <tr className="border-y border-black">
                  <th className="w-8 py-1.5 text-left font-bold">No.</th>
                  <th className="py-1.5 text-left font-bold">부서</th>
                  <th className="py-1.5 text-left font-bold">중분류</th>
                  <th className="py-1.5 text-left font-bold">역할</th>
                  <th className="w-24 py-1.5 text-left font-bold">담당자</th>
                </tr>
              </thead>
              <tbody>
                {unassigned.map((r, i) => (
                  <tr key={r.duty.id} className="print-block">
                    <td className="border-b border-neutral-200 py-1.5 pr-1 tabular-nums text-neutral-500">
                      {i + 1}
                    </td>
                    {noneDeptSpans[i].render && (
                      <td
                        rowSpan={noneDeptSpans[i].rowSpan}
                        className="border-b border-r border-neutral-200 py-1.5 pr-2 align-top"
                      >
                        {r.deptName}
                      </td>
                    )}
                    {noneGroupSpans[i].render && (
                      <td
                        rowSpan={noneGroupSpans[i].rowSpan}
                        className="border-b border-r border-neutral-200 py-1.5 pl-2 pr-2 align-top text-neutral-600"
                      >
                        {r.groupName}
                      </td>
                    )}
                    <td className="border-b border-neutral-200 py-1.5 pl-2 pr-2 font-semibold">
                      {r.duty.name}
                    </td>
                    {/* 종이에 적어 넣을 자리 — 회의에서 이 문서를 놓고 정하는 게 실제 흐름이다 */}
                    <td className="border-b border-neutral-200 py-1.5 text-neutral-300">
                      서명 __________
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <footer className="mt-8 border-t border-neutral-300 pt-2 text-[10.5px] text-neutral-500">
        모아킷 · 모아랩 업무 워크스페이스 — 부서업무
      </footer>
    </main>
  );
}

/* ------------------------------------------------------------ 부서별 통합 */

function DeptDoc({
  tree,
  nameOf,
  bare,
  today,
}: {
  tree: DeptNode[];
  nameOf: (id: string | null) => string;
  bare: boolean;
  today: string;
}) {
  return (
    <section>
      {bare && (
        <header className="print-block mb-5 border-b-2 border-black pb-3">
          <h1 className="text-[20px] font-black">부서업무 — 부서별</h1>
          <p className="mt-1 text-[11px] text-neutral-400">출력일 {today}</p>
        </header>
      )}
      {tree.map((d) => {
        /* 표를 그리기 전에 평평하게 펴둔다 — 통합 셀(rowSpan)은 '몇 번째 줄인지' 를
           알아야 계산되는데, 중첩 map 안에서는 그 번호가 묶음마다 0으로 돌아간다 */
        const rows = d.groups.flatMap((g) => g.duties.map((node) => ({ group: g.group, node })));
        const spans = mergeRuns(rows.map((r) => r.group.name));
        return (
        /* 부서마다 새 쪽에서 시작하지는 않는다 — 부서가 5개인데 각각 반 쪽이면
           종이가 두 배가 된다. 대신 부서 덩어리가 쪽 경계에서 안 잘리게만 한다 */
        <section key={d.dept.id} className="print-block mb-5">
          <h2 className="mb-1.5 flex items-baseline gap-2 border-b border-black pb-1">
            <span className="text-[15px] font-black">{d.dept.name}</span>
            <span className="text-[11.5px] font-normal text-neutral-500">역할 {d.total}</span>
            {d.unassigned > 0 && (
              <span className="text-[11.5px] font-bold text-neutral-700">미정 {d.unassigned}</span>
            )}
            {d.dept.head_id && (
              <span className="ml-auto text-[11.5px] text-neutral-600">
                부서장 {nameOf(d.dept.head_id)}
              </span>
            )}
          </h2>

          {d.groups.length === 0 ? (
            <p className="py-1.5 text-[11.5px] text-neutral-500">중분류가 없습니다.</p>
          ) : (
            <table className="w-full border-collapse text-[11.5px]">
              <thead>
                <tr className="border-b border-black">
                  <th className="w-28 py-1.5 text-left font-bold">중분류</th>
                  <th className="py-1.5 text-left font-bold">역할</th>
                  <th className="w-20 py-1.5 text-left font-bold">주담당</th>
                  <th className="w-24 py-1.5 text-left font-bold">부담당</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ group, node }, i) => (
                  <tr key={node.duty.id} className="print-block">
                    {/* 같은 중분류가 이어지면 **한 칸으로 합친다.** 빈 칸으로 두면
                        줄마다 가로선이 그어져서 묶음이 안 보인다 (mergeRuns) */}
                    {spans[i].render && (
                      <td
                        rowSpan={spans[i].rowSpan}
                        className="border-b border-r border-neutral-200 py-1.5 pr-2 align-top font-semibold"
                      >
                        {group.name}
                      </td>
                    )}
                    <td className="border-b border-neutral-200 py-1.5 pl-2 pr-2 font-semibold">
                      {node.duty.name}
                    </td>
                    <td className="border-b border-neutral-200 py-1.5 pr-2">
                      {node.duty.owner_id ? (
                        nameOf(node.duty.owner_id)
                      ) : (
                        <span className="font-bold text-neutral-700">미정</span>
                      )}
                    </td>
                    <td className="border-b border-neutral-200 py-1.5 text-neutral-600">
                      {node.helperIds.length > 0 ? node.helperIds.map((h) => nameOf(h)).join(', ') : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        );
      })}
    </section>
  );
}

/* ---------------------------------------------------------------- 사람별 */

function PersonSheet({
  name,
  own,
  help,
  today,
  breakBefore,
}: {
  name: string;
  own: DutyRef[];
  help: DutyRef[];
  today: string;
  breakBefore: boolean;
}) {
  const rows = [
    ...own.map((r) => ({ r, kind: '주담당' })),
    ...help.map((r) => ({ r, kind: '부담당' })),
  ];
  /* 한 사람이 같은 부서에서 여러 역할을 맡는 게 보통이라 부서·중분류가 줄줄이
     반복된다. 이어지는 것은 한 칸으로 합친다 (부서별 표와 같은 규칙).
     중분류는 **부서가 같을 때만** 합친다 — 부서가 다른데 중분류 이름이 우연히
     같다고 합치면 서로 다른 부서가 한 칸에 묶인다 */
  const deptSpans = mergeRuns(rows.map(({ r }) => r.deptName));
  const groupSpans = mergeRuns(rows.map(({ r }) => `${r.deptName} › ${r.groupName}`));

  return (
    <section className={`mb-6 ${breakBefore ? 'print-page-break' : ''}`}>
      <header className="mb-2 flex items-baseline gap-2 border-b-2 border-black pb-1.5">
        <h3 className="text-[17px] font-black">{name}</h3>
        <span className="text-[12px] text-neutral-600">
          주담당 {own.length} · 부담당 {help.length}
        </span>
        <span className="ml-auto text-[10.5px] text-neutral-400">{today}</span>
      </header>

      {rows.length === 0 ? (
        <p className="py-2 text-[12px] text-neutral-500">맡은 역할이 없습니다.</p>
      ) : (
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr className="border-b border-black">
              <th className="w-8 py-1.5 text-left font-bold">No.</th>
              <th className="w-24 py-1.5 text-left font-bold">부서</th>
              <th className="w-24 py-1.5 text-left font-bold">중분류</th>
              <th className="py-1.5 text-left font-bold">역할</th>
              <th className="w-14 py-1.5 text-left font-bold">구분</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, kind }, i) => (
              <tr key={`${r.duty.id}-${kind}`} className="print-block">
                <td className="border-b border-neutral-200 py-1.5 pr-1 tabular-nums text-neutral-500">
                  {i + 1}
                </td>
                {deptSpans[i].render && (
                  <td
                    rowSpan={deptSpans[i].rowSpan}
                    className="border-b border-r border-neutral-200 py-1.5 pr-2 align-top"
                  >
                    {r.deptName}
                  </td>
                )}
                {groupSpans[i].render && (
                  <td
                    rowSpan={groupSpans[i].rowSpan}
                    className="border-b border-r border-neutral-200 py-1.5 pl-2 pr-2 align-top text-neutral-600"
                  >
                    {r.groupName}
                  </td>
                )}
                <td className="border-b border-neutral-200 py-1.5 pl-2 pr-2 font-semibold">
                  {r.duty.name}
                </td>
                <td className="border-b border-neutral-200 py-1.5">{kind}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* 종이로 넘길 때 필요하다 — 지출결의서 인쇄에 결의자·확인 서명란을 둔 것과 같다 */}
      <div className="mt-3 flex gap-6 text-[11px] text-neutral-500">
        <span>확인 (본인) ______________</span>
        <span>확인 (원장) ______________</span>
      </div>
    </section>
  );
}
