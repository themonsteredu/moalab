'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { queueDrive, uploadFile } from '@/lib/upload';
import { logActivity } from '@/lib/log';
import { downloadFilesAsZip, safeFileName } from '@/lib/zip';
import { ConfirmDialog, ErrorBanner, Sheet } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { shortTime, relTime } from '@/lib/format';
import { PLAN_KINDS, planKindMeta, type PlanFile, type PlanKind } from '@/lib/types';

/** 문서 하나 = 판(version) 여러 개. [0] 이 최신 */
interface PlanDoc {
  groupId: string;
  versions: PlanFile[];
}

function groupDocs(files: PlanFile[]): PlanDoc[] {
  const m = new Map<string, PlanFile[]>();
  for (const f of files) {
    const g = f.group_id ?? f.id;
    const list = m.get(g) ?? [];
    list.push(f);
    m.set(g, list);
  }
  return [...m.entries()]
    .map(([groupId, list]) => ({
      groupId,
      versions: [...list].sort((a, b) => b.version - a.version || b.created_at.localeCompare(a.created_at)),
    }))
    // 최근에 손댄 문서를 위로
    .sort((a, b) => b.versions[0].created_at.localeCompare(a.versions[0].created_at));
}

/** 문서의 갈래 = 최신 판의 갈래. 칸이 생기기 전 파일은 '계획안' 으로 읽힌다 */
function kindOf(doc: PlanDoc): PlanKind {
  return planKindMeta(doc.versions[0].kind).value;
}

/** 갈래 거르기 칩 — /apps 목록의 상태 칩과 같은 모양이다 */
function KindChip({
  on,
  dim,
  onClick,
  children,
}: {
  on: boolean;
  dim?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`tap shrink-0 rounded-full border px-3 text-[12.5px] font-bold transition ${
        on
          ? 'pick-on'
          : dim
            ? 'border-neutral-200 bg-surface text-neutral-300'
            : 'border-neutral-300 bg-surface text-neutral-600'
      }`}
    >
      {children}
    </button>
  );
}

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];

function extOf(name: string): string {
  return (name.split('.').pop() ?? '').toLowerCase();
}

/** 브라우저가 그대로 열 수 있는 것만 미리보기 */
function previewKind(name: string): 'image' | 'pdf' | 'none' {
  const e = extOf(name);
  if (IMAGE_EXT.includes(e)) return 'image';
  if (e === 'pdf') return 'pdf';
  return 'none';
}

/** 확장자를 색 있는 라벨로 — 뭐가 들었는지 바로 보인다 */
function FileBadge({ name, size = 36 }: { name: string; size?: number }) {
  const ext = extOf(name);
  const tone =
    ext === 'pdf'
      ? 'bg-red-50 text-red-600'
      : ['hwp', 'hwpx', 'doc', 'docx'].includes(ext)
        ? 'bg-blue-50 text-blue-600'
        : ['ppt', 'pptx'].includes(ext)
          ? 'bg-brand-100 text-brand-700'
          : ['xls', 'xlsx', 'csv'].includes(ext)
            ? 'bg-green-50 text-green-700'
            : IMAGE_EXT.includes(ext)
              ? 'bg-violet-100 text-violet-700'
              : 'bg-neutral-100 text-neutral-500';
  return (
    <span
      style={{ width: size, height: size }}
      className={`flex shrink-0 items-center justify-center rounded-lg text-[9.5px] font-bold uppercase ${tone}`}
    >
      {ext.slice(0, 4) || 'FILE'}
    </span>
  );
}

