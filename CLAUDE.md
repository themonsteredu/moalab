# 모아랩 업무 워크스페이스 (moalab-work)

모아킷/모아랩 **내부 전용** 업무 관리 웹앱. 외부 판매용 아님.
사용자는 원장 1명 + 강사 4~6명. **전원 스마트폰 접속이 기본**, PC는 원장이 주로 쓴다.

## 이 프로젝트가 해결하려는 것

노션으로 관리하면서 안 되던 세 가지:

1. 강사가 폰에서 보면 표가 가로로 길어서 자기 할 일을 못 찾는다
   → **강사 홈은 "내 할 일" 부터, 원장 홈은 "전체 현황·일정" 부터** (`isAdmin` 으로 순서만 바꾼다)
2. 웹앱을 수정해도 이전 검증 체크가 남아 뭘 다시 봐야 할지 모른다 → **검증 라운드**
3. 원가·작품 사진·수업계획안이 흩어져 있다
   → **프로그램 페이지 한 장에 전부** (아래 "프로그램 페이지" 참고)

## 가장 중요한 전제

> **관리 대상 웹앱은 계속 늘어난다.**
> 앱을 추가할 때 **코드를 절대 건드리지 않는다.** 원장이 화면에서 버튼으로 추가한다.

앱 관련 화면·쿼리는 전부 데이터 기반이다. 앱이 21개든 200개든
`useAppsOverview` 의 쿼리 수는 그대로다. 새 앱을 추가할 때 수정할 파일은 **없다**.

---

## 기술 스택

| | |
|---|---|
| 프레임워크 | Next.js 14 (App Router) + TypeScript |
| 스타일 | Tailwind CSS · **다크 대시보드** (브랜드 `#F26522`, 보조 `#2AD1C8`) |
| 폰트 | 에스코어드림 (S-Core Dream, OFL) — jsDelivr CDN |
| DB / Storage | Supabase |
| 로그인 | 자체 PIN 4자리 (Supabase Auth 안 씀) |
| 배포 | Vercel |

---

## 시작하기

```bash
# 1) 의존성
npm install

# 2) 환경변수
cp .env.example .env.local
#    Supabase 대시보드 > Project Settings > API 에서 세 값을 복사해 채운다

# 3) DB 스키마
#    Supabase 대시보드 > SQL Editor 에 supabase/schema.sql 을 통째로 붙여넣고 실행
#    (여러 번 실행해도 안전 / Storage 버킷 3개와 초기 멤버 5명까지 같이 만들어짐)

# 4) ★ Supabase 설정 > API > Exposed schemas 에 moalab 추가 후 Save
#    이걸 빼먹으면 앱이 데이터를 하나도 못 읽는다

# 5) 개발 서버
npm run dev        # http://localhost:3000
```

**초기 PIN** — 로그인한 뒤 `관리 > 멤버`에서 반드시 바꿀 것.

| 이름 | PIN | 역할 |
|---|---|---|
| 강양희 | 0000 | admin |
| 이서은 | 1111 | teacher |
| 주은서 | 2222 | teacher |
| 강지연 | 3333 | teacher |
| 윤창진 | 4444 | teacher |

### Vercel 배포

프로젝트 환경변수에 `.env.local` 과 같은 세 개를 넣는다.
`SUPABASE_SERVICE_ROLE_KEY` 는 **절대 `NEXT_PUBLIC_` 을 붙이지 않는다** (서버에서만 씀).

---

## 화면 구조

하단 탭 5개 + 원장 전용 1개

| 경로 | 탭 | 내용 |
|---|---|---|
| `/home` | 홈 | 대시보드 — 인사 배너 · **달력** · 통계 3장 · 마감 타임라인 · 내 할 일 · 팀 현황<br>(PC 는 오른쪽에 팀 활동 · 주간 활동 · 프로그램 구성) |
| `/apps` | 프로그램 | 목록(리스트·보드·갤러리) → `/apps/[id]` **프로그램 페이지** |
| `/cost` | 원가 | 원가표 목록 → `/cost/[sheetId]` 계산서 |
| `/gallery` | 갤러리 | 앨범/사진 → `/gallery/[albumId]` |
| `/schedule` | 일정 | 월간·주간 달력 |
| `/admin` | 관리 | **원장만.** 멤버, 앱 추가, 전체 현황, 활동 로그 |

