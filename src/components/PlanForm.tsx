'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { queueDrive, uploadBlob, uploadFile } from '@/lib/upload';
import { logActivity } from '@/lib/log';
import { ConfirmDialog, ErrorBanner } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { relTime } from '@/lib/format';
import { downloadPlanHwpx } from '@/lib/hwpx';
import type { LessonPlan, LessonPlanItem, PlanSlot } from '@/lib/types';

/**
 * 강의계획서 — 원장이 준 한글 양식 그대로 채우는 칸.
 *
 * 한글 파일을 열어 타이핑하고 다시 올리는 왕복을 없애려고 만들었다.
 * **화면 구성이 곧 인쇄물 구성이다** — 위에서 아래로 채우면 그 순서 그대로 A4 로 나간다.
 * 인쇄 쪽 그림은 /print/[id] 에 있고, 칸 이름과 순서를 여기와 똑같이 맞춰야 한다.
 *
 * 저장은 자동이 아니라 **저장 버튼**이다 (강사가 잘못 눌렀다 날리면 안 된다).
 * 다만 사진은 올리는 즉시 그 줄만 저장된다 — 사진을 고른 뒤 저장을 안 눌러
 * 업로드가 날아가는 게 더 나쁘다.
 */

const SLOT_META: Record<PlanSlot, { title: string; add: string; hint: string }> = {
  step: {
    title: '',
    add: '활동 추가',
    hint: '예) VR 문화유산 탐방 미션 안내',
  },
  order: {
    title: '만드는 순서',
    add: '순서 추가',
    hint: '예) 색지를 반으로 접어요',
  },
  result: {
    title: '결과 이미지',
    add: '이미지 추가',
    hint: '예) 완성한 작품',
  },
};

