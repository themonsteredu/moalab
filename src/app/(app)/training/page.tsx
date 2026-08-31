'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { logActivity } from '@/lib/log';
import { PageHeader } from '@/components/PageHeader';
import { Avatar } from '@/components/Brand';
import { Icon } from '@/components/Icon';
import { CardSkeleton, ConfirmDialog, EmptyState, ErrorBanner, ProgressBar, Sheet, useToast } from '@/components/ui';
import {
  TRAINING_STATES,
  type TrainingCourse,
  type TrainingRecord,
  type TrainingState,
} from '@/lib/types';

type View = 'me' | 'team';

/**
 * 강사양성 — 과정 목록 × 강사별 이수 상태.
 * 강사는 '내 과정'만 보고 자기 상태를 바꾸고,
 * 원장은 '전체'에서 누가 어디까지 왔는지 한 판으로 본다.
 */
export default function TrainingPage() {
  const { session, isAdmin } = useSession();
  const { members } = useMembers();
  const toast = useToast();

  const [courses, setCourses] = useState<TrainingCourse[] | null>(null);
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>(isAdmin ? 'team' : 'me');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TrainingCourse | null>(null);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [cRes, rRes] = await Promise.all([
        supabase.from('training_courses').select('*').order('sort_order').order('created_at'),
        supabase.from('training_records').select('*'),
      ]);
      if (cRes.error) throw cRes.error;
      setCourses((cRes.data ?? []) as TrainingCourse[]);
      setRecords((rRes.data ?? []) as TrainingRecord[]);
    } catch (e) {
      setError(friendlyError(e, '강사양성 과정을 불러오지 못했어요.'));
      setCourses([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stateOf = useCallback(
    (courseId: string, memberId: string): TrainingState =>
      records.find((r) => r.course_id === courseId && r.member_id === memberId)?.state ?? 'todo',
    [records],
  );

  const myDone = useMemo(() => {
    if (!session || !courses) return 0;
    return courses.filter((c) => stateOf(c.id, session.id) === 'done').length;
  }, [courses, session, stateOf]);

  const setState = async (courseId: string, memberId: string, state: TrainingState) => {
    const before = records;
    // 눌러서 바로 반영 — 상태 하나짜리 토글이라 저장 버튼을 따로 두면 오히려 헷갈린다
    setRecords((v) => {
      const i = v.findIndex((r) => r.course_id === courseId && r.member_id === memberId);
      if (i < 0) {
        return [
          ...v,
          {
            id: `tmp-${courseId}-${memberId}`,
            course_id: courseId,
            member_id: memberId,
            state,
            memo: null,
            done_at: state === 'done' ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          },
        ];
      }
      const next = [...v];
      next[i] = { ...next[i], state, updated_at: new Date().toISOString() };
      return next;
    });

    const { error: e } = await supabase.from('training_records').upsert(
      {
        course_id: courseId,
        member_id: memberId,
        state,
        done_at: state === 'done' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'course_id,member_id' },
    );
    if (e) {
      setRecords(before);
      setError(friendlyError(e, '상태를 바꾸지 못했어요.'));
      return;
    }
    const label = TRAINING_STATES.find((s) => s.value === state)?.label ?? state;
    const courseTitle = courses?.find((c) => c.id === courseId)?.title ?? '';
    logActivity(session?.id, `강사양성 ${courseTitle} — ${label}`, `training:${courseId}`);
    await load();
  };

  const startNew = () => {
    setEditing(null);
    setTitle('');
    setSummary('');
    setFormErr('');
    setFormOpen(true);
  };

  const startEdit = (c: TrainingCourse) => {
    setEditing(c);
    setTitle(c.title);
    setSummary(c.summary ?? '');
    setFormErr('');
    setFormOpen(true);
  };

  const save = async () => {
    setFormErr('');
    if (!title.trim()) {
      setFormErr('과정 이름을 적어주세요.');
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        const { error: e } = await supabase
          .from('training_courses')
          .update({ title: title.trim(), summary: summary.trim() || null })
          .eq('id', editing.id);
        if (e) throw e;
      } else {
        const { error: e } = await supabase.from('training_courses').insert({
          title: title.trim(),
          summary: summary.trim() || null,
          sort_order: (courses?.length ?? 0) + 1,
        });
        if (e) throw e;
      }
      logActivity(session?.id, `강사양성 과정 ${editing ? '수정' : '추가'} — ${title.trim()}`, 'training');
      setFormOpen(false);
      toast.show('저장했어요.');
      await load();
    } catch (e) {
      setFormErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setDeleting(null);
    const { error: e } = await supabase.from('training_courses').delete().eq('id', id);
    if (e) {
      setError(friendlyError(e, '지우지 못했어요.'));
      return;
    }
    toast.show('지웠어요.');
    await load();
  };

  return (
    <div>
      <PageHeader
        title="강사양성"
        subtitle={
          courses === null
            ? '불러오는 중…'
            : `과정 ${courses.length}개 · 내 이수 ${myDone}/${courses.length}`
        }
        right={
          isAdmin ? (
            <button onClick={startNew} className="btn-primary px-3 text-[13.5px]">
              <Icon name="plus" size={15} />
              과정 추가
            </button>
          ) : undefined
        }
      />

      <div className="px-4 pb-8 pt-3 lg:px-0">
        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} onRetry={() => void load()} />
          </div>
        )}

        {isAdmin && (
          <div className="mb-3 flex gap-1.5">
            {(['team', 'me'] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`tap flex-1 rounded-xl border text-[13px] font-bold transition ${
                  view === v ? 'pick-on' : 'border-neutral-200 bg-surface text-neutral-500'
                }`}
              >
                {v === 'team' ? '전체 현황' : '내 과정'}
              </button>
            ))}
          </div>
        )}

        {courses === null ? (
          <CardSkeleton rows={3} />
        ) : courses.length === 0 ? (
          <EmptyState
            icon="cap"
            title="등록된 과정이 없어요"
            desc={isAdmin ? '오른쪽 위 과정 추가로 커리큘럼을 만들어보세요.' : '과정이 등록되면 여기 보여요.'}
          />
        ) : view === 'me' || !isAdmin ? (
          <ul className="space-y-2.5">
            {courses.map((c) => {
              const st = session ? stateOf(c.id, session.id) : 'todo';
              return (
                <li key={c.id} className="card p-3.5">
                  <p className="text-[14.5px] font-bold text-neutral-900">{c.title}</p>
                  {c.summary && (
                    <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-500">
                      {c.summary}
                    </p>
                  )}
                  <div className="mt-2.5 flex gap-1.5" role="group" aria-label={`${c.title} 내 상태`}>
                    {TRAINING_STATES.map((s) => {
                      const on = st === s.value;
                      return (
                        <button
                          key={s.value}
                          onClick={() => session && void setState(c.id, session.id, s.value)}
                          aria-pressed={on}
                          className={`tap flex-1 rounded-lg border text-[13.5px] font-bold transition ${
                            on ? s.on : 'border-neutral-200 bg-surface text-neutral-500'
                          }`}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="space-y-2.5">
            {/* 강사별 진도 요약 */}
            <section className="card p-3.5">
              <h2 className="mb-2.5 text-[14px] font-bold">강사별 이수율</h2>
              <div className="space-y-2">
                {members.map((m) => {
                  const done = courses.filter((c) => stateOf(c.id, m.id) === 'done').length;
                  const pct = courses.length ? Math.round((done / courses.length) * 100) : 0;
                  return (
                    <div key={m.id} className="flex items-center gap-2">
                      <Avatar name={m.name} size={22} />
                      <span className="w-14 shrink-0 truncate text-[12.5px] font-semibold text-neutral-600">
                        {m.name}
                      </span>
                      <ProgressBar value={pct} className="flex-1" />
                      <span className="w-10 shrink-0 text-right text-[11px] font-bold tabular-nums text-neutral-500">
                        {done}/{courses.length}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 과정별 — 폰에서 표를 쓰면 가로로 흐르니 카드로 편다 */}
            {courses.map((c) => (
              <section key={c.id} className="card p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[14.5px] font-bold text-neutral-900">{c.title}</p>
                    {c.summary && (
                      <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-500">
                        {c.summary}
                      </p>
                    )}
                  </div>
                  <span className="chip shrink-0 bg-neutral-100 text-neutral-500">
                    {members.filter((m) => stateOf(c.id, m.id) === 'done').length}/{members.length}
                  </span>
                </div>

                <ul className="mt-2.5 space-y-1.5">
                  {members.map((m) => {
                    const st = stateOf(c.id, m.id);
                    return (
                      <li key={m.id} className="flex items-center gap-2">
                        <Avatar name={m.name} size={20} />
                        <span className="w-14 shrink-0 truncate text-[12.5px] font-semibold text-neutral-600">
                          {m.name}
                        </span>
                        <span className="flex flex-1 gap-1">
                          {TRAINING_STATES.map((s) => {
                            const on = st === s.value;
                            return (
                              <button
                                key={s.value}
                                onClick={() => void setState(c.id, m.id, s.value)}
                                aria-pressed={on}
                                aria-label={`${m.name} ${c.title} ${s.label}`}
                                className={`h-9 flex-1 rounded-lg border text-[12px] font-bold transition ${
                                  on ? s.on : 'border-neutral-200 bg-surface text-neutral-400'
                                }`}
                              >
                                {s.label}
                              </button>
                            );
                          })}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                <div className="mt-2.5 flex gap-2">
                  <button onClick={() => startEdit(c)} className="btn-ghost h-9 flex-1 text-[13px]">
                    고치기
                  </button>
                  <button
                    onClick={() => setDeleting(c.id)}
                    className="h-9 rounded-xl border border-neutral-300 px-3 text-[13px] text-neutral-500"
                  >
                    삭제
                  </button>
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <Sheet open={formOpen} onClose={() => setFormOpen(false)} title={editing ? '과정 고치기' : '과정 추가'}>
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="course-title">
              과정 이름
            </label>
            <input
              id="course-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="field"
              placeholder="예) 게이트 코드 발급·배포 실습"
            />
          </div>
          <div>
            <label className="label" htmlFor="course-summary">
              설명
            </label>
            <textarea
              id="course-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={4}
              className="field resize-none"
              placeholder="무엇을 할 줄 알아야 이수인지 적어주세요."
            />
          </div>

          {formErr && <ErrorBanner message={formErr} />}

          <button onClick={save} disabled={busy} className="btn-primary w-full">
            {busy ? '저장 중…' : '저장'}
          </button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="과정을 지울까요?"
        message="강사별 이수 기록도 함께 사라져요."
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove(deleting)}
      />

      {toast.node}
    </div>
  );
}
