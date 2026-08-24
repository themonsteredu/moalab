'use client';

/**
 * 파일 여러 개를 zip 으로 묶어 내려받는다. jszip 은 필요할 때만 불러온다.
 * (사진·문서 첨부 등 공용)
 */
export async function downloadFilesAsZip(
  photos: { url: string; name: string }[],
  zipName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  const used = new Set<string>();
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    const res = await fetch(p.url);
    if (!res.ok) throw new Error('사진을 내려받지 못했어요.');
    const blob = await res.blob();

    let name = p.name;
    let n = 1;
    while (used.has(name)) {
      const dot = p.name.lastIndexOf('.');
      name = dot > 0 ? `${p.name.slice(0, dot)}-${n}${p.name.slice(dot)}` : `${p.name}-${n}`;
      n++;
    }
    used.add(name);

    zip.file(name, blob);
    onProgress?.(i + 1, photos.length);
  }

  const out = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(out);
  const a = document.createElement('a');
  a.href = url;
  a.download = zipName.endsWith('.zip') ? zipName : `${zipName}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** 파일명에 못 쓰는 글자 정리 */
export function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'photos';
}

/** 예전 이름 — 사진 화면들이 쓰고 있다 */
export const downloadPhotosAsZip = downloadFilesAsZip;
