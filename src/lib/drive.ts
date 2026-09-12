import type { DriveKind } from './drivePath';

/**
 * 구글 드라이브 자동 업로드 — **서버 전용.** 클라이언트에서 import 하지 말 것.
 *
 * ## 왜 이렇게 만들었나
 *
 * 이 앱은 **구글 계정 개념이 아예 없다** (PIN 4자리 로그인). 그래서 "강사가
 * 자기 드라이브에 올린다" 는 성립하지 않는다. **원장 계정 하나로 대신 올린다.**
 *
 * · 서비스 계정은 못 쓴다 — 개인 지메일에서는 서비스 계정의 저장 용량이 0이라
 *   `Service Accounts do not have storage quota` 로 막힌다. 공유 드라이브(Shared Drive)가
 *   있어야 하는데 그건 구글 워크스페이스(유료)에만 있다.
 * · 그래서 원장이 한 번 동의하고 받은 **리프레시 토큰**을 서버가 들고 있다가
 *   그때그때 액세스 토큰으로 바꿔 쓴다. 파일 주인은 전부 원장이 된다.
 *
 * ## 절대 앱을 막지 않는다
 *
 * 올릴 것은 바로 보내지 않고 `moalab.drive_uploads` 에 **줄을 세운다.**
 * 드라이브가 느리거나 죽어도 강사의 파일 올리기는 그대로 끝난다
 * (알림이 실패해도 공지가 올라가는 것과 같은 규칙).
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const GOOGLE_DOCUMENT_MIME = 'application/vnd.google-apps.document';

/** app_secrets 의 열쇠 이름 */
export const DRIVE_KEY = 'google_drive';

/** 드라이브 폴더를 만들 최상위 이름. 없으면 만든다 */
export const ROOT_NAME = '모아랩';

type Admin = ReturnType<typeof import('./supabaseAdmin').getAdminClient> extends infer T
  ? Exclude<T, null>
  : never;

/** 동의 화면으로 보낼 때 만든 한 번짜리 확인값 */
export interface OauthState {
  s: string;
  until: number;
}

/**
 * 한 번에 **하나만** 들고 있으면 안 된다.
 *
 * 폰에서는 구글 창이 따로 열리는데, 원장이 그 창을 닫지 않고 관리 화면에서 한 번 더
 * 누르면 확인값이 새 것으로 바뀐다. 그 뒤 **앞의 창**을 끝까지 진행하면
 * *"연결 확인값이 안 맞아요"* 로 튕긴다 — 실제로 그렇게 두 번 튕겼다.
 * 그래서 최근 몇 개를 같이 들고 있다가 그중 하나만 맞으면 받아준다.
 */
export const OAUTH_KEEP = 3;

/** 폰에서는 로그인·경고·동의를 거치느라 10분이 모자란다 */
export const OAUTH_TTL_MS = 30 * 60_000;

export interface DriveMeta {
  /** 최상위 '모아랩' 폴더 id */
  rootId?: string;
  /** 아직 안 쓴 확인값들 (최근 것부터 최대 OAUTH_KEEP 개) */
  oauthStates?: OauthState[];
  /** (구) 한 개짜리 확인값 — 예전에 시작한 연결이 끝날 수 있게 남겨둔다 */
  oauthState?: string;
  oauthUntil?: number;
  /** 연결한 구글 계정 (화면에 보여줄 용도) */
  email?: string;
  /** 켜둔 갈래. 없으면 전부 켠 것으로 본다 */
  kinds?: DriveKind[];
  /** 폴더 경로 → id 캐시. 매번 찾지 않으려고 */
  folders?: Record<string, string>;
}

export interface DriveConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  meta: DriveMeta;
}

/* ------------------------------------------------------------------ 설정 */

