'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { logActivity } from '@/lib/log';
import { Icon } from '@/components/Icon';
import { ErrorBanner, Sheet } from '@/components/ui';
import type { AppOverview } from '@/lib/useAppsOverview';
import type { Topic } from '@/lib/types';

const NO_TOPIC = '주제 없음';

/**
 * 프로그램을 체크해서 주제로 한꺼번에 옮긴다.
 *
 * 프로그램이 21개면 하나씩 [수정 → 주제 → 저장] 을 21번 해야 했다.
 * 여기서는 지금 주제별로 묶인 이름 목록을 보고 체크만 하면 update 한 번으로 끝난다.
 * 그래서 카드가 아니라 **한 줄짜리 목록**으로 촘촘하게 그린다.
 */
export function TopicMove({
  open,
  onClose,
  items,
  topics,
  onMoved,
}: {
  open: boolean;
  onClose: () => void;
  items: AppOverview[];
  topics: Topic[];
  onMoved: (count: number, topicName: string) => void;
}) {
  const { session } = useSession();
  const [checked, setChecked] = useState<string[]>([]);
  /** 어디로 옮길지. '' = 주제 없음으로 빼기 */
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // 열 때마다 초기화 — 지난번 선택이 남아 있으면 엉뚱한 걸 옮긴다
  useEffect(() => {
    if (open) {
      setChecked([]);
      setError('');
      setTarget(topics[0]?.id ?? '');
    }
  }, [open, topics]);

  /** 지금 주제별로 묶어서 보여준다. 주제 없는 것부터 (그게 채워야 할 것이다) */
  const groups = useMemo(() => {
    const m = new Map<string, AppOverview[]>();
    for (const it of items) {
      const name = it.topicName || NO_TOPIC;
      const list = m.get(name) ?? [];
      list.push(it);
      m.set(name, list);
    }
    const order = new Map(topics.map((t, i) => [t.name, i]));
    return [...m.entries()]
      .map(([name, list]) => ({
        name,
        list: [...list].sort((a, b) => a.app.title_ko.localeCompare(b.app.title_ko, 'ko')),
      }))
      .sort((a, b) => {
        if (a.name === NO_TOPIC) return -1;
        if (b.name === NO_TOPIC) return 1;
        return (order.get(a.name) ?? 9999) - (order.get(b.name) ?? 9999);
      });
  }, [items, topics]);

  const toggle = (id: string) =>
    setChecked((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));

  const toggleGroup = (list: AppOverview[]) => {
    const ids = list.map((i) => i.app.id);
    const allOn = ids.every((id) => checked.includes(id));
    setChecked((v) => (allOn ? v.filter((x) => !ids.includes(x)) : [...new Set([...v, ...ids])]));
  };

  const targetName = target ? (topics.find((t) => t.id === target)?.name ?? '') : NO_TOPIC;

  const move = async () => {
    setError('');
    if (checked.length === 0) {
      setError('옮길 프로그램을 골라주세요.');
      return;
    }
    setBusy(true);
    try {
      // 여러 개를 한 번에 — 21개도 요청 하나로 끝난다
      const { error: e } = await supabase
        .from('apps')
        .update({ topic_id: target || null })
        .in('id', checked);
      if (e) throw e;
      logActivity(session?.id, `주제 이동 — ${checked.length}개를 ${targetName} 으로`, 'topics');
      onMoved(checked.length, targetName);
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
      title="주제로 옮기기"
      footer={
        <div className="space-y-2">
          {error && <ErrorBanner message={error} />}
          <div className="flex items-center gap-2">
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-label="옮길 주제"
              className="field flex-1"
            >
              {topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
              <option value="">{NO_TOPIC} 으로 빼기</option>
            </select>
            <button
              onClick={() => void move()}
              disabled={busy || checked.length === 0}
              className="btn-primary shrink-0 px-4"
            >
              {busy ? '옮기는 중…' : `${checked.length}개 옮기기`}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] leading-relaxed text-neutral-500">
          옮길 프로그램을 체크하고, 아래에서 주제를 골라 <b>옮기기</b> 를 누르세요.
          {topics.length === 0 && (
            <>
              <br />
              <b className="text-red-600">먼저 주제 관리에서 주제를 하나 만들어주세요.</b>
            </>
          )}
        </p>

        {groups.map((g) => {
          const ids = g.list.map((i) => i.app.id);
          const allOn = ids.every((id) => checked.includes(id));
          return (
            <div key={g.name}>
              <button
                onClick={() => toggleGroup(g.list)}
                className="mb-1 flex w-full items-center gap-1.5 text-left"
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    allOn ? 'border-brand bg-brand text-white' : 'border-neutral-300'
                  }`}
                >
                  {allOn && <Icon name="check" size={10} strokeWidth={3.5} />}
                </span>
                <span
                  className={`text-[12px] font-bold ${
                    g.name === NO_TOPIC ? 'text-red-600' : 'text-neutral-500'
                  }`}
                >
                  {g.name} {g.list.length}개
                </span>
                <span className="text-[11px] text-neutral-400">· 묶음 전체 선택</span>
              </button>

              <ul className="overflow-hidden rounded-xl border border-neutral-200">
                {g.list.map((it, i) => {
                  const on = checked.includes(it.app.id);
                  return (
                    <li key={it.app.id} className={i > 0 ? 'border-t border-neutral-100' : ''}>
                      <button
                        onClick={() => toggle(it.app.id)}
                        aria-pressed={on}
                        className={`flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2 text-left transition ${
                          on ? 'bg-brand-50' : ''
                        }`}
                      >
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                            on ? 'border-brand bg-brand text-white' : 'border-neutral-300'
                          }`}
                        >
                          {on && <Icon name="check" size={12} strokeWidth={3} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-semibold text-neutral-900">
                            {it.app.title_ko}
                          </span>
                          <span className="block truncate text-[11px] text-neutral-400">{it.app.slug}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
