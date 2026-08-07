'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { logActivity } from '@/lib/log';
import { downloadPhotosAsZip, safeFileName } from '@/lib/zip';
import { korDate, today } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { Icon } from '@/components/Icon';
import { CardSkeleton, EmptyState, ErrorBanner, Sheet, useToast } from '@/components/ui';
import { PHOTO_TAGS, type Album, type AppRow, type Photo, type PhotoTag } from '@/lib/types';

type Mode = 'album' | 'photo';

export default function GalleryPage() {
  return (
    <Suspense fallback={<div className="px-4 py-4"><CardSkeleton rows={3} /></div>}>
      <GalleryInner />
    </Suspense>
  );
}

function GalleryInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { session } = useSession();
  const { members, nameOf } = useMembers(true);
  const toast = useToast();

  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [apps, setApps] = useState<AppRow[]>([]);
  const [error, setError] = useState('');

  const [mode, setMode] = useState<Mode>('album');
  const [fApp, setFApp] = useState(params.get('app') ?? '');
  const [fSchool, setFSchool] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [fTag, setFTag] = useState<PhotoTag | ''>('');
  const [noFaceOnly, setNoFaceOnly] = useState(false);

  const [selected, setSelected] = useState<string[]>([]);
  const [zipping, setZipping] = useState('');
  const [newOpen, setNewOpen] = useState(false);

  // 앱에서 "이 프로그램 작품 보기"로 들어오면 사진 모드로 바로 보여준다
  useEffect(() => {
    if (params.get('app')) setMode('photo');
  }, [params]);

  const load = useCallback(async () => {
    setError('');
    try {
      const [aRes, pRes, appRes] = await Promise.all([
        supabase.from('albums').select('*').order('class_date', { ascending: false }),
        supabase.from('photos').select('*').order('created_at', { ascending: false }),
        supabase.from('apps').select('*').order('title_ko'),
      ]);
      if (aRes.error) throw aRes.error;
      setAlbums((aRes.data ?? []) as Album[]);
      setPhotos((pRes.data ?? []) as Photo[]);
      setApps((appRes.data ?? []) as AppRow[]);
    } catch (e) {
      setAlbums([]);
      setError(friendlyError(e, '갤러리를 불러오지 못했어요. 다시 시도해주세요.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const schools = useMemo(
    () => [...new Set((albums ?? []).map((a) => a.school))].sort(),
    [albums],
  );

  const filteredAlbums = useMemo(() => {
    return (albums ?? []).filter((a) => {
      if (fApp && a.app_id !== fApp) return false;
      if (fSchool && a.school !== fSchool) return false;
      if (fFrom && a.class_date < fFrom) return false;
      if (fTo && a.class_date > fTo) return false;
      return true;
    });
  }, [albums, fApp, fSchool, fFrom, fTo]);

  const filteredPhotos = useMemo(() => {
    const ids = new Set(filteredAlbums.map((a) => a.id));
    return photos.filter((p) => {
      if (!ids.has(p.album_id)) return false;
      if (fTag && p.tag !== fTag) return false;
      if (noFaceOnly && p.has_face) return false;
      return true;
    });
  }, [photos, filteredAlbums, fTag, noFaceOnly]);

  const photoCountOf = useCallback(
    (albumId: string) => photos.filter((p) => p.album_id === albumId).length,
    [photos],
  );

  const coverOf = useCallback(
    (a: Album) => {
      const byId = a.cover_photo_id ? photos.find((p) => p.id === a.cover_photo_id) : null;
      return byId ?? photos.find((p) => p.album_id === a.id) ?? null;
    },
    [photos],
  );

  const albumOf = useCallback(
    (id: string) => (albums ?? []).find((a) => a.id === id) ?? null,
    [albums],
  );

  const toggleSelect = (id: string) =>
    setSelected((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));

  const download = async () => {
    const list = filteredPhotos.filter((p) => selected.includes(p.id));
    if (list.length === 0) return;
    setZipping(`묶는 중… 0/${list.length}`);
    try {
      await downloadPhotosAsZip(
        list.map((p, i) => {
          const al = albumOf(p.album_id);
          const base = safeFileName(
            `${al?.school ?? '사진'}_${al?.class_date ?? ''}_${String(i + 1).padStart(2, '0')}${p.has_face ? '_얼굴O' : ''}`,
          );
          const ext = p.url.split('.').pop()?.split('?')[0] || 'webp';
          return { url: p.url, name: `${base}.${ext}` };
        }),
        safeFileName(`모아랩_사진_${today()}`),
        (d, t) => setZipping(`묶는 중… ${d}/${t}`),
      );
      logActivity(session?.id, `사진 ${list.length}장 다운로드`, null);
      toast.show('다운로드를 시작했어요.');
      setSelected([]);
    } catch (e) {
      setError(friendlyError(e, '다운로드가 안 됐어요. 장수를 줄여 다시 해보세요.'));
    } finally {
      setZipping('');
    }
  };

  const resetFilters = () => {
    setFApp('');
    setFSchool('');
    setFFrom('');
    setFTo('');
    setFTag('');
    setNoFaceOnly(false);
    router.replace('/gallery');
  };

  const filterCount =
    (fApp ? 1 : 0) + (fSchool ? 1 : 0) + (fFrom || fTo ? 1 : 0) + (fTag ? 1 : 0) + (noFaceOnly ? 1 : 0);

  return (
    <>
      <PageHeader
        title="작품 갤러리"
        subtitle={albums ? `앨범 ${albums.length}개 · 사진 ${photos.length}장` : undefined}
        right={
          <button onClick={() => setNewOpen(true)} className="btn-primary h-10 px-3.5 text-[14px]">
            + 앨범
          </button>
        }
      />

      {/* 사진 선택 바(약 70px)가 마지막 줄을 덮지 않도록 여유를 둔다 */}
      <div className="px-4 pb-24 pt-3">
        {/* 모드 전환 */}
        <div className="mb-3 flex gap-1.5 rounded-xl bg-neutral-200/60 p-1">
          {(
            [
              ['album', '앨범'],
              ['photo', '사진 모아보기'],
            ] as [Mode, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => {
                setMode(v);
                setSelected([]);
              }}
              className={`tap flex-1 rounded-lg text-[14px] font-bold transition ${
                mode === v ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 필터 */}
        <details className="card mb-3 overflow-hidden" open={filterCount > 0}>
          <summary className="tap cursor-pointer list-none px-4 text-[14px] font-bold text-neutral-700">
            필터 {filterCount > 0 && <span className="chip ml-1 bg-brand text-white">{filterCount}</span>}
          </summary>
          <div className="space-y-3 border-t border-neutral-100 p-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="g-school">
                  학교
                </label>
                <select id="g-school" value={fSchool} onChange={(e) => setFSchool(e.target.value)} className="field">
                  <option value="">전체</option>
                  {schools.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="g-app">
                  프로그램
                </label>
                <select id="g-app" value={fApp} onChange={(e) => setFApp(e.target.value)} className="field">
                  <option value="">전체</option>
                  {apps.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title_ko}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="g-from">
                  시작일
                </label>
                <input id="g-from" type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} className="field" />
              </div>
              <div>
                <label className="label" htmlFor="g-to">
                  종료일
                </label>
                <input id="g-to" type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} className="field" />
              </div>
            </div>

            <div>
              <span className="label">태그</span>
              <div className="flex flex-wrap gap-2">
                {PHOTO_TAGS.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setFTag(fTag === t.value ? '' : t.value)}
                    className={`tap rounded-full border px-3.5 text-[13.5px] font-semibold ${
                      fTag === t.value ? 'border-brand bg-brand text-white' : 'border-neutral-300 bg-white text-neutral-600'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-3 rounded-xl bg-neutral-50 px-3 py-2.5">
              <input
                type="checkbox"
                checked={noFaceOnly}
                onChange={(e) => setNoFaceOnly(e.target.checked)}
                className="h-5 w-5 accent-[#F26522]"
              />
              <span className="text-[14px] font-semibold">얼굴 없는 사진만 (외부 자료용)</span>
            </label>

            {filterCount > 0 && (
              <button onClick={resetFilters} className="btn-ghost w-full">
                필터 초기화
              </button>
            )}
          </div>
        </details>

        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} onRetry={() => void load()} />
          </div>
        )}

        {albums === null ? (
          <CardSkeleton rows={3} />
        ) : mode === 'album' ? (
          filteredAlbums.length === 0 ? (
            <EmptyState
              icon="camera"
              title={albums.length === 0 ? '앨범이 아직 없어요' : '조건에 맞는 앨범이 없어요'}
              desc={albums.length === 0 ? '수업 하나당 앨범 하나로 정리하면 나중에 찾기 쉬워요.' : undefined}
              action={
                albums.length === 0 ? (
                  <button onClick={() => setNewOpen(true)} className="btn-primary px-5">
                    첫 앨범 만들기
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {filteredAlbums.map((a) => {
                const cover = coverOf(a);
                return (
                  <Link key={a.id} href={`/gallery/${a.id}`} className="card overflow-hidden active:opacity-80">
                    <div className="aspect-[4/3] bg-neutral-100">
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cover.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-neutral-300">
                          <Icon name="image" size={26} />
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <p className="truncate text-[14px] font-bold leading-tight">{a.school}</p>
                      <p className="mt-0.5 truncate text-[11.5px] text-neutral-500">
                        {korDate(a.class_date)} · {photoCountOf(a.id)}장
                      </p>
                      <p className="mt-0.5 truncate text-[11.5px] text-neutral-400">
                        {a.app_id ? (apps.find((x) => x.id === a.app_id)?.title_ko ?? '') : ''}
                        {a.grade ? ` · ${a.grade}` : ''}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )
        ) : filteredPhotos.length === 0 ? (
          <EmptyState icon="search" title="조건에 맞는 사진이 없어요" desc="필터를 바꿔보세요." />
        ) : (
          <>
            <div className="mb-2.5 flex items-center justify-between">
              <p className="text-[13px] font-bold text-neutral-600">{filteredPhotos.length}장</p>
              <button
                onClick={() =>
                  setSelected(
                    selected.length === filteredPhotos.length ? [] : filteredPhotos.map((p) => p.id),
                  )
                }
                className="text-[13px] font-bold text-brand"
              >
                {selected.length === filteredPhotos.length ? '전체 해제' : '전체 선택'}
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {filteredPhotos.map((p) => {
                const on = selected.includes(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => toggleSelect(p.id)}
                    className="relative aspect-square overflow-hidden rounded-lg bg-neutral-100"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={p.caption ?? ''} loading="lazy" className="h-full w-full object-cover" />
                    {p.has_face && (
                      <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9.5px] font-bold text-white">
                        얼굴O
                      </span>
                    )}
                    <span
                      className={`absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 text-[11px] font-bold ${
                        on ? 'border-brand bg-brand text-white' : 'border-white/80 bg-black/25 text-transparent'
                      }`}
                    >
                      <Icon name="check" size={11} strokeWidth={3} />
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* 선택 다운로드 바 */}
      {mode === 'photo' && selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-[56px] z-30 border-t border-neutral-200 bg-white/97 px-4 py-3 backdrop-blur safe-bottom">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <span className="text-[13.5px] font-bold">{selected.length}장 선택됨</span>
            <button onClick={() => setSelected([])} className="text-[13px] text-neutral-500">
              해제
            </button>
            <button onClick={download} disabled={Boolean(zipping)} className="btn-primary ml-auto h-10 px-4 text-[14px]">
              {zipping || 'zip 다운로드'}
            </button>
          </div>
        </div>
      )}

      <AlbumForm
        open={newOpen}
        onClose={() => setNewOpen(false)}
        apps={apps}
        members={members}
        onSaved={(id) => {
          void load();
          router.push(`/gallery/${id}`);
        }}
      />
      {toast.node}
      {nameOf('') === '' && null}
    </>
  );
}

/* ------------------------------------------------------------------ 앨범 만들기 */

function AlbumForm({
  open,
  onClose,
  onSaved,
  apps,
  members,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
  apps: AppRow[];
  members: { id: string; name: string }[];
}) {
  const { session } = useSession();
  const [school, setSchool] = useState('');
  const [date, setDate] = useState(today());
  const [appId, setAppId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [grade, setGrade] = useState('');
  const [headcount, setHeadcount] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSchool('');
    setDate(today());
    setAppId('');
    setTeacherId(session?.id ?? '');
    setGrade('');
    setHeadcount('');
    setError('');
  }, [open, session?.id]);

  const save = async () => {
    setError('');
    if (!school.trim()) return setError('학교명을 입력해주세요.');
    if (!date) return setError('수업 날짜를 골라주세요.');

    setBusy(true);
    try {
      const { data, error: e } = await supabase
        .from('albums')
        .insert({
          school: school.trim(),
          class_date: date,
          app_id: appId || null,
          teacher_id: teacherId || null,
          grade: grade.trim() || null,
          headcount: headcount ? Number(headcount) : null,
        })
        .select()
        .single();
      if (e) throw e;
      logActivity(session?.id, `앨범 생성 — ${school.trim()} ${date}`, `album:${data.id}`);
      onSaved(data.id);
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
      title="새 앨범"
      footer={
        <button onClick={save} disabled={busy} className="btn-primary w-full">
          {busy ? '만드는 중…' : '만들기'}
        </button>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <div>
          <label className="label" htmlFor="al-school">
            학교명
          </label>
          <input
            id="al-school"
            value={school}
            onChange={(e) => setSchool(e.target.value)}
            placeholder="모아초등학교"
            className="field"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="al-date">
              수업 날짜
            </label>
            <input id="al-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field" />
          </div>
          <div>
            <label className="label" htmlFor="al-grade">
              학년/반
            </label>
            <input
              id="al-grade"
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              placeholder="4학년 2반"
              className="field"
            />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="al-app">
            프로그램
          </label>
          <select id="al-app" value={appId} onChange={(e) => setAppId(e.target.value)} className="field">
            <option value="">선택 안 함</option>
            {apps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title_ko}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="al-teacher">
              담당 강사
            </label>
            <select id="al-teacher" value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className="field">
              <option value="">선택 안 함</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="al-hc">
              참여 인원
            </label>
            <input
              id="al-hc"
              value={headcount}
              onChange={(e) => setHeadcount(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              placeholder="24"
              className="field"
            />
          </div>
        </div>
      </div>
    </Sheet>
  );
}
