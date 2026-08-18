'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { Icon } from '@/components/Icon';
import { ErrorBanner } from '@/components/ui';
import { PlanSheet } from '@/components/PlanSheet';
import type { AppRow, LessonPlan, LessonPlanItem, Topic } from '@/lib/types';

/**
 * 강의계획서 전체 인쇄 — 목표를 써서 저장한 프로그램 전부를
 * **한 프로그램 = A4 한 장**으로 이어서 뽑는다 (학교·기관에 묶음으로 제출할 때).
 *
 * - 순서는 목록 트리와 같다: 주제 순서 → 프로그램 이름순.
 * - 장마다 fill — 내용이 적어도 전개 줄이 늘어나 그 장의 아래까지 채운다.
 * - 아직 안 쓴 프로그램은 문서에 안 싣고, 화면에서만 몇 개가 빠졌는지 알려준다.
 *   빈 양식이 섞여 나가면 덜 만든 문서처럼 보인다.
 */
export default function LecturesPrintPage() {
  const router = useRouter();
  // 이 화면은 (app) 레이아웃 밖이라 로그인 가드를 직접 붙인다
  const { session, loading: sessionLoading } = useSession();

  useEffect(() => {
    if (!sessionLoading && !session) router.replace('/login');
  }, [session, sessionLoading, router]);

  const [docs, setDocs] = useState<{ app: AppRow; plan: LessonPlan; items: LessonPlanItem[] }[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [appsRes, planRes, itemRes, topicRes] = await Promise.all([
        supabase.from('apps').select('*').eq('archived', false),
        supabase.from('lesson_plans').select('*'),
        supabase.from('lesson_plan_items').select('*').order('sort_order'),
        supabase.from('topics').select('*').order('sort_order').order('name'),
      ]);
      if (appsRes.error) throw appsRes.error;

      const apps = (appsRes.data ?? []) as AppRow[];
      const planByApp = new Map(((planRes.data ?? []) as LessonPlan[]).map((p) => [p.app_id, p]));
      const itemsByApp = new Map<string, LessonPlanItem[]>();
      for (const it of (itemRes.data ?? []) as LessonPlanItem[]) {
        const list = itemsByApp.get(it.app_id) ?? [];
        list.push(it);
        itemsByApp.set(it.app_id, list);
      }
      const topicOrder = new Map(((topicRes.data ?? []) as Topic[]).map((t, i) => [t.id, i]));

      const withPlan: { app: AppRow; plan: LessonPlan; items: LessonPlanItem[] }[] = [];
      const without: string[] = [];
      for (const app of apps) {
        const plan = planByApp.get(app.id);
        if (plan?.goal?.trim()) {
          withPlan.push({ app, plan, items: itemsByApp.get(app.id) ?? [] });
        } else {
          without.push(app.title_ko);
        }
      }
      // 목록 트리와 같은 순서 — 주제 순서 → 이름순. 주제 없음은 맨 뒤
      withPlan.sort((a, b) => {
        const ai = a.app.topic_id != null ? (topicOrder.get(a.app.topic_id) ?? 9998) : 9999;
        const bi = b.app.topic_id != null ? (topicOrder.get(b.app.topic_id) ?? 9998) : 9999;
        return ai - bi || a.app.title_ko.localeCompare(b.app.title_ko, 'ko');
      });
      setDocs(withPlan);
      setSkipped(without.sort((a, b) => a.localeCompare(b, 'ko')));
    } catch (e) {
      setError(friendlyError(e, '불러오지 못했어요.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (sessionLoading || !session || loading) {
    return <p className="p-10 text-center text-[14px] text-neutral-500">인쇄할 내용을 준비하고 있어요…</p>;
  }
  if (error) {
    return (
      <div className="p-6">
        <ErrorBanner message={error} />
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
          강의계획서를 쓴 프로그램 <b>{docs.length}개</b>가 한 장씩 이어서 인쇄돼요.
          {skipped.length > 0 && (
            <>
              <br />
              아직 안 쓴 {skipped.length}개는 안 들어가요: {skipped.join(', ')}
            </>
          )}
        </p>
      </div>

      {docs.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-neutral-500">
          아직 강의계획서를 쓴 프로그램이 없어요. 프로그램 화면의 <b>강의계획서</b> 에서 먼저 채워주세요.
        </p>
      ) : (
        docs.map((d, i) => (
          // 한 프로그램 = A4 한 장. fill 이라 내용이 적어도 그 장의 아래까지 채워진다
          <section
            key={d.app.id}
            className={`flex min-h-[269mm] flex-col ${i > 0 ? 'print-page-break mt-10 print:mt-0' : ''}`}
          >
            <PlanSheet plan={d.plan} items={d.items} title={d.app.title_ko} fill />
          </section>
        ))
      )}
    </main>
  );
}