/** app_secrets 에서 꺼낸다. `value` 에 JSON 으로 세 값을 함께 넣는다 */
export async function loadConfig(admin: Admin): Promise<DriveConfig | null> {
  const { data } = await admin
    .from('app_secrets')
    .select('value, meta')
    .eq('key', DRIVE_KEY)
    .maybeSingle();
  if (!data?.value) return null;
  try {
    const v = JSON.parse(data.value) as Partial<DriveConfig>;
    if (!v.clientId || !v.clientSecret || !v.refreshToken) return null;
    return {
      clientId: v.clientId,
      clientSecret: v.clientSecret,
      refreshToken: v.refreshToken,
      meta: (data.meta ?? {}) as DriveMeta,
    };
  } catch {
    return null;
  }
}

export async function saveMeta(admin: Admin, meta: DriveMeta): Promise<void> {
  await admin.from('app_secrets').update({ meta }).eq('key', DRIVE_KEY);
}

/* -------------------------------------------------------------- 액세스 토큰
   리프레시 토큰은 오래 살고, 액세스 토큰은 1시간이다.
   따뜻한 인스턴스 안에서는 다시 받지 않게 잠깐 들고 있는다. */

const tokenCache = new Map<string, { token: string; until: number }>();

export async function getAccessToken(cfg: DriveConfig): Promise<string | null> {
  const hit = tokenCache.get(cfg.refreshToken);
  if (hit && hit.until > Date.now() + 60_000) return hit.token;

  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: cfg.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) return null;
    tokenCache.set(cfg.refreshToken, {
      token: j.access_token,
      until: Date.now() + (j.expires_in ?? 3600) * 1000,
    });
    return j.access_token;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ 폴더 */

/** 드라이브 검색 문법에서 작은따옴표는 반드시 escape 해야 한다 (학교 이름에 들어갈 수 있다) */
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** `1_기획개발부` · `01. 홍보` 처럼 앞에 붙은 번호를 떼어낸다 */
const stripNo = (s: string) => s.replace(/^\s*\d+\s*[._)\-]?\s*/, '').trim();

/**
 * 부모 밑에서 이름으로 폴더를 찾고, 없으면 만든다.
 *
 * ⚠️ **번호가 붙은 폴더도 같은 것으로 본다.** 원장이 손으로 만든 폴더는
 * `1_기획개발부` 인데 앱이 아는 부서 이름은 `기획개발부` 라, 이름이 정확히 같은
 * 것만 찾으면 **폴더가 두 개로 갈라진다.** `1_`·`01. ` 같은 앞머리를 떼고 견줘서
 * 이미 있는 폴더를 그대로 쓴다.
 */
