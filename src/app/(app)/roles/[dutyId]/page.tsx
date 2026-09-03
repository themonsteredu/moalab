'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { planFor } from '@/lib/dutyTable';
import { PageHeader } from '@/components/PageHeader';
import { Icon } from '@/components/Icon';
import { DutyFiles } from '@/components/DutyFiles';
import { DutyForm } from '@/components/DutyForm';
import { DutyTable } from '@/components/DutyTable';
import { CardSkeleton, ErrorBanner } from '@/components/ui';
import type { Duty, DutyGroup, Department } from '@/lib/types';

/**
 * **역할 한 장** — 이 일을 하는 자리.
 *
 * 원장: *"각각 해야 할 일에 맞는 문서 양식이 구현이 되어 있어야 다들 일하기 편할 것
 * 같음. 예를 들어 학교기관관리 → 리스트 업하고 관리하는 페이지."*
 *
 * 그런데 역할 전부에 표를 붙이면 안 된다 — 원장이 이어서 물은 것이 그것이다
 * (*"그냥 업로드만 해야 할 것들과 양식이 있으면 좋을 것들을 분류해"*). 가르는 질문은
 * 하나다: **이 일을 하면 파일이 하나 나오나, 줄이 하나 늘어나나?**
 *
 * · 줄이 는다 → **표** (학교 명단·재고·지원자)
 * · 파일이 난다 → **자료 올리기** (교육안·활동지·소개자료)
 * · **앱에 이미 자리가 있다** → **바로가기.** 표를 또 만들면 데이터가 두 벌이 되고
 *   둘 다 못 쓴다 — 이 앱이 '따로국밥을 없앤 곳' 인데 부서별로 쪼개면 되돌아간다
 *
 * 갈래는 `planFor()` 가 **짐작만** 한다. 진짜 상태는 데이터다 —
 * 열이 있으면 표가 보이고, 없으면 양식 고르는 자리가 보인다.
 */
export default function DutyPage() {
  const { dutyId } = useParams<{ dutyId: string }>();
  const { isAdmin } = useSession();

  const [duty, setDuty] = useState<Duty | null>(null);
  const [group, setGroup] = useState<DutyGroup | null>(null);
  const [dept, setDept] = useState<Department | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const { data: d, error: e } = await supabase.from('duties').select('*').eq('id', dutyId).maybeSingle();
      if (e) throw e;
      if (!d) {
        setError('없는 역할이에요. 지워졌을 수 있어요.');
        setLoading(false);
        return;
      }
      setDuty(d as Duty);
      const { data: g } = await supabase.from('duty_groups').select('*').eq('id', d.group_id).maybeSingle();
      setGroup((g ?? null) as DutyGroup | null);
      if (g) {
        const { data: dp } = await supabase.from('departments').select('*').eq('id', g.dept_id).maybeSingle();
        setDept((dp ?? null) as Department | null);
      }
    } catch (e) {
      setError(friendlyError(e, '역할을 불러오지 못했어요.'));
    } finally {
      setLoading(false);
    }
  }, [dutyId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div>
        <PageHeader title="역할" back="/roles" />
        <div className="mx-auto max-w-3xl px-4 py-4">
          <CardSkeleton rows={3} />
        </div>
      </div>
    );
  }

  if (!duty) {
    return (
      <div>
        <PageHeader title="역할" back="/roles" />
        <div className="mx-auto max-w-3xl px-4 py-4">
          <ErrorBanner message={error || '없는 역할이에요.'} />
        </div>
      </div>
    );
  }

  const deptName = dept?.name ?? '';
  const groupName = group?.name ?? '';
  const path = [deptName, groupName].filter(Boolean).join(' › ');
  const plan = planFor(duty.name, groupName);
  /** 앱에 자리가 있는 일인데 바로가기를 아직 안 걸어둔 경우, 갈 곳을 미리 알려준다 */
  const suggestHref = plan.mode === 'app' ? plan.href ?? null : null;

  return (
    <div>
      <PageHeader
        title={duty.name}
        subtitle={path || undefined}
        back="/roles"
        right={
          <button
            onClick={() => setEditOpen(true)}
            aria-label="역할 고치기"
            className="tap -mr-2 w-10 text-neutral-500"
          >
            <Icon name="wrench" size={16} />
          </button>
        }
      />

      <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
        {error && <ErrorBanner message={error} onRetry={() => void load()} />}

        {duty.note && <p className="text-[13px] leading-relaxed text-neutral-500">{duty.note}</p>}

        {/* 이 일로 바로 가기 — 걸어둔 것이 먼저, 없으면 갈 만한 곳을 권한다.
            **자료를 옮기지 않는다. 길만 낸다.** */}
        {(duty.link || suggestHref) && (
          <Link
            href={duty.link || suggestHref!}
            className="card flex items-center gap-3 p-3.5 transition hover:border-brand-300"
          >
            <span className="shrink-0 rounded-xl bg-raised p-2 text-brand">
              <Icon name="external" size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-bold">
                {duty.link ? '이 일로 바로 가기' : '이 일은 앱 안에 자리가 있어요'}
              </span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-neutral-500">
                {duty.link ? duty.link : plan.why}
              </span>
            </span>
            <Icon name="chevronDown" size={14} className="shrink-0 -rotate-90 text-neutral-300" />
          </Link>
        )}

        {/* **주인공이 갈래마다 다르다.** 줄이 쌓이는 일이면 목록이 위, 결과물이 파일인
            일이면 자료가 위다. 순서만 바꾼다 — 둘 다 늘 있고, 접힘도 각자 기억한다 */}
        <div className="flex flex-col">
          <div className={plan.mode === 'table' ? 'order-1' : 'order-2'}>
            <DutyTable
              dutyId={duty.id}
              dutyName={duty.name}
              groupName={groupName}
              defaultOpen={plan.mode === 'table'}
            />
          </div>
          <div className={plan.mode === 'table' ? 'order-2' : 'order-1'}>
            <DutyFiles
              dutyId={duty.id}
              dutyName={duty.name}
              deptName={deptName || path}
              groupName={groupName || path}
            />
          </div>
        </div>
      </div>

      <DutyForm
        open={editOpen}
        onClose={() => setEditOpen(false)}
        groupId={duty.group_id}
        groupLabel={path}
        deptName={deptName}
        groupName={groupName}
        duty={duty}
        canDelete={isAdmin}
        onSaved={() => void load()}
      />
    </div>
  );
}
