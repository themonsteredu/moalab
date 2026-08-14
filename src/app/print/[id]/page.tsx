'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { supabase, friendlyError } from '@/lib/supabase';
import { useMembers } from '@/lib/useMembers';
import { useTopics } from '@/lib/useTopics';
import { useSession } from '@/lib/session';
import { calcItem, calcSheet, categoryLabel } from '@/lib/cost';
import { STATUS_META } from '@/lib/status';
import { korDateFull, won, won1 } from '@/lib/format';
import { Icon } from '@/components/Icon';
import { parsePrintParts, type PrintPart } from '@/lib/print';
import { BrandMark } from '@/components/Brand';
import { PlanSheet } from '@/components/PlanSheet';
import { ErrorBanner } from '@/components/ui';
import {
  FINDING_META,
  REPLY_STATES,
  type Album,
  type AppRow,
  type CostItem,
  type CostSheet,
  type Finding,
  type FindingFile,
  type FindingReply,
  type Photo,
  type PlanFile,
  type AppSample,
  type LessonPlan,
  type LessonPlanItem,
  type PlanSlot,
} from '@/lib/types';

/**
 * 인쇄 / PDF 저장 화면.
 *
 * PDF 라이브러리를 넣지 않고 **브라우저 인쇄**를 쓴다.
 * 아이폰은 사파리 공유 → 프린트 → 'PDF로 저장' 이 되고,
 * PC 는 인쇄 대화상자에서 'PDF로 저장' 을 고르면 된다.
 * 라이브러리로 그리면 한글 폰트를 따로 넣어야 하고 표가 깨진다.
 */
