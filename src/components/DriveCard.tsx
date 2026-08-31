'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from '@/lib/session';
import { DRIVE_KINDS, driveKindLabel, type DriveKind } from '@/lib/drivePath';
import { Icon } from '@/components/Icon';
import { Collapsible, ConfirmDialog, ErrorBanner, Skeleton } from '@/components/ui';

interface Status {
  connected: boolean;
  hasKeys: boolean;
  email?: string | null;
  kinds?: DriveKind[] | null;
  pending: number;
  failed: number;
  missing?: boolean;
  detail?: string;
}

interface Row {
  id: string;
  kind: string;
  file_name: string;
  folder_path: string;
  status: string;
  error: string | null;
  tries: number;
}

/**
 * 구글 드라이브 자동 업로드 — 원장 전용.
 *
 * **왜 원장 계정 하나로 올리나**: 이 앱은 PIN 로그인이라 구글 계정 개념이 없다.
 * 강사가 앱에 올리면 서버가 원장 계정으로 드라이브에 한 벌 더 넣는다.
 *
 * 시크릿과 토큰은 `app_secrets`(PIN 과 똑같이 잠긴 표)에 있고 **화면으로 절대
 * 안 내려온다** — 연결됐는지, 어느 계정인지만 보여준다 (`AiKeyCard` 와 같은 규칙).
 */
