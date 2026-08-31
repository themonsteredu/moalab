import type { Metadata } from 'next';
import { Foot, LegalHeader, Li, Section } from '@/components/LegalDoc';

export const metadata: Metadata = {
  title: '개인정보처리방침 — 모아랩 업무',
  description: '모아랩 업무 워크스페이스가 어떤 정보를 다루는지 적어둔 문서입니다.',
};

/**
 * 개인정보처리방침.
 *
 * **왜 만들었나** — 구글 OAuth 동의 화면을 `게시(프로덕션)` 로 바꾸려면 구글이
 * 홈페이지·개인정보처리방침·서비스약관 세 링크를 요구한다. 테스트 상태로 두면
 * 리프레시 토큰이 7일마다 만료돼서 매주 드라이브 연결이 끊긴다.
 *
 * ⚠️ 이 장은 **로그인 없이 보여야 한다.** 구글이 사람 없이 열어보기 때문이다.
 * 그래서 `(app)` 레이아웃 밖에 두고 로그인 가드를 붙이지 않았다.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <LegalHeader title="개인정보처리방침" />

      <Section title="이 앱은 무엇인가요">
        <p>
          <b>모아랩 업무</b>는 모아킷·모아랩의 <b>내부 직원 전용</b> 업무 관리 도구입니다. 원장 1명과
          강사 4~6명이 씁니다. 회원가입이 없고, 밖에 파는 서비스가 아니며, 광고를 싣지 않습니다.
        </p>
      </Section>

      <Section title="어떤 정보를 다루나요">
        <ul className="space-y-1.5">
          <Li>
            <b>사람</b> — 이름, 역할(원장·강사), 로그인용 PIN 4자리. 주민번호·주소·전화번호는 받지 않습니다.
          </Li>
          <Li>
            <b>업무 기록</b> — 업무·일정·공지·검증 지적·역할분장·부서 요청·대화 내용.
          </Li>
          <Li>
            <b>올린 파일</b> — 수업계획안·교육안·활동지, 수업 사진, 지출 영수증 사진.
          </Li>
          <Li>
            <b>지출 기록</b> — 날짜·금액·구분·사용 내용. 카드번호나 계좌번호는 저장하지 않습니다.
          </Li>
        </ul>
        <p className="mt-2.5 text-neutral-500">
          위치 정보, 연락처 목록, 통화 기록, 광고 식별자는 <b>수집하지 않습니다.</b>
        </p>
      </Section>

      <Section title="구글 계정 정보는 어떻게 쓰나요">
        <p>
          원장이 <b>구글 드라이브 자동 업로드</b>를 켠 경우에만 구글 계정에 연결합니다. 이때 받는 권한과
          쓰임은 이것뿐입니다.
        </p>
        <ul className="mt-2 space-y-1.5">
          <Li>
            <b>구글 드라이브 접근 권한</b>(<code className="text-[12px]">auth/drive</code>) — 앱에 올라온
            문서·영수증·수업 사진·강의계획서를 <b>원장 본인의 드라이브 폴더에 한 벌 더 복사</b>하는 데만
            씁니다. 폴더를 만들고 파일을 넣는 것 외의 일은 하지 않습니다.
          </Li>
          <Li>
            <b>계정 이메일 주소</b> — 관리 화면에 &ldquo;어느 계정에 연결됐는지&rdquo;를 보여주기 위해서만 씁니다.
          </Li>
        </ul>
        <p className="mt-2.5">
          구글에서 받은 접근 토큰은 서버에만 보관하며 <b>화면으로 내려보내지 않습니다.</b> 구글 계정
          비밀번호는 이 앱이 받지도, 보지도, 저장하지도 않습니다 — 로그인은 구글 자체 화면에서 이루어집니다.
        </p>
        <p className="mt-2.5">
          구글에서 가져온 정보를 <b>광고에 쓰거나, 팔거나, 다른 곳에 넘기지 않으며</b>, 사람이 열어보지
          않습니다. 모아랩은 구글 사용자 데이터를 위에 적은 &ldquo;눈에 보이는 기능&rdquo; 외의 목적으로 쓰지 않고,
          AI 모델 학습에도 쓰지 않습니다.
        </p>
      </Section>

      <Section title="어디에 저장되나요">
        <ul className="space-y-1.5">
          <Li>
            업무 데이터와 파일은 <b>Supabase</b>(데이터베이스·파일 저장소)에 보관합니다.
          </Li>
          <Li>
            앱은 <b>Vercel</b>에서 돌아갑니다.
          </Li>
          <Li>
            드라이브 자동 업로드를 켠 경우, 복사본이 <b>원장 개인의 구글 드라이브</b>에 저장됩니다.
          </Li>
        </ul>
      </Section>

      <Section title="누가 볼 수 있나요">
        <p>
          모아랩 내부 구성원만 봅니다. <b>외부에 제공하거나 판매하지 않습니다.</b> 1:1 대화와 부서 대화는
          서버에서 참여자인지 확인한 뒤에만 내려주며, 다른 사람은 대화방 주소를 알아도 볼 수 없습니다.
        </p>
      </Section>

      <Section title="얼마나 보관하나요">
        <p>
          업무 기록은 회사의 업무 기록으로서 보관합니다. 지우고 싶은 자료가 있으면 앱 안에서 지우거나
          아래 연락처로 알려주시면 지웁니다. 구글 드라이브 연결은 <b>관리 화면에서 언제든 끊을 수</b> 있고,
          끊으면 저장해둔 토큰을 지우고 구글에도 권한 회수를 요청합니다.
        </p>
        <p className="mt-2.5">
          구글 계정 쪽에서 직접 끊으실 수도 있습니다 —{' '}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noreferrer"
            className="font-bold text-brand-700 underline"
          >
            구글 계정 &gt; 보안 &gt; 타사 앱
          </a>
        </p>
      </Section>

      <Section title="문의">
        <p>
          모아킷·모아랩 · <a href="mailto:cuteheea0@gmail.com" className="font-bold text-brand-700 underline">cuteheea0@gmail.com</a>
        </p>
      </Section>

      <Foot />
    </main>
  );
}
