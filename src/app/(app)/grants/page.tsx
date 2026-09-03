'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { Icon } from '@/components/Icon';
import { CardSkeleton, EmptyState, ErrorBanner, Sheet, useToast } from '@/components/ui';
import { daysUntil, GRANT_STATUS, grantProgress } from '@/lib/grants';
import { useMembers } from '@/lib/useMembers';
import { useSession } from '@/lib/session';
import { friendlyError } from '@/lib/supabase';
import type { GrantCollaborator, GrantProject, GrantStatus } from '@/lib/types';

type Filter = 'active' | 'mine' | 'submitted' | 'archive' | 'all';
const CACHE_KEY = 'moalab.grants.cache.v1';
const CACHE_TTL_MS = 5 * 60 * 1000;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'active', label: '진행 중' },
  { value: 'mine', label: '내 사업' },
  { value: 'submitted', label: '제출 완료' },
  { value: 'archive', label: '결과·보관' },
  { value: 'all', label: '전체' },
];

export default function GrantsPage() {
  const router = useRouter();
  const { session } = useSession();
  const { members, nameOf } = useMembers();
  const toast = useToast();
  const [projects, setProjects] = useState<GrantProject[] | null>(null);
  const [collaborators, setCollaborators] = useState<GrantCollaborator[]>([]);
  const [filter, setFilter] = useState<Filter>('active');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ title: '', agency: '', announcementUrl: '', deadline: '' });

  const load = useCallback(async () => {
    if (!session?.token) return;
    setError('');
    let hasCachedList = false;
    try {
      const raw = window.sessionStorage.getItem(CACHE_KEY);
      const cached = raw ? JSON.parse(raw) as {
        memberId?: string;
        cachedAt?: number;
        projects?: GrantProject[];
        collaborators?: GrantCollaborator[];
      } : null;
      if (cached?.memberId === session.id
        && typeof cached.cachedAt === 'number'
        && Date.now() - cached.cachedAt < CACHE_TTL_MS
        && Array.isArray(cached.projects)
        && Array.isArray(cached.collaborators)) {
        setProjects(cached.projects);
        setCollaborators(cached.collaborators);
        hasCachedList = true;
      }
    } catch {
      // 캐시가 깨져도 서버의 최신 목록을 읽으면 된다.
    }
    try {
      const response = await fetch('/api/grants', { headers: { 'x-session-token': session.token } });
      const result = await response.json() as { projects?: GrantProject[]; collaborators?: GrantCollaborator[]; error?: string };
      if (!response.ok) throw new Error(result.error || '불러오기 실패');
      const nextProjects = result.projects ?? [];
      const nextCollaborators = result.collaborators ?? [];
      setProjects(nextProjects);
      setCollaborators(nextCollaborators);
      try {
        window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({
          memberId: session.id,
          cachedAt: Date.now(),
          projects: nextProjects,
          collaborators: nextCollaborators,
        }));
      } catch {
        // 저장 공간이 막혀도 화면 사용에는 영향이 없다.
      }
    } catch (caught) {
      if (!hasCachedList) setProjects([]);
      setError(friendlyError(caught, '정부지원사업을 불러오지 못했어요.'));
    }
  }, [session?.id, session?.token]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!session || !form.title.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/grants', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-session-token': session.token ?? '' },
        body: JSON.stringify(form),
      });
      const result = await response.json() as { project?: GrantProject; error?: string };
      if (!response.ok || !result.project) throw new Error(result.error || '등록 실패');
      toast.show('정부지원사업을 등록했어요.');
      router.push(`/grants/${result.project.id}`);
    } catch (caught) {
      setError(friendlyError(caught, '사업을 등록하지 못했어요.'));
      setSaving(false);
    }
  };

  const collaboratorIds = useMemo(() => {
    const byGrant = new Map<string, string[]>();
    for (const row of collaborators) byGrant.set(row.grant_id, [...(byGrant.get(row.grant_id) ?? []), row.member_id]);
    return byGrant;
  }, [collaborators]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ko');
    return (projects ?? []).filter((project) => {
      const people = [project.lead_id, ...(collaboratorIds.get(project.id) ?? [])];
      const statusOk = filter === 'all'
        || (filter === 'active' && ['discovered', 'concept_shared', 'writing'].includes(project.status))
        || (filter === 'mine' && Boolean(session?.id && people.includes(session.id)))
        || (filter === 'submitted' && project.status === 'submitted')
        || (filter === 'archive' && ['selected', 'not_selected', 'paused'].includes(project.status));
      const queryOk = !needle || [project.title, project.agency, project.item_name, ...people.map(nameOf)]
        .filter(Boolean).join(' ').toLocaleLowerCase('ko').includes(needle);
      return statusOk && queryOk;
    });
  }, [projects, filter, query, collaboratorIds, session?.id, nameOf]);

  return (
    <>
      <PageHeader
        title="정부지원사업"
        subtitle={projects ? `등록 ${projects.length}건` : undefined}
        right={
          <button type="button" onClick={() => setCreating(true)} aria-label="새 공고 등록" className="tap -mr-2 w-10 text-brand">
            <Icon name="plus" size={19} />
          </button>
        }
      />

      <main className="space-y-3 px-3 pb-8 pt-3 sm:px-4">
        <section className="card overflow-hidden">
          <div className="grid grid-cols-5 divide-x divide-neutral-100 text-center">
            {['공고', '기획 공유', '협업 작성', '최종 제출', '결과 축적'].map((label, index) => (
              <div key={label} className="px-1 py-3">
                <span className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-brand-50 text-[11px] font-black text-brand">{index + 1}</span>
                <span className="mt-1 block break-keep text-[10.5px] font-bold text-neutral-600">{label}</span>
              </div>
            ))}
          </div>
        </section>

        {error && <ErrorBanner message={error} onRetry={() => void load()} />}

        <div className="flex gap-2">
          <label className="relative min-w-0 flex-1">
            <Icon name="search" size={15} className="absolute left-3 top-3.5 text-neutral-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="공고·아이템·담당자 검색" className="field pl-9" />
          </label>
          <button type="button" onClick={() => setCreating(true)} className="btn-primary shrink-0 px-3 sm:px-4">
            <Icon name="plus" size={15} /><span className="hidden sm:inline">공고 등록</span>
          </button>
        </div>

        <div className="-mx-3 overflow-x-auto px-3 sm:-mx-4 sm:px-4">
          <div className="flex w-max gap-1.5">
            {FILTERS.map((item) => (
              <button key={item.value} type="button" onClick={() => setFilter(item.value)} className={`chip min-h-9 px-3 ${filter === item.value ? 'pick-on' : 'bg-surface text-neutral-500'}`}>
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {projects === null ? <CardSkeleton rows={4} /> : visible.length === 0 ? (
          <EmptyState
            icon="briefcase"
            title={query ? '검색 결과가 없어요' : '이 단계의 사업이 없어요'}
            desc={!query && projects.length === 0 ? '찾은 공고부터 가볍게 등록해두세요.' : undefined}
            action={!query && projects.length === 0 ? <button onClick={() => setCreating(true)} className="btn-primary">첫 공고 등록</button> : undefined}
          />
        ) : (
          <div className="grid gap-2.5 lg:grid-cols-2">
            {visible.map((project) => {
              const meta = GRANT_STATUS[project.status];
              const days = daysUntil(project.deadline);
              const people = [project.lead_id, ...(collaboratorIds.get(project.id) ?? [])].filter((id, i, all): id is string => Boolean(id) && all.indexOf(id) === i);
              return (
                <Link key={project.id} href={`/grants/${project.id}`} className="card block p-4 transition hover:border-brand-200">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`chip ${meta.chip}`}>{meta.label}</span>
                        {days !== null && project.status !== 'submitted' && !['selected', 'not_selected', 'paused'].includes(project.status) && (
                          <span className={`chip ${days < 0 ? 'bg-red-100 text-red-700' : days <= 7 ? 'bg-amber-100 text-amber-800' : 'bg-neutral-100 text-neutral-500'}`}>
                            {days < 0 ? `마감 ${Math.abs(days)}일 지남` : days === 0 ? '오늘 마감' : `D-${days}`}
                          </span>
                        )}
                      </div>
                      <h2 className="mt-2 break-keep text-[16px] font-black leading-snug text-neutral-900">{project.title}</h2>
                      <p className="mt-1 truncate text-[12.5px] text-neutral-500">{[project.agency, project.item_name].filter(Boolean).join(' · ') || '기관 미입력'}</p>
                    </div>
                    <Icon name="chevronDown" size={15} className="mt-1 -rotate-90 text-neutral-300" />
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${grantProgress(project.status)}%` }} />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 text-[11.5px] text-neutral-500">
                    <span className="truncate">담당자 {project.lead_id ? nameOf(project.lead_id) : '기획 대기'}</span>
                    <span className="truncate text-right">협업 {people.length > 1 ? people.slice(1).map(nameOf).join(' · ') : '없음'}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>

      <Sheet
        open={creating}
        onClose={() => !saving && setCreating(false)}
        title="새 정부지원사업 공고"
        footer={<button type="button" onClick={() => void create()} disabled={saving || !form.title.trim()} className="btn-primary w-full">{saving ? '등록 중…' : '공고 등록'}</button>}
      >
        <div className="space-y-3.5">
          <Field label="공고명 *"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="field" placeholder="예: 2026 모두의 창업" /></Field>
          <Field label="공고 기관"><input value={form.agency} onChange={(e) => setForm({ ...form, agency: e.target.value })} className="field" placeholder="예: 한국과학창의재단" /></Field>
          <Field label="공고 링크"><input type="url" value={form.announcementUrl} onChange={(e) => setForm({ ...form, announcementUrl: e.target.value })} className="field" placeholder="https://" /></Field>
          <Field label="접수 마감"><input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} className="field" /></Field>
          <p className="rounded-xl bg-brand-50 px-3 py-2.5 text-[12px] font-semibold leading-relaxed text-brand-800">공고만 먼저 공유됩니다. 기획안을 가장 먼저 제출한 사람이 담당자가 됩니다.</p>
        </div>
      </Sheet>
      {toast.node}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="label">{label}</span>{children}</label>;
}