export default function PrintPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { nameOf } = useMembers(true);
  const { nameOfTopic } = useTopics();
  // 이 화면은 (app) 레이아웃 밖이라 로그인 가드를 직접 붙인다
  const { session, loading: sessionLoading } = useSession();

  useEffect(() => {
    if (!sessionLoading && !session) router.replace('/login');
  }, [session, sessionLoading, router]);

  const parts = useMemo<Set<PrintPart>>(() => parsePrintParts(search.get('parts')), [search]);

  /**
   * 강의계획서만 골랐으면 **그 한 장만** 나간다.
   * 표지(프로그램명·상태·검증 라운드·제작자…)는 여러 묶음을 한 문서로 묶을 때 쓰는 머리다.
   * 학교에 계획서 한 장만 낼 때 우리 내부 검증 현황이 같이 찍히면 안 된다.
   */
  const onlyPlan = parts.size === 1 && parts.has('plan');

  const [app, setApp] = useState<AppRow | null>(null);
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [findingFiles, setFindingFiles] = useState<FindingFile[]>([]);
  const [findingReplies, setFindingReplies] = useState<FindingReply[]>([]);
  const [planFiles, setPlanFiles] = useState<PlanFile[]>([]);
  const [lessonPlan, setLessonPlan] = useState<LessonPlan | null>(null);
  const [planItems, setPlanItems] = useState<LessonPlanItem[]>([]);
  const [sheet, setSheet] = useState<CostSheet | null>(null);
  const [costItems, setCostItems] = useState<CostItem[]>([]);
  const [samples, setSamples] = useState<AppSample[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const { data: a, error: aErr } = await supabase.from('apps').select('*').eq('id', id).maybeSingle();
      if (aErr) throw aErr;
      if (!a) {
        setError('프로그램을 찾지 못했어요.');
        setLoading(false);
        return;
      }
      setApp(a as AppRow);

      const [revRes, fdRes, planRes, sheetRes, sampleRes, albumRes, lpRes, lpiRes] = await Promise.all([
        supabase.from('app_reviewers').select('member_id').eq('app_id', id),
        parts.has('verify')
          ? supabase.from('findings').select('*').eq('app_id', id).order('created_at')
          : Promise.resolve({ data: [] }),
        parts.has('planfile')
          ? supabase.from('plan_files').select('*').eq('app_id', id).order('created_at')
          : Promise.resolve({ data: [] }),
        parts.has('cost')
          ? supabase.from('cost_sheets').select('*').eq('app_id', id).order('updated_at', { ascending: false })
          : Promise.resolve({ data: [] }),
        parts.has('sample')
          ? supabase.from('app_samples').select('*').eq('app_id', id).order('sort_order')
          : Promise.resolve({ data: [] }),
        parts.has('photo')
          ? supabase.from('albums').select('*').eq('app_id', id).order('class_date', { ascending: false })
          : Promise.resolve({ data: [] }),
        parts.has('plan')
          ? supabase.from('lesson_plans').select('*').eq('app_id', id).maybeSingle()
          : Promise.resolve({ data: null }),
        parts.has('plan')
          ? supabase.from('lesson_plan_items').select('*').eq('app_id', id).order('sort_order')
          : Promise.resolve({ data: [] }),
      ]);

      setReviewerIds((revRes.data ?? []).map((r) => r.member_id));
      setPlanFiles((planRes.data ?? []) as PlanFile[]);
      setLessonPlan((lpRes.data as LessonPlan) ?? null);
      setPlanItems((lpiRes.data ?? []) as LessonPlanItem[]);
      setSamples((sampleRes.data ?? []) as AppSample[]);

      const fds = (fdRes.data ?? []) as Finding[];
      setFindings(fds);
      if (fds.length > 0) {
        const ids = fds.map((f) => f.id);
        const [flRes, rpRes] = await Promise.all([
          supabase.from('finding_files').select('*').in('finding_id', ids).order('sort_order'),
          supabase.from('finding_replies').select('*').in('finding_id', ids).order('created_at'),
        ]);
        setFindingFiles((flRes.data ?? []) as FindingFile[]);
        setFindingReplies((rpRes.data ?? []) as FindingReply[]);
      }

      const sheets = (sheetRes.data ?? []) as CostSheet[];
      if (sheets.length > 0) {
        setSheet(sheets[0]);
        const { data: ci } = await supabase
          .from('cost_items')
          .select('*')
          .eq('sheet_id', sheets[0].id)
          .order('sort_order');
        setCostItems((ci ?? []) as CostItem[]);
      }

      const als = (albumRes.data ?? []) as Album[];
      setAlbums(als);
      if (als.length > 0) {
        const { data: ps } = await supabase
          .from('photos')
          .select('*')
          .in('album_id', als.map((x) => x.id))
          .order('created_at', { ascending: false })
          .limit(60);
        setPhotos((ps ?? []) as Photo[]);
      }
    } catch (e) {
      setError(friendlyError(e, '불러오지 못했어요.'));
    } finally {
      setLoading(false);
    }
  }, [id, parts]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(
    () => (sheet ? calcSheet(costItems, sheet.headcount, sheet.sale_price) : null),
    [sheet, costItems],
  );

  const openFindings = findings.filter((f) => FINDING_META[f.status].open);

  /** 계획안은 문서별 최신 판만 싣는다 (지난 판까지 넣으면 문서가 지저분해진다) */
  const latestPlans = useMemo(() => {
    const m = new Map<string, PlanFile>();
    for (const f of planFiles) {
      const g = f.group_id ?? f.id;
      const cur = m.get(g);
      if (!cur || f.version > cur.version) m.set(g, f);
    }
    return [...m.values()].sort((a, b) => a.file_name.localeCompare(b.file_name, 'ko'));
  }, [planFiles]);

  if (sessionLoading || !session || loading) {
    return <p className="p-10 text-center text-[14px] text-neutral-500">인쇄할 내용을 준비하고 있어요…</p>;
  }
  if (error || !app) {
    return (
      <div className="p-6">
        <ErrorBanner message={error || '프로그램을 찾지 못했어요.'} />
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-[820px] bg-white p-6 text-black print:p-0">
      {/* 화면에서만 보이는 조작 줄 */}
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

      {/* ------------------------------------------------------ 표지
          강의계획서만 뽑을 때는 붙이지 않는다 (위 onlyPlan 설명 참고) */}
      {!onlyPlan && (
        <header className="print-block mb-6 border-b-2 border-black pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[12px] font-bold tracking-wide text-neutral-500">
                {nameOfTopic(app.topic_id) || '모아랩 프로그램'}
              </p>
              <h1 className="mt-1 text-[26px] font-black leading-tight">{app.title_ko}</h1>
              <p className="mt-1 text-[12.5px] text-neutral-500">{app.slug}</p>
            </div>
            <span className="flex shrink-0 items-center justify-center rounded-[14px] bg-black p-2.5">
              <BrandMark size={40} />
            </span>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-3">
            <Row label="상태" value={STATUS_META[app.status].label} />
            <Row label="검증 라운드" value={`${app.current_round}차`} />
            <Row label="제작자" value={app.creator_id ? nameOf(app.creator_id) : '-'} />
            <Row
              label="검증 참여"
              value={reviewerIds.length > 0 ? reviewerIds.map((r) => nameOf(r)).join(', ') : '-'}
            />
            <Row label="마감일" value={app.due_date ? korDateFull(app.due_date) : '-'} />
            <Row label="대상 학년" value={app.target_grade || '-'} />
          </dl>

          {app.purpose && (
            <p className="mt-3 whitespace-pre-wrap text-[12.5px] leading-relaxed text-neutral-700">
              {app.purpose}
            </p>
          )}
          <p className="mt-3 text-[11px] text-neutral-400">
            출력일 {korDateFull(new Date().toISOString().slice(0, 10))}
          </p>
        </header>
      )}

      {/* ------------------------------------------------------ 검증 */}
      {parts.has('verify') && (
        <Section title="검증" sub={`지적 ${findings.length}건 · 안 닫힘 ${openFindings.length}건`}>
          {findings.length === 0 ? (
            <Empty>지적이 없습니다.</Empty>
          ) : (
            <ol className="space-y-3">
              {findings.map((f, i) => {
                const shots = findingFiles.filter((x) => x.finding_id === f.id);
                const replies = findingReplies.filter((x) => x.finding_id === f.id);
                const meta = FINDING_META[f.status];
                return (
                  <li key={f.id} className="print-block border border-neutral-300 p-2.5">
                    <p className="flex flex-wrap items-baseline gap-2 text-[12px]">
                      <span className="font-black">{i + 1}.</span>
                      <span className="border border-neutral-400 px-1.5 py-0.5 font-bold">{meta.label}</span>
                      <span className="text-neutral-500">
                        {nameOf(f.member_id)} · {korDateFull(f.created_at.slice(0, 10))}
                      </span>
                    </p>
                    <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed">{f.body}</p>

                    {shots.length > 0 && (
                      <div className="mt-2 grid grid-cols-3 gap-1.5">
                        {shots.map((s) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={s.id}
                            src={s.file_url}
                            alt={s.file_name ?? '캡처'}
                            className="w-full border border-neutral-200 object-contain"
                          />
                        ))}
                      </div>
                    )}

                    {replies.map((r) => (
                      <p key={r.id} className="mt-1.5 border-l-2 border-neutral-400 pl-2 text-[12px] leading-relaxed">
                        <b>{REPLY_STATES.find((s) => s.value === r.state)?.label}</b>{' '}
                        <span className="text-neutral-500">{nameOf(r.member_id)}</span> — {r.body}
                      </p>
                    ))}
                  </li>
                );
              })}
            </ol>
          )}
        </Section>
      )}

      {/* -------------------------------------------- 강의계획서 (양식 그대로)
          한글 양식과 같은 표를 그대로 그린다.
          앞에 표지·검증 기록이 붙을 때만 새 쪽에서 시작한다 — 이 장만 뽑을 때
          쪽 넘김을 넣으면 맨 앞에 빈 쪽이 한 장 딸려 나온다. */}
      {parts.has('plan') && lessonPlan && (
        <section className={onlyPlan ? '' : 'print-page-break mb-6'}>
          <PlanSheet
            plan={lessonPlan}
            items={planItems}
            title={app.title_ko}
          />
        </section>
      )}
      {parts.has('plan') && !lessonPlan && (
        <p className="py-10 text-center text-[13px] text-neutral-500">
          아직 강의계획서를 안 만들었어요. 프로그램 화면의 <b>강의계획서</b> 에서 먼저 채워주세요.
        </p>
      )}

      {/* ------------------------------------------------ 계획안 첨부 */}
      {parts.has('planfile') && (
        <Section title="계획안 첨부파일" sub={`문서 ${latestPlans.length}개`}>
          {latestPlans.length === 0 ? (
            <Empty>첨부된 계획안이 없습니다.</Empty>
          ) : (
            <>
              <ul className="space-y-1">
                {latestPlans.map((f) => (
                  <li key={f.id} className="border-b border-neutral-200 py-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[12.5px]">
                        {f.file_name}
                        {f.version > 1 && <span className="ml-1.5 font-bold">{f.version}판</span>}
                      </span>
                      <span className="shrink-0 text-[11px] text-neutral-500">
                        {nameOf(f.member_id)} · {korDateFull(f.created_at.slice(0, 10))}
                        {f.file_size ? ` · ${Math.round(f.file_size / 1024)}KB` : ''}
                      </span>
                    </div>
                    {f.note && (
                      <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-600">{f.note}</p>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-neutral-500">
                계획안은 한글·PDF 파일이라 이 문서에 본문이 들어가지 않습니다. 파일은 프로그램 화면에서
                내려받아 따로 인쇄해주세요.
              </p>
            </>
          )}
        </Section>
      )}

      {/* -------------------------------------------------------- 원가 */}
      {parts.has('cost') && (
        <Section title="원가표" sub={sheet ? `${sheet.title} · ${sheet.headcount}명 기준` : undefined}>
          {!sheet || costItems.length === 0 ? (
            <Empty>원가표가 없습니다.</Empty>
          ) : (
            <>
              <table className="w-full border-collapse text-[11.5px]">
                <thead>
                  <tr className="border-y border-black">
                    <th className="py-1.5 text-left font-bold">품목</th>
                    <th className="py-1.5 text-left font-bold">구분</th>
                    <th className="py-1.5 text-right font-bold">묶음가</th>
                    <th className="py-1.5 text-right font-bold">1인당</th>
                    <th className="py-1.5 text-right font-bold">총액</th>
                  </tr>
                </thead>
                <tbody>
                  {costItems.map((it) => {
                    const c = calcItem(it, sheet.headcount);
                    return (
                      <tr key={it.id} className="border-b border-neutral-200">
                        <td className="py-1.5 pr-2">
                          {it.name}
                          {it.reusable && <span className="ml-1 text-[10px] text-neutral-500">재사용</span>}
                          {it.vendor && (
                            <span className="block text-[10px] text-neutral-500">{it.vendor}</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-2">{categoryLabel(it.category)}</td>
                        <td className="py-1.5 text-right tabular-nums">{won(it.pack_price)}</td>
                        <td className="py-1.5 text-right tabular-nums">{won1(c.perPerson)}</td>
                        <td className="py-1.5 text-right tabular-nums">{won(c.total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-y-2 border-black font-black">
                    <td className="py-2" colSpan={3}>
                      합계 ({sheet.headcount}명)
                    </td>
                    <td className="py-2 text-right tabular-nums">{won1(totals?.perPerson ?? 0)}</td>
                    <td className="py-2 text-right tabular-nums">{won(totals?.total ?? 0)}</td>
                  </tr>
                </tfoot>
              </table>

              {sheet.sale_price > 0 && totals && (
                <dl className="mt-3 grid grid-cols-3 gap-3 text-[12px]">
                  <Row label="1인당 판매가" value={won(sheet.sale_price)} />
                  <Row label="총 수입" value={won(totals.revenue)} />
                  <Row
                    label="마진"
                    value={`${won(totals.margin)}${
                      totals.marginRate != null ? ` (${totals.marginRate.toFixed(1)}%)` : ''
                    }`}
                  />
                </dl>
              )}
            </>
          )}
        </Section>
      )}

      {/* -------------------------------------------------- 샘플 이미지 */}
      {parts.has('sample') && (
        <Section title="샘플 이미지" sub={`${samples.length}장`}>
          {samples.length === 0 ? (
            <Empty>샘플 이미지가 없습니다.</Empty>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {samples.map((s) => (
                <figure key={s.id} className="print-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.url} alt={s.caption ?? ''} className="w-full border border-neutral-200 object-cover" />
                  {s.caption && <figcaption className="mt-0.5 text-[10px] text-neutral-600">{s.caption}</figcaption>}
                </figure>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* ---------------------------------------------------- 수업 사진 */}
      {parts.has('photo') && (
        <Section title="수업 사진" sub={`앨범 ${albums.length}개 · 사진 ${photos.length}장`}>
          {photos.length === 0 ? (
            <Empty>수업 사진이 없습니다.</Empty>
          ) : (
            albums.map((al) => {
              const ps = photos.filter((p) => p.album_id === al.id);
              if (ps.length === 0) return null;
              return (
                <div key={al.id} className="mb-3">
                  <p className="mb-1 text-[12px] font-bold">
                    {al.school} · {korDateFull(al.class_date)}
                    {al.grade && ` · ${al.grade}`}
                  </p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {ps.map((p) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={p.id}
                        src={p.url}
                        alt={p.caption ?? ''}
                        className="print-block w-full border border-neutral-200 object-cover"
                      />
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </Section>
      )}

      <footer className="mt-8 border-t border-neutral-300 pt-2 text-[10.5px] text-neutral-500">
        모아킷 · 모아랩 업무 워크스페이스 — {app.title_ko}
      </footer>
    </main>
  );
}

function Section({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 border-b border-black pb-1 text-[15px] font-black">
        {title}
        {sub && <span className="ml-2 text-[11.5px] font-normal text-neutral-500">{sub}</span>}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-neutral-500">{label}</dt>
      <dd className="min-w-0 font-semibold">{value}</dd>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-[12px] text-neutral-500">{children}</p>;
}
