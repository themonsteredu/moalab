'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { logActivity } from '@/lib/log';
import { hhmm, korDateFull, relTime, today } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { Icon } from '@/components/Icon';
import { CardSkeleton, ConfirmDialog, EmptyState, ErrorBanner, Sheet, useToast } from '@/components/ui';
import type { AppRow, MockFeedback, MockLesson } from '@/lib/types';

/**
 * 모의수업 — 학교에 나가기 전에 우리끼리 한 번 돌려보는 자리.
 * 날짜·발표자만 잡아두고, 끝나면 참석한 사람이 "좋았던 점 / 고칠 점" 두 칸만 적는다.
 * 칸이 많으면 아무도 안 적는다.
 */
export default function MockPage() {
  const { session, isAdmin } = useSession();
  const { members, nameOf } = useMembers(true);
  const toast = useToast();

  const [lessons, setLessons] = useState<MockLesson[] | null>(null);
  const [feedback, setFeedback] = useState<MockFeedback[]>([]);
  const [apps, setApps] = useState<AppRow[]>([]);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MockLesson | null>(null);
  const [title, setTitle] = useState('');
  const [appId, setAppId] = useState('');
  const [date, setDate] = useState(today());
  const [time, setTime] = useState('');
  const [place, setPlace] = useState('');
  const [presenter, setPresenter] = useState('');
  const [memo, setMemo] = useState('');
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [lRes, aRes] = await Promise.all([
        supabase.from('mock_lessons').select('*').order('lesson_date', { ascending: false }),
        supabase.from('apps').select('*').eq('archived', false).order('title_ko'),
      ]);
      if (lRes.error) throw lRes.error;
      const list = (lRes.data ?? []) as MockLesson[];
      setLessons(list);
      setApps((aRes.data ?? []) as AppRow[]);

      if (list.length > 0) {
        const { data } = await supabase
          .from('mock_feedback')
          .select('*')
          .in('mock_id', list.map((l) => l.id))
          .order('created_at');
        setFeedback((data ?? []) as MockFeedback[]);
      } else {
        setFeedback([]);
      }
    } catch (e) {
      setError(friendlyError(e, '모의수업을 불러오지 못했어요.'));
      setLessons([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const todayStr = today();
  const upcoming = useMemo(() => (lessons ?? []).filter((l) => l.lesson_date >= todayStr), [lessons, todayStr]);
  const past = useMemo(() => (lessons ?? []).filter((l) => l.lesson_date < todayStr), [lessons, todayStr]);

  const startNew = () => {
    setEditing(null);
    setTitle('');
    setAppId('');
    setDate(todayStr);
    setTime('');
    setPlace('');
    setPresenter(session?.id ?? '');
    setMemo('');
    setFormErr('');
    setFormOpen(true);
  };

  const startEdit = (l: MockLesson) => {
    setEditing(l);
    setTitle(l.title);
    setAppId(l.app_id ?? '');
    setDate(l.lesson_date);
    setTime(l.start_time?.slice(0, 5) ?? '');
    setPlace(l.place ?? '');
    setPresenter(l.presenter_id ?? '');
    setMemo(l.memo ?? '');
    setFormErr('');
    setFormOpen(true);
  };

  const save = async () => {
    setFormErr('');
    if (!title.trim()) {
      setFormErr('제목을 적어주세요.');
      return;
    }
    if (!date) {
      setFormErr('날짜를 골라주세요.');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        title: title.trim(),
        app_id: appId || null,
        lesson_date: date,
        start_time: time || null,
        place: place.trim() || null,
        presenter_id: presenter || null,
        memo: memo.trim() || null,
      };
      if (editing) {
        const { error: e } = await supabase.from('mock_lessons').update(payload).eq('id', editing.id);
        if (e) throw e;
        logActivity(session?.id, `모의수업 수정 — ${title.trim()}`, `mock:${editing.id}`);
      } else {
        const { data, error: e } = await supabase.from('mock_lessons').insert(payload).select().single();
        if (e) throw e;
        logActivity(session?.id, `모의수업 등록 — ${title.trim()}`, `mock:${data.id}`);
      }
      setFormOpen(false);
      toast.show('저장했어요.');
      await load();
    } catch (e) {
      setFormErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleDone = async (l: MockLesson) => {
    const next = !l.done;
    setLessons((v) => v?.map((x) => (x.id === l.id ? { ...x, done: next } : x)) ?? null);
    const { error: e } = await supabase.from('mock_lessons').update({ done: next }).eq('id', l.id);
    if (e) {
      setError(friendlyError(e, '상태를 바꾸지 못했어요.'));
      await load();
    }
  };

  const remove = async (id: string) => {
    setDeleting(null);
    const { error: e } = await supabase.from('mock_lessons').delete().eq('id', id);
    if (e) {
      setError(friendlyError(e, '지우지 못했어요.'));
      return;
    }
    toast.show('지웠어요.');
    await load();
  };

  const card = (l: MockLesson) => (
    <MockCard
      key={l.id}
      lesson={l}
      appTitle={apps.find((a) => a.id === l.app_id)?.title_ko ?? null}
      feedback={feedback.filter((f) => f.mock_id === l.id)}
      open={openId === l.id}
      onToggleOpen={() => setOpenId((v) => (v === l.id ? null : l.id))}
      onToggleDone={() => void toggleDone(l)}
      onEdit={() => startEdit(l)}
      onDelete={() => setDeleting(l.id)}
      canEdit={isAdmin || l.presenter_id === session?.id}
      nameOf={nameOf}
      onSaved={load}
    />
  );

  return (
    <div>
      <PageHeader
        title="모의수업"
        subtitle={lessons === null ? '불러오는 중…' : `예정 ${upcoming.length} · 지난 ${past.length}`}
        right={
          <button onClick={startNew} className="btn-primary px-3 text-[13.5px]">
            <Icon name="plus" size={15} />
            잡기
          </button>
        }
      />

      <div className="px-4 pb-8 pt-3 lg:px-0">
        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} onRetry={() => void load()} />
          </div>
        )}

        {lessons === null ? (
          <CardSkeleton rows={3} />
        ) : lessons.length === 0 ? (
          <EmptyState
            icon="present"
            title="잡힌 모의수업이 없어요"
            desc="학교에 나가기 전에 한 번 돌려볼 날짜를 잡아보세요."
          />
        ) : (
          <div className="space-y-4">
            {upcoming.length > 0 && (
              <section>
                <h2 className="mb-2 text-[13px] font-bold text-neutral-400">예정</h2>
                <ul className="space-y-2.5">{upcoming.map(card)}</ul>
              </section>
            )}
            {past.length > 0 && (
              <section>
                <h2 className="mb-2 text-[13px] font-bold text-neutral-400">지난 모의수업</h2>
                <ul className="space-y-2.5">{past.map(card)}</ul>
              </section>
            )}
          </div>
        )}
      </div>

      <Sheet open={formOpen} onClose={() => setFormOpen(false)} title={editing ? '모의수업 고치기' : '모의수업 잡기'}>
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="mock-title">
              제목
            </label>
            <input
              id="mock-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="field"
              placeholder="예) AI 화장품 만들기 모의수업"
            />
          </div>

          <div>
            <label className="label" htmlFor="mock-app">
              어떤 프로그램
            </label>
            <select id="mock-app" value={appId} onChange={(e) => setAppId(e.target.value)} className="field">
              <option value="">선택 안 함</option>
              {apps.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title_ko}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="mock-date">
                날짜
              </label>
              <input id="mock-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field" />
            </div>
            <div>
              <label className="label" htmlFor="mock-time">
                시작 시간
              </label>
              <input id="mock-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="field" />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="mock-presenter">
              진행하는 사람
            </label>
            <select
              id="mock-presenter"
              value={presenter}
              onChange={(e) => setPresenter(e.target.value)}
              className="field"
            >
              <option value="">선택 안 함</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="mock-place">
              장소
            </label>
            <input
              id="mock-place"
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              className="field"
              placeholder="예) 더몬스터학원 2층"
            />
          </div>

          <div>
            <label className="label" htmlFor="mock-memo">
              메모
            </label>
            <textarea
              id="mock-memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              rows={3}
              className="field resize-none"
              placeholder="준비물, 확인할 것 등"
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
        title="모의수업을 지울까요?"
        message="적어둔 피드백도 함께 사라져요."
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove(deleting)}
      />

      {toast.node}
    </div>
  );
}

