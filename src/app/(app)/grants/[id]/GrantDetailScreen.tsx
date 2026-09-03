'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { Icon } from '@/components/Icon';
import { CardSkeleton, ErrorBanner, useToast } from '@/components/ui';
import { GRANT_STATUS, isGrantConceptReady } from '@/lib/grants';
import { useMembers } from '@/lib/useMembers';
import { useSession } from '@/lib/session';
import { friendlyError } from '@/lib/supabase';
import { readCache, writeCache } from '@/lib/pageCache';
import { logActivity } from '@/lib/log';
import type { GrantCollaborator, GrantFile, GrantFileKind, GrantProject, GrantStatus } from '@/lib/types';

const STATUS_ORDER: GrantStatus[] = ['discovered', 'concept_shared', 'writing', 'submitted', 'selected', 'not_selected', 'paused'];
const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * 지난번에 본 내용을 먼저 그려 빈 화면을 없앤다 (src/lib/pageCache.ts).
 * **첨부파일은 일부러 안 담는다** — 내려받기 주소가 1시간이면 만료되므로
 * 낡은 주소를 눌러 실패하느니 파일 칸만 잠깐 비워두는 편이 낫다.
 */
const cacheKey = (id: string) => `grant.${id}.v1`;

interface CachedGrant {
  project: GrantProject;
  collaboratorIds: string[];
}

