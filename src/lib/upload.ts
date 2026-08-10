'use client';

import { supabase } from './supabase';
import { resizeImage, storagePath } from './image';

/** 버킷 이름에 moalab- 접두어를 붙여 같은 프로젝트의 다른 앱 버킷과 섞이지 않게 한다 */
export type BucketName =
  | 'moalab-comment-files'
  | 'moalab-cost-photos'
  | 'moalab-gallery'
  | 'moalab-plans'
  | 'moalab-notices'
  | 'moalab-receipts';

export interface UploadedFile {
  url: string;
  name: string;
  /** 저장된 실제 크기 (이미지는 리사이즈 후 크기) */
  size: number;
}

/** 리사이즈 → 업로드 → 공개 URL 반환. 사진은 반드시 이 함수를 거친다. */
export async function uploadFile(
  bucket: BucketName,
  file: File,
  prefix = 'misc',
): Promise<UploadedFile> {
  const { blob, ext } = await resizeImage(file);
  const path = storagePath(prefix, ext);

  const { error } = await supabase.storage.from(bucket).upload(path, blob, {
    contentType: blob.type || file.type || 'application/octet-stream',
    upsert: false,
  });
  // 어느 버킷이 문제인지 메시지에 남긴다 — 폰에서는 콘솔을 못 보니
  // "저장소가 없다" 만 뜨면 어느 걸 만들어야 하는지 알 수 없다
  if (error) throw new Error(`${error.message} (${bucket})`);

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { url: data.publicUrl, name: file.name, size: blob.size };
}

export async function uploadMany(
  bucket: BucketName,
  files: File[],
  prefix = 'misc',
  onProgress?: (done: number, total: number) => void,
): Promise<UploadedFile[]> {
  const out: UploadedFile[] = [];
  for (let i = 0; i < files.length; i++) {
    out.push(await uploadFile(bucket, files[i], prefix));
    onProgress?.(i + 1, files.length);
  }
  return out;
}