function humanSize(n: number | null): string {
  if (!n) return '';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * 문서 첨부 — 파일 전용.
 *
 * 계획안 · 교육안 · 양식 · 기타 **네 갈래**를 한 자리에서 올리고 갈래로 거른다.
 * 갈래는 형식(한글이냐 PPT냐)이 아니라 **누가 읽는가**로 가른다 (types.ts 의 PLAN_KINDS).
 * 형식으로 가르면 확장자 라벨(FileBadge)과 겹치기만 하고 아무것도 안 알려준다.
 *
 * A 가 올리고 → A 가 고쳐 올리고 → B 가 또 고쳐 올린다.
 * 이걸 평면 목록으로 쌓으면 '지도안_최종2.hwp' 가 여러 개 생겨서
 * 뭐가 최신이고 누가 뭘 바꿨는지 아무도 모른다 (카톡과 똑같은 문제).
 *
 * 그래서 **문서 하나 = 카드 하나**로 두고, 고쳐 올린 것은 그 문서의 다음 판이 된다.
 *   · 카드에는 늘 **최신 판**만 크게 보인다 (v3 · 올린 사람 · 바꾼 내용)
 *   · 지난 판은 접혀 있고, 필요하면 펼쳐서 그대로 받을 수 있다
 *   · '새 버전 올리기' 는 그 문서에, '새 문서' 는 별도 카드로 들어간다
 */
export function LessonPlan({
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
  /** 누가 올렸는지 이름으로 보여주려면 필요하다 */
  nameOf: (id: string | null) => string;
}) {
  const { session } = useSession();
  const [files, setFiles] = useState<PlanFile[] | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState('');
  const [zipping, setZipping] = useState('');
  const [deleting, setDeleting] = useState<PlanFile | null>(null);
  const [preview, setPreview] = useState<PlanFile | null>(null);
  /** 어느 문서에 새 판을 올릴지 */
  const [newVerFor, setNewVerFor] = useState<PlanDoc | null>(null);
  const [verFile, setVerFile] = useState<File | null>(null);
  const [verNote, setVerNote] = useState('');
  const [openHistory, setOpenHistory] = useState<string[]>([]);
  /** 목록 거르기 */
  const [filter, setFilter] = useState<PlanKind | 'all'>('all');
  /** 고른 파일은 바로 안 올라간다 — 갈래를 정한 뒤에 올라간다 */
  const [pending, setPending] = useState<File[]>([]);
  const [pendingKind, setPendingKind] = useState<PlanKind | ''>('');
  const inputRef = useRef<HTMLInputElement>(null);
  const verInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('plan_files').select('*').eq('app_id', appId).order('created_at');
    setFiles((data ?? []) as PlanFile[]);
  }, [appId]);

  const docs = files ? groupDocs(files) : null;
  const shown = (docs ?? []).filter((d) => filter === 'all' || kindOf(d) === filter);
  const countOf = (k: PlanKind) => (docs ?? []).filter((d) => kindOf(d) === k).length;
  /** 실제로 올라와 있는 갈래만. 0건 갈래로 걸러봐야 '없어요' 만 나온다 */
  const usedKinds = PLAN_KINDS.filter((k) => countOf(k.value) > 0);

  useEffect(() => {
    void load();
  }, [load]);

  /** 파일을 고르면 바로 안 올린다 — 갈래부터 묻는다 */
  const pickFiles = (picked: File[]) => {
    // 같은 파일을 다시 골라도 onChange 가 뜨게 값을 비운다
    if (inputRef.current) inputRef.current.value = '';
    if (picked.length === 0) return;
    setError('');
    setPending(picked);
    // 갈래를 미리 골라두지 않는다 — 여러 개가 한꺼번에 엉뚱한 갈래로 들어가면
    // 되돌리는 것도 그만큼 여러 번이다 (업무 나눠주기와 같은 판단)
    setPendingKind('');
  };

  /** 새 문서 올리기 — 파일 하나가 문서 하나(1판)가 된다 */
  const uploadPending = async () => {
    if (pending.length === 0 || !pendingKind) return;
    setError('');
    let ok = 0;
    /** 실패한 것만 남긴다 — 다시 눌렀을 때 성공한 것이 두 번 올라가면 안 된다 */
    const left: File[] = [];
    /** 드라이브에도 넣을 것 (성공한 것만) */
    const copied: { url: string; name: string }[] = [];
    for (let i = 0; i < pending.length; i++) {
      setUploading(`올리는 중… ${i + 1}/${pending.length}`);
      try {
        const up = await uploadFile('moalab-plans', pending[i], `app-${appId}`);
        const { data, error: e } = await supabase
          .from('plan_files')
          .insert({
            app_id: appId,
            file_url: up.url,
            file_name: up.name,
            file_size: up.size,
            member_id: session?.id ?? null,
            kind: pendingKind,
            version: 1,
          })
          .select()
          .single();
        if (e) throw e;
        // 새 문서는 자기 id 를 group_id 로 삼는다 (판을 쌓을 기준점)
        await supabase.from('plan_files').update({ group_id: data.id }).eq('id', data.id);
        copied.push({ url: up.url, name: up.name });
        ok++;
      } catch (e) {
        left.push(pending[i]);
        setError(friendlyError(e, `${pending[i].name} 을 올리지 못했어요.`));
      }
    }
    setUploading('');
    setPending(left);
    if (ok > 0) {
      logActivity(session?.id, `${appSlug} ${planKindMeta(pendingKind).label} ${ok}개 추가`, `app:${appId}`);
      // 방금 올린 것이 안 보이면 안 된다 — 다른 갈래로 걸러져 있으면 전체로 되돌린다
      if (filter !== 'all' && filter !== pendingKind) setFilter('all');
      // 구글 드라이브에도 한 벌 (기다리지 않는다 — 연결 안 돼 있으면 서버가 조용히 넘긴다)
      queueDrive(session?.id, session?.token, { kind: 'plan', files: copied, topic, appTitle, prefix: appTitle });
      await load();
    }
  };

  /** 이 문서의 다음 판으로 올리기 */
  const uploadVersion = async () => {
    if (!newVerFor || !verFile) {
      setError('올릴 파일을 골라주세요.');
      return;
    }
    setError('');
    const nextV = newVerFor.versions[0].version + 1;
    setUploading(`${nextV}판 올리는 중…`);
    try {
      const up = await uploadFile('moalab-plans', verFile, `app-${appId}`);
      const { error: e } = await supabase.from('plan_files').insert({
        app_id: appId,
        file_url: up.url,
        file_name: up.name,
        file_size: up.size,
        member_id: session?.id ?? null,
        // 판이 바뀌어도 갈래는 그 문서의 것을 그대로 따라간다
        kind: kindOf(newVerFor),
        note: verNote.trim() || null,
        group_id: newVerFor.groupId,
        version: nextV,
      });
      if (e) throw e;
      logActivity(
        session?.id,
        `${appSlug} ${planKindMeta(kindOf(newVerFor)).label} ${nextV}판 올림`,
        `app:${appId}`,
      );
      /* 드라이브에도 한 벌. **판 번호를 이름에 넣는다** — 안 넣으면 같은 이름이라
         드라이브에서 1판을 덮어쓰거나(같은 이름은 안 올린다) 뭐가 최신인지 모른다 */
      queueDrive(session?.id, session?.token, {
        kind: 'plan',
        files: [{ url: up.url, name: `${nextV}판_${up.name}` }],
        topic,
        appTitle,
        prefix: appTitle,
      });
      setNewVerFor(null);
      setVerFile(null);
      setVerNote('');
      if (verInputRef.current) verInputRef.current.value = '';
      await load();
    } catch (e) {
      setError(friendlyError(e, '새 버전을 올리지 못했어요.'));
    } finally {
      setUploading('');
    }
  };

  /** 최신 판만 묶는다 — 지난 판까지 다 받으면 받는 쪽이 또 헷갈린다 */
  const downloadAll = async () => {
    if (shown.length === 0) return;
    // 화면에 보이는 것만 묶는다 — 갈래로 걸러놓고 전부 받으면 화면과 다른 게 온다
    const latest = shown.map((d) => d.versions[0]);
    const label = filter === 'all' ? '문서' : planKindMeta(filter).label;
    setError('');
    setZipping(`묶는 중… 0/${latest.length}`);
    try {
      await downloadFilesAsZip(
        latest.map((f) => ({ url: f.file_url, name: f.file_name })),
        safeFileName(`${appTitle}_${label}`),
        (d, t) => setZipping(`묶는 중… ${d}/${t}`),
      );
      logActivity(session?.id, `${appSlug} ${label} 전체 다운로드`, `app:${appId}`);
    } catch (e) {
      setError(friendlyError(e, '다운로드가 안 됐어요. 다시 눌러주세요.'));
    } finally {
      setZipping('');
    }
  };

  const remove = async (f: PlanFile) => {
    setDeleting(null);
    setPreview(null);
    const { error: e } = await supabase.from('plan_files').delete().eq('id', f.id);
    if (e) {
      setError(friendlyError(e, '삭제하지 못했어요. 다시 눌러주세요.'));
      return;
    }
    await load();
  };

  const previewAs = preview ? previewKind(preview.file_name) : 'none';

  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} />}

      <input
        id={`plan-files-${appId}`}
        ref={inputRef}
        type="file"
        multiple
        onChange={(e) => pickFiles(Array.from(e.target.files ?? []))}
        className="hidden"
      />

      {docs === null ? (
        <div className="skeleton h-16 w-full" />
      ) : docs.length === 0 ? (
        <label
          htmlFor={`plan-files-${appId}`}
          className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed
                     border-neutral-300 bg-raised px-4 py-7 text-center transition hover:border-brand-300"
        >
          <Icon name="clip" size={22} className="text-neutral-300" />
          <span className="mt-1.5 text-[13.5px] font-semibold text-neutral-600">
            {uploading || '교육안 · 양식 · 계획안을 올려주세요'}
          </span>
          <span className="mt-0.5 text-[11.5px] text-neutral-400">한글 · PDF · PPT · 엑셀 · 이미지</span>
        </label>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <p className="flex-1 text-[13px] font-bold text-neutral-600">
              문서 <span className="text-brand">{shown.length}</span>
              {filter !== 'all' && <span className="text-neutral-400"> / {docs.length}</span>}
            </p>
            <button
              onClick={downloadAll}
              disabled={Boolean(zipping) || shown.length === 0}
              className="btn-ghost h-9 px-3 text-[12.5px]"
            >
              <Icon name="download" size={14} />
              {zipping || '최신 전체 받기'}
            </button>
            <label htmlFor={`plan-files-${appId}`} className="btn-primary h-9 cursor-pointer px-3 text-[12.5px]">
              <Icon name="plus" size={14} />
              새 문서
            </label>
          </div>

          {/* 갈래 거르기 — 있는 갈래만, 한 줄 가로 스크롤.
              갈래가 하나뿐이면 줄 자체를 안 그린다 (누를 게 없는데 44px 을 먹는다).
              여러 줄로 깔면 정작 문서 목록이 화면 밖으로 밀린다 (지출결의서에서 겪은 것) */}
          {usedKinds.length > 1 && (
            <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
              <KindChip on={filter === 'all'} onClick={() => setFilter('all')}>
                전체 {docs.length}
              </KindChip>
              {usedKinds.map((k) => (
                <KindChip
                  key={k.value}
                  on={filter === k.value}
                  onClick={() => setFilter(filter === k.value ? 'all' : k.value)}
                >
                  {`${k.label} ${countOf(k.value)}`}
                </KindChip>
              ))}
            </div>
          )}

          {shown.length === 0 && (
            <p className="rounded-xl border border-dashed border-neutral-200 bg-raised px-4 py-6 text-center text-[13px] text-neutral-400">
              이 갈래로 올린 문서가 아직 없어요.
            </p>
          )}

          <ul className="space-y-2.5">
            {shown.map((doc) => {
              const cur = doc.versions[0];
              const past = doc.versions.slice(1);
              const historyOpen = openHistory.includes(doc.groupId);
              return (
                <li key={doc.groupId} className="card overflow-hidden">
                  {/* 최신 판 */}
                  <div className="flex items-start gap-2.5 p-3">
                    <FileBadge name={cur.file_name} />
                    {/* 미리보기를 여는 자리 = 카드에서 가장 크게 누르는 곳.
                        두 줄이던 것을 한 줄로 줄이면서 40px 이 됐다 — 44px 로 되돌린다 */}
                    <button
                      onClick={() => setPreview(cur)}
                      className="flex min-h-[44px] min-w-0 flex-1 flex-col justify-center text-left"
                    >
                      {/* 갈래와 파일 이름을 한 줄에 둔다. 갈래를 따로 한 줄 잡으면
                          문서 한 장마다 24px 씩 길어진다. 판 번호는 아랫줄로 내렸다 */}
                      <span className="flex items-center gap-1.5">
                        <span className={`chip shrink-0 ${planKindMeta(cur.kind).chip}`}>
                          {planKindMeta(cur.kind).label}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-neutral-900">
                          {cur.file_name}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[11.5px] text-neutral-400">
                        {doc.versions.length > 1 && (
                          <b className="text-neutral-500">{cur.version}판 · </b>
                        )}
                        {nameOf(cur.member_id)} · {relTime(cur.created_at)} · {humanSize(cur.file_size)}
                      </span>
                    </button>
                    <a
                      href={cur.file_url}
                      download={cur.file_name}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`${cur.file_name} 내려받기`}
                      className="tap w-8 shrink-0 text-neutral-400 hover:text-brand"
                    >
                      <Icon name="download" size={15} />
                    </a>
                    <button
                      onClick={() => setDeleting(cur)}
                      aria-label={`${cur.file_name} 삭제`}
                      className="tap w-8 shrink-0 text-neutral-300 hover:text-red-500"
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </div>

                  {/* 이번 판에서 바꾼 것 */}
                  {cur.note && (
                    <p className="mx-3 mb-2 whitespace-pre-wrap rounded-lg bg-raised px-2.5 py-2 text-[12.5px] leading-relaxed text-neutral-700">
                      {cur.note}
                    </p>
                  )}

                  <div className="flex items-center gap-2 border-t border-neutral-100 px-3 py-2">
                    <button
                      onClick={() => {
                        setNewVerFor(doc);
                        setVerFile(null);
                        setVerNote('');
                        setError('');
                      }}
                      className="-my-3 flex min-h-[44px] items-center gap-1 text-[12.5px] font-bold text-brand"
                    >
                      <Icon name="refresh" size={13} />
                      고쳐서 올리기
                    </button>
                    {past.length > 0 && (
                      <button
                        onClick={() =>
                          setOpenHistory((v) =>
                            v.includes(doc.groupId) ? v.filter((x) => x !== doc.groupId) : [...v, doc.groupId],
                          )
                        }
                        className="-my-3 ml-auto flex min-h-[44px] items-center gap-1 text-[12px] font-bold text-neutral-400"
                      >
                        지난 판 {past.length}개
                        <Icon
                          name="chevronDown"
                          size={12}
                          className={`transition-transform ${historyOpen ? 'rotate-180' : ''}`}
                        />
                      </button>
                    )}
                  </div>

                  {/* 지난 판 — 누가 언제 뭘 바꿨는지 그대로 남는다 */}
                  {historyOpen && past.length > 0 && (
                    <ul className="divide-y divide-neutral-100 border-t border-neutral-100 bg-raised">
                      {past.map((v) => (
                        <li key={v.id} className="flex items-start gap-2 px-3 py-2">
                          <span className="mt-0.5 shrink-0 text-[11px] font-bold text-neutral-400">
                            {v.version}판
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] text-neutral-600">{v.file_name}</span>
                            <span className="block text-[11px] text-neutral-400">
                              {nameOf(v.member_id)} · {shortTime(v.created_at)}
                            </span>
                            {v.note && (
                              <span className="mt-0.5 block whitespace-pre-wrap text-[11.5px] leading-relaxed text-neutral-500">
                                {v.note}
                              </span>
                            )}
                          </span>
                          <a
                            href={v.file_url}
                            download={v.file_name}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`${v.version}판 내려받기`}
                            className="tap w-7 shrink-0 text-neutral-400"
                          >
                            <Icon name="download" size={14} />
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* 올리기 — 갈래를 고른 뒤에 올라간다.
          미리 골라두면 목록 맨 위 갈래로 여러 개가 한꺼번에 잘못 들어간다 */}
      <Sheet
        open={pending.length > 0}
        onClose={() => setPending([])}
        title={`문서 ${pending.length}개 올리기`}
        footer={
          <button
            onClick={() => void uploadPending()}
            disabled={!pendingKind || Boolean(uploading)}
            className="btn-primary w-full"
          >
            {uploading || (pendingKind ? `${planKindMeta(pendingKind).label} 갈래로 올리기` : '갈래를 골라주세요')}
          </button>
        }
      >
        <div className="space-y-3">
          <ul className="space-y-1.5 rounded-xl bg-raised px-3 py-2.5">
            {pending.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2">
                <FileBadge name={f.name} size={26} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-neutral-600">{f.name}</span>
                <span className="shrink-0 text-[11px] text-neutral-400">{humanSize(f.size)}</span>
              </li>
            ))}
          </ul>

          <div>
            <p className="label">무엇을 올리나요?</p>
            <div className="grid grid-cols-2 gap-2">
              {PLAN_KINDS.map((k) => {
                const on = pendingKind === k.value;
                return (
                  <button
                    key={k.value}
                    onClick={() => setPendingKind(k.value)}
                    aria-pressed={on}
                    className={`tap flex-col items-start justify-center gap-0.5 rounded-xl border px-3 py-2 text-left transition ${
                      on ? 'border-brand bg-brand-50' : 'border-neutral-200 bg-surface'
                    }`}
                  >
                    <span className={`text-[13.5px] font-bold ${on ? 'text-brand-700' : 'text-neutral-700'}`}>
                      {k.label}
                    </span>
                    <span className="text-[11px] leading-tight text-neutral-400">{k.hint}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11.5px] text-neutral-400">
              고른 갈래가 {pending.length}개 전부에 붙어요. 갈래가 다르면 나눠서 올려주세요.
            </p>
          </div>

          {error && <ErrorBanner message={error} />}
        </div>
      </Sheet>

      {/* 새 버전 올리기 */}
      <Sheet
        open={Boolean(newVerFor)}
        onClose={() => setNewVerFor(null)}
        title="고쳐서 올리기"
        footer={
          <button onClick={() => void uploadVersion()} disabled={Boolean(uploading)} className="btn-primary w-full">
            {uploading || `${(newVerFor?.versions[0].version ?? 0) + 1}판으로 올리기`}
          </button>
        }
      >
        {newVerFor && (
          <div className="space-y-3">
            <p className="rounded-lg bg-raised px-3 py-2 text-[12.5px] leading-relaxed text-neutral-600">
              <b>{newVerFor.versions[0].file_name}</b> 의 다음 판으로 올라가요.
              <br />
              지금 판({newVerFor.versions[0].version}판)은 지워지지 않고 &lsquo;지난 판&rsquo; 에 남아요.
            </p>

            <div>
              <p className="label">고친 파일</p>
              <input
                ref={verInputRef}
                id={`plan-ver-${appId}`}
                type="file"
                onChange={(e) => setVerFile(e.target.files?.[0] ?? null)}
                className="hidden"
              />
              <label
                htmlFor={`plan-ver-${appId}`}
                className="tap w-full cursor-pointer gap-1.5 rounded-xl border border-dashed border-neutral-300 text-[14px] font-semibold text-neutral-500"
              >
                <Icon name="clip" size={15} />
                {verFile ? verFile.name : '파일 고르기'}
              </label>
            </div>

            <div>
              <label className="label" htmlFor={`plan-note-${appId}`}>
                무엇을 바꿨나요?
              </label>
              <textarea
                id={`plan-note-${appId}`}
                value={verNote}
                onChange={(e) => setVerNote(e.target.value)}
                rows={3}
                placeholder="예) 3차시 활동을 모둠 활동으로 바꿨어요. 준비물에 색지 추가."
                className="field resize-none"
              />
              <p className="mt-1 text-[11.5px] text-neutral-400">
                안 적어도 되지만, 적어두면 다음 사람이 파일을 열어보지 않고도 알 수 있어요.
              </p>
            </div>

            {error && <ErrorBanner message={error} />}
          </div>
        )}
      </Sheet>

      {/* 미리보기 */}
      <Sheet
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.file_name ?? '미리보기'}
        footer={
          preview ? (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setDeleting(preview)} className="btn-ghost text-red-600">
                삭제
              </button>
              <a
                href={preview.file_url}
                download={preview.file_name}
                target="_blank"
                rel="noreferrer"
                className="btn-primary"
              >
                <Icon name="download" size={15} />
                내려받기
              </a>
            </div>
          ) : undefined
        }
      >
        {preview && (
          <div>
            {previewAs === 'image' ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={preview.file_url}
                alt={preview.file_name}
                className="max-h-[62vh] w-full rounded-xl bg-raised object-contain"
              />
            ) : previewAs === 'pdf' ? (
              <object
                data={preview.file_url}
                type="application/pdf"
                className="h-[62vh] w-full rounded-xl border border-neutral-200 bg-raised"
              >
                <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                  <FileBadge name={preview.file_name} size={44} />
                  <p className="text-[13px] text-neutral-500">
                    이 브라우저에서는 PDF 를 바로 못 열어요. 내려받아서 봐주세요.
                  </p>
                </div>
              </object>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-neutral-300 bg-raised px-6 py-12 text-center">
                <FileBadge name={preview.file_name} size={48} />
                <p className="text-[14px] font-semibold text-neutral-700">
                  {extOf(preview.file_name).toUpperCase()} 는 화면에서 바로 못 열어요
                </p>
                <p className="text-[12.5px] leading-relaxed text-neutral-400">
                  아래 <b>내려받기</b>를 눌러 한글·오피스에서 열어주세요.
                </p>
              </div>
            )}
            <p className="mt-2.5 text-center text-[11.5px] text-neutral-400">
              {preview.version}판 · {nameOf(preview.member_id)} · {shortTime(preview.created_at)} ·{' '}
              {humanSize(preview.file_size)}
            </p>
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`'${deleting?.file_name ?? ''}' ${deleting?.version ?? 1}판을 지울까요?`}
        message="이 판만 지워져요. 지난 판이 있으면 그게 다시 최신이 돼요."
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove(deleting)}
      />
    </div>
  );
}