export default function GrantDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const { session, signOut } = useSession();
  const { members, nameOf } = useMembers();
  const toast = useToast();
  const [project, setProject] = useState<GrantProject | null>(null);
  const [collaboratorIds, setCollaboratorIds] = useState<string[]>([]);
  const [files, setFiles] = useState<GrantFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<GrantFileKind | null>(null);
  const [error, setError] = useState('');
  /** 서버가 신원을 확인 못 하는 상태 — '다시' 를 눌러봐야 같은 실패가 반복된다 */
  const [needRelogin, setNeedRelogin] = useState(false);
  const announcementRef = useRef<HTMLInputElement>(null);
  const finalRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!session) return;
    // ⚠️ 목록 화면과 같은 이유로 **조용히 멈추면 안 된다** — `loading` 이 true 로 남아
    // 스켈레톤이 영원히 돌고 원장은 "안 뜬다" 만 본다.
    if (!session.token) {
      setLoading(false);
      setNeedRelogin(true);
      setError('로그인 정보가 오래돼서 내용을 못 불러왔어요. 다시 로그인하면 바로 보입니다.');
      return;
    }
    setError('');
    setNeedRelogin(false);
    try {
      const response = await fetch(`/api/grants/${id}`, { headers: { 'x-session-token': session.token } });
      const result = await response.json() as { project?: GrantProject; collaborators?: GrantCollaborator[]; files?: GrantFile[]; error?: string };
      if (response.status === 401) {
        setNeedRelogin(true);
        setError('로그인 정보가 만료됐어요. 다시 로그인하면 바로 보입니다.');
        return;
      }
      if (!response.ok) throw new Error(result.error || '불러오기 실패');
      const found = result.project ?? null;
      if (!found) throw new Error('사업을 찾을 수 없습니다.');
      const nextCollaboratorIds = (result.collaborators ?? []).map((row) => row.member_id);
      setProject(found);
      setCollaboratorIds(nextCollaboratorIds);
      setFiles(result.files ?? []);
      if (session?.id) writeCache<CachedGrant>(cacheKey(id), session.id, { project: found, collaboratorIds: nextCollaboratorIds });
    } catch (caught) {
      setError(friendlyError(caught, '사업 내용을 불러오지 못했어요.'));
    } finally {
      setLoading(false);
    }
  }, [id, session]);

  // 첫 진입에만 지난번 내용을 얹는다. 아래 load 보다 **먼저** 선언해야 순서가 보장된다.
  // 저장한 뒤 다시 불러올 때는 이 효과가 다시 돌지 않는다 —
  // 방금 저장한 값 위로 옛 값이 덮이면 안 된다.
  useEffect(() => {
    if (!session?.id) return;
    const cached = readCache<CachedGrant>(cacheKey(id), session.id);
    if (!cached?.project) return;
    setProject(cached.project);
    setCollaboratorIds(cached.collaboratorIds ?? []);
    setLoading(false);
  }, [id, session?.id]);

  useEffect(() => { void load(); }, [load]);

  const set = <K extends keyof GrantProject>(key: K, value: GrantProject[K]) => {
    setProject((current) => current ? { ...current, [key]: value } : current);
  };

  const save = async () => {
    if (!project || !session || saving) return;
    if (!project.title.trim()) { setError('공고명을 적어주세요.'); return; }
    const submittingFirstConcept = !project.lead_id && isGrantConceptReady(project.item_name, project.concept_summary);
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/grants/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-session-token': session.token ?? '' },
        body: JSON.stringify({
          title: project.title,
          agency: project.agency,
          announcementUrl: project.announcement_url,
          deadline: project.deadline,
          itemName: project.item_name,
          targetAudience: project.target_audience,
          conceptSummary: project.concept_summary,
          differentiation: project.differentiation,
          supportNeeded: project.support_needed,
          status: project.status,
          duplicateChecked: project.duplicate_checked,
          submittedAt: project.submitted_at,
          resultNote: project.result_note,
          collaboratorIds,
        }),
      });
      const result = await response.json() as { project?: GrantProject; leadClaimed?: boolean; error?: string };
      if (!response.ok) throw new Error(result.error || '저장 실패');
      logActivity(session.id, `${result.leadClaimed ? '정부지원사업 기획안 제출' : '정부지원사업 저장'} — ${project.title}`, `grant:${id}`);
      toast.show(result.leadClaimed || submittingFirstConcept ? '기획안이 제출되어 담당자로 지정됐어요.' : '저장했어요.');
      await load();
    } catch (caught) {
      setError(friendlyError(caught, '사업 내용을 저장하지 못했어요.'));
    } finally {
      setSaving(false);
    }
  };

  const upload = async (kind: GrantFileKind, selected: FileList | null) => {
    if (!project || !session || !selected?.length || uploading) return;
    const picked = Array.from(selected);
    const tooLarge = picked.find((file) => file.size > MAX_FILE_BYTES);
    if (tooLarge) { setError(`${tooLarge.name} 파일이 25MB보다 커요.`); return; }
    setUploading(kind);
    setError('');
    try {
      const uploaded: GrantFile[] = [];
      for (const file of picked) {
        const form = new FormData();
        form.append('kind', kind);
        form.append('file', file);
        const response = await fetch(`/api/grants/${id}/files`, {
          method: 'POST',
          headers: { 'x-session-token': session.token ?? '' },
          body: form,
        });
        const result = await response.json() as { file?: GrantFile; error?: string };
        if (!response.ok || !result.file) throw new Error(result.error || '업로드 실패');
        uploaded.push(result.file);
      }
      setFiles((current) => [...uploaded.reverse(), ...current]);
      logActivity(session.id, `정부지원사업 ${kind === 'announcement' ? '공고' : '최종본'} 첨부 — ${project.title}`, `grant:${id}`);
      toast.show(`${picked.length}개 파일을 올렸어요.`);
    } catch (caught) {
      setError(friendlyError(caught, '파일을 올리지 못했어요.'));
    } finally {
      setUploading(null);
      if (announcementRef.current) announcementRef.current.value = '';
      if (finalRef.current) finalRef.current.value = '';
    }
  };

  if (loading) return <><PageHeader title="정부지원사업" back="/grants" /><main className="px-4 py-4"><CardSkeleton rows={6} /></main></>;
  if (!project) return <><PageHeader title="정부지원사업" back="/grants" /><main className="px-4 py-4"><ErrorBanner message={error || '사업을 찾을 수 없어요.'} actionLabel={needRelogin ? '다시 로그인' : '다시'} onRetry={needRelogin ? signOut : () => void load()} /></main></>;

  const announcementFiles = files.filter((file) => file.kind === 'announcement');
  const finalFiles = files.filter((file) => file.kind === 'final_plan');
  const conceptReady = isGrantConceptReady(project.item_name, project.concept_summary);
  const toggleCollaborator = (memberId: string) => setCollaboratorIds((current) => current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId]);

  return (
    <>
      <PageHeader title={project.title} subtitle={GRANT_STATUS[project.status].label} back="/grants" />
      <main className="space-y-3 px-3 pb-28 pt-3 sm:px-4">
        {error && (
          <ErrorBanner
            message={error}
            actionLabel={needRelogin ? '다시 로그인' : '다시'}
            onRetry={needRelogin ? signOut : () => void load()}
          />
        )}

        <section className="card overflow-hidden">
          <div className="-mx-px overflow-x-auto p-3">
            <div className="flex min-w-max gap-1.5">
              {STATUS_ORDER.map((status) => {
                const meta = GRANT_STATUS[status];
                const disabled = !project.lead_id && status !== 'discovered';
                return <button key={status} type="button" disabled={disabled} onClick={() => set('status', status)} className={`chip min-h-9 px-3 disabled:cursor-not-allowed disabled:opacity-40 ${project.status === status ? meta.chip + ' ring-2 ring-current/15' : 'bg-neutral-50 text-neutral-400'}`}>{meta.label}</button>;
              })}
            </div>
          </div>
        </section>

        <div className="grid items-start gap-3 lg:grid-cols-[1.15fr_.85fr]">
          <div className="space-y-3">
            <Section title="1. 공고 정보">
              <Field label="공고명 *"><input value={project.title} onChange={(e) => set('title', e.target.value)} className="field" /></Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="공고 기관"><input value={project.agency ?? ''} onChange={(e) => set('agency', e.target.value)} className="field" /></Field>
                <Field label="접수 마감"><input type="date" value={project.deadline ?? ''} onChange={(e) => set('deadline', e.target.value)} className="field" /></Field>
              </div>
              <Field label="공고 링크">
                <div className="flex gap-2">
                  <input type="url" value={project.announcement_url ?? ''} onChange={(e) => set('announcement_url', e.target.value)} className="field min-w-0 flex-1" placeholder="https://" />
                  {project.announcement_url && <a href={project.announcement_url} target="_blank" rel="noopener noreferrer" className="btn-ghost shrink-0 px-3" aria-label="공고 링크 열기"><Icon name="external" size={15} /></a>}
                </div>
              </Field>
              <FileBox kind="announcement" files={announcementFiles} inputRef={announcementRef} busy={uploading === 'announcement'} onPick={(list) => void upload('announcement', list)} />
            </Section>

            <Section title="2. 기획안">
              {!project.lead_id && (
                <div className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-3 text-[12.5px] font-semibold leading-relaxed text-brand-800">
                  지원 아이템과 기획 핵심 내용을 먼저 제출한 사람이 담당자가 됩니다.
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="지원 아이템"><input value={project.item_name ?? ''} onChange={(e) => set('item_name', e.target.value)} className="field" placeholder="어떤 아이템으로 도전하나요?" /></Field>
                <Field label="대상·수혜자"><input value={project.target_audience ?? ''} onChange={(e) => set('target_audience', e.target.value)} className="field" placeholder="누구를 위한 사업인가요?" /></Field>
              </div>
              <Field label="기획 핵심 내용"><textarea value={project.concept_summary ?? ''} onChange={(e) => set('concept_summary', e.target.value)} rows={6} className="field resize-y" placeholder="문제, 해결방법, 운영내용, 기대효과를 적어주세요." /></Field>
              <Field label="기존 사업·아이템과 다른 점"><textarea value={project.differentiation ?? ''} onChange={(e) => set('differentiation', e.target.value)} rows={3} className="field resize-y" /></Field>
              <Field label="필요한 협조"><textarea value={project.support_needed ?? ''} onChange={(e) => set('support_needed', e.target.value)} rows={3} className="field resize-y" placeholder="예: 앱 개발, 기술 검토, 예산 작성, 자료 조사" /></Field>
              <Check checked={project.duplicate_checked} onChange={(checked) => set('duplicate_checked', checked)} label="중복 아이템 지원 여부 확인" />
            </Section>

            <Section title="3. 최종 제출">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="실제 제출일"><input type="date" value={project.submitted_at ?? ''} onChange={(e) => set('submitted_at', e.target.value)} className="field" /></Field>
                <div className="rounded-xl bg-neutral-50 px-3 py-2.5 text-[12px] font-semibold leading-relaxed text-neutral-500">최종 파일을 올려도 제출 상태는 자동 변경되지 않아요. 실제 제출 후 위에서 ‘제출 완료’를 선택하세요.</div>
              </div>
              <FileBox kind="final_plan" files={finalFiles} inputRef={finalRef} busy={uploading === 'final_plan'} onPick={(list) => void upload('final_plan', list)} />
              <Field label="선정·미선정 결과와 다음 개선점"><textarea value={project.result_note ?? ''} onChange={(e) => set('result_note', e.target.value)} rows={4} className="field resize-y" placeholder="심사 결과, 떨어진 이유 추정, 다음에 보완할 내용을 남겨주세요." /></Field>
            </Section>
          </div>

          <Section title="담당자·협업자" sticky>
            <div>
              <p className="label">기획 담당자</p>
              <div className={`rounded-xl border px-3 py-3 text-[13px] font-black ${project.lead_id ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-dashed border-neutral-300 bg-neutral-50 text-neutral-500'}`}>
                {project.lead_id ? nameOf(project.lead_id) : '아직 정해지지 않았어요'}
              </div>
              {!project.lead_id && <p className="mt-2 break-keep text-[11.5px] leading-relaxed text-neutral-500">기획안을 먼저 제출하면 자동으로 담당자가 되며, 다른 사람이 임의로 바꿀 수 없습니다.</p>}
            </div>
            {project.lead_id ? (
              <div>
                <p className="label">함께 작성·개발하는 사람</p>
                <div className="flex flex-wrap gap-2">
                  {members.filter((member) => member.id !== project.lead_id).map((member) => {
                    const selected = collaboratorIds.includes(member.id);
                    return <button key={member.id} type="button" onClick={() => toggleCollaborator(member.id)} className={`chip min-h-10 px-3 ${selected ? 'pick-on' : 'bg-neutral-100 text-neutral-600'}`}><span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${selected ? 'bg-current' : 'bg-neutral-300'}`} />{member.name}</button>;
                  })}
                </div>
              </div>
            ) : (
              <div className="rounded-xl bg-neutral-50 px-3 py-3 text-[12px] leading-relaxed text-neutral-500">담당자가 정해진 뒤 협업자를 추가할 수 있어요.</div>
            )}
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-[12.5px] leading-relaxed text-neutral-600">
              <b className="text-neutral-800">현재 구성</b>
              <p className="mt-1">담당자 {project.lead_id ? nameOf(project.lead_id) : '미정'} · 협업 {collaboratorIds.filter((id) => id !== project.lead_id).map(nameOf).join(', ') || '없음'}</p>
            </div>
          </Section>
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-[56px] z-30 border-t border-neutral-200 bg-surface/95 px-3 py-2 backdrop-blur safe-bottom lg:bottom-0 lg:left-[232px]">
        <div className="mx-auto max-w-[1000px]"><button type="button" onClick={() => void save()} disabled={saving || Boolean(uploading)} className="btn-primary w-full"><Icon name="check" size={16} />{saving ? '저장 중…' : !project.lead_id && conceptReady ? '기획안 제출하고 담당자 되기' : '사업 내용 저장'}</button></div>
      </div>
      {toast.node}
    </>
  );
}

function Section({ title, children, sticky = false }: { title: string; children: React.ReactNode; sticky?: boolean }) {
  return <section className={`card p-4 ${sticky ? 'lg:sticky lg:top-5' : ''}`}><h2 className="mb-4 border-b border-neutral-100 pb-3 text-[15px] font-black text-neutral-900">{title}</h2><div className="space-y-3.5">{children}</div></section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="label">{label}</span>{children}</label>;
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return <label className={`flex min-h-[50px] cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 ${checked ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-neutral-200 bg-surface text-neutral-600'}`}><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 accent-[#F26522]" /><span className="break-keep text-[12.5px] font-bold">{label}</span></label>;
}

function FileBox({ kind, files, inputRef, busy, onPick }: { kind: GrantFileKind; files: GrantFile[]; inputRef: React.RefObject<HTMLInputElement>; busy: boolean; onPick: (files: FileList | null) => void }) {
  const label = kind === 'announcement' ? '공고문·첨부자료' : '최종 제출 사업계획서';
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2"><p className="label mb-0">{label}</p><label className="cursor-pointer text-[12px] font-black text-brand"><input ref={inputRef} type="file" multiple className="hidden" accept=".pdf,.hwp,.hwpx,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,image/*" onChange={(e) => onPick(e.target.files)} />{busy ? '올리는 중…' : '+ 파일 첨부'}</label></div>
      {files.length === 0 ? <div className="rounded-xl border border-dashed border-neutral-300 px-3 py-5 text-center text-[12px] text-neutral-400">첨부된 파일 없음</div> : <div className="space-y-1.5">{files.map((file) => file.signed_url ? <a key={file.id} href={file.signed_url} target="_blank" rel="noopener noreferrer" className="flex min-h-[44px] items-center gap-2 rounded-xl border border-neutral-200 px-3 text-[12.5px] font-semibold text-neutral-700"><Icon name="clip" size={14} className="text-brand" /><span className="min-w-0 flex-1 truncate">{file.file_name}</span><Icon name="external" size={13} className="text-neutral-300" /></a> : <div key={file.id} className="flex min-h-[44px] items-center gap-2 rounded-xl border border-neutral-200 px-3 text-[12.5px] text-neutral-400"><Icon name="clip" size={14} /><span className="truncate">{file.file_name}</span></div>)}</div>}
    </div>
  );
}