---

---

## 전용 스키마 `moalab` — 이걸 먼저 알아야 한다

이 Supabase 프로젝트는 **다른 앱과 같이 쓴다.** `public` 스키마에는 이미
`members` · `apps` · `schedules` · `photos` 같은 남의 테이블이 있다.
그래서 모아랩 테이블은 **전부 `moalab` 스키마 안**에 있다.

- 브라우저·서버 클라이언트 모두 `db: { schema: 'moalab' }` 로 만든다
  (`src/lib/supabase.ts`, `src/lib/supabaseAdmin.ts`)
  → 앱 코드에서는 그냥 `supabase.from('apps')` 라고 쓰면 `moalab.apps` 로 간다.
- SQL 로 직접 볼 때만 스키마를 붙인다: `select * from moalab.apps;`
- Storage 버킷도 같은 이유로 `moalab-` 접두어를 붙였다
  (`moalab-comment-files`, `moalab-cost-photos`, `moalab-gallery`, `moalab-plans`).
  접두어 없이 `gallery` 를 쓰면 남의 버킷을 공개로 덮어쓸 위험이 있다.
- **Supabase 설정 > API > Exposed schemas 에 `moalab` 이 없으면 아무것도 안 된다.**
  이 경우 `friendlyError()` 가 그 사실을 한글로 알려준다.

> 새 테이블을 추가할 때도 반드시 `moalab.` 을 붙이고, `schema.sql` 의
> RLS 목록(`internal_all` 루프)에 테이블 이름을 넣어줘야 한다.

### ⚠️ `service_role` 권한을 빼먹지 말 것

`public` 스키마와 달리 **커스텀 스키마는 Supabase 기본 권한이 안 붙는다.**
`anon`/`authenticated` 만 주고 `service_role` 을 빠뜨리면
`/api/login` 이 `permission denied for schema moalab` 으로 죽는다
(로그인 화면에 이름은 뜨는데 PIN 을 넣으면 실패 → 원인 찾기 어렵다).

```sql
grant usage on schema moalab to anon, authenticated, service_role;
grant all on all tables in schema moalab to anon, authenticated, service_role;
grant all on moalab.members to service_role;   -- members 는 anon revoke 후에도 남겨야 함
```

검증 환경을 만들 때도 **슈퍼유저가 아니라 진짜 `service_role`** 로 테스트해야
이 구멍이 잡힌다.

---

## 프로그램 페이지 — "따로국밥" 을 없앤 곳

노션에서 가장 답답했던 게 **웹앱 · 검증 · 수업계획안 · 원가 · 샘플이미지가 다 딴 데** 있던 것이다.
그래서 `/apps/[id]` 한 페이지에 전부 올렸다. 위에서 아래로 읽으면 그게 곧 일하는 순서다.

| 섹션 | 내용 | 데이터 |
|---|---|---|
| 속성 블록 | 상태·라운드·제작자·검증자·마감·학년·링크 | `apps`, `app_reviewers` |
| ✅ 검증 | 현재 라운드 체크리스트 + 지난 라운드 | `rounds`, `checks` |
| 📄 수업계획안 | 본문 + 지도안·활동지 파일 | `apps.plan_body`, `plan_files` |
| 💰 원가 | 1인당·총원가·마진 요약 (고칠 땐 `/cost/[id]`) | `cost_sheets`, `cost_items` |
| 🖼️ 샘플 이미지 | 제안서용 예시 작품 | `app_samples` |
| 📸 수업 사진 | 실제 수업 기록 (앨범 링크) | `albums`, `photos` |
| 💬 댓글 | 스크린샷 첨부 | `comments`, `comment_files` |

- 상단 목차 칩은 스크롤에 따라 따라간다 (`IntersectionObserver`).
- **샘플 이미지 vs 수업 사진**: 샘플은 "이 수업 하면 이런 게 나온다"(제안서용),
  수업 사진은 "언제 어느 학교에서 뭘 했다"(기록용). 목적이 달라 저장소를 나눴다.

### 목록은 노션 데이터베이스처럼