export function DriveCard() {
  const { session } = useSession();
  const params = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [killing, setKilling] = useState(false);

  const headers = useCallback(
    () => ({ 'Content-Type': 'application/json', 'x-actor-id': session?.id ?? '' }),
    [session],
  );

  const load = useCallback(async () => {
    if (!session?.id) return;
    try {
      const res = await fetch('/api/settings/drive', { headers: headers(), cache: 'no-store' });
      const j: Status = await res.json();
      setStatus(j);
      // 못 올린 게 있을 때만 목록까지 받아둔다 (Collapsible 은 펼침 신호를 안 준다)
      if ((j.pending ?? 0) + (j.failed ?? 0) > 0) {
        const r = await fetch('/api/drive/run', { headers: headers(), cache: 'no-store' }).catch(() => null);
        if (r?.ok) setRows((await r.json()).rows ?? []);
      } else {
        setRows([]);
      }
    } catch {
      setError('연결 상태를 못 읽었어요.');
      // 못 읽어도 카드는 그려야 한다 — 안 그러면 스켈레톤에 갇혀 에러가 안 보인다
      setStatus((s) => s ?? { connected: false, hasKeys: false, pending: 0, failed: 0 });
    }
  }, [session, headers]);

  useEffect(() => {
    void load();
  }, [load]);

  /* 구글에서 돌아오면 결과가 주소에 실려 온다 (그 자리는 우리 헤더가 없어서 이렇게 온다) */
  useEffect(() => {
    const ok = params.get('driveOk');
    const bad = params.get('driveError');
    if (ok) setNote(ok);
    if (bad) setError(bad);
    if (!ok && !bad) return;
    void load();

    /* 읽었으면 주소에서 지운다. **안 지우면 같은 화면만 맴돈다** —
       폰에서 뒤로 가기를 누르면 방금 다녀온 구글 콜백 주소가 히스토리에 남아 있어서
       이미 쓴 확인값으로 그 자리를 다시 밟고, 같은 오류로 또 돌아온다.
       원장이 *"이거로만 되돌아옴"* 이라고 한 것이 이것이다 */
    const url = new URL(window.location.href);
    url.searchParams.delete('driveOk');
    url.searchParams.delete('driveError');
    window.history.replaceState(null, '', url.pathname + url.search);
  }, [params, load]);

  const saveKeys = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/settings/drive', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ clientId, clientSecret: secret }),
      });
      const j = await res.json();
      if (!res.ok) return setError(j.error ?? '저장하지 못했어요.');
      setEditing(false);
      setClientId('');
      setSecret('');
      setNote('저장했어요. 이제 아래 `구글 계정 연결` 을 눌러주세요.');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const toggleKind = async (k: DriveKind) => {
    const cur = status?.kinds ?? DRIVE_KINDS.map((d) => d.value);
    const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
    setStatus((s) => (s ? { ...s, kinds: next } : s));
    await fetch('/api/settings/drive', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ kinds: next }),
    }).catch(() => null);
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await fetch('/api/settings/drive', { method: 'DELETE', headers: headers() });
      setKilling(false);
      setNote('연결을 끊었어요. 이미 올라간 파일은 드라이브에 그대로 있어요.');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/drive/run?retry=1', { method: 'POST', headers: headers() });
      const j = await res.json();
      if (!res.ok) setError(j.error ?? '다시 시도하지 못했어요.');
      else setNote(`${j.done ?? 0}개 올렸어요.${j.failed ? ` ${j.failed}개는 또 실패했어요.` : ''}`);
      setRows(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!session) return null;

  /* 아직 못 읽었을 때 `1. 열쇠 넣기` 빈 칸을 그리면 **저장해둔 열쇠가 사라진 것처럼 보인다.**
     실제로 원장이 그 화면을 보고 열쇠를 다시 넣으려 했다 (로딩엔 스켈레톤 규칙과 같은 이유) */
  if (!status) {
    return (
      <div className="card p-4">
        <Skeleton className="mb-3 h-5 w-2/3" />
        <Skeleton className="mb-3 h-3.5 w-full" />
        <Skeleton className="h-11 w-full rounded-xl" />
      </div>
    );
  }

  const on = status?.kinds ?? DRIVE_KINDS.map((d) => d.value);

  /* 이미 연결돼 있으면 한 줄로 접는다 — 다 끝난 설정이 큰 카드로 자리를 먹으면 안 된다
     (PushToggle·AiKeyCard 와 같은 판단) */
  if (status?.connected && !editing && status.pending === 0 && status.failed === 0) {
    return (
      <div className="card flex items-center gap-2 px-3.5 py-2.5">
        <Icon name="check" size={13} className="shrink-0 text-green-600" />
        <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-neutral-600">
          구글 드라이브 연결됨{status.email ? ` · ${status.email}` : ''}
        </p>
        <button
          onClick={() => setEditing(true)}
          className="tap -my-3 shrink-0 px-1 text-[12.5px] font-bold text-neutral-400"
        >
          설정
        </button>
      </div>
    );
  }

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-[15px] font-bold">
            <Icon name="doc" size={15} />
            구글 드라이브 자동 업로드
          </h2>
          <p className="mt-0.5 text-[12px] leading-snug text-neutral-400">
            앱에 올린 파일이 원장님 드라이브에도 한 벌 들어가요.
            {status?.email ? ` (${status.email})` : ''}
          </p>
        </div>
        {status?.connected && (
          <span className="chip shrink-0 bg-green-100 text-green-800">연결됨</span>
        )}
      </div>

      {error && (
        <div className="mb-3">
          <ErrorBanner message={error} />
        </div>
      )}
      {note && (
        <p className="mb-3 rounded-lg bg-green-100 px-3 py-2 text-[12.5px] font-semibold text-green-800">{note}</p>
      )}

      {status?.missing && (
        <p className="mb-3 rounded-lg bg-amber-100 px-3 py-2 text-[12.5px] leading-relaxed text-amber-800">
          아직 표가 없어요. 채팅으로 드린 SQL 을 Supabase 에 한 번 붙여넣어주세요.
        </p>
      )}

      {/* 1단계 — 구글 클라우드에서 받은 열쇠 */}
      {(!status?.hasKeys || editing) && (
        <div className="mb-3 space-y-2">
          <p className="text-[12.5px] font-bold text-neutral-500">1. 구글에서 받은 열쇠 넣기</p>
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="클라이언트 ID (...apps.googleusercontent.com)"
            className="field text-[13px]"
          />
          <input
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            type="password"
            placeholder="클라이언트 보안 비밀"
            className="field text-[13px]"
          />
          <div className="flex gap-2">
            <button
              onClick={() => void saveKeys()}
              disabled={busy || !clientId.trim() || !secret.trim()}
              className="btn-primary flex-1 text-[14px]"
            >
              {busy ? '저장 중…' : '저장'}
            </button>
            {editing && (
              <button onClick={() => setEditing(false)} className="btn-ghost text-[14px]">
                취소
              </button>
            )}
          </div>
        </div>
      )}

      {/* 2단계 — 구글 계정 동의 */}
      {status?.hasKeys && (
        <a
          href={`/api/settings/drive/start?actor=${session.id}`}
          className={`tap mb-3 w-full rounded-xl text-[14px] font-bold ${
            status.connected ? 'btn-ghost' : 'btn-primary'
          }`}
        >
          {status.connected ? '구글 계정 다시 연결' : '2. 구글 계정 연결하기'}
        </a>
      )}

      {/* 3단계 — 무엇을 올릴지 */}
      {status?.connected && (
        <div className="mb-3">
          <p className="mb-1.5 text-[12.5px] font-bold text-neutral-500">무엇을 올릴까요</p>
          <div className="space-y-1.5">
            {DRIVE_KINDS.map((k) => (
              <button
                key={k.value}
                onClick={() => void toggleKind(k.value)}
                aria-pressed={on.includes(k.value)}
                className={`flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition ${
                  on.includes(k.value) ? 'pick-on' : 'border-neutral-200 bg-surface text-neutral-500'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border ${
                    on.includes(k.value) ? 'border-brand bg-brand text-white' : 'border-neutral-300'
                  }`}
                >
                  {on.includes(k.value) && <Icon name="check" size={11} strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-bold">{k.label}</span>
                  <span className="block text-[11.5px] leading-snug opacity-80">
                    {k.hint} → {k.where}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 못 올린 것 */}
      {status && (status.pending > 0 || status.failed > 0) && (
        <div className="mb-3">
          <Collapsible
            id="drive-queue"
            dense
            title="못 올린 파일"
            badge={
              <span className="flex items-center gap-1">
                {status.pending > 0 && (
                  <span className="chip bg-neutral-100 text-neutral-600">기다리는 중 {status.pending}</span>
                )}
                {status.failed > 0 && <span className="chip bg-red-100 text-red-700">실패 {status.failed}</span>}
              </span>
            }
          >
            <ul className="space-y-1.5">
              {(rows ?? []).map((r) => (
                <li key={r.id} className="rounded-lg bg-raised px-3 py-2">
                  <p className="truncate text-[12.5px] font-semibold text-neutral-700">
                    {driveKindLabel(r.kind)} · {r.file_name}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-neutral-400">{r.folder_path}</p>
                  {r.error && <p className="mt-0.5 text-[11.5px] text-red-600">{r.error}</p>}
                </li>
              ))}
              {rows !== null && rows.length === 0 && (
                <li className="py-2 text-center text-[12.5px] text-neutral-400">목록이 비었어요.</li>
              )}
            </ul>
            <button onClick={() => void retry()} disabled={busy} className="btn-ghost mt-2 w-full text-[13.5px]">
              {busy ? '올리는 중…' : '다시 시도'}
            </button>
          </Collapsible>
        </div>
      )}

      {status?.connected && (
        <button
          onClick={() => setKilling(true)}
          className="tap -my-2 w-full text-[12.5px] font-bold text-neutral-400"
        >
          연결 끊기
        </button>
      )}

      {/* 처음 쓰는 사람을 위한 순서 — 이 단계는 원장이 직접 해야 한다 */}
      {!status?.connected && (
        <Collapsible id="drive-howto" dense title="구글에서 열쇠 받는 법 (처음 한 번)">
          <ol className="space-y-1.5 text-[12.5px] leading-relaxed text-neutral-600">
            <li>
              1. <b>console.cloud.google.com</b> 에서 프로젝트를 하나 만들어요.
            </li>
            <li>
              2. <b>API 및 서비스 &gt; 라이브러리</b> 에서 <b>Google Drive API</b> 를 켜요.
            </li>
            <li>
              3. <b>OAuth 동의 화면</b> — 외부(External) 로 만들고, 만든 뒤 반드시{' '}
              <b className="text-red-600">게시(프로덕션)</b> 를 눌러요. 테스트 상태로 두면 연결이{' '}
              <b>7일마다 끊어져요.</b>
            </li>
            <li>
              4. <b>사용자 인증 정보 &gt; OAuth 클라이언트 ID</b> — 웹 애플리케이션으로 만들고,
              <b> 승인된 리디렉션 URI</b> 에 아래를 그대로 넣어요.
            </li>
            <li>
              <code className="mt-1 block break-all rounded-lg bg-raised px-2.5 py-2 text-[11.5px] text-neutral-700">
                {typeof window !== 'undefined' ? window.location.origin : ''}/api/settings/drive/callback
              </code>
            </li>
            <li>5. 만들어진 ID 와 보안 비밀을 위 칸에 붙여넣고 저장해요.</li>
            <li className="text-neutral-400">
              ※ 연결할 때 &quot;확인되지 않은 앱&quot; 경고가 뜨는데, 원장님 본인 앱이라 <b>고급 → 계속</b> 을
              누르면 돼요.
            </li>
          </ol>
        </Collapsible>
      )}

      <ConfirmDialog
        open={killing}
        title="구글 드라이브 연결을 끊을까요?"
        message="앞으로 자동으로 안 올라가요. 이미 올라간 파일은 드라이브에 그대로 있어요."
        confirmLabel="연결 끊기"
        onConfirm={() => void disconnect()}
        onCancel={() => setKilling(false)}
      />
    </div>
  );
}
