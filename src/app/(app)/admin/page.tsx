'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { useAppsOverview } from '@/lib/useAppsOverview';
import { STATUS_META } from '@/lib/status';
import { ddayClass, ddayLabel, logTime } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { PushToggle } from '@/components/PushToggle';
import { AiKeyCard } from '@/components/AiKeyCard';
import { AppForm } from '@/components/AppForm';
import { CardSkeleton, ConfirmDialog, ErrorBanner, ProgressBar, Sheet, Skeleton, useToast } from '@/components/ui';
import type { ActivityLog, MemberPublic, Role } from '@/lib/types';

type Tab = 'members' | 'apps' | 'log';

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="px-4 py-4"><CardSkeleton rows={3} /></div>}>
      <AdminInner />
    </Suspense>
  );
}

function AdminInner() {
  const { session, isAdmin } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'members');

  useEffect(() => {
    if (session && !isAdmin) router.replace('/home');
  }, [session, isAdmin, router]);

  if (!isAdmin) return null;

  return (
    <>
      <PageHeader title="관리" subtitle="원장 전용" />

      <div className="px-4 pb-8 pt-3">
        <div className="mb-3 space-y-2">
          <PushToggle />
          <AiKeyCard />
        </div>
        <div className="mb-4 flex gap-1.5 rounded-xl bg-neutral-200/60 p-1">
          {(
            [
              ['members', '멤버'],
              ['apps', '전체 현황'],
              ['log', '활동 로그'],
            ] as [Tab, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setTab(v)}
              className={`tap flex-1 rounded-lg text-[14px] font-bold transition ${
                tab === v ? 'bg-surface text-neutral-900 shadow-sm' : 'text-neutral-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'members' && <MembersTab onToast={toast.show} />}
        {tab === 'apps' && <AppsTab />}
        {tab === 'log' && <LogTab />}
      </div>

      {toast.node}
    </>
  );
}

/* ------------------------------------------------------------------ 멤버 관리 */

function MembersTab({ onToast }: { onToast: (m: string) => void }) {
  const { session } = useSession();
  const { members, reload, loading } = useMembers(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MemberPublic | null>(null);
  const [deleting, setDeleting] = useState<MemberPublic | null>(null);

  const call = useCallback(
    async (method: 'POST' | 'PATCH' | 'DELETE', body?: unknown, query = '') => {
      const res = await fetch(`/api/members${query}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-actor-id': session?.id ?? '' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? '처리하지 못했어요. 다시 눌러주세요.');
      return json;
    },
    [session?.id],
  );

  const toggleActive = async (m: MemberPublic) => {
    setError('');
    try {
      await call('PATCH', { id: m.id, active: !m.active });
      onToast(m.active ? '비활성으로 바꿨어요.' : '다시 활성화했어요.');
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    const t = deleting;
    setDeleting(null);
    setError('');
    try {
      await call('DELETE', undefined, `?id=${t.id}`);
      onToast('삭제했어요.');
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} />}

      <button
        onClick={() => {
          setEditing(null);
          setFormOpen(true);
        }}
        className="btn-primary w-full"
      >
        + 멤버 추가
      </button>

      {loading ? (
        <CardSkeleton rows={3} />
      ) : (
        members.map((m) => (
          <div key={m.id} className={`card p-4 ${m.active ? '' : 'opacity-60'}`}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[16px] font-bold">
                {m.name}
                {m.id === session?.id && <span className="ml-1.5 text-[12px] text-brand">(나)</span>}
              </p>
              <span className={`chip ${m.role === 'admin' ? 'bg-brand-50 text-brand-700' : 'bg-neutral-100 text-neutral-600'}`}>
                {m.role === 'admin' ? '원장' : '강사'}
              </span>
            </div>
            {!m.active && <p className="mt-1 text-[12px] text-neutral-500">비활성 — 로그인 목록에 안 보여요</p>}

            <div className="mt-3 flex gap-2">
              {/* 44px — 셋이 나란히 있고 그중 하나가 삭제다. 36px 이라 잘못 누르기 쉬웠다.
                  이름을 aria-label 에 넣는다 — 다섯 명이면 같은 글자의 버튼이 15개다 */}
              <button
                onClick={() => {
                  setEditing(m);
                  setFormOpen(true);
                }}
                aria-label={`${m.name} 수정 / PIN 변경`}
                className="h-11 flex-1 rounded-lg border border-neutral-300 text-[13px] font-semibold text-neutral-600"
              >
                수정 / PIN 변경
              </button>
              <button
                onClick={() => toggleActive(m)}
                aria-label={`${m.name} ${m.active ? '비활성으로' : '활성으로'}`}
                className="h-11 rounded-lg border border-neutral-300 px-3 text-[13px] text-neutral-500"
              >
                {m.active ? '비활성' : '활성'}
              </button>
              {m.id !== session?.id && (
                <button
                  onClick={() => setDeleting(m)}
                  aria-label={`${m.name} 삭제`}
                  className="h-11 rounded-lg border border-neutral-300 px-3 text-[13px] text-red-500"
                >
                  삭제
                </button>
              )}
            </div>
          </div>
        ))
      )}

      <MemberForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        editing={editing}
        onSaved={async () => {
          onToast('저장했어요.');
          await reload();
        }}
        call={call}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`'${deleting?.name ?? ''}' 멤버를 지울까요?`}
        message="이 사람이 남긴 검증 체크와 배정도 함께 사라져요. 기록을 남기려면 삭제 대신 '비활성'을 쓰세요."
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
      />
    </div>
  );
}