`/apps` 는 **리스트 · 보드(상태별) · 갤러리** 세 가지 보기를 제공한다 (선택은 localStorage 에 기억).
카드마다 **검증·계획안·원가·샘플·사진** 5개가 채워졌는지 배지로 보인다.
"빠진 것" 필터로 *원가 없는 프로그램만* 같은 걸 바로 뽑을 수 있다.
관련 계산은 `useAppsOverview` 의 `Completeness` 에 모여 있다.

---

## 핵심 도메인 규칙

### 검증 체크리스트 — 고정 5항목

`src/lib/types.ts` 의 `CHECK_ITEMS`. **개수를 바꾸면 DB `checks.item_no` 제약과 어긋난다.**

1. 폰에서 정상적으로 열린다
2. 게이트 코드 / 반코드 입력이 된다
3. AI 응답이 정상이다 (오류·무응답 없음)
4. 학생 입력값이 저장된다
5. 오탈자·용어·학년 수준 확인

각 항목은 `none | pass | fail`. **`fail` 을 고르면 메모 없이는 저장이 막힌다.**
(`src/components/Checklist.tsx`) — "봤다"인지 "다 돌려봤다"인지 구분이 안 되던 게 노션의 가장 큰 문제였다.

### 검증 라운드

앱을 수정하면 이전 검증은 무효다.

- 앱 등록 → 1차 라운드 + (검증자 × 5) 체크 레코드 자동 생성
- 앱 상세의 **"수정했음 → 재검증 요청"** → 수정 내용 입력 필수 → **N+1차 라운드**
- 새 라운드는 모든 체크가 `none` 으로 리셋
- 이전 라운드는 접힌 상태로 보존 (누가 언제 뭘 지적했는지 남는다)

관련 코드는 전부 `src/lib/verify.ts` 에 모여 있다.

### 상태 자동 계산

앱 `status` 는 **사람이 고르지 않는다.** 현재 라운드 체크 결과로만 결정된다
(`src/lib/status.ts` → `computeStatus`).

| 조건 | 상태 | 색 |
|---|---|---|
| 검증자 전원 × 5항목 전부 `pass` | `done` 검증 완료 | 초록 |
| 하나라도 `fail` | `fixing` 수정 필요 | 빨강 |
| 그 외 | `pending` 진행 중 | 회색 |

체크를 저장할 때마다 `recomputeAppStatus(appId)` 가 DB 의 `status` 를 다시 쓴다.

### 원가 계산

`src/lib/cost.ts`

```
소모품:   1인당 = (묶음가격 ÷ 묶음수량) × 1인사용량
          총   = 1인당 × 참여인원

재사용품: 1회당 = 묶음가격 ÷ 감가회차
          1인당 = 1회당 ÷ 참여인원
          총   = 1회당
```

- **강사비·교통비**처럼 수업 한 번에 통으로 나가는 돈은 `재사용 + 감가회차 1` 로 넣으면
  1회당 = 그 금액, 1인당 = 금액 ÷ 인원 이 된다.
- 인원수를 20 → 25 로 바꾸면 재사용품 1인당 단가가 **즉시** 내려간다.
  학교와 인원 협의할 때 이 숫자를 보고 판단한다.
- 인원·판매가는 화면에서 즉시 반영되지만 **저장은 명시적 버튼**이다.

### 로그인 / 권한

- 회원가입 없음. 이름 버튼 → PIN 4자리. 세션은 localStorage 30일 (`src/lib/session.tsx`).
- **PIN 검증은 서버에서만** 한다 (`/api/login`, service_role 키).
  `members` 테이블은 RLS 로 anon 접근을 전면 차단했고,
  브라우저는 pin 컬럼이 없는 `members_public` 뷰만 읽는다.
- 멤버 추가/수정/삭제도 서버 라우트(`/api/members`)에서 `x-actor-id` 로 admin 을 확인한 뒤 처리.

---

## 파일 지도

