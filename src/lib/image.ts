/**
 * 폰에서 올린 원본 사진은 4~8MB 씩 된다. 그대로 저장하면 스토리지가 터지고
 * 목록 로딩도 느려지므로 업로드 전에 항상 여기를 통과시킨다.
 * 긴 변 1600px, WebP 변환 (품질 0.82).
 */
const MAX_EDGE = 1600;
const QUALITY = 0.82;

export interface ResizedImage {
  blob: Blob;
  ext: string;
  width: number;
  height: number;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('사진을 읽지 못했어요. 다른 사진으로 시도해주세요.'));
    };
    img.src = url;
  });
}

export async function resizeImage(file: File, maxEdge = MAX_EDGE): Promise<ResizedImage> {
  // 이미지가 아니면 손대지 않고 그대로 (댓글에 pdf 등을 붙일 수도 있음)
  if (!file.type.startsWith('image/')) {
    const ext = file.name.split('.').pop() || 'bin';
    return { blob: file, ext, width: 0, height: 0 };
  }

  const img = await loadImage(file);
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { blob: file, ext: file.name.split('.').pop() || 'jpg', width: w, height: h };
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', QUALITY));
  if (blob && blob.size > 0) return { blob, ext: 'webp', width: w, height: h };

  // WebP 미지원 브라우저 대비
  const jpg = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', QUALITY));
  if (jpg) return { blob: jpg, ext: 'jpg', width: w, height: h };
  return { blob: file, ext: file.name.split('.').pop() || 'jpg', width: w, height: h };
}

/** 충돌 없는 저장 경로 만들기 */
export function storagePath(prefix: string, ext: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}/${Date.now()}-${rand}.${ext}`;
}