function MemberForm({
  open,
  onClose,
  onSaved,
  editing,
  call,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  editing: MemberPublic | null;
  call: (method: 'POST' | 'PATCH' | 'DELETE', body?: unknown, query?: string) => Promise<unknown>;
}) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState<Role>('teacher');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setPin('');
    setName(editing?.name ?? '');
    setRole(editing?.role ?? 'teacher');
  }, [open, editing]);

  const save = async () => {
    setError('');
    if (!name.trim()) return setError('이름을 입력해주세요.');
    if (!editing && !/^\d{4}$/.test(pin)) return setError('PIN은 숫자 4자리로 입력해주세요.');
    if (editing && pin && !/^\d{4}$/.test(pin)) return setError('PIN은 숫자 4자리로 입력해주세요.');

    setBusy(true);
    try {
      if (editing) {
        await call('PATCH', { id: editing.id, name: name.trim(), role, ...(pin ? { pin } : {}) });
      } else {
        await call('POST', { name: name.trim(), pin, role });
      }
      await onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? '멤버 수정' : '멤버 추가'}
      footer={
        <button onClick={save} disabled={busy} className="btn-primary w-full">
          {busy ? '저장 중…' : '저장'}
        </button>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <div>
          <label className="label" htmlFor="mb-name">
            이름
          </label>
          <input id="mb-name" value={name} onChange={(e) => setName(e.target.value)} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="mb-pin">
            PIN 4자리 {editing && <span className="font-normal text-neutral-400">(비워두면 그대로)</span>}
          </label>
          <input
            id="mb-pin"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            inputMode="numeric"
            placeholder="0000"
            className="field"
          />
        </div>
        <div>
          <span className="label">역할</span>
          <div className="flex gap-2">
            {(
              [
                ['teacher', '강사'],
                ['admin', '원장'],
              ] as [Role, string][]
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setRole(v)}
                className={`tap flex-1 rounded-xl border text-[14px] font-semibold transition ${
                  role === v ? 'border-brand bg-brand text-white' : 'border-neutral-300 bg-surface text-neutral-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ 전체 현황 */

function AppsTab() {
  const { items, loading, error, reload } = useAppsOverview(true);
  const { nameOf } = useMembers(true);
  const [formOpen, setFormOpen] = useState(false);
  const router = useRouter();

  const stats = useMemo(() => {
    const done = items.filter((i) => i.status === 'done').length;
    const fixing = items.filter((i) => i.status === 'fixing').length;
    return { total: items.length, done, fixing, pending: items.length - done - fixing };
  }, [items]);

  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} onRetry={() => void reload()} />}

      <button onClick={() => setFormOpen(true)} className="btn-primary w-full">
        + 새 앱 추가
      </button>

      <div className="card p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[13.5px] font-bold text-neutral-600">전체 진행률</span>
          <span className="text-[19px] font-black text-brand">
            {stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0}%
          </span>
        </div>
        <ProgressBar value={stats.total > 0 ? (stats.done / stats.total) * 100 : 0} />
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {(
            [
              ['검증 완료', stats.done, 'text-green-700'],
              ['수정 필요', stats.fixing, 'text-red-600'],
              ['진행 중', stats.pending, 'text-neutral-600'],
            ] as [string, number, string][]
          ).map(([label, n, cls]) => (
            <div key={label} className="rounded-xl bg-neutral-50 py-2">
              <p className={`text-[19px] font-black ${cls}`}>{n}</p>
              <p className="text-[11px] text-neutral-500">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {loading ? (
        <CardSkeleton rows={4} />
      ) : (
        <div className="card divide-y divide-neutral-100">
          {items.map((it) => (
            <Link key={it.app.id} href={`/apps/${it.app.id}`} className="block px-4 py-3 active:bg-neutral-50">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-[14.5px] font-bold">
                  {it.app.title_ko}
                  {it.app.archived && <span className="ml-1.5 text-[11px] text-neutral-400">보관됨</span>}
                </p>
                <span className={`chip shrink-0 ${STATUS_META[it.status].chip}`}>
                  {STATUS_META[it.status].label}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-[11.5px] text-neutral-500">
                  {it.currentRound?.round_no ?? 1}차 · {it.progress}% · 제작 {nameOf(it.app.creator_id)}
                </span>
                {it.app.due_date && (
                  <span className={`chip ml-auto ${ddayClass(it.app.due_date)}`}>{ddayLabel(it.app.due_date)}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      <AppForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={(id) => {
          void reload();
          router.push(`/apps/${id}`);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------- 활동 로그 */

function LogTab() {
  const { nameOf } = useMembers(true);
  const [logs, setLogs] = useState<ActivityLog[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('activity_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300);
      setLogs((data ?? []) as ActivityLog[]);
    })();
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return logs ?? [];
    return (logs ?? []).filter(
      (l) => l.action.toLowerCase().includes(term) || nameOf(l.member_id).toLowerCase().includes(term),
    );
  }, [logs, q, nameOf]);

  return (
    <div className="space-y-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="이름이나 내용으로 찾기"
        className="field"
        aria-label="로그 검색"
      />

      {logs === null ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : filtered.length === 0 ? (
        <p className="card px-4 py-8 text-center text-[13px] text-neutral-400">기록이 없어요.</p>
      ) : (
        <div className="card px-4 py-3">
          <ul className="space-y-2.5">
            {filtered.map((l) => (
              <li key={l.id} className="text-[12.5px] leading-relaxed text-neutral-600">
                <span className="text-neutral-400">{logTime(l.created_at)}</span>{' '}
                <b className="text-neutral-800">{nameOf(l.member_id)}</b> — {l.action}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-center text-[11.5px] text-neutral-400">최근 300건까지 보여요.</p>
    </div>
  );
}
