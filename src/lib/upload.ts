'use client';

import { supabase } from './supabase';
import { resizeImage, storagePath } from './image';

export type BucketName = 'comment-files' | 'cost-photos' | 'gallery';

export interface UploadedFile {
  url: string;
  name: string;
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
  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { url: data.publicUrl, name: file.name };
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
