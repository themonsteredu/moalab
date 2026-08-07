'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { logActivity } from '@/lib/log';
import { hhmm, korDateFull, toISODate, today } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { ConfirmDialog, ErrorBanner, MultiPicker, Sheet, Skeleton, useToast } from '@/components/ui';
import type { AppRow, Schedule, ScheduleKind } from '@/lib/types';

type View = 'month' | 'week';

interface Entry {
  id: string;
  kind: 'due' | ScheduleKind;
  title: string;
  date: string;
  time?: string | null;
  place?: string | null;
  memo?: string | null;
  appId?: string;
}

const KIND_STYLE: Record<Entry['kind'], { dot: string; chip: string; label: string }> = {
  due: { dot: 'bg-red-500', chip: 'bg-red-100 text-red-700', label: '제출 마감' },
  meeting: { dot: 'bg-blue-500', chip: 'bg-blue-100 text-blue-700', label: '회의' },
  visit: { dot: 'bg-green-500', chip: 'bg-green-100 text-green-700', label: '학교 방문' },
};

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

export default function SchedulePage() {
  const { session } = useSession();
  const { members, nameOf } = useMembers();
  const toast = useToast();

  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [view, setView] = useState<View>('month');
  const [picked, setPicked] = useState<string>(today());

  const [apps, setApps] = useState<AppRow[]>([]);
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [attendees, setAttendees] = useState<Record<string, string[]>>({});
  const [error, setError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [deleting, setDeleting] = useState<Schedule | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [aRes, sRes, smRes] = await Promise.all([
        supabase.from('apps').select('*').eq('archived', false).not('due_date', 'is', null),
        supabase.from('schedules').select('*').order('date').order('start_time'),
        supabase.from('schedule_members').select('*'),
      ]);
      if (sRes.error) throw sRes.error;
      setApps((aRes.data ?? []) as AppRow[]);
      setSchedules((sRes.data ?? []) as Schedule[]);

      const map: Record<string, string[]> = {};
      for (const r of smRes.data ?? []) {
        (map[r.schedule_id] ??= []).push(r.member_id);
      }
      setAttendees(map);
    } catch (e) {
      setSchedules([]);
      setError(friendlyError(e, '일정을 불러오지 못했어요. 다시 시도해주세요.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 앱 마감일은 따로 입력하지 않는다 — apps.due_date 에서 자동으로 만들어진다. */
  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    for (const a of apps) {
      if (!a.due_date) continue;
      out.push({ id: `due-${a.id}`, kind: 'due', title: `${a.title_ko} 제출 마감`, date: a.due_date, appId: a.id });
    }
    for (const s of schedules ?? []) {
      out.push({
        id: s.id,
        kind: s.kind,
        title: s.title,
        date: s.date,
        time: s.start_time,
        place: s.place,
        memo: s.memo,
      });
    }
    return out;
  }, [apps, schedules]);

  const byDate = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of entries) {
      const list = m.get(e.date) ?? [];
      list.push(e);
      m.set(e.date, list);
    }
    for (const list of m.values()) {
      list.sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99'));
    }
    return m;
  }, [entries]);

  /** 달력 격자 (월요일 시작 아님 — 한국 달력은 일요일 시작) */
  const grid = useMemo(() => {
    if (view === 'week') {
      const base = new Date(picked + 'T00:00:00');
      const start = new Date(base);
      start.setDate(base.getDate() - base.getDay());
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        return d;
      });
    }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    const cells: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push(d);
      // 마지막 주가 전부 다음 달이면 그만
      if (i >= 34 && d.getMonth() !== cursor.getMonth() && d.getDay() === 6) break;
    }
    return cells;
  }, [cursor, view, picked]);

  const dayEntries = byDate.get(picked) ?? [];
  const todayStr = today();

  const move = (delta: number) => {
    if (view === 'month') {
      setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
    } else {
      const d = new Date(picked + 'T00:00:00');
      d.setDate(d.getDate() + delta * 7);
      setPicked(toISODate(d));
      setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
    }
  };

  const removeSchedule = async () => {
    if (!deleting) return;
    const t = deleting;
    setDeleting(null);
    const { error: e } = await supabase.from('schedules').delete().eq('id', t.id);
    if (e) {
      setError(friendlyError(e));
      return;
    }
    logActivity(session?.id, `일정 삭제 — ${t.title}`, null);
    toast.show('지웠어요.');
    await load();
  };

  return (
    <>
      <PageHeader
        title="일정"
        right={
          <button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="btn-primary h-10 px-3.5 text-[14px]"
          >
            + 일정
          </button>
        }
      />

      <div className="px-4 pb-8 pt-3">
        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} onRetry={() => void load()} />
          </div>
        )}

        {/* 월/주 전환 + 이동 */}
        <div className="mb-3 flex items-center gap-2">
          <button onClick={() => move(-1)} aria-label="이전" className="tap w-11 rounded-xl border border-neutral-300 bg-white text-neutral-500">
            ‹
          </button>
          <p className="flex-1 text-center text-[16px] font-black">
            {view === 'month'
              ? `${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월`
              : `${new Date(picked + 'T00:00:00').getMonth() + 1}월 ${Math.ceil(new Date(picked + 'T00:00:00').getDate() / 7)}주차`}
          </p>
          <button onClick={() => move(1)} aria-label="다음" className="tap w-11 rounded-xl border border-neutral-300 bg-white text-neutral-500">
            ›
          </button>
        </div>

        <div className="mb-3 flex gap-1.5 rounded-xl bg-neutral-200/60 p-1">
          {(
            [
              ['month', '월간'],
              ['week', '주간'],
            ] as [View, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`tap flex-1 rounded-lg text-[14px] font-bold transition ${
                view === v ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 범례 */}
        <div className="mb-3 flex flex-wrap gap-3 px-1">
          {(['due', 'meeting', 'visit'] as const).map((k) => (
            <span key={k} className="flex items-center gap-1.5 text-[12px] text-neutral-600">
              <span className={`h-2.5 w-2.5 rounded-full ${KIND_STYLE[k].dot}`} />
              {KIND_STYLE[k].label}
            </span>
          ))}
        </div>

        {/* 달력 */}
        {schedules === null ? (
          <Skeleton className="h-72 w-full rounded-2xl" />
        ) : (
          <div className="card overflow-hidden p-2">
            <div className="grid grid-cols-7">
              {WEEK.map((w, i) => (
                <div
                  key={w}
                  className={`pb-1.5 text-center text-[11.5px] font-bold ${
                    i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-neutral-400'
                  }`}
                >
                  {w}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {grid.map((d) => {
                const iso = toISODate(d);
                const inMonth = view === 'week' || d.getMonth() === cursor.getMonth();
                const list = byDate.get(iso) ?? [];
                const isToday = iso === todayStr;
                const isPicked = iso === picked;
                return (
                  <button
                    key={iso}
                    onClick={() => setPicked(iso)}
                    className={`flex min-h-[52px] flex-col items-center rounded-lg py-1 transition ${
                      isPicked ? 'bg-brand text-white' : isToday ? 'bg-brand-50' : ''
                    }`}
                  >
                    <span
                      className={`text-[13px] font-bold ${
                        isPicked
                          ? 'text-white'
                          : !inMonth
                            ? 'text-neutral-300'
                            : d.getDay() === 0
                              ? 'text-red-500'
                              : d.getDay() === 6
                                ? 'text-blue-500'
                                : 'text-neutral-700'
                      }`}
                    >
                      {d.getDate()}
                    </span>
                    <span className="mt-1 flex h-2 gap-0.5">
                      {[...new Set(list.map((e) => e.kind))].slice(0, 3).map((k) => (
                        <span
                          key={k}
                          className={`h-1.5 w-1.5 rounded-full ${isPicked ? 'bg-white/90' : KIND_STYLE[k].dot}`}
                        />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 선택한 날짜의 항목 */}
        <div className="mt-4">
          <p className="mb-2.5 text-[15px] font-bold">{korDateFull(picked)}</p>

          {dayEntries.length === 0 ? (
            <p className="card px-4 py-8 text-center text-[13px] text-neutral-400">이 날은 일정이 없어요.</p>
          ) : (
            <div className="space-y-2.5">
              {dayEntries.map((e) => {
                const st = KIND_STYLE[e.kind];
                const body = (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 text-[15px] font-bold leading-snug">{e.title}</p>
                      <span className={`chip shrink-0 ${st.chip}`}>{st.label}</span>
                    </div>
                    {(e.time || e.place) && (
                      <p className="mt-1 text-[12.5px] text-neutral-500">
                        {hhmm(e.time)} {e.place ? `· ${e.place}` : ''}
                      </p>
                    )}
                    {e.kind !== 'due' && (attendees[e.id]?.length ?? 0) > 0 && (
                      <p className="mt-1 text-[12.5px] text-neutral-500">
                        참석 {attendees[e.id].map((m) => nameOf(m)).join(', ')}
                      </p>
                    )}
                    {e.memo && (
                      <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-600">{e.memo}</p>
                    )}
                  </>
                );

                if (e.kind === 'due') {
                  return (
                    <Link key={e.id} href={`/apps/${e.appId}`} className="card block p-3.5 active:bg-neutral-50">
                      {body}
                    </Link>
                  );
                }

                const sched = (schedules ?? []).find((s) => s.id === e.id)!;
                return (
                  <div key={e.id} className="card p-3.5">
                    {body}
                    <div className="mt-2.5 flex gap-2">
                      <button
                        onClick={() => {
                          setEditing(sched);
                          setFormOpen(true);
                        }}
                        className="h-9 flex-1 rounded-lg border border-neutral-300 text-[13px] font-semibold text-neutral-600"
                      >
                        수정
                      </button>
                      <button
                        onClick={() => setDeleting(sched)}
                        className="h-9 rounded-lg border border-neutral-300 px-3 text-[13px] text-neutral-500"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ScheduleForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        defaultDate={picked}
        editing={editing}
        members={members}
        attendees={editing ? (attendees[editing.id] ?? []) : []}
        onSaved={() => {
          toast.show('저장했어요.');
          void load();
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`'${deleting?.title ?? ''}' 일정을 지울까요?`}
        onCancel={() => setDeleting(null)}
        onConfirm={removeSchedule}
      />

      {toast.node}
    </>
  );
}

/* --------------------------------------------------------------- 일정 추가/수정 */

function ScheduleForm({
  open,
  onClose,
  onSaved,
  defaultDate,
  editing,
  members,
  attendees,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  defaultDate: string;
  editing: Schedule | null;
  members: { id: string; name: string }[];
  attendees: string[];
}) {
  const { session } = useSession();
  const [kind, setKind] = useState<ScheduleKind>('meeting');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState('');
  const [place, setPlace] = useState('');
  const [memo, setMemo] = useState('');
  const [people, setPeople] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    if (editing) {
      setKind(editing.kind);
      setTitle(editing.title);
      setDate(editing.date);
      setTime(hhmm(editing.start_time));
      setPlace(editing.place ?? '');
      setMemo(editing.memo ?? '');
      setPeople(attendees);
    } else {
      setKind('meeting');
      setTitle('');
      setDate(defaultDate);
      setTime('');
      setPlace('');
      setMemo('');
      setPeople(session?.id ? [session.id] : []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, defaultDate]);

  const save = async () => {
    setError('');
    if (!title.trim()) return setError('제목을 입력해주세요.');
    if (!date) return setError('날짜를 골라주세요.');

    setBusy(true);
    try {
      const payload = {
        kind,
        title: title.trim(),
        date,
        start_time: time || null,
        place: place.trim() || null,
        memo: memo.trim() || null,
      };

      let id: string;
      if (editing) {
        const { error: e } = await supabase.from('schedules').update(payload).eq('id', editing.id);
        if (e) throw e;
        id = editing.id;
        await supabase.from('schedule_members').delete().eq('schedule_id', id);
      } else {
        const { data, error: e } = await supabase.from('schedules').insert(payload).select().single();
        if (e) throw e;
        id = data.id;
      }

      if (people.length > 0) {
        const { error: e } = await supabase
          .from('schedule_members')
          .insert(people.map((member_id) => ({ schedule_id: id, member_id })));
        if (e) throw e;
      }

      logActivity(session?.id, `${editing ? '일정 수정' : '일정 추가'} — ${title.trim()}`, `schedule:${id}`);
      onSaved();
      onClose();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? '일정 수정' : '새 일정'}
      footer={
        <button onClick={save} disabled={busy} className="btn-primary w-full">
          {busy ? '저장 중…' : '저장'}
        </button>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}

        <div>
          <span className="label">종류</span>
          <div className="flex gap-2">
            {(
              [
                ['meeting', '회의'],
                ['visit', '학교 방문 수업'],
              ] as [ScheduleKind, string][]
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setKind(v)}
                className={`tap flex-1 rounded-xl border text-[14px] font-semibold transition ${
                  kind === v ? 'border-brand bg-brand text-white' : 'border-neutral-300 bg-white text-neutral-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-neutral-400">
            제출 마감은 앱 마감일에서 자동으로 달력에 표시돼요. 여기서 넣지 않아도 됩니다.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="sc-title">
            제목
          </label>
          <input
            id="sc-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="모아초 4학년 방문 수업"
            className="field"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="sc-date">
              날짜
            </label>
            <input id="sc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field" />
          </div>
          <div>
            <label className="label" htmlFor="sc-time">
              시간
            </label>
            <input id="sc-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="field" />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="sc-place">
            장소
          </label>
          <input
            id="sc-place"
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            placeholder="모아초등학교 3층 과학실"
            className="field"
          />
        </div>

        <div>
          <span className="label">참석자</span>
          <MultiPicker options={members} selected={people} onChange={setPeople} />
        </div>

        <div>
          <label className="label" htmlFor="sc-memo">
            메모
          </label>
          <textarea
            id="sc-memo"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={3}
            placeholder="준비물, 주차 안내 등"
            className="field resize-none"
          />
        </div>
      </div>
    </Sheet>
  );
}
