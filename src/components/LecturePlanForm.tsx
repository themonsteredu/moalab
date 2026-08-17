'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { uploadFile } from '@/lib/upload';
import { logActivity } from '@/lib/log';
import { ConfirmDialog, ErrorBanner, Sheet, useToast } from '@/components/ui';
import { Icon } from '@/components/Icon';
import {
  LECTURE_BADGE,
  LECTURE_CLOSING,
  LECTURE_DEV_TITLE,
  LECTURE_TOOLS,
  LECTURE_WORK_TITLE,
  lectureIntroText,
} from '@/lib/lecture';
import type { LecturePlanItem, LecturePlanRow } from '@/lib/types';

/**
 * 강의계획서 작성 — 여기 채운 순서 그대로 `/print/lecture/[id]` 한 장 서식에 실린다.
 *
 * 글 칸은 `moalab.lesson_plans` 한 행(프로그램당 1개), 이미지 칸은
 * `moalab.lesson_plan_items` (slot: step = [AI 웹앱활동] / work = [활동작품]).
 *
 * - 글 저장은 **명시적 저장 버튼** 하나로 (자동저장 금지).
 * - 이미지는 올리는 즉시 저장되고, 설명은 이미지를 눌러 따로 적는다 (샘플 이미지와 같은 방식).
 * - 처음 열면 도입·마무리 같은 공통 멘트가 기본으로 채워져 있어 목표만 쓰면 된다.
 */
