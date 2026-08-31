'use client';

import { useEffect, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { logActivity } from '@/lib/log';
import { Avatar } from '@/components/Brand';
import { Icon } from '@/components/Icon';
import { ConfirmDialog, ErrorBanner, MultiPicker, Sheet } from '@/components/ui';
import type { Duty, MemberPublic } from '@/lib/types';

/**
 * 소분류(역할) 한 줄 고치기 — 이름 · 설명 · 주담당 · 부담당.
 *
 * **주담당은 한 명이다.** 책임이 한 사람에게 지워져야 일이 굴러간다
 * (업무의 `assignee_id` 와 같은 판단). 대신 같이 하는 사람은 부담당으로 여럿 둔다.
 * 주담당으로 고른 사람은 부담당 목록에서 **자동으로 빠진다** — 한 사람이
 * 두 번 세어지면 사람별 보기의 숫자가 어긋난다.
 *
 * **알림은 안 보낸다.** 역할에는 기한이 없어 지금 당장 움직일 일이 아니고,
 * 원장이 미정 12건을 한 번에 채우면 12통이 나간다 — 그날로 알림을 꺼버린다
 * (체크리스트 뿌리기에서 '사람당 한 통' 으로 묶은 것과 같은 이유).
 */
export function DutyForm({
  open,
  onClose,
  groupId,
  groupLabel,
  duty,
  members,
  canDelete,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** 새로 만들 때 들어갈 중분류 */
  groupId: string;
  /** '기획개발부 › 프로그램 기획' — 어디에 넣는지 보여준다 */
  groupLabel: string;
  /** null 이면 새로 만들기 */
  duty: Duty | null;
  members: MemberPublic[];
  /**
   * 지우기는 **원장만.** 만들고 고치는 건 전원이지만, 지우는 것은 남이 적어둔
   * 역할을 없애는 일이라 갈래가 다르다 (프로그램은 등록·수정이 전원, 보관은 원장인 것과 같다).
   */
  canDelete: boolean;
  onSaved: () => void;
}) {
  const { session } = useSession();
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [helperIds, setHelperIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setName(duty?.name ?? '');
    setNote(duty?.note ?? '');
    setOwnerId(duty?.owner_id ?? '');
    if (!duty) {
      setHelperIds([]);
      return;
    }
    void (async () => {
      const { data } = await supabase.from('duty_helpers').select('member_id').eq('duty_id', duty.id);
      setHelperIds((data ?? []).map((r: { member_id: string }) => r.member_id));
    })();
  }, [open, duty]);

  /** 주담당으로 고른 사람은 부담당에서 뺀다 */
  const pickOwner = (id: string) => {
    setOwnerId(id);
    setHelperIds((v) => v.filter((m) => m !== id));
  };

  const save = async () => {
    const n = name.trim();
    setError('');
    if (!n) {
      setError('역할 이름을 적어주세요.');
      return;
    }
    setBusy(true);
    try {
      let id = duty?.id ?? '';
      if (duty) {
        const { error: e } = await supabase
          .from('duties')
          .update({ name: n, note: note.trim() || null, owner_id: ownerId || null })
          .eq('id', duty.id);
        if (e) throw e;
      } else {
        // 맨 뒤로 붙인다
        const { data: sib } = await supabase.from('duties').select('sort_order').eq('group_id', groupId);
        const next = (sib ?? []).reduce((m: number, r: { sort_order: number }) => Math.max(m, r.sort_order), 0) + 1;
        const { data, error: e } = await supabase
          .from('duties')
          .insert({ group_id: groupId, name: n, note: note.trim() || null, owner_id: ownerId || null, sort_order: next })
          .select()
          .single();
        if (e) throw e;
        id = data.id;
      }

      // 부담당은 통째로 다시 쓴다 — 몇 명 안 되고, 지웠는지 더했는지 따질 이유가 없다
      const { error: dErr } = await supabase.from('duty_helpers').delete().eq('duty_id', id);
      if (dErr) throw dErr;
      const keep = helperIds.filter((m) => m !== ownerId);
      if (keep.length > 0) {
        const { error: hErr } = await supabase
          .from('duty_helpers')
          .insert(keep.map((member_id) => ({ duty_id: id, member_id })));
        if (hErr) throw hErr;
      }

      logActivity(session?.id, `역할 ${duty ? '수정' : '추가'} — ${groupLabel} › ${n}`, `duty:${id}`);
      onSaved();
      onClose();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!duty) return;
    setDeleting(false);
    setBusy(true);
    try {
      const { error: e } = await supabase.from('duties').delete().eq('id', duty.id);
      if (e) throw e;
      logActivity(session?.id, `역할 삭제 — ${groupLabel} › ${duty.name}`, 'org');
      onSaved();
      onClose();
    } catch (e) {
      setError(friendlyError(e, '지우지 못했어요.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={duty ? '역할 고치기' : '역할 추가'}
        footer={
          <button onClick={() => void save()} disabled={busy} className="btn-primary w-full">
            {busy ? '저장 중…' : '저장'}
          </button>
        }
      >
        <div className="space-y-3">
          <p className="rounded-lg bg-raised px-3 py-2 text-[12.5px] font-semibold text-neutral-500">
            {groupLabel}
          </p>

          <div>
            <label className="label" htmlFor="duty-name">
              역할 이름
            </label>
            <input
              id="duty-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="field"
              placeholder="예) 학교 제안서 작성·발송"
            />
          </div>

          <div>
            <label className="label" htmlFor="duty-note">
              무슨 일인가요
            </label>
            <textarea
              id="duty-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="field resize-none"
              placeholder="한 줄이면 충분해요. 안 적어도 됩니다."
            />
          </div>

          <div>
            <p className="label">주담당 — 한 명</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => pickOwner('')}
                aria-pressed={ownerId === ''}
                className={`tap rounded-full border px-3.5 text-[14px] font-semibold transition ${
                  ownerId === ''
                    ? 'border-neutral-400 bg-neutral-100 text-neutral-700'
                    : 'border-neutral-300 bg-surface text-neutral-400'
                }`}
              >
                미정
              </button>
              {members.map((m) => {
                const on = ownerId === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => pickOwner(m.id)}
                    aria-pressed={on}
                    className={`tap gap-1.5 rounded-full border px-3 text-[14px] font-semibold transition ${
                      on ? 'pick-on' : 'border-neutral-300 bg-surface text-neutral-600'
                    }`}
                  >
                    <Avatar name={m.name} size={20} />
                    {m.name}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11.5px] text-neutral-400">
              책임은 한 사람에게 지웁니다. 둘이 나눠 맡아야 하면 역할을 둘로 쪼개주세요.
            </p>
          </div>

          <div>
            <p className="label">부담당 — 같이 하는 사람</p>
            <MultiPicker
              options={members.filter((m) => m.id !== ownerId).map((m) => ({ id: m.id, name: m.name }))}
              selected={helperIds}
              onChange={setHelperIds}
            />
          </div>

          {error && <ErrorBanner message={error} />}

          {duty && canDelete && (
            <button
              onClick={() => setDeleting(true)}
              className="tap w-full gap-1.5 rounded-xl border border-neutral-300 text-[13.5px] font-bold text-neutral-500"
            >
              <Icon name="trash" size={14} />이 역할 지우기
            </button>
          )}
        </div>
      </Sheet>

      <ConfirmDialog
        open={deleting}
        title="이 역할을 지울까요?"
        message={`${duty?.name ?? ''} — 담당자 지정도 같이 사라져요.`}
        onCancel={() => setDeleting(false)}
        onConfirm={() => void remove()}
      />
    </>
  );
}