```
supabase/schema.sql          moalab 스키마·테이블·RLS·Storage 버킷·초기 멤버 (한 번에 실행)
supabase/seed-apps.sql       노션에서 이관한 웹앱 21개 일괄 등록 (재실행 안전)

src/lib/
  types.ts                   DB 타입 + CHECK_ITEMS(고정 5항목) + 카테고리 상수
  supabase.ts                브라우저 클라이언트(schema: moalab) + friendlyError (한글 에러 변환)
  supabaseAdmin.ts           서버 전용 service_role 클라이언트(schema: moalab)
  session.tsx                로그인 세션 컨텍스트 (localStorage 30일)
  verify.ts                  라운드 생성 / 체크 생성 / 상태 재계산
  status.ts                  computeStatus, roundProgress, 상태 배지 스타일
  cost.ts                    원가 계산, 시트 합계, 구매 목록(장보기)
  image.ts                   업로드 전 리사이즈 (긴 변 1600px, WebP)
  upload.ts                  리사이즈 → Storage 업로드 → 공개 URL
  zip.ts                     사진 zip 다운로드 (jszip 은 지연 로딩)
  log.ts                     활동 로그 기록 (실패해도 본 작업을 막지 않음)
  format.ts                  원화·날짜·D-day 표기
  useMembers.ts              멤버 목록 훅
  useAppsOverview.ts         앱 요약(상태·진행률·미해결 댓글) — 목록 화면 공용

src/components/
  ui.tsx                     Sheet, ConfirmDialog, Skeleton, EmptyState, Toast 등
  BottomNav.tsx              하단 탭 (원장이면 '관리' 탭 추가)
  PageHeader.tsx             상단 헤더
  AppForm.tsx                앱 추가/수정 — 저장 시 라운드·체크 자동 생성
  AppCard.tsx                앱 목록 카드 (리스트/보드/갤러리 3종 + PieceRow)
  LessonPlan.tsx             수업계획안 본문 + 파일 첨부
  CostInline.tsx             프로그램 페이지 안의 원가 요약
  SampleImages.tsx           프로그램 샘플 이미지
  Brand.tsx                  브랜드 마크 · 멤버 아바타
  Icon.tsx                   인라인 SVG 아이콘 모음 (이모지 대체)
  MonthCalendar.tsx          월간 달력 그리드 (홈·일정 공용)
  Charts.tsx                 Sparkline · WeekBars · Timeline · StatCard (SVG 직접)
  TeamBoard.tsx              누가 뭘 했나/안 했나 — 사람 단위 협업 현황
  Checklist.tsx              검증자 1명의 5항목 체크 (명시적 저장 / fail 메모 강제)
  RoundHistory.tsx           지난 라운드 접힌 기록
  CommentThread.tsx          댓글 + 사진 첨부 + 해결됨 토글
  CostItemForm.tsx           원가 항목 입력 (사진·구매처·재사용)
  CostChart.tsx              구분별 도넛 + 막대 (SVG 직접 그림, 라이브러리 없음)
```

---

## 반드시 지킬 것 (수정할 때도)

- **모바일 우선.** 모든 화면을 폭 **375px** 에서 먼저 확인한다. 가로 스크롤이 나오면 실패다.
- 버튼은 최소 **44px** 높이 (`.tap` 클래스).
- 표를 모바일에서 그대로 쓰지 말고 **카드**로 바꾼다.
- 사진 업로드는 **반드시** `uploadFile()` 을 거친다 (리사이즈 후 저장).
- 로딩 중에 빈 화면을 두지 말고 **스켈레톤**을 보여준다.
- 자동저장 금지. **명시적 저장 버튼**. (강사들이 잘못 눌렀다 날리면 안 된다)
- **다크 테마다.** `tailwind.config.ts` 에서 `neutral` 스케일을 통째로 뒤집어 놨다
  (50 = 가장 어두움, 900 = 가장 밝음). 그래서 화면 코드는 라이트 기준 그대로
  `text-neutral-900`(본문) / `bg-neutral-50`(옅은 배경) 처럼 쓰면 된다.
  카드 배경은 `bg-surface`, 한 단계 뜬 면은 `bg-raised`, 페이지는 `bg-canvas`.
  · 새 색을 쓸 땐 config 에 그 색의 50·100(어두운 틴트)과 700·800(밝은 글자)을 정의할 것
  · `bg-white` 를 새로 쓰지 말 것 — `bg-surface` 를 쓴다
- **PC 는 왼쪽 사이드바, 폰은 하단 탭.** 둘 다 `src/components/BottomNav.tsx`
  (`SideNav` / `BottomNav`). 분기는 `lg:` 브레이크포인트 하나뿐이다.
- **이모지를 UI 에 쓰지 않는다.** 기기마다 모양·크기가 달라 화면이 지저분해진다.
  아이콘은 전부 `src/components/Icon.tsx` (인라인 SVG). 새 아이콘도 여기에 추가한다.