export function LecturePlanForm({ appId, appSlug }: { appId: string; appSlug: string }) {
  const { session } = useSession();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  /** DB 에 행이 이미 있는지 — 안내 문구용 */
  const [exists, setExists] = useState(false);

  const [category, setCategory] = useState(LECTURE_BADGE);
  const [goal, setGoal] = useState('');
  const [intro, setIntro] = useState(lectureIntroText());
  const [devTitle, setDevTitle] = useState(LECTURE_DEV_TITLE);
  const [workTitle, setWorkTitle] = useState(LECTURE_WORK_TITLE);
  const [closing, setClosing] = useState(LECTURE_CLOSING);
  const [tools, setTools] = useState(LECTURE_TOOLS);
  const [etc, setEtc] = useState('');

  const [items, setItems] = useState<LecturePlanItem[]>([]);
  const [uploading, setUploading] = useState('');
  const [viewing, setViewing] = useState<LecturePlanItem | null>(null);
  const [label, setLabel] = useState('');
  const [deleting, setDeleting] = useState<LecturePlanItem | null>(null);
  const stepInputRef = useRef<HTMLInputElement>(null);
  const workInputRef = useRef<HTMLInputElement>(null);

  const loadItems = useCallback(async () => {
    const { data } = await supabase
      .from('lesson_plan_items')
      .select('*')
      .eq('app_id', appId)
      .order('slot')
      .order('sort_order');
    setItems(((data ?? []) as LecturePlanItem[]).filter((i) => i.url));
  }, [appId]);

  useEffect(() => {
    void (async () => {
      try {
        const [{ data: p, error: pErr }] = await Promise.all([
          supabase.from('lesson_plans').select('*').eq('app_id', appId).maybeSingle(),
          loadItems(),
        ]);
        if (pErr) throw pErr;
        if (p) {
          const row = p as LecturePlanRow;
          setExists(true);
          setCategory(row.category ?? LECTURE_BADGE);
          setGoal(row.goal ?? '');
          setIntro(row.intro ?? lectureIntroText());
          setDevTitle(row.dev_title ?? LECTURE_DEV_TITLE);
          setWorkTitle(row.work_title ?? LECTURE_WORK_TITLE);
          setClosing(row.closing ?? LECTURE_CLOSING);
          setTools(row.tools ?? LECTURE_TOOLS);
          setEtc(row.etc ?? '');
        }
      } catch (e) {
        setError(friendlyError(e, '강의계획서를 불러오지 못했어요.'));
      } finally {
        setLoading(false);
      }
    })();
  }, [appId, loadItems]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const { error: e } = await supabase.from('lesson_plans').upsert({
        app_id: appId,
        category: category.trim() || null,
        goal: goal.trim() || null,
        intro: intro.trim() || null,
        dev_title: devTitle.trim() || null,
        work_title: workTitle.trim() || null,
        closing: closing.trim() || null,
        tools: tools.trim() || null,
        etc: etc.trim() || null,
        updated_by: session?.id ?? null,
        updated_at: new Date().toISOString(),
      });
      if (e) throw e;
      setExists(true);
      logActivity(session?.id, `${appSlug} 강의계획서 저장`, `app:${appId}`);
      toast.show('강의계획서를 저장했어요.');
    } catch (e) {
      setError(friendlyError(e, '저장하지 못했어요. 다시 눌러주세요.'));
    } finally {
      setSaving(false);
    }
  };

  const onFiles = async (slot: 'step' | 'work', picked: File[]) => {
    if (picked.length === 0) return;
    setError('');
    const base = items.filter((i) => i.slot === slot).length;
    let ok = 0;
    for (let i = 0; i < picked.length; i++) {
      setUploading(`올리는 중… ${i + 1}/${picked.length}`);
      try {
        const up = await uploadFile('moalab-plans', picked[i], `plan-${appId}`);
        const { error: e } = await supabase
          .from('lesson_plan_items')
          .insert({ app_id: appId, slot, url: up.url, sort_order: base + i });
        if (e) throw e;
        ok++;
      } catch (e) {
        setError(friendlyError(e, `${i + 1}번째 사진을 올리지 못했어요.`));
      }
    }
    setUploading('');
    if (stepInputRef.current) stepInputRef.current.value = '';
    if (workInputRef.current) workInputRef.current.value = '';
    if (ok > 0) {
      logActivity(session?.id, `${appSlug} 강의계획서 사진 ${ok}장 추가`, `app:${appId}`);
      await loadItems();
    }
  };

  const saveLabel = async () => {
    if (!viewing) return;
    const { error: e } = await supabase
      .from('lesson_plan_items')
      .update({ label: label.trim() || null })
      .eq('id', viewing.id);
    if (e) {
      setError(friendlyError(e));
      return;
    }
    setItems((v) => v.map((x) => (x.id === viewing.id ? { ...x, label: label.trim() || null } : x)));
    setViewing(null);
  };

  const removeItem = async (it: LecturePlanItem) => {
    setDeleting(null);
    setViewing(null);
    const { error: e } = await supabase.from('lesson_plan_items').delete().eq('id', it.id);
    if (e) {
      setError(friendlyError(e, '삭제하지 못했어요. 다시 눌러주세요.'));
      return;
    }
    await loadItems();
  };

  if (loading) {
    return <div className="skeleton h-40 w-full rounded-xl" />;
  }

  const grid = (slot: 'step' | 'work', inputRef: React.RefObject<HTMLInputElement>) => {
    const list = items.filter((i) => i.slot === slot);
    const inputId = `lecture-${slot}-${appId}`;
    return (
      <>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => void onFiles(slot, Array.from(e.target.files ?? []))}
          className="hidden"
        />
        <div className="grid grid-cols-3 gap-1.5">
          {list.map((it, i) => (
            <button
              key={it.id}
              onClick={() => {
                setViewing(it);
                setLabel(it.label ?? '');
              }}
              className="relative aspect-square overflow-hidden rounded-lg bg-neutral-100"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.url ?? ''} alt={it.label ?? ''} loading="lazy" className="h-full w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-3 text-left text-[10px] text-white">
                {it.label || `${i + 1}. 설명을 적어주세요`}
              </span>
            </button>
          ))}
          <label
            htmlFor={inputId}
            className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg
                       border border-dashed border-neutral-300 text-neutral-400"
          >
            <span className="text-xl leading-none">＋</span>
            <span className="mt-0.5 text-[10.5px]">{slot === 'step' ? '활동 화면' : '작품 사진'}</span>
          </label>
        </div>
      </>
    );
  };

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}

      <p className="rounded-lg bg-raised px-3 py-2 text-[12.5px] leading-relaxed text-neutral-500">
        여기 채운 순서 그대로 A4 강의계획서로 인쇄돼요. 위쪽 <b>인쇄 / PDF 저장</b> 에서 확인하세요.
        {!exists && ' 도입·마무리 같은 공통 멘트는 미리 채워뒀어요 — 목표부터 쓰면 됩니다.'}
      </p>

      <div>
        <label className="label" htmlFor="lecture-category">
          분류 (제목 오른쪽 배지)
        </label>
        <input
          id="lecture-category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder={LECTURE_BADGE}
          className="field"
        />
      </div>

      <div>
        <label className="label" htmlFor="lecture-goal">
          목표
        </label>
        <textarea
          id="lecture-goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={5}
          placeholder={'1. 이 수업에서 학생이 무엇을 경험하는지\n2. 무엇을 익히는지 적어주세요'}
          className="field resize-none leading-relaxed"
        />
      </div>

      <div>
        <label className="label" htmlFor="lecture-intro">
          도입
        </label>
        <textarea
          id="lecture-intro"
          value={intro}
          onChange={(e) => setIntro(e.target.value)}
          rows={4}
          className="field resize-none leading-relaxed"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="label mb-0" htmlFor="lecture-dev-title">
            전개 — 활동 화면
          </label>
          <input
            id="lecture-dev-title"
            value={devTitle}
            onChange={(e) => setDevTitle(e.target.value)}
            className="field h-9 max-w-[170px] text-[12.5px]"
            aria-label="전개 첫 블록 제목"
          />
        </div>
        {grid('step', stepInputRef)}
        <p className="text-[11.5px] leading-relaxed text-neutral-400">
          웹앱 화면을 올리고 사진을 눌러 설명을 적으면, 인쇄물에 번호 붙은 활동 안내로 실려요.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="label mb-0" htmlFor="lecture-work-title">
            전개 — 활동작품
          </label>
          <input
            id="lecture-work-title"
            value={workTitle}
            onChange={(e) => setWorkTitle(e.target.value)}
            className="field h-9 max-w-[170px] text-[12.5px]"
            aria-label="전개 둘째 블록 제목"
          />
        </div>
        {grid('work', workInputRef)}
        <p className="text-[11.5px] leading-relaxed text-neutral-400">
          작품 사진이 없으면 인쇄물에서 이 블록은 통째로 빠져요.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="lecture-closing">
          마무리
        </label>
        <textarea
          id="lecture-closing"
          value={closing}
          onChange={(e) => setClosing(e.target.value)}
          rows={2}
          className="field resize-none leading-relaxed"
        />
      </div>

      <div>
        <label className="label" htmlFor="lecture-tools">
          교구
        </label>
        <input id="lecture-tools" value={tools} onChange={(e) => setTools(e.target.value)} className="field" />
      </div>

      <div>
        <label className="label" htmlFor="lecture-etc">
          기타사항
        </label>
        <input
          id="lecture-etc"
          value={etc}
          onChange={(e) => setEtc(e.target.value)}
          placeholder="비워두면 인쇄물에 빈 칸으로 나가요"
          className="field"
        />
      </div>

      {uploading && <p className="text-[12.5px] text-neutral-500">{uploading}</p>}

      <button onClick={save} disabled={saving} className="btn-primary w-full">
        {saving ? '저장하는 중…' : '강의계획서 저장'}
      </button>

      <Sheet
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        title="사진 설명"
        footer={
          <button onClick={saveLabel} className="btn-primary w-full">
            저장
          </button>
        }
      >
        {viewing && (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl bg-neutral-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={viewing.url ?? ''} alt={viewing.label ?? ''} className="max-h-[46vh] w-full object-contain" />
            </div>
            <div>
              <label className="label" htmlFor="lecture-item-label">
                설명 (인쇄물에 번호와 함께 실려요)
              </label>
              <input
                id="lecture-item-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="드론 조종 훈련 — 시동·이륙·착륙을 연습합니다"
                className="field"
              />
            </div>
            <button onClick={() => setDeleting(viewing)} className="btn-ghost w-full text-red-600">
              <Icon name="trash" size={14} />
              이 사진 삭제
            </button>
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="이 사진을 지울까요?"
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && removeItem(deleting)}
      />

      {toast.node}
    </div>
  );
}