export function PlanForm({
  appId,
  appSlug,
  appTitle,
  topic,
  nameOf,
}: {
  appId: string;
  appSlug: string;
  appTitle: string;
  /** 구글 드라이브에 넣을 때 `프로그램/{주제}/{이름}` 으로 묶는다 */
  topic?: string | null;
  nameOf: (id: string | null) => string;
}) {
  const { session } = useSession();
  const [plan, setPlan] = useState<LessonPlan | null>(null);
  const [items, setItems] = useState<LessonPlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<LessonPlanItem | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [hwpBusy, setHwpBusy] = useState(false);
  const [hwpNote, setHwpNote] = useState('');
  const logoRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [p, it] = await Promise.all([
        supabase.from('lesson_plans').select('*').eq('app_id', appId).maybeSingle(),
        supabase.from('lesson_plan_items').select('*').eq('app_id', appId).order('sort_order'),
      ]);
      if (p.error) throw p.error;
      if (it.error) throw it.error;
      setPlan((p.data as LessonPlan) ?? null);
      setItems((it.data ?? []) as LessonPlanItem[]);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 아직 한 번도 안 쓴 프로그램 — DB 기본값으로 첫 줄을 만든다 */
  const start = async () => {
    setSaving(true);
    setError('');
    try {
      const { data, error: e } = await supabase
        .from('lesson_plans')
        .insert({ app_id: appId, updated_by: session?.id ?? null })
        .select()
        .single();
      if (e) throw e;
      setPlan(data as LessonPlan);
      logActivity(session?.id, `${appSlug} 강의계획서 시작`, `app:${appId}`);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof LessonPlan>(k: K, v: LessonPlan[K]) =>
    setPlan((p) => (p ? { ...p, [k]: v } : p));

  const save = async () => {
    if (!plan) return;
    setSaving(true);
    setError('');
    setSaved('');
    try {
      const { error: e } = await supabase
        .from('lesson_plans')
        .update({
          category: plan.category.trim() || '진로직업체험',
          goal: plan.goal,
          intro: plan.intro,
          dev_title: plan.dev_title.trim() || '[AI 웹앱활동]',
          work_title: plan.work_title.trim() || '[활동작품]',
          closing: plan.closing,
          tools: plan.tools,
          etc: plan.etc,
          updated_by: session?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('app_id', appId);
      if (e) throw e;
      logActivity(session?.id, `${appSlug} 강의계획서 저장`, `app:${appId}`);
      setSaved('저장했어요');
      setTimeout(() => setSaved(''), 2500);
      await load();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------------------------------------------ 항목 */

  const addItem = async (slot: PlanSlot) => {
    setError('');
    const next = items.filter((i) => i.slot === slot).length;
    try {
      const { data, error: e } = await supabase
        .from('lesson_plan_items')
        .insert({ app_id: appId, slot, sort_order: next })
        .select()
        .single();
      if (e) throw e;
      setItems((v) => [...v, data as LessonPlanItem]);
    } catch (e) {
      setError(friendlyError(e));
    }
  };

  /** 글은 타이핑이 끝나면(blur) 그 줄만 저장한다 — 줄마다 저장 버튼을 두면 화면이 버튼 밭이 된다 */
  const saveLabel = async (item: LessonPlanItem, label: string) => {
    if ((item.label ?? '') === label) return;
    setItems((v) => v.map((i) => (i.id === item.id ? { ...i, label } : i)));
    const { error: e } = await supabase
      .from('lesson_plan_items')
      .update({ label: label || null })
      .eq('id', item.id);
    if (e) setError(friendlyError(e));
  };

  /** 사진은 고르는 즉시 올리고 그 줄만 저장한다 */
  const pickImage = async (item: LessonPlanItem, file: File | undefined) => {
    if (!file) return;
    setError('');
    setBusyItem(item.id);
    try {
      const up = await uploadFile('moalab-plans', file, `plan-${appId}`);
      const { error: e } = await supabase
        .from('lesson_plan_items')
        .update({ url: up.url })
        .eq('id', item.id);
      if (e) throw e;
      setItems((v) => v.map((i) => (i.id === item.id ? { ...i, url: up.url } : i)));
      logActivity(session?.id, `${appSlug} 강의계획서 사진 추가`, `app:${appId}`);
    } catch (e) {
      setError(friendlyError(e, '사진을 올리지 못했어요.'));
    } finally {
      setBusyItem(null);
    }
  };

  const removeItem = async (item: LessonPlanItem) => {
    setDeleting(null);
    const { error: e } = await supabase.from('lesson_plan_items').delete().eq('id', item.id);
    if (e) {
      setError(friendlyError(e));
      return;
    }
    setItems((v) => v.filter((i) => i.id !== item.id));
  };

  const move = async (item: LessonPlanItem, dir: -1 | 1) => {
    const row = items.filter((i) => i.slot === item.slot);
    const at = row.findIndex((i) => i.id === item.id);
    const to = at + dir;
    if (to < 0 || to >= row.length) return;
    const reordered = [...row];
    [reordered[at], reordered[to]] = [reordered[to], reordered[at]];
    setItems((v) => [
      ...v.filter((i) => i.slot !== item.slot),
      ...reordered.map((i, n) => ({ ...i, sort_order: n })),
    ]);
    await Promise.all(
      reordered.map((i, n) =>
        supabase.from('lesson_plan_items').update({ sort_order: n }).eq('id', i.id),
      ),
    );
  };

  /* -------------------------------------------------------------- 로고 */

  const pickLogo = async (file: File | undefined) => {
    if (!file || !plan) return;
    setError('');
    setLogoBusy(true);
    try {
      const up = await uploadFile('moalab-plans', file, `plan-logo-${appId}`);
      const { error: e } = await supabase
        .from('lesson_plans')
        .update({ logo_url: up.url })
        .eq('app_id', appId);
      if (e) throw e;
      set('logo_url', up.url);
      logActivity(session?.id, `${appSlug} 강의계획서 로고 변경`, `app:${appId}`);
    } catch (e) {
      setError(friendlyError(e, '로고를 올리지 못했어요.'));
    } finally {
      setLogoBusy(false);
      if (logoRef.current) logoRef.current.value = '';
    }
  };

  const clearLogo = async () => {
    if (!plan) return;
    const { error: e } = await supabase
      .from('lesson_plans')
      .update({ logo_url: null })
      .eq('app_id', appId);
    if (e) {
      setError(friendlyError(e));
      return;
    }
    set('logo_url', null);
  };

  /* -------------------------------------------------------------- 화면 */

  if (loading) return <div className="skeleton h-24 w-full" />;

  if (!plan) {
    return (
      <div className="space-y-3">
        {error && <ErrorBanner message={error} onRetry={() => void load()} />}
        <div className="rounded-xl border border-dashed border-neutral-300 bg-raised px-4 py-7 text-center">
          <Icon name="doc" size={22} className="mx-auto text-neutral-300" />
          <p className="mt-1.5 text-[13.5px] font-semibold text-neutral-600">
            강의계획서를 아직 안 만들었어요
          </p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-neutral-400">
            한글 양식 그대로 채우고 그대로 인쇄할 수 있어요.
            <br />
            도입·마무리는 늘 쓰는 문구가 미리 들어가 있어요.
          </p>
          <button onClick={() => void start()} disabled={saving} className="btn-primary mt-3 px-4">
            <Icon name="plus" size={15} />
            {saving ? '만드는 중…' : '강의계획서 만들기'}
          </button>
        </div>
      </div>
    );
  }

  /** 한글 파일로 내려받기 — 사진을 다 받아 넣어야 해서 조금 걸린다 */
  const downloadHwp = async () => {
    if (!plan) return;
    setHwpBusy(true);
    setHwpNote('');
    try {
      const { skipped, blob, fileName } = await downloadPlanHwpx(plan, items, appTitle);
      setHwpNote(
        skipped > 0
          ? `받았어요. 사진 ${skipped}장은 못 넣었어요 — 다시 눌러보세요.`
          : '받았어요. 한글에서 열어 [다른 이름으로 저장 → hwp] 하면 hwp 가 돼요.',
      );
      logActivity(session?.id, `${appSlug} 강의계획서 한글파일 받기`, `app:${appId}`);

      /* 구글 드라이브에도 한 벌 — 학교에 낼 파일이라 원장이 PC 에서 바로 꺼내 쓴다.
         **받는 것은 이미 끝났다.** 여기서 실패해도 화면에는 아무 일도 안 일어난다 */
      void (async () => {
        try {
          const up = await uploadBlob('moalab-plans', blob, fileName, `app-${appId}`);
          queueDrive(session?.id, session?.token, {
            kind: 'lecture',
            files: [{ url: up.url, name: fileName, mime: 'application/hwp+zip' }],
            topic,
            appTitle,
          });
        } catch {
          /* 드라이브 복사는 덤이다 — 실패해도 원장은 이미 파일을 받았다 */
        }
      })();
    } catch (e) {
      setHwpNote('');
      setError(friendlyError(e, '한글 파일을 만들지 못했어요.'));
    } finally {
      setHwpBusy(false);
    }
  };

  const bySlot = (s: PlanSlot) =>
    items.filter((i) => i.slot === s).sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="space-y-3.5">
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {/* 미리보기 안내 — 이 순서가 곧 인쇄물 순서다 */}
      <p className="rounded-lg bg-raised px-3 py-2 text-[11.5px] leading-relaxed text-neutral-500">
        여기 채운 순서 그대로 A4 강의계획서로 인쇄돼요. 위쪽 <b>인쇄 / PDF 저장</b> 에서 확인하세요.
      </p>

      {/* 한글 파일로 받기 — 학교·기관에 hwp 로 내야 할 때.
          .hwp(독점 바이너리)는 브라우저에서 만들 수 없어서 국가표준인 .hwpx 로 준다.
          한글에서 열어 '다른 이름으로 저장 → hwp' 하면 hwp 가 된다. */}
      <div>
        <button
          onClick={() => void downloadHwp()}
          disabled={hwpBusy}
          className="btn-ghost h-11 w-full text-[13px]"
        >
          <Icon name="download" size={15} />
          {hwpBusy ? '한글 파일 만드는 중…' : '한글 파일(.hwpx)로 받기'}
        </button>
        <p className="mt-1.5 text-center text-[11px] leading-relaxed text-neutral-400">
          {hwpNote || '한글 2014 이상에서 열려요. hwp 로 내려면 한글에서 [다른 이름으로 저장] 하세요.'}
        </p>
      </div>

      <Field label="분류 (제목 오른쪽 배지)">
        <input
          value={plan.category}
          onChange={(e) => set('category', e.target.value)}
          placeholder="진로직업체험"
          className="field"
        />
      </Field>

      <Field label="목표">
        <textarea
          value={plan.goal ?? ''}
          onChange={(e) => set('goal', e.target.value)}
          rows={3}
          placeholder="이 수업으로 무엇을 할 수 있게 되나요?"
          className="field resize-none"
        />
      </Field>

      <Field label="도입">
        <textarea
          value={plan.intro ?? ''}
          onChange={(e) => set('intro', e.target.value)}
          rows={5}
          className="field resize-none"
        />
      </Field>

      {/* ----------------------------------------------------- 전개 */}
      <div className="rounded-xl border border-neutral-200 bg-raised p-3">
        <p className="text-[12px] font-bold text-brand-700">전개</p>

        <div className="mt-2">
          <input
            value={plan.dev_title}
            onChange={(e) => set('dev_title', e.target.value)}
            placeholder="[AI 웹앱활동]"
            className="field font-bold"
            aria-label="웹앱활동 제목"
          />
          <ItemRows
            rows={bySlot('step')}
            slot="step"
            busyItem={busyItem}
            numbered
            onLabel={saveLabel}
            onImage={pickImage}
            onDelete={setDeleting}
            onMove={move}
            onAdd={() => void addItem('step')}
          />
        </div>

        <div className="mt-3.5 border-t border-neutral-200 pt-3">
          <input
            value={plan.work_title}
            onChange={(e) => set('work_title', e.target.value)}
            placeholder="[활동작품]"
            className="field font-bold"
            aria-label="활동작품 제목"
          />
          <p className="mt-2.5 text-[11.5px] font-bold text-neutral-500">* 만드는 순서</p>
          <ItemRows
            rows={bySlot('order')}
            slot="order"
            busyItem={busyItem}
            onLabel={saveLabel}
            onImage={pickImage}
            onDelete={setDeleting}
            onMove={move}
            onAdd={() => void addItem('order')}
          />
          <p className="mt-3 text-[11.5px] font-bold text-neutral-500">* 결과 이미지</p>
          <ItemRows
            rows={bySlot('result')}
            slot="result"
            busyItem={busyItem}
            onLabel={saveLabel}
            onImage={pickImage}
            onDelete={setDeleting}
            onMove={move}
            onAdd={() => void addItem('result')}
          />
        </div>
      </div>

      <Field label="마무리">
        <textarea
          value={plan.closing ?? ''}
          onChange={(e) => set('closing', e.target.value)}
          rows={2}
          className="field resize-none"
        />
      </Field>

      <div className="rounded-xl border border-neutral-200 bg-raised p-3">
        <p className="text-[12px] font-bold text-brand-700">운영사항</p>
        <div className="mt-2 space-y-2.5">
          <Field label="교구">
            <textarea
              value={plan.tools ?? ''}
              onChange={(e) => set('tools', e.target.value)}
              rows={2}
              placeholder="예) 태블릿 20대, 색지, 가위"
              className="field resize-none"
            />
          </Field>
          <Field label="기타사항">
            <textarea
              value={plan.etc ?? ''}
              onChange={(e) => set('etc', e.target.value)}
              rows={2}
              className="field resize-none"
            />
          </Field>
        </div>
      </div>

      {/* ---------------------------------------------------- 로고 */}
      <Field label="맨 아래 로고">
        <input
          ref={logoRef}
          id={`plan-logo-${appId}`}
          type="file"
          accept="image/*"
          onChange={(e) => void pickLogo(e.target.files?.[0])}
          className="hidden"
        />
        {plan.logo_url ? (
          <div className="flex items-center gap-2.5 rounded-xl border border-neutral-200 bg-surface p-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={plan.logo_url} alt="로고" className="h-9 max-w-[55%] object-contain" />
            <label
              htmlFor={`plan-logo-${appId}`}
              className="btn-ghost ml-auto h-9 cursor-pointer px-3 text-[12.5px]"
            >
              <Icon name="refresh" size={14} />
              {logoBusy ? '올리는 중…' : '바꾸기'}
            </label>
            <button onClick={() => void clearLogo()} className="tap w-8 text-neutral-300 hover:text-red-500">
              <Icon name="close" size={14} />
            </button>
          </div>
        ) : (
          <label
            htmlFor={`plan-logo-${appId}`}
            className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed
                       border-neutral-300 bg-surface px-4 py-5 text-center transition hover:border-brand-300"
          >
            <Icon name="image" size={20} className="text-neutral-300" />
            <span className="mt-1 text-[12.5px] font-semibold text-neutral-600">
              {logoBusy ? '올리는 중…' : '로고 넣기'}
            </span>
            <span className="mt-0.5 text-[11px] text-neutral-400">
              기관이 바뀌면 언제든 여기서 갈아끼우면 돼요
            </span>
          </label>
        )}
      </Field>

      <div className="sticky bottom-[84px] z-10 lg:bottom-3">
        <button onClick={() => void save()} disabled={saving} className="btn-primary w-full shadow-lg">
          <Icon name="check" size={16} />
          {saving ? '저장 중…' : saved || '강의계획서 저장'}
        </button>
      </div>

      <p className="text-center text-[11px] text-neutral-400">
        마지막 저장 {nameOf(plan.updated_by)} · {relTime(plan.updated_at)}
        <br />
        사진과 활동 줄은 고르는 즉시 저장돼요. 나머지 칸은 저장 버튼을 눌러주세요.
      </p>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="이 줄을 지울까요?"
        message="적어둔 글과 사진이 같이 지워져요."
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && removeItem(deleting)}
      />
    </div>
  );
}

/* ------------------------------------------------------------ 조각들 */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="label">{label}</p>
      {children}
    </div>
  );
}

/** 글 한 줄 + 사진 한 장이 한 항목. 양식의 전개 칸이 이 모양이다 */
function ItemRows({
  rows,
  slot,
  busyItem,
  numbered = false,
  onLabel,
  onImage,
  onDelete,
  onMove,
  onAdd,
}: {
  rows: LessonPlanItem[];
  slot: PlanSlot;
  busyItem: string | null;
  numbered?: boolean;
  onLabel: (item: LessonPlanItem, label: string) => void;
  onImage: (item: LessonPlanItem, file: File | undefined) => void;
  onDelete: (item: LessonPlanItem) => void;
  onMove: (item: LessonPlanItem, dir: -1 | 1) => void;
  onAdd: () => void;
}) {
  return (
    <>
      <ul className="mt-2 space-y-2">
        {rows.map((it, n) => (
          <li key={it.id} className="rounded-xl border border-neutral-200 bg-surface p-2.5">
            <div className="flex items-center gap-1.5">
              {numbered && (
                <span className="w-5 shrink-0 text-[12.5px] font-bold text-brand">{n + 1}.</span>
              )}
              <input
                defaultValue={it.label ?? ''}
                onBlur={(e) => onLabel(it, e.target.value.trim())}
                placeholder={SLOT_META[slot].hint}
                className="field h-10 flex-1 text-[13.5px]"
                aria-label="활동 내용"
              />
              <button
                onClick={() => onMove(it, -1)}
                disabled={n === 0}
                aria-label="위로"
                className="tap w-7 shrink-0 text-neutral-300 disabled:opacity-30"
              >
                <Icon name="chevronDown" size={13} className="rotate-180" />
              </button>
              <button
                onClick={() => onMove(it, 1)}
                disabled={n === rows.length - 1}
                aria-label="아래로"
                className="tap w-7 shrink-0 text-neutral-300 disabled:opacity-30"
              >
                <Icon name="chevronDown" size={13} />
              </button>
              <button
                onClick={() => onDelete(it)}
                aria-label="줄 삭제"
                className="tap w-7 shrink-0 text-neutral-300 hover:text-red-500"
              >
                <Icon name="close" size={13} />
              </button>
            </div>

            <input
              id={`plan-img-${it.id}`}
              type="file"
              accept="image/*"
              onChange={(e) => onImage(it, e.target.files?.[0])}
              className="hidden"
            />
            {it.url ? (
              <div className="mt-2 flex items-start gap-2">
                {/* 인쇄물과 같은 4:3 칸으로 보여준다 — 크기는 일정하게, 사진은 안 자른다
                    (폰 세로 사진은 양옆 여백). 여기서 보이는 그대로 인쇄된다 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={it.url}
                  alt={it.label ?? '사진'}
                  className="aspect-[4/3] w-full rounded-lg bg-raised object-contain"
                />
                <label
                  htmlFor={`plan-img-${it.id}`}
                  className="tap w-8 shrink-0 cursor-pointer text-neutral-400"
                  aria-label="사진 바꾸기"
                >
                  <Icon name="refresh" size={14} />
                </label>
              </div>
            ) : (
              <label
                htmlFor={`plan-img-${it.id}`}
                className="mt-2 flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border
                           border-dashed border-neutral-300 py-2.5 text-[12px] font-semibold text-neutral-400"
              >
                <Icon name="camera" size={14} />
                {busyItem === it.id ? '올리는 중…' : '사진 넣기'}
              </label>
            )}
          </li>
        ))}
      </ul>

      <button onClick={onAdd} className="btn-ghost mt-2 h-9 w-full text-[12.5px]">
        <Icon name="plus" size={14} />
        {SLOT_META[slot].add}
      </button>
    </>
  );
}
