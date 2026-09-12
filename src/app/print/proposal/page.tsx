'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/session';
import { EMPTY_ORG, type OrgProfile } from '@/lib/types';
import { PRINT_DRAFT_KEY, type ProposalInput } from '@/lib/proposal';
import { downloadProposalHwpx } from '@/lib/hwpx';
import { ProposalSheet } from '@/components/ProposalSheet';
import { Icon } from '@/components/Icon';

/**
 * 제안서 인쇄 / PDF 저장 — `/proposal` 화면의 **미리보기·인쇄** 에서 새 창으로 연다.
 *
 * 내용은 주소가 아니라 **이 기기의 저장소**(localStorage)로 넘겨받는다 — 프로그램 여러 개의
 * 소개·목표·사진 주소를 주소창에 실으면 수천 자가 되어 잘린다. 같은 기기의 새 창이라
 * 저장소를 그대로 읽을 수 있다. 다른 기기에서는 제안서 화면에서 다시 열면 된다.
 *
 * 다른 인쇄 화면과 같이 **PDF 라이브러리를 안 쓴다** (브라우저 인쇄). (app) 레이아웃 밖이라
 * 로그인 가드를 직접 붙인다.
 */
export default function PrintProposalPage() {
  const router = useRouter();
  const { session, loading } = useSession();
  const [data, setData] = useState<{ input: ProposalInput; org: OrgProfile } | null | undefined>(undefined);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!loading && !session) router.replace('/login');
  }, [session, loading, router]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PRINT_DRAFT_KEY);
      if (!raw) {
        setData(null);
        return;
      }
      const parsed = JSON.parse(raw) as { input: ProposalInput; org?: OrgProfile };
      setData({ input: parsed.input, org: { ...EMPTY_ORG, ...(parsed.org ?? {}) } });
    } catch {
      setData(null);
    }
  }, []);

  const hwp = async () => {
    if (!data) return;
    setMsg('한글 파일을 만드는 중…');
    try {
      const r = await downloadProposalHwpx(data.input, data.org);
      setMsg(r.skipped > 0 ? `받았어요. 사진 ${r.skipped}장은 못 넣었어요.` : '받았어요. 한글에서 열어보세요.');
    } catch {
      setMsg('한글 파일을 만들지 못했어요. 잠시 후 다시 눌러주세요.');
    }
  };

  if (loading || !session || data === undefined) return null;

  return (
    <main className="mx-auto max-w-[820px] bg-white p-6 text-black print:p-0">
      <div className="no-print mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-raised p-3">
        <button onClick={() => window.print()} disabled={!data} className="btn-primary px-3.5 text-[14px]">
          <Icon name="printer" size={15} />
          인쇄 / PDF 저장
        </button>
        <button onClick={() => void hwp()} disabled={!data} className="btn-ghost px-3 text-[13px]">
          <Icon name="download" size={14} />
          한글 파일 받기
        </button>
        <button onClick={() => window.close()} className="btn-ghost px-3 text-[13px]">
          닫기
        </button>
        <p className="w-full text-[12px] leading-relaxed text-neutral-500">
          {msg || (
            <>
              아이폰은 <b>공유 → 프린트</b> 를 누른 뒤 미리보기를 두 손가락으로 벌리면 PDF 로 저장됩니다.
              PC 는 인쇄 대화상자에서 대상을 <b>PDF로 저장</b> 으로 바꾸세요.
            </>
          )}
        </p>
      </div>

      {data ? (
        <ProposalSheet input={data.input} org={data.org} />
      ) : (
        <p className="rounded-xl border border-neutral-200 p-4 text-[13px] text-neutral-600">
          보여줄 제안서가 없어요. <b>제안서</b> 화면에서 프로그램을 고르고 <b>미리보기 · 인쇄</b> 를 눌러 여기로 오세요.
        </p>
      )}
    </main>
  );
}
