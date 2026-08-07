'use client';

import { useEffect, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { logActivity } from '@/lib/log';
import { ensureChecks, getCurrentRound, openFirstRound, recomputeAppStatus } from '@/lib/verify';
import { ErrorBanner, MultiPicker, Sheet } from '@/components/ui';
import type { AppRow } from '@/lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (appId: string) => void;
  /** 있으면 수정 모드 */
  editing?: { app: AppRow; reviewerIds: string[] } | null;
}

/**
 * 앱 추가/수정 폼.
 * 새 앱을 저장하면 1차 라운드 + (검증자 × 5) 체크 레코드가 자동으로 만들어진다.
 * 코드를 고치지 않고 화면에서만 앱을 계속 늘릴 수 있어야 한다는 게 이 폼의 존재 이유다.
 */
export function AppForm({ open, onClose, onSaved, editing }: Props) {
  const { session } = useSession();
  const { members } = useMembers();

  const [slug, setSlug] = useState('');
  const [titleKo, setTitleKo] = useState('');
  const [url, setUrl] = useState('');
  const [purpose, setPurpose] = useState('');
  const [grade, setGrade] = useState('');
  const [creatorId, setCreatorId] = useState('');
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    if (editing) {
      setSlug(editing.app.slug);
      setTitleKo(editing.app.title_ko);
      setUrl(editing.app.url ?? '');
      setPurpose(editing.app.purpose ?? '');
      setGrade(editing.app.target_grade ?? '');
      setCreatorId(editing.app.creator_id ?? '');
      setReviewerIds(editing.reviewerIds);
      setDueDate(editing.app.due_date ?? '');
    } else {
      setSlug('');
      setTitleKo('');
      setUrl('');
      setPurpose('');
      setGrade('');
      setCreatorId('');
      setReviewerIds([]);
      setDueDate('');
    }
  }, [open, editing]);

  const save = async () => {
    setError('');
    const s = slug.trim().toLowerCase();
    if (!s) return setError('앱 이름(영문)을 입력해주세요.');
    if (!/^[a-z0-9-]+$/.test(s)) return setError('앱 이름은 영문 소문자·숫자·하이픈만 쓸 수 있어요.');
    if (!titleKo.trim()) return setError('한글 표시명을 입력해주세요.');
    if (!creatorId) return setError('제작자를 골라주세요.');
    if (reviewerIds.length === 0) return setError('검증자를 최소 1명 골라주세요.');
    if (url.trim() && !/^https?:\/\//i.test(url.trim()))
      return setError('배포 링크는 http:// 또는 https:// 로 시작해야 해요.');

    setBusy(true);
    try {
      const payload = {
        slug: s,
        title_ko: titleKo.trim(),
        url: url.trim() || null,
        purpose: purpose.trim() || null,
        target_grade: grade.trim() || null,
        creator_id: creatorId,
        due_date: dueDate || null,
      };

      if (editing) {
        const { error: upErr } = await supabase.from('apps').update(payload).eq('id', editing.app.id);
        if (upErr) throw upErr;

        // 검증자 변경분 반영
        const removed = editing.reviewerIds.filter((id) => !reviewerIds.includes(id));
        const added = reviewerIds.filter((id) => !editing.reviewerIds.includes(id));
        if (removed.length > 0) {
          await supabase.from('app_reviewers').delete().eq('app_id', editing.app.id).in('member_id', removed);
        }
        if (added.length > 0) {
          await supabase
            .from('app_reviewers')
            .insert(added.map((member_id) => ({ app_id: editing.app.id, member_id })));
        }
        // 새로 들어온 검증자에게는 현재 라운드의 빈 체크를 만들어준다
        const round = await getCurrentRound(editing.app.id);
        if (round) {
          if (added.length > 0) await ensureChecks(round.id, added);
          if (removed.length > 0) {
            await supabase.from('checks').delete().eq('round_id', round.id).in('member_id', removed);
          }
        }
        await recomputeAppStatus(editing.app.id);
        logActivity(session?.id, `${s} 앱 정보 수정`, `app:${editing.app.id}`);
        onSaved(editing.app.id);
      } else {
        const { data: app, error: insErr } = await supabase.from('apps').insert(payload).select().single();
        if (insErr) throw insErr;

        await supabase
          .from('app_reviewers')
          .insert(reviewerIds.map((member_id) => ({ app_id: app.id, member_id })));
        await openFirstRound(app.id, reviewerIds);

        logActivity(session?.id, `${s} 앱 등록 — 1차 검증 시작`, `app:${app.id}`);
        onSaved(app.id);
      }
      onClose();
    } catch (e) {
      setError(friendlyError(e, '저장이 안 됐어요. 다시 눌러주세요.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? '앱 정보 수정' : '새 앱 추가'}
      footer={
        <button onClick={save} disabled={busy} className="btn-primary w-full">
          {busy ? '저장 중…' : editing ? '수정 저장' : '저장하고 1차 검증 시작'}
        </button>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}

        <div>
          <label className="label" htmlFor="f-slug">
            앱 이름 (영문)
          </label>
          <input
            id="f-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="ai-bakery"
            className="field"
            autoCapitalize="none"
            autoCorrect="off"
          />
        </div>

        <div>
          <label className="label" htmlFor="f-title">
            한글 표시명
          </label>
          <input
            id="f-title"
            value={titleKo}
            onChange={(e) => setTitleKo(e.target.value)}
            placeholder="제과제빵"
            className="field"
          />
        </div>

        <div>
          <label className="label" htmlFor="f-url">
            배포 링크
          </label>
          <input
            id="f-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            inputMode="url"
            className="field"
            autoCapitalize="none"
          />
        </div>

        <div>
          <label className="label" htmlFor="f-purpose">
            제작 목적
          </label>
          <textarea
            id="f-purpose"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            rows={4}
            placeholder="이 앱으로 학생들이 무엇을 하게 되나요?"
            className="field resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="f-grade">
              대상 학년
            </label>
            <input
              id="f-grade"
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              placeholder="초3~4"
              className="field"
            />
          </div>
          <div>
            <label className="label" htmlFor="f-due">
              마감일
            </label>
            <input
              id="f-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="field"
            />
          </div>
        </div>

        <div>
          <span className="label">제작자 (1명)</span>
          <div className="flex flex-wrap gap-2">
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setCreatorId(m.id === creatorId ? '' : m.id)}
                className={`tap rounded-full border px-3.5 text-[14px] font-semibold transition ${
                  creatorId === m.id
                    ? 'border-brand bg-brand text-white'
                    : 'border-neutral-300 bg-surface text-neutral-600'
                }`}
              >
                {m.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="label">검증자 (1~3명)</span>
          <MultiPicker options={members} selected={reviewerIds} onChange={setReviewerIds} max={3} />
          <p className="mt-2 text-[12px] text-neutral-500">
            고른 사람 수 × 5개 항목만큼 체크 칸이 자동으로 만들어져요.
          </p>
        </div>
      </div>
    </Sheet>
  );
}
