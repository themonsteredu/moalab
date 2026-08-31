import type { Metadata } from 'next';
import { Foot, LegalHeader, Li, Section } from '@/components/LegalDoc';

export const metadata: Metadata = {
  title: '서비스 약관 — 모아랩 업무',
  description: '모아랩 업무 워크스페이스를 쓰는 규칙입니다.',
};

/**
 * 서비스 약관.
 *
 * 개인정보처리방침과 같은 이유로 만들었다 (구글 OAuth 게시에 필요).
 * 로그인 없이 보여야 해서 `(app)` 레이아웃 밖에 둔다.
 */
export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <LegalHeader title="서비스 약관" />

      <Section title="누가 쓰나요">
        <p>
          <b>모아랩 업무</b>는 모아킷·모아랩의 <b>내부 직원 전용</b> 도구입니다. 회사가 계정을 만들어준
          사람만 쓸 수 있고, 회원가입이나 외부 신청을 받지 않습니다. 무료이며 결제 기능이 없습니다.
        </p>
      </Section>

      <Section title="지켜주실 것">
        <ul className="space-y-1.5">
          <Li>PIN 을 남에게 알려주지 않기. 계정은 사람마다 하나입니다.</Li>
          <Li>업무와 관계없는 자료를 올리지 않기.</Li>
          <Li>
            학생 사진처럼 <b>다른 사람이 찍힌 자료</b>는 필요한 범위에서만 올리고, 밖으로 내보내지 않기.
          </Li>
          <Li>앱에서 본 회사 자료를 무단으로 밖에 공유하지 않기.</Li>
        </ul>
      </Section>

      <Section title="올린 자료">
        <p>
          업무 중에 올린 자료는 <b>회사의 업무 기록</b>으로 다룹니다. 회사는 이 자료를 업무 목적으로
          보관·이용하며, 외부에 판매하거나 광고에 쓰지 않습니다.
        </p>
      </Section>

      <Section title="구글 드라이브 연결">
        <p>
          원장이 연결을 켜면, 앱에 올라온 파일이 <b>원장 개인 구글 드라이브</b>에 한 벌 더 복사됩니다.
          무엇을 어떻게 다루는지는{' '}
          <a href="/privacy" className="font-bold text-brand-700 underline">
            개인정보처리방침
          </a>
          에 적어뒀습니다. 연결은 관리 화면에서 언제든 끊을 수 있습니다.
        </p>
      </Section>

      <Section title="중단·변경">
        <p>
          내부 도구라서 기능이 자주 바뀌고, 예고 없이 멈출 수 있습니다. 중요한 자료는 앱에만 두지 마시고
          따로 보관해주세요. 이 앱은 <b>있는 그대로</b> 제공되며, 회사는 자료 유실이나 서비스 중단에 대해
          법이 정한 범위를 넘는 책임을 지지 않습니다.
        </p>
      </Section>

      <Section title="문의">
        <p>
          모아킷·모아랩 ·{' '}
          <a href="mailto:cuteheea0@gmail.com" className="font-bold text-brand-700 underline">
            cuteheea0@gmail.com
          </a>
        </p>
      </Section>

      <Foot />
    </main>
  );
}
