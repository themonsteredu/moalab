'use client';

import { useEffect, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { logActivity } from '@/lib/log';
import { Icon } from '@/components/Icon';
import { DutyFiles } from '@/components/DutyFiles';
import { ConfirmDialog, ErrorBanner, Sheet } from '@/components/ui';
import type { Duty } from '@/lib/types';

interface LinkTarget {
  href: string;
  label: string;
}

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
  deptName,
  groupName,
  duty,
  canDelete,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** 새로 만들 때 들어갈 중분류 */
  groupId: string;
  /** '기획개발부 › 프로그램 기획' — 어디에 넣는지 보여준다 */
  groupLabel: string;
  /** 드라이브 폴더(`업무분장/{부서}/{중분류}`)를 정하는 데 쓴다 */
  deptName?: string;
  groupName?: string;
  /** null 이면 새로 만들기 */
  duty: Duty | null;
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
  /** 이 일로 바로 가는 곳 — 프로그램 페이지·원가표 주소 */
  const [link, setLink] = useState('');
  const [targets, setTargets] = useState<{ apps: LinkTarget[]; sheets: LinkTarget[] }>({ apps: [], sheets: [] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setName(duty?.name ?? '');
    setNote(duty?.note ?? '');
    setLink(duty?.link ?? '');
  }, [open, duty]);

  /* 바로가기로 걸 수 있는 것 — 프로그램과 원가표. 시트를 열 때 한 번만 읽는다.
     주소를 손으로 치게 하면 폰에서 아무도 안 건다 (출강 제목을 사람이 안 짓게 한 것과 같은 판단) */
  useEffect(() => {
    if (!open) return;
    void (async () => {
      const [a, c] = await Promise.all([
        supabase.from('apps').select('id,title_ko').order('title_ko'),
        supabase.from('cost_sheets').select('id,title').order('title'),
      ]);
      setTargets({
        apps: ((a.data ?? []) as { id: string; title_ko: string }[]).map((r) => ({
          href: `/apps/${r.id}`,
          label: r.title_ko,
        })),
        sheets: ((c.data ?? []) as { id: string; title: string }[]).map((r) => ({
          href: `/cost/${r.id}`,
          label: r.title,
        })),
      });
    })();
  }, [open]);

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
          /* owner_id·duty_helpers 는 **건드리지 않는다.** 역할은 부서(팀장)가 도맡고
             사람을 붙이지 않기로 했다 — 다만 지난 기록을 지울 이유는 없어서 남겨둔다
             (옛 `checks` 표를 기록 보존용으로 남긴 것과 같은 판단) */
          .update({ name: n, note: note.trim() || null, link: link || null })
          .eq('id', duty.id);
        if (e) throw e;
      } else {
        // 맨 뒤로 붙인다
        const { data: sib } = await supabase.from('duties').select('sort_order').eq('group_id', groupId);
        const next = (sib ?? []).reduce((m: number, r: { sort_order: number }) => Math.max(m, r.sort_order), 0) + 1;
        const { data, error: e } = await supabase
          .from('duties')
          .insert({
            group_id: groupId,
            name: n,
            note: note.trim() || null,
            link: link || null,
            sort_order: next,
          })
          .select()
          .single();
        if (e) throw e;
        id = data.id;
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

          {/* 이 일로 바로 가는 곳 — 원장이 "계획안이나 원가계산은 부서가 나뉘었으니
              거기로 이동해야 해" 라고 한 것. **자료를 옮기는 게 아니라 길만 낸다.**
              주소를 손으로 치게 하면 폰에서 아무도 안 건다 → 목록에서 고른다 */}
          <div>
            <label className="label" htmlFor="duty-link">
              이 일로 바로 가기 <span className="font-normal text-neutral-400">(선택)</span>
            </label>
            <select
              id="duty-link"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              className="field"
            >
              <option value="">안 걸기</option>
              {targets.apps.length > 0 && (
                <optgroup label="프로그램">
                  {targets.apps.map((t) => (
                    <option key={t.href} value={t.href}>
                      {t.label}
                    </option>
                  ))}
                </optgroup>
              )}
              {targets.sheets.length > 0 && (
                <optgroup label="원가표">
                  {targets.sheets.map((t) => (
                    <option key={t.href} value={t.href}>
                      {t.label}
                    </option>
                  ))}
                </optgroup>
              )}
              {/* 목록에 없는 옛 값도 지워지지 않게 남긴다 */}
              {link && ![...targets.apps, ...targets.sheets].some((t) => t.href === link) && (
                <option value={link}>{link}</option>
              )}
            </select>
            <p className="mt-1 text-[11.5px] text-neutral-400">
              걸어두면 역할 옆에 바로가기가 생겨요. 자료는 그대로 원래 자리에 있습니다.
            </p>
          </div>

          {/* 이 일을 해서 만든 결과물 — **이미 만들어진 역할일 때만.**
              새로 만드는 중에는 붙일 id 가 없다 (저장하면 그때 칸이 생긴다)

              ⚠️ **담당자 칸보다 위다.** 이 시트를 여는 이유는 대개 자료를 올리는
              것인데 맨 아래 있으면 스크롤을 내려야 나온다. 담당자는 한 번 정하면
              오래 가고 자료는 계속 쌓이니, 자주 하는 것이 위로 온다 */}
          {duty && (
            <div className="border-y border-neutral-200 py-3">
              <DutyFiles
                dutyId={duty.id}
                dutyName={duty.name}
                deptName={deptName ?? groupLabel.split('›')[0].trim()}
                groupName={groupName ?? groupLabel.split('›').pop()!.trim()}
              />
            </div>
          )}

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