function MockCard({
  lesson,
  appTitle,
  feedback,
  open,
  onToggleOpen,
  onToggleDone,
  onEdit,
  onDelete,
  canEdit,
  nameOf,
  onSaved,
}: {
  lesson: MockLesson;
  appTitle: string | null;
  feedback: MockFeedback[];
  open: boolean;
  onToggleOpen: () => void;
  onToggleDone: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canEdit: boolean;
  nameOf: (id: string | null) => string;
  onSaved: () => Promise<void>;
}) {
  const { session } = useSession();
  const mine = feedback.find((f) => f.member_id === session?.id) ?? null;

  const [good, setGood] = useState(mine?.good ?? '');
  const [fix, setFix] = useState(mine?.fix ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setGood(mine?.good ?? '');
    setFix(mine?.fix ?? '');
  }, [mine?.good, mine?.fix]);

  const dirty = (mine?.good ?? '') !== good || (mine?.fix ?? '') !== fix;

  const saveFeedback = async () => {
    setErr('');
    if (!good.trim() && !fix.trim()) {
      setErr('좋았던 점이나 고칠 점 중 하나는 적어주세요.');
      return;
    }
    setBusy(true);
    try {
      if (mine) {
        const { error: e } = await supabase
          .from('mock_feedback')
          .update({ good: good.trim() || null, fix: fix.trim() || null })
          .eq('id', mine.id);
        if (e) throw e;
      } else {
        const { error: e } = await supabase.from('mock_feedback').insert({
          mock_id: lesson.id,
          member_id: session?.id ?? null,
          good: good.trim() || null,
          fix: fix.trim() || null,
        });
        if (e) throw e;
      }
      logActivity(session?.id, `모의수업 피드백 — ${lesson.title}`, `mock:${lesson.id}`);
      await onSaved();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="card overflow-hidden">
      <button onClick={onToggleOpen} aria-expanded={open} className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-[14.5px] font-bold text-neutral-900">{lesson.title}</span>
            {lesson.done && <span className="chip bg-green-100 text-green-800">완료</span>}
          </span>
          <span className="mt-0.5 block truncate text-[11.5px] text-neutral-400">
            {korDateFull(lesson.lesson_date)}
            {lesson.start_time && ` ${hhmm(lesson.start_time)}`}
            {lesson.place && ` · ${lesson.place}`}
            {lesson.presenter_id && ` · ${nameOf(lesson.presenter_id)}`}
          </span>
          {appTitle && <span className="mt-1 block text-[11.5px] font-bold text-brand">{appTitle}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {feedback.length > 0 && <span className="chip bg-neutral-100 text-neutral-500">피드백 {feedback.length}</span>}
          <Icon
            name="chevronDown"
            size={14}
            className={`text-neutral-300 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      {open && (
        <div className="border-t border-neutral-100 px-3.5 py-3">
          {lesson.memo && (
            <p className="mb-3 whitespace-pre-wrap rounded-lg bg-raised px-3 py-2 text-[13px] leading-relaxed text-neutral-700">
              {lesson.memo}
            </p>
          )}

          {feedback.filter((f) => f.member_id !== session?.id).length > 0 && (
            <ul className="mb-3 space-y-2">
              {feedback
                .filter((f) => f.member_id !== session?.id)
                .map((f) => (
                  <li key={f.id} className="rounded-lg border border-neutral-200 px-3 py-2">
                    <p className="text-[12px] font-bold text-neutral-500">
                      {nameOf(f.member_id)}
                      <span className="ml-1.5 font-normal text-neutral-400">{relTime(f.created_at)}</span>
                    </p>
                    {f.good && (
                      <p className="mt-1 text-[13px] leading-relaxed text-green-800">
                        <span className="font-bold">좋았던 점</span> {f.good}
                      </p>
                    )}
                    {f.fix && (
                      <p className="mt-0.5 text-[13px] leading-relaxed text-amber-800">
                        <span className="font-bold">고칠 점</span> {f.fix}
                      </p>
                    )}
                  </li>
                ))}
            </ul>
          )}

          <p className="label">내 피드백</p>
          <textarea
            value={good}
            onChange={(e) => setGood(e.target.value)}
            rows={2}
            className="field resize-none"
            placeholder="좋았던 점"
            aria-label="좋았던 점"
          />
          <textarea
            value={fix}
            onChange={(e) => setFix(e.target.value)}
            rows={2}
            className="field mt-2 resize-none"
            placeholder="고칠 점"
            aria-label="고칠 점"
          />
          {err && (
            <div className="mt-2">
              <ErrorBanner message={err} />
            </div>
          )}
          <button onClick={saveFeedback} disabled={busy || !dirty} className="btn-primary mt-2 w-full">
            {busy ? '저장 중…' : dirty ? '피드백 저장' : '저장됨'}
          </button>

          <div className="mt-2.5 flex gap-2">
            <button
              onClick={onToggleDone}
              className={`h-9 flex-1 rounded-lg border text-[13px] font-bold transition ${
                lesson.done
                  ? 'border-neutral-300 bg-surface text-neutral-500'
                  : 'border-green-600 bg-green-600 text-white'
              }`}
            >
              {lesson.done ? '완료 취소' : '완료로 표시'}
            </button>
            {canEdit && (
              <>
                <button onClick={onEdit} className="h-9 rounded-lg border border-neutral-300 px-3 text-[13px] text-neutral-600">
                  고치기
                </button>
                <button onClick={onDelete} className="h-9 rounded-lg border border-neutral-300 px-3 text-[13px] text-neutral-500">
                  삭제
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