- **세로 스크롤을 아낀다.** 폰 한 화면이 812px 인 걸 기준으로 생각한다.
  · 프로그램 페이지 섹션은 접이식 — 기본은 '검증'만 펼침
  · 검증 카드도 내 것만 펼침 (남의 건 통과 개수만)
  · **빈 섹션은 아예 그리지 않는다.** "없어요" 카드가 쌓이면 스크롤만 길어진다
- 폰트는 **에스코어드림**. `globals.css` 에서 굵기 4개(400·600·700·900)만 불러온다.
  한글 폰트는 굵기당 1MB 가까이 되니 굵기를 늘리지 말 것. `font-display: swap` 이라
  폰트를 받는 동안에도 시스템 폰트로 글자가 먼저 보인다.
- 에러 메시지는 **한글**로, 개발자 용어 없이.
  `Failed to fetch` (X) → "인터넷 연결이 불안정해요. 잠시 후 다시 눌러주세요." (O)
  변환은 `friendlyError()` 에서 한다.

---

## 진행 상황

### ✅ 1단계 — 뼈대와 검증
- [x] Next.js 14 + TypeScript + Tailwind 프로젝트 구성
- [x] Supabase 연결, `supabase/schema.sql` 전체 스키마 (테이블 15개 + RLS + Storage 3버킷)
- [x] PIN 로그인 (30일 세션, 서버 검증, PIN 노출 차단)
- [x] 앱 추가 폼 + 앱 목록 (검색·필터·상태 배지·진행률)
- [x] 검증 체크리스트 5항목 + 라운드 + 상태 자동 계산
- [x] 홈 대시보드 (내 할 일, D-day, 진행률, 원장용 강사별 현황·지연·활동)

### ✅ 2단계 — 소통
- [x] 댓글 + 사진 첨부 (카메라롤 바로 열림) + 해결됨 토글
- [x] 일정 달력 (월간/주간, 마감 자동 표시, 회의·방문 직접 추가)

### ✅ 3단계 — 원가
- [x] 원가계산서 (재료 사진, 구매처·링크, 소모품/재사용 자동계산)
- [x] 하단 고정 요약 바 (인원 슬라이더, 1인당·총 원가, 판매가, 마진율 음수 빨강)
- [x] 구분별 소계 도넛/막대 그래프
- [x] 구매 목록 보기 (구매처별 묶음, 사진 포함, 장보기 리스트 복사)
- [x] 원가표 복제, 카톡 붙여넣기용 텍스트 복사

### ✅ 4단계 — 갤러리
- [x] 앨범 (학교 + 날짜 + 프로그램) + 여러 장 업로드 + 자동 리사이즈(1600px WebP)
- [x] 캡션·태그·얼굴 포함 체크·대표 사진 지정
- [x] 필터 (학교/프로그램/기간/태그/얼굴없는것만) + 선택 zip 다운로드
- [x] 앱 상세 → "이 프로그램 작품 보기"

### ✅ 5단계 — 마무리
- [x] 활동 로그 (원장 관리 화면에서만 조회, 검색 가능)
- [x] 카톡 복사, 진행률 그래프

### 다음에 하면 좋을 것

- [ ] 사진 Storage 실제 파일 삭제 — 지금은 DB 레코드만 지운다 (버킷에 파일이 남음).
      쌓이면 Supabase Storage 정리 스크립트가 필요하다.
- [ ] 수업계획안 첨부 (스펙 0번의 "수업계획안" — 현재는 앱의 '제작 목적' 텍스트로만 있음)
- [ ] 댓글에 답글(스레드) — 지금은 평면 목록
- [ ] 앱 목록 정렬 옵션 (마감순 고정 → 이름순/상태순 선택)
- [ ] PWA 아이콘 (`public/manifest.webmanifest` 의 `icons` 가 비어 있음)

---

## 작업 방식

- 이 문서에 단계 완료 시 무엇을 만들었는지, 다음에 뭘 할지 기록한다.
- 환경변수는 `.env.local`, 공유용 템플릿은 `.env.example`.
- 스키마 변경은 반드시 `supabase/schema.sql` 에도 반영한다 (여러 번 실행해도 안전하게).
