'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useMembers } from '@/lib/useMembers';
import { uploadFile } from '@/lib/upload';
import { logActivity } from '@/lib/log';
import { downloadPhotosAsZip, safeFileName } from '@/lib/zip';
import { korDateFull } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { CardSkeleton, ConfirmDialog, EmptyState, ErrorBanner, Sheet, useToast } from '@/components/ui';
import { PHOTO_TAGS, type Album, type AppRow, type Photo, type PhotoTag } from '@/lib/types';

export default function AlbumPage() {
  const { albumId } = useParams<{ albumId: string }>();
  const router = useRouter();
  const { session } = useSession();
  const { nameOf } = useMembers(true);
  const toast = useToast();

  const [album, setAlbum] = useState<Album | null>(null);
  const [app, setApp] = useState<AppRow | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [uploading, setUploading] = useState('');
  const [editing, setEditing] = useState<Photo | null>(null);
  const [deletingAlbum, setDeletingAlbum] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [zipping, setZipping] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const { data: a, error: aErr } = await supabase.from('albums').select('*').eq('id', albumId).maybeSingle();
      if (aErr) throw aErr;
      if (!a) {
        setError('앨범을 찾지 못했어요.');
        setLoading(false);
        return;
      }
      setAlbum(a as Album);

      if (a.app_id) {
        const { data: ap } = await supabase.from('apps').select('*').eq('id', a.app_id).maybeSingle();
        setApp((ap as AppRow | null) ?? null);
      } else {
        setApp(null);
      }

      const { data: ps } = await supabase
        .from('photos')
        .select('*')
        .eq('album_id', albumId)
        .order('created_at');
      setPhotos((ps ?? []) as Photo[]);
    } catch (e) {
      setError(friendlyError(e, '앨범을 불러오지 못했어요. 다시 시도해주세요.'));
    } finally {
      setLoading(false);
    }
  }, [albumId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 폰에서 여러 장 한 번에. 업로드 전에 항상 1600px WebP 로 줄인다. */
  const onFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setError('');
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      setUploading(`올리는 중… ${i + 1}/${files.length}`);
      try {
        const up = await uploadFile('moalab-gallery', files[i], `album-${albumId}`);
        const { error: e } = await supabase
          .from('photos')
          .insert({ album_id: albumId, url: up.url, tag: 'work', has_face: false });
        if (e) throw e;
        ok++;
      } catch (e) {
        setError(friendlyError(e, `${i + 1}번째 사진을 올리지 못했어요. 나머지는 계속 올릴게요.`));
      }
    }
    setUploading('');
    if (fileRef.current) fileRef.current.value = '';
    if (ok > 0) {
      logActivity(session?.id, `${album?.school ?? ''} 앨범에 사진 ${ok}장 추가`, `album:${albumId}`);
      toast.show(`${ok}장 올렸어요.`);
      await load();
    }
  };

  const setCover = async (photoId: string) => {
    const { error: e } = await supabase.from('albums').update({ cover_photo_id: photoId }).eq('id', albumId);
    if (e) {
      setError(friendlyError(e));
      return;
    }
    setAlbum((a) => (a ? { ...a, cover_photo_id: photoId } : a));
    setEditing(null);
    toast.show('대표 사진으로 지정했어요.');
  };

  const savePhoto = async (p: Photo, patch: { caption: string; tag: PhotoTag; has_face: boolean }) => {
    const { error: e } = await supabase.from('photos').update(patch).eq('id', p.id);
    if (e) {
      setError(friendlyError(e));
      return;
    }
    setPhotos((v) => v.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));
    setEditing(null);
    toast.show('저장했어요.');
  };

  const deletePhoto = async (p: Photo) => {
    const { error: e } = await supabase.from('photos').delete().eq('id', p.id);
    if (e) {
      setError(friendlyError(e, '삭제하지 못했어요. 다시 눌러주세요.'));
      return;
    }
    setEditing(null);
    toast.show('지웠어요.');
    await load();
  };

  const deleteAlbum = async () => {
    setDeletingAlbum(false);
    const { error: e } = await supabase.from('albums').delete().eq('id', albumId);
    if (e) {
      setError(friendlyError(e));
      return;
    }
    logActivity(session?.id, `앨범 삭제 — ${album?.school ?? ''}`, null);
    router.push('/gallery');
  };

  const download = async (onlyNoFace: boolean) => {
    const list = selecting
      ? photos.filter((p) => selected.includes(p.id))
      : photos.filter((p) => (onlyNoFace ? !p.has_face : true));
    if (list.length === 0) {
      toast.show('내려받을 사진이 없어요.');
      return;
    }
    setZipping(`묶는 중… 0/${list.length}`);
    try {
      await downloadPhotosAsZip(
        list.map((p, i) => {
          const ext = p.url.split('.').pop()?.split('?')[0] || 'webp';
          return {
            url: p.url,
            name: `${safeFileName(`${album?.school ?? ''}_${album?.class_date ?? ''}_${String(i + 1).padStart(2, '0')}`)}.${ext}`,
          };
        }),
        safeFileName(`${album?.school ?? '앨범'}_${album?.class_date ?? ''}`),
        (d, t) => setZipping(`묶는 중… ${d}/${t}`),
      );
      toast.show('다운로드를 시작했어요.');
      setSelected([]);
      setSelecting(false);
    } catch (e) {
      setError(friendlyError(e, '다운로드가 안 됐어요. 장수를 줄여 다시 해보세요.'));
    } finally {
      setZipping('');
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader title="불러오는 중" back="/gallery" />
        <div className="px-4 py-4">
          <CardSkeleton rows={2} />
        </div>
      </>
    );
  }

  if (!album) {
    return (
      <>
        <PageHeader title="앨범" back="/gallery" />
        <div className="px-4 py-4">
          <ErrorBanner message={error || '앨범을 찾지 못했어요.'} onRetry={() => void load()} />
        </div>
      </>
    );
  }

  const faceCount = photos.filter((p) => p.has_face).length;

  return (
    <>
      <PageHeader
        title={album.school}
        subtitle={`${korDateFull(album.class_date)} · ${photos.length}장`}
        back="/gallery"
        right={
          <button
            onClick={() => {
              setSelecting((v) => !v);
              setSelected([]);
            }}
            className="btn-ghost h-9 px-3 text-[13px]"
          >
            {selecting ? '취소' : '선택'}
          </button>
        }
      />

      <div className="px-4 pb-28 pt-3">
        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} onRetry={() => void load()} />
          </div>
        )}

        <div className="card mb-3 p-4">
          <div className="grid grid-cols-2 gap-y-2 text-[13px]">
            <Info label="프로그램" value={app?.title_ko ?? '-'} />
            <Info label="담당 강사" value={nameOf(album.teacher_id)} />
            <Info label="학년/반" value={album.grade ?? '-'} />
            <Info label="참여 인원" value={album.headcount ? `${album.headcount}명` : '-'} />
          </div>
          {faceCount > 0 && (
            <p className="mt-3 rounded-lg bg-yellow-50 px-3 py-2 text-[12px] leading-relaxed text-yellow-900">
              얼굴이 나온 사진 {faceCount}장이 있어요. 외부 자료로 쓸 땐 <b>얼굴 없는 것만 받기</b>를 쓰세요.
            </p>
          )}
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <label htmlFor="album-upload" className="btn-primary cursor-pointer">
            {uploading || '📷 사진 올리기'}
          </label>
          <input
            id="album-upload"
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => void onFiles(Array.from(e.target.files ?? []))}
            className="hidden"
          />
          <button onClick={() => download(true)} disabled={Boolean(zipping)} className="btn-ghost">
            {zipping || '⬇ 얼굴 없는 것만 받기'}
          </button>
        </div>

        {photos.length === 0 ? (
          <EmptyState icon="📷" title="사진이 없어요" desc="폰에서 여러 장 한 번에 올릴 수 있어요. 올릴 때 자동으로 용량을 줄여요." />
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {photos.map((p) => {
              const on = selected.includes(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() =>
                    selecting
                      ? setSelected((v) => (on ? v.filter((x) => x !== p.id) : [...v, p.id]))
                      : setEditing(p)
                  }
                  className="relative aspect-square overflow-hidden rounded-lg bg-neutral-100"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.caption ?? ''} loading="lazy" className="h-full w-full object-cover" />
                  {p.has_face && (
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9.5px] font-bold text-white">
                      얼굴O
                    </span>
                  )}
                  {album.cover_photo_id === p.id && (
                    <span className="absolute bottom-1 left-1 rounded bg-brand px-1 text-[9.5px] font-bold text-white">
                      대표
                    </span>
                  )}
                  {selecting && (
                    <span
                      className={`absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 text-[11px] font-bold ${
                        on ? 'border-brand bg-brand text-white' : 'border-white/80 bg-black/25 text-transparent'
                      }`}
                    >
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <button onClick={() => setDeletingAlbum(true)} className="btn-ghost mt-6 w-full text-red-600">
          앨범 삭제
        </button>
      </div>

      {selecting && selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-[56px] z-30 border-t border-neutral-200 bg-white/97 px-4 py-3 backdrop-blur safe-bottom">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <span className="text-[13.5px] font-bold">{selected.length}장 선택됨</span>
            <button onClick={() => download(false)} disabled={Boolean(zipping)} className="btn-primary ml-auto h-10 px-4 text-[14px]">
              {zipping || 'zip 다운로드'}
            </button>
          </div>
        </div>
      )}

      <PhotoEditor
        photo={editing}
        isCover={editing ? album.cover_photo_id === editing.id : false}
        onClose={() => setEditing(null)}
        onSave={savePhoto}
        onSetCover={setCover}
        onDelete={deletePhoto}
      />

      <ConfirmDialog
        open={deletingAlbum}
        title="앨범을 지울까요?"
        message="이 앨범의 사진 기록이 모두 사라져요."
        onCancel={() => setDeletingAlbum(false)}
        onConfirm={deleteAlbum}
      />

      {toast.node}
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11.5px] text-neutral-500">{label}</p>
      <p className="mt-0.5 font-semibold text-neutral-800">{value}</p>
    </div>
  );
}

function PhotoEditor({
  photo,
  isCover,
  onClose,
  onSave,
  onSetCover,
  onDelete,
}: {
  photo: Photo | null;
  isCover: boolean;
  onClose: () => void;
  onSave: (p: Photo, patch: { caption: string; tag: PhotoTag; has_face: boolean }) => void;
  onSetCover: (id: string) => void;
  onDelete: (p: Photo) => void;
}) {
  const [caption, setCaption] = useState('');
  const [tag, setTag] = useState<PhotoTag>('work');
  const [hasFace, setHasFace] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    if (!photo) return;
    setCaption(photo.caption ?? '');
    setTag(photo.tag);
    setHasFace(photo.has_face);
    setConfirmDel(false);
  }, [photo]);

  if (!photo) return null;

  return (
    <>
      <Sheet
        open={Boolean(photo)}
        onClose={onClose}
        title="사진 정보"
        footer={
          <button onClick={() => onSave(photo, { caption, tag, has_face: hasFace })} className="btn-primary w-full">
            저장
          </button>
        }
      >
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl bg-neutral-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt={photo.caption ?? ''} className="max-h-[46vh] w-full object-contain" />
          </div>

          <div>
            <label className="label" htmlFor="ph-caption">
              캡션
            </label>
            <input
              id="ph-caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="4학년 2반 밀랍 작품"
              className="field"
            />
          </div>

          <div>
            <span className="label">태그</span>
            <div className="flex flex-wrap gap-2">
              {PHOTO_TAGS.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setTag(t.value)}
                  className={`tap rounded-full border px-3.5 text-[14px] font-semibold ${
                    tag === t.value ? 'border-brand bg-brand text-white' : 'border-neutral-300 bg-white text-neutral-600'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-start gap-3 rounded-xl bg-neutral-50 px-3 py-3">
            <input
              type="checkbox"
              checked={hasFace}
              onChange={(e) => setHasFace(e.target.checked)}
              className="mt-0.5 h-5 w-5 accent-[#F26522]"
            />
            <span>
              <span className="block text-[14px] font-semibold">학생 얼굴이 나와요</span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-neutral-500">
                초상권 때문에 체크해두면 외부용 다운로드에서 기본으로 빠져요.
              </span>
            </span>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => onSetCover(photo.id)} disabled={isCover} className="btn-ghost">
              {isCover ? '대표 사진' : '대표로 지정'}
            </button>
            <a href={photo.url} target="_blank" rel="noreferrer" className="btn-ghost">
              원본 열기 ↗
            </a>
          </div>

          <button onClick={() => setConfirmDel(true)} className="btn-ghost w-full text-red-600">
            이 사진 삭제
          </button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmDel}
        title="이 사진을 지울까요?"
        onCancel={() => setConfirmDel(false)}
        onConfirm={() => onDelete(photo)}
      />
    </>
  );
}