async function findOrCreateFolder(access: string, parentId: string, name: string): Promise<string | null> {
  const q = `'${esc(parentId)}' in parents and name = '${esc(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
  try {
    const found = await fetch(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`, {
      headers: { authorization: `Bearer ${access}` },
    });
    // 검색 자체가 실패한 것을 "폴더 없음"으로 보면 429/5xx 때 중복 폴더를 만들게 된다.
    if (!found.ok) return null;
    const j = (await found.json()) as { files?: { id: string }[] };
    if (j.files?.[0]?.id) return j.files[0].id;

    // 정확히 같은 이름이 없으면 번호 붙은 것을 찾아본다 (`1_기획개발부`)
    const loose = `'${esc(parentId)}' in parents and name contains '${esc(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
    const alt = await fetch(`${API}/files?q=${encodeURIComponent(loose)}&fields=files(id,name)&pageSize=20`, {
      headers: { authorization: `Bearer ${access}` },
    });
    if (!alt.ok) return null;
    const altJson = (await alt.json()) as { files?: { id: string; name: string }[] };
    const hit = (altJson.files ?? []).find((f) => stripNo(f.name) === name);
    if (hit) return hit.id;
    const made = await fetch(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    if (!made.ok) return null;
    return ((await made.json()) as { id?: string }).id ?? null;
  } catch {
    return null;
  }
}

/** 최상위 '모아랩' 폴더 — 이미 있으면 그것을 쓴다 (원장이 손으로 만든 그 폴더다) */
export async function ensureRoot(access: string): Promise<string | null> {
  const q = `'root' in parents and name = '${esc(ROOT_NAME)}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
  try {
    const res = await fetch(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`, {
      headers: { authorization: `Bearer ${access}` },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { files?: { id: string }[] };
    if (j.files?.[0]?.id) return j.files[0].id;
  } catch {
    return null;
  }
  return findOrCreateFolder(access, 'root', ROOT_NAME);
}

/**
 * `프로그램/미술/제과제빵` 같은 경로를 따라 내려가며 없는 폴더는 만든다.
 * 찾은 것은 캐시에 적어둔다 — 파일 열 장을 올릴 때 같은 길을 열 번 묻지 않는다.
 */
export async function ensurePath(
  access: string,
  rootId: string,
  path: string,
  cache: Record<string, string>,
): Promise<string | null> {
  const segs = path.split('/').map((s) => s.trim()).filter(Boolean);
  let cur = rootId;
  let key = '';
  for (const seg of segs) {
    key = key ? `${key}/${seg}` : seg;
    const hit = cache[key];
    if (hit) {
      cur = hit;
      continue;
    }
    const id = await findOrCreateFolder(access, cur, seg);
    if (!id) return null;
    cache[key] = id;
    cur = id;
  }
  return cur;
}

/* ------------------------------------------------------------------ 올리기 */

/** 같은 이름이 이미 있으면 그 id 를 준다 — 두 벌을 안 만들고 **그 파일을 덮어쓴다** */
async function findFile(access: string, folderId: string, name: string): Promise<string | null> {
  const q = `'${esc(folderId)}' in parents and name = '${esc(name)}' and trashed = false`;
  try {
    const res = await fetch(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`, {
      headers: { authorization: `Bearer ${access}` },
    });
    if (!res.ok) return null;
    return ((await res.json()) as { files?: { id: string }[] }).files?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

/** 같은 이름의 Google 문서를 찾는다. 일반 HTML 파일과 섞이지 않게 MIME까지 제한한다. */
async function findGoogleDocument(
  access: string,
  folderId: string,
  name: string,
): Promise<{ id: string | null } | { error: string }> {
  const q = `'${esc(folderId)}' in parents and name = '${esc(name)}' and mimeType = '${GOOGLE_DOCUMENT_MIME}' and trashed = false`;
  try {
    const res = await fetch(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`, {
      headers: { authorization: `Bearer ${access}` },
    });
    if (!res.ok) return { error: driveError(res.status, await res.text().catch(() => '')) };
    return { id: ((await res.json()) as { files?: { id: string }[] }).files?.[0]?.id ?? null };
  } catch {
    return { error: '드라이브에서 기존 문서를 확인하지 못했어요.' };
  }
}

/** 파일 한 개를 드라이브에 올린다. 올라간 파일 id 를 준다 */
export async function uploadFile(
  access: string,
  folderId: string,
  name: string,
  mime: string,
  bytes: Blob,
): Promise<{ id: string } | { error: string }> {
  /* 같은 이름이 이미 있으면 **그 파일을 덮어쓴다.**
     예전엔 건너뛰었는데, 그러면 같은 자리에 새 판을 올려도 드라이브에는 옛 파일이
     그대로 남는다 — 원장이 *"그 위치의 파일을 새로 만들 경우 항상 새로운 파일이
     대체되는 구조로"* 라고 한 것이 이것이다.
     · 새로 만들지 않고 **그 파일의 내용만 갈아끼운다** — 드라이브 파일 id 가 그대로라
       공유 링크와 지난 판(구글이 스스로 남기는 버전 기록)이 안 끊긴다
     · 판(버전)을 올릴 때는 이름 앞에 판 번호가 붙으므로(`2판_지도안.hwp`) 이름이 달라
       덮어쓰기가 아니라 새 파일로 올라간다 — 그건 원래 그렇게 두는 게 맞다 */
  const already = await findFile(access, folderId, name);

  const boundary = `moalab${Math.random().toString(36).slice(2)}`;
  // 덮어쓸 때는 부모를 다시 주지 않는다 (그 자리에 그대로 있다)
  const meta = already ? { name } : { name, parents: [folderId] };
  const head =
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\ncontent-type: ${mime}\r\n\r\n`;
  const body = new Blob([head, bytes, `\r\n--${boundary}--`]);

  try {
    const res = await fetch(
      already
        ? `${UPLOAD}/${encodeURIComponent(already)}?uploadType=multipart&fields=id`
        : `${UPLOAD}?uploadType=multipart&fields=id`,
      {
        method: already ? 'PATCH' : 'POST',
        headers: { authorization: `Bearer ${access}`, 'content-type': `multipart/related; boundary=${boundary}` },
        body,
      },
    );
    if (!res.ok) return { error: driveError(res.status, await res.text().catch(() => '')) };
    const id = ((await res.json()) as { id?: string }).id;
    return id ? { id } : { error: '드라이브가 파일 번호를 안 줬어요.' };
  } catch {
    return { error: '드라이브에 닿지 못했어요. 인터넷이 불안정한 것 같아요.' };
  }
}

/**
 * HTML을 편집 가능한 Google 문서로 올린다.
 *
 * `existingId`가 있으면 그 문서의 내용과 이름만 바꾼다. 따라서 공유 링크는 유지되고,
 * 사용자가 Drive에서 파일 이름을 직접 바꿔도 다음 저장 때 새 문서가 중복 생성되지 않는다.
 */
export async function uploadGoogleDocument(
  access: string,
  folderId: string,
  name: string,
  html: Blob,
  existingId?: string | null,
): Promise<{ id: string } | { error: string }> {
  const lookup = existingId ? { id: existingId } : await findGoogleDocument(access, folderId, name);
  if ('error' in lookup) return lookup;
  const found = lookup.id;

  const send = async (id?: string | null) => {
    const boundary = `moalabdoc${Math.random().toString(36).slice(2)}`;
    // 기존 Google 문서는 MIME과 부모를 바꿀 수 없다. 새 문서일 때만 변환 MIME과 폴더를 준다.
    const meta = id
      ? { name }
      : { name, mimeType: GOOGLE_DOCUMENT_MIME, parents: [folderId] };
    const head =
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\ncontent-type: text/html; charset=UTF-8\r\n\r\n`;
    const body = new Blob([head, html, `\r\n--${boundary}--`]);
    return fetch(
      id
        ? `${UPLOAD}/${encodeURIComponent(id)}?uploadType=multipart&fields=id`
        : `${UPLOAD}?uploadType=multipart&fields=id`,
      {
        method: id ? 'PATCH' : 'POST',
        headers: {
          authorization: `Bearer ${access}`,
          'content-type': `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );
  };

  try {
    let res = await send(found);
    // 사용자가 Drive에서 기존 문서를 지웠다면 남아 있는 id에 매달리지 않고 새로 만든다.
    if (found && res.status === 404) res = await send(null);
    if (!res.ok) return { error: driveError(res.status, await res.text().catch(() => '')) };
    const id = ((await res.json()) as { id?: string }).id;
    return id ? { id } : { error: '드라이브가 문서 번호를 안 줬어요.' };
  } catch {
    return { error: '드라이브에 닿지 못했어요. 인터넷이 불안정한 것 같아요.' };
  }
}

/** 구글이 준 에러를 원장이 읽을 수 있는 한글로 (friendlyError 와 같은 갈래) */
export function driveError(status: number, raw: string): string {
  if (status === 401) return '구글 연결이 만료됐어요. 관리 화면에서 다시 연결해주세요.';
  if (status === 403 && raw.includes('storageQuota')) return '구글 드라이브 저장 공간이 꽉 찼어요.';
  if (status === 403) return '드라이브에 쓸 권한이 없어요. 다시 연결해주세요.';
  if (status === 404) return '올릴 폴더를 못 찾았어요. 폴더가 지워졌는지 확인해주세요.';
  if (status === 429 || status === 503) return '구글이 잠시 바빠요. 조금 뒤 다시 시도돼요.';
  return `드라이브가 거절했어요 (${status}${raw ? ` — ${raw.slice(0, 80)}` : ''})`;
}
