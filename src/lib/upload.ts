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

/**
 * 이미 만들어진 blob 을 **리사이즈 없이** 그대로 올린다 (한글 파일·PDF 처럼
 * 이미지가 아닌 것). `uploadFile` 은 사진 전용이라 여기 섞지 않는다.
 */
export async function uploadBlob(
  bucket: BucketName,
  blob: Blob,
  fileName: string,
  prefix = 'misc',
): Promise<UploadedFile> {
  const ext = fileName.includes('.') ? fileName.split('.').pop()! : 'bin';
  const path = storagePath(prefix, ext);
  const { error } = await supabase.storage.from(bucket).upload(path, blob, {
    contentType: blob.type || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw new Error(`${error.message} (${bucket})`);
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { url: data.publicUrl, name: fileName, size: blob.size };
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

/* ------------------------------------------------------ 구글 드라이브 복사

   앱에 올린 파일을 드라이브에도 한 벌 넣는다. **줄만 세우고 곧바로 돌아온다** —
   드라이브가 느리거나 꺼져 있어도 강사의 파일 올리기는 이미 끝나 있어야 한다
   (알림이 실패해도 공지가 올라가는 것과 같은 규칙).

   연결 안 됨 / 그 갈래를 꺼둠 / 어느 폴더로 갈지 모름 → 서버가 조용히 넘긴다. */

export interface DriveQueueInput {
  kind: 'plan' | 'receipt' | 'photo' | 'lecture' | 'dept';
  files: { url: string; name: string; mime?: string }[];
  /** 갈래에 따라 필요한 것만 채우면 된다 */
  topic?: string | null;
  appTitle?: string | null;
  month?: string | null;
  date?: string | null;
  school?: string | null;
  deptName?: string | null;
  groupName?: string | null;
  /** 파일 이름 앞에 붙일 말 (뜻 없는 `abc123.webp` 를 알아볼 수 있게) */
  prefix?: string | null;
}

/** 절대 await 하지 않아도 된다. 실패해도 아무 일도 일어나지 않는다 */
export function queueDrive(actorId: string | null | undefined, input: DriveQueueInput): void {
  if (!actorId || input.files.length === 0) return;
  void fetch('/api/drive/queue', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-actor-id': actorId },
    body: JSON.stringify(input),
  }).catch(() => null);
}
