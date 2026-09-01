-- =====================================================================
--  모아랩 업무 워크스페이스 (moalab-work) — Supabase 스키마
--
--  Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 실행하세요.
--  여러 번 실행해도 안전합니다.
--
--  ★ 모든 테이블을 전용 스키마 'moalab' 안에 만듭니다.
--    이 프로젝트에 이미 다른 앱의 members / apps / schedules / photos 같은
--    테이블이 있어도 절대 건드리지 않습니다.
--
--  ★ 실행 후 대시보드에서 한 가지를 더 해주셔야 합니다:
--    Settings → API → Exposed schemas 에 moalab 을 추가하고 Save.
--    (기본값 public, graphql_public 은 그대로 두고 moalab 만 추가)
--    이걸 안 하면 앱이 "찾을 수 없다"는 에러를 냅니다.
-- =====================================================================

create extension if not exists "pgcrypto";

create schema if not exists moalab;
-- service_role 을 빼먹으면 PIN 로그인(/api/login)이 "permission denied for schema" 로 죽는다
grant usage on schema moalab to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1. 멤버
-- ---------------------------------------------------------------------
create table if not exists moalab.members (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  pin         text not null,                       -- 4자리
  role        text not null default 'teacher',     -- 'admin' | 'teacher'
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. 웹앱
-- ---------------------------------------------------------------------
create table if not exists moalab.apps (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,              -- ai-bakery
  title_ko      text not null,                     -- 제과제빵
  url           text,
  purpose       text,
  target_grade  text,
  creator_id    uuid references moalab.members(id) on delete set null,
  due_date      date,
  current_round int not null default 1,
  status        text not null default 'pending',   -- pending | fixing | recheck | done
  archived      boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists apps_status_idx   on moalab.apps(status);
create index if not exists apps_due_date_idx on moalab.apps(due_date);

-- status 는 computeStatus 가 계산한 세 값만 들어간다 (사람이 고르는 값이 아니다).
-- 예전 코드가 지적 상태('recheck')를 그대로 써 넣은 행이 있었는데, 그 값은
-- STATUS_META 에 없어서 인쇄 화면(/print/[id])이 죽는다. 다시는 못 들어가게 막는다.
update moalab.apps set status = 'fixing' where status not in ('pending','fixing','done');
do $$ begin
  alter table moalab.apps
    add constraint apps_status_check check (status in ('pending','fixing','done'));
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------
-- 2-1. 주제 — 프로그램 목록을 묶는 기준
--
--   주제는 한 곳(프로그램계획 > 주제 관리)에서 만들고 고치고 순서를 바꾼다.
--   프로그램마다 매번 타이핑하지 않는다.
--   여기 이름을 고치면 그 주제를 쓰는 프로그램 전부에 한 번에 반영된다 (FK 라서).
-- ---------------------------------------------------------------------
create table if not exists moalab.topics (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists topics_order_idx on moalab.topics(sort_order, name);

-- 주제를 지우면 그 프로그램들은 '주제 없음' 으로 돌아간다 (프로그램은 안 지운다)
alter table moalab.apps add column if not exists topic_id uuid
  references moalab.topics(id) on delete set null;
create index if not exists apps_topic_id_idx on moalab.apps(topic_id);

-- (구) 자유 입력 주제. 아래 블록이 topics 로 옮긴 뒤에는 안 쓴다 — 기록용으로만 남긴다
alter table moalab.apps add column if not exists topic text;

-- 예전에 자유 입력으로 넣어둔 주제를 topics 로 옮긴다 (여러 번 실행해도 안전)
insert into moalab.topics (name, sort_order)
select distinct btrim(a.topic), 0
from moalab.apps a
where a.topic is not null and btrim(a.topic) <> ''
on conflict (name) do nothing;

update moalab.apps a
set topic_id = t.id
from moalab.topics t
where a.topic_id is null and btrim(coalesce(a.topic, '')) = t.name;

-- ---------------------------------------------------------------------
-- 3. 검증자 배정 (앱 1 : 검증자 N)
-- ---------------------------------------------------------------------
create table if not exists moalab.app_reviewers (
  id        uuid primary key default gen_random_uuid(),
  app_id    uuid not null references moalab.apps(id) on delete cascade,
  member_id uuid not null references moalab.members(id) on delete cascade,
  unique (app_id, member_id)
);
create index if not exists app_reviewers_app_idx    on moalab.app_reviewers(app_id);
create index if not exists app_reviewers_member_idx on moalab.app_reviewers(member_id);

-- ---------------------------------------------------------------------
-- 4. 검증 라운드
-- ---------------------------------------------------------------------
create table if not exists moalab.rounds (
  id          uuid primary key default gen_random_uuid(),
  app_id      uuid not null references moalab.apps(id) on delete cascade,
  round_no    int not null,
  change_note text,                                -- 무엇을 수정했는지
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz,
  unique (app_id, round_no)
);
create index if not exists rounds_app_idx on moalab.rounds(app_id);

-- ---------------------------------------------------------------------
-- 5. 검증 — 캡처 + 지적 + 답변
--
--    검증은 "고정 5항목에 O/X" 가 아니라 **화면을 캡처해서 뭐가 이상한지 적는 것**이다.
--    5항목 표는 정작 어디가 왜 안 되는지가 안 남아서 걷어냈다.
--
--    findings         지적 한 건 = 캡처 여러 장 + 무엇이 이상한지
--    finding_replies  그 지적에 대한 답변 스레드 (수정완료 / 수정불가 / 다시확인 + 글)
--    round_signoffs   검증자가 "이 라운드 다 봤다" 고 표시한 기록
-- ---------------------------------------------------------------------
create table if not exists moalab.findings (
  id         uuid primary key default gen_random_uuid(),
  app_id     uuid not null references moalab.apps(id) on delete cascade,
  round_id   uuid references moalab.rounds(id) on delete set null,
  member_id  uuid references moalab.members(id) on delete set null,   -- 지적한 사람
  body       text not null,                        -- 무엇이 어떻게 이상한지 (필수)
  -- open 지적됨 / fixed 수정완료 / recheck 다시확인 / wontfix 수정불가 / closed 확인완료
  status     text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists findings_app_idx   on moalab.findings(app_id, created_at desc);
create index if not exists findings_round_idx on moalab.findings(round_id);

-- 캡처 이미지. 말로만 적으면 어디를 말하는지 못 찾는다
create table if not exists moalab.finding_files (
  id         uuid primary key default gen_random_uuid(),
  finding_id uuid not null references moalab.findings(id) on delete cascade,
  file_url   text not null,
  file_name  text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists finding_files_finding_idx on moalab.finding_files(finding_id, sort_order);

-- 답변 스레드. 제작자만이 아니라 누구나 붙일 수 있다
create table if not exists moalab.finding_replies (
  id         uuid primary key default gen_random_uuid(),
  finding_id uuid not null references moalab.findings(id) on delete cascade,
  member_id  uuid references moalab.members(id) on delete set null,
  state      text not null,                        -- fixed | wontfix | recheck
  body       text not null,                        -- 글 없이 상태만 바꾸는 건 막는다
  created_at timestamptz not null default now()
);
create index if not exists finding_replies_finding_idx on moalab.finding_replies(finding_id, created_at);

create table if not exists moalab.round_signoffs (
  round_id  uuid not null references moalab.rounds(id) on delete cascade,
  member_id uuid not null references moalab.members(id) on delete cascade,
  signed_at timestamptz not null default now(),
  primary key (round_id, member_id)
);

-- ---------------------------------------------------------------------
-- 5-1. (구) 고정 5항목 체크 — 더 이상 화면에서 쓰지 않는다
--      지난 기록을 지우지 않으려고 테이블만 남겨뒀다. 새 코드는 findings 를 쓴다.
-- ---------------------------------------------------------------------
create table if not exists moalab.checks (
  id         uuid primary key default gen_random_uuid(),
  round_id   uuid not null references moalab.rounds(id) on delete cascade,
  member_id  uuid not null references moalab.members(id) on delete cascade,
  item_no    int  not null check (item_no between 1 and 5),
  result     text not null default 'none',         -- none | pass | fail
  note       text,                                 -- fail 이면 필수 (앱에서 강제)
  updated_at timestamptz not null default now(),
  unique (round_id, member_id, item_no)
);
create index if not exists checks_round_idx  on moalab.checks(round_id);
create index if not exists checks_member_idx on moalab.checks(member_id);

-- 지적사항에 대한 제작자·원장의 답변
--   none      아직 답 없음
--   fixed     "업데이트 완료" — 검증자에게 다시 봐달라는 신호
--   explained 사유만 적음 (이건 이래서 이렇습니다)
alter table moalab.checks add column if not exists response       text;
alter table moalab.checks add column if not exists response_state text not null default 'none';
alter table moalab.checks add column if not exists responded_by   uuid references moalab.members(id) on delete set null;
alter table moalab.checks add column if not exists responded_at   timestamptz;

-- 지적할 때 붙이는 캡처 이미지 (말로만 적으면 뭘 말하는지 못 찾는다)
create table if not exists moalab.check_files (
  id         uuid primary key default gen_random_uuid(),
  check_id   uuid not null references moalab.checks(id) on delete cascade,
  file_url   text not null,
  file_name  text,
  created_at timestamptz not null default now()
);
create index if not exists check_files_check_idx on moalab.check_files(check_id);

-- ---------------------------------------------------------------------
-- 6. 댓글
-- ---------------------------------------------------------------------
create table if not exists moalab.comments (
  id         uuid primary key default gen_random_uuid(),
  app_id     uuid not null references moalab.apps(id) on delete cascade,
  member_id  uuid references moalab.members(id) on delete set null,
  body       text not null,
  resolved   boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists comments_app_idx on moalab.comments(app_id, created_at desc);

create table if not exists moalab.comment_files (
  id         uuid primary key default gen_random_uuid(),
  comment_id uuid not null references moalab.comments(id) on delete cascade,
  file_url   text not null,
  file_name  text
);
create index if not exists comment_files_comment_idx on moalab.comment_files(comment_id);

-- ---------------------------------------------------------------------
-- 7. 원가계산서
-- ---------------------------------------------------------------------
create table if not exists moalab.cost_sheets (
  id         uuid primary key default gen_random_uuid(),
  app_id     uuid references moalab.apps(id) on delete set null,
  title      text not null,
  headcount  int not null default 20,
  sale_price numeric not null default 0,           -- 1인당 판매가
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists moalab.cost_items (
  id              uuid primary key default gen_random_uuid(),
  sheet_id        uuid not null references moalab.cost_sheets(id) on delete cascade,
  category        text not null default 'material', -- material|api|instructor|transport|etc
  name            text not null,
  vendor          text,
  buy_url         text,
  spec            text,
  pack_qty        numeric not null default 1,
  pack_price      numeric not null default 0,
  qty_per_person  numeric not null default 1,
  reusable        boolean not null default false,
  reuse_count     int,
  memo            text,
  sort_order      int not null default 0
);
create index if not exists cost_items_sheet_idx on moalab.cost_items(sheet_id, sort_order);

create table if not exists moalab.cost_item_photos (
  id        uuid primary key default gen_random_uuid(),
  item_id   uuid not null references moalab.cost_items(id) on delete cascade,
  photo_url text not null
);
create index if not exists cost_item_photos_item_idx on moalab.cost_item_photos(item_id);

-- ---------------------------------------------------------------------
-- 7-1. 수익 프로젝트
--
-- 광주중학교·모두의창업처럼 매출과 비용을 따로 정산하는 사업 단위다.
-- 교육 프로그램(apps)과는 다르며, 필요할 때만 창작자·원가표 참조용으로 연결한다.
-- ---------------------------------------------------------------------
create table if not exists moalab.revenue_projects (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(btrim(name)) between 1 and 120),
  linked_app_id  uuid references moalab.apps(id) on delete set null,
  archived       boolean not null default false,
  created_by     uuid references moalab.members(id) on delete set null,
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
create index if not exists revenue_projects_active_idx
  on moalab.revenue_projects(archived, updated_at desc);
create index if not exists revenue_projects_linked_app_idx
  on moalab.revenue_projects(linked_app_id);

-- ---------------------------------------------------------------------
-- 7-2. 프로젝트별 수익배분 기본안
-- ---------------------------------------------------------------------
create table if not exists moalab.revenue_project_plans (
  project_id       uuid primary key references moalab.revenue_projects(id) on delete cascade,
  funding_type     text not null default 'private'
                   check (funding_type in ('private','public_contract','grant')),
  gross_amount     numeric(18,0) not null default 0 check (gross_amount >= 0),
  direct_costs     numeric(18,0) not null default 0 check (direct_costs >= 0),
  base_member_ids  uuid[] not null default '{}',
  pools            jsonb not null default '[]'::jsonb check (jsonb_typeof(pools) = 'array'),
  note             text,
  updated_by       uuid references moalab.members(id) on delete set null,
  updated_at       timestamptz not null default now(),
  created_at       timestamptz not null default now()
);
create index if not exists revenue_project_plans_updated_idx
  on moalab.revenue_project_plans(updated_at desc);

-- ---------------------------------------------------------------------
-- 7-3. 프로젝트별 월 수익배분 계산안
--
-- 프로젝트 기본안과 실제 월별 숫자는 다른 축이다. 월별 행에는
-- 그때의 금액·참여자·비율·계산 결과·이름을 한 덩어리로 저장한다. 비율이 아직 미정이면
-- rate_status='undecided'인 가안이며, 지급 근거로 확정하지 않는다.
-- ---------------------------------------------------------------------
create table if not exists moalab.revenue_project_months (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references moalab.revenue_projects(id) on delete cascade,
  settlement_month  date not null check (extract(day from settlement_month) = 1),
  rate_status       text not null default 'undecided'
                    check (rate_status in ('undecided','draft','agreed')),
  funding_type      text not null default 'private'
                    check (funding_type in ('private','public_contract','grant')),
  gross_amount      numeric(18,0) not null default 0 check (gross_amount >= 0),
  direct_costs      numeric(18,0) not null default 0 check (direct_costs >= 0),
  base_member_ids   uuid[] not null default '{}',
  pools             jsonb not null default '[]'::jsonb check (jsonb_typeof(pools) = 'array'),
  member_snapshot   jsonb not null default '[]'::jsonb check (jsonb_typeof(member_snapshot) = 'array'),
  calculation       jsonb not null check (jsonb_typeof(calculation) = 'object'),
  note              text,
  updated_by        uuid references moalab.members(id) on delete set null,
  updated_at        timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  unique (project_id, settlement_month)
);
create index if not exists revenue_project_months_month_idx
  on moalab.revenue_project_months(settlement_month desc);
create index if not exists revenue_project_months_project_idx
  on moalab.revenue_project_months(project_id, settlement_month desc);

-- ---------------------------------------------------------------------
-- 8. 갤러리
-- ---------------------------------------------------------------------
create table if not exists moalab.albums (
  id             uuid primary key default gen_random_uuid(),
  school         text not null,
  class_date     date not null,
  app_id         uuid references moalab.apps(id) on delete set null,
  teacher_id     uuid references moalab.members(id) on delete set null,
  grade          text,
  headcount      int,
  cover_photo_id uuid,
  created_at     timestamptz not null default now()
);
create index if not exists albums_date_idx on moalab.albums(class_date desc);

create table if not exists moalab.photos (
  id         uuid primary key default gen_random_uuid(),
  album_id   uuid not null references moalab.albums(id) on delete cascade,
  url        text not null,
  caption    text,
  tag        text not null default 'work',        -- work | activity | board | group
  has_face   boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists photos_album_idx on moalab.photos(album_id, created_at);

do $$ begin
  alter table moalab.albums
    add constraint albums_cover_photo_fk
    foreign key (cover_photo_id) references moalab.photos(id) on delete set null;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------
-- 9. 일정
-- ---------------------------------------------------------------------
create table if not exists moalab.schedules (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null default 'meeting',      -- class(출강) | meeting(회의) | etc(기타)
  title      text not null,
  date       date not null,
  start_time time,
  place      text,
  memo       text,
  created_at timestamptz not null default now()
);
create index if not exists schedules_date_idx on moalab.schedules(date);

create table if not exists moalab.schedule_members (
  schedule_id uuid not null references moalab.schedules(id) on delete cascade,
  member_id   uuid not null references moalab.members(id) on delete cascade,
  primary key (schedule_id, member_id)
);

-- ---------------------------------------------------------------------
-- 10. 문서 첨부(판) — 프로그램 하나당 본문 1개 + 첨부파일 N개
--     (본문은 apps.plan_body, 파일은 아래 테이블)
-- ---------------------------------------------------------------------
alter table moalab.apps add column if not exists plan_body text;

create table if not exists moalab.plan_files (
  id         uuid primary key default gen_random_uuid(),
  app_id     uuid not null references moalab.apps(id) on delete cascade,
  file_url   text not null,
  file_name  text not null,
  file_size  bigint,
  created_at timestamptz not null default now()
);
create index if not exists plan_files_app_idx on moalab.plan_files(app_id, created_at);

-- 문서는 A 가 올리고 → A 가 고쳐 올리고 → B 가 또 고쳐 올린다.
-- 평면 목록으로 쌓으면 '지도안_최종2.hwp' 가 여러 개 생겨서 뭐가 최신인지 모른다.
-- 그래서 같은 문서의 판(版)을 group_id 로 묶고 version 으로 줄을 세운다.
alter table moalab.plan_files add column if not exists member_id uuid
  references moalab.members(id) on delete set null;   -- 올린 사람
alter table moalab.plan_files add column if not exists note     text;   -- 이번에 바꾼 것
alter table moalab.plan_files add column if not exists group_id uuid;   -- 같은 문서면 같은 값
alter table moalab.plan_files add column if not exists version  int not null default 1;

-- 예전에 올린 파일은 각자 하나의 문서(1판)로 본다
update moalab.plan_files set group_id = id where group_id is null;
create index if not exists plan_files_group_idx on moalab.plan_files(group_id, version desc);

-- 문서 갈래 — 무엇을 올린 건지. 형식(한글이냐 PPT냐)이 아니라 **누가 읽는가**로 가른다.
--   plan  계획안  프로그램 계획 문서 — 우리끼리·학교
--   guide 교육안  이 수업을 어떻게 진행하는지 — 강사가 읽는다
--   form  양식    활동지·학습지 — 인쇄해 나눠준다
--   etc   기타    PPT·영상·참고자료
-- 기본값이 plan 인 이유: 이 칸이 생기기 전에 올린 파일은 전부 계획안이었다.
-- 기본값을 다른 것으로 두면 지난 파일의 뜻이 소급해서 바뀐다.
alter table moalab.plan_files add column if not exists kind text not null default 'plan';
do $$ begin
  alter table moalab.plan_files add constraint plan_files_kind_chk
    check (kind in ('plan','guide','form','etc'));
exception when duplicate_object then null; end $$;
create index if not exists plan_files_kind_idx on moalab.plan_files(app_id, kind);

-- ---------------------------------------------------------------------
-- 11. 프로그램 샘플 이미지 — 제안서·소개용 예시 작품
--     (수업 현장 사진은 albums/photos 쪽이다. 목적이 다르다)
-- ---------------------------------------------------------------------
create table if not exists moalab.app_samples (
  id         uuid primary key default gen_random_uuid(),
  app_id     uuid not null references moalab.apps(id) on delete cascade,
  url        text not null,
  caption    text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists app_samples_app_idx on moalab.app_samples(app_id, sort_order);

-- ---------------------------------------------------------------------
-- 11-1. 강의계획서 — 원장이 준 한글 양식 그대로 화면에서 채우고 그대로 인쇄한다
--
--   양식 한 장 = 프로그램 하나라서 app_id 가 그대로 기본키다.
--   도입·마무리는 프로그램이 달라도 늘 같은 문구여서 기본값으로 채워둔다
--   (그대로 두면 그대로 인쇄되고, 고치면 고친 대로 나간다).
--   plan_files(첨부·판) 는 그대로 남는다 — 한글 원본을 올리는 곳은 계속 필요하다.
-- ---------------------------------------------------------------------
create table if not exists moalab.lesson_plans (
  app_id     uuid primary key references moalab.apps(id) on delete cascade,
  category   text not null default '진로직업체험',   -- 제목 오른쪽 배지
  goal       text,                                   -- 목표
  intro      text default '1. 참석자 확인
2. 체험처 및 진행 강사 소개
3. 진행 프로그램 소개
4. 프로그램이 진행되는 장소에서의 안전 및 유의사항 전달',
  dev_title  text not null default '[AI 웹앱활동]',
  work_title text not null default '[활동작품]',
  closing    text default '궁금한 점에 대해 질의응답 및 간단한 소감 발표',
  tools      text,                                   -- 운영사항 > 교구
  etc        text,                                   -- 운영사항 > 기타사항
  -- 문서 맨 아래 로고. 기관마다 다르고 언제든 바뀌니 박아넣지 않고 올리는 칸으로 둔다
  logo_url   text,
  updated_by uuid references moalab.members(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 전개 칸에 들어가는 항목 — 글 + 사진 한 장이 한 줄이다.
--   step   [AI 웹앱활동]  1·2·3 … 제목 + 화면 캡처
--   order  [활동작품]     *만드는 순서
--   result [활동작품]     * 결과 이미지
create table if not exists moalab.lesson_plan_items (
  id         uuid primary key default gen_random_uuid(),
  app_id     uuid not null references moalab.apps(id) on delete cascade,
  slot       text not null check (slot in ('step','order','result')),
  label      text,
  url        text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists lesson_plan_items_idx
  on moalab.lesson_plan_items(app_id, slot, sort_order);

-- ---------------------------------------------------------------------
-- 12. 활동 로그
-- ---------------------------------------------------------------------
create table if not exists moalab.activity_logs (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid references moalab.members(id) on delete set null,
  action     text not null,
  target     text,
  created_at timestamptz not null default now()
);
create index if not exists activity_logs_created_idx on moalab.activity_logs(created_at desc);

-- ---------------------------------------------------------------------
-- 13. 공지사항 — "봤다"까지 남아야 전달이 된 것이다
-- ---------------------------------------------------------------------
create table if not exists moalab.notices (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  pinned     boolean not null default false,
  member_id  uuid references moalab.members(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists notices_created_idx on moalab.notices(pinned desc, created_at desc);

-- 공지 첨부 — 사진도, 한글·PDF 도 (is_image 로 화면에서 갈라 보여준다)
create table if not exists moalab.notice_files (
  id         uuid primary key default gen_random_uuid(),
  notice_id  uuid not null references moalab.notices(id) on delete cascade,
  file_url   text not null,
  file_name  text not null,
  file_size  bigint,
  is_image   boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists notice_files_notice_idx on moalab.notice_files(notice_id, sort_order);

create table if not exists moalab.notice_reads (
  notice_id uuid not null references moalab.notices(id) on delete cascade,
  member_id uuid not null references moalab.members(id) on delete cascade,
  read_at   timestamptz not null default now(),
  primary key (notice_id, member_id)
);

-- ---------------------------------------------------------------------
-- 13-1. 푸시 알림 구독
--
--   브라우저마다 구독이 하나씩 생긴다 (폰 / PC 따로).
--   endpoint 가 고유키다. 만료된 구독은 발송 때 410 이 오면 지운다.
--   ※ 아이폰은 사파리에서 '홈 화면에 추가' 를 해야 푸시를 받을 수 있다 (iOS 16.4+).
-- ---------------------------------------------------------------------
create table if not exists moalab.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references moalab.members(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subs_member_idx on moalab.push_subscriptions(member_id);

-- ---------------------------------------------------------------------
-- 14. 모의수업 — 학교 나가기 전에 우리끼리 돌려보는 자리
-- ---------------------------------------------------------------------
create table if not exists moalab.mock_lessons (
  id          uuid primary key default gen_random_uuid(),
  app_id      uuid references moalab.apps(id) on delete set null,
  title       text not null,
  lesson_date date not null,
  start_time  time,
  place       text,
  presenter_id uuid references moalab.members(id) on delete set null,
  memo        text,
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists mock_lessons_date_idx on moalab.mock_lessons(lesson_date desc);

create table if not exists moalab.mock_feedback (
  id         uuid primary key default gen_random_uuid(),
  mock_id    uuid not null references moalab.mock_lessons(id) on delete cascade,
  member_id  uuid references moalab.members(id) on delete set null,
  good       text,                                 -- 좋았던 점
  fix        text,                                 -- 고칠 점
  created_at timestamptz not null default now()
);
create index if not exists mock_feedback_mock_idx on moalab.mock_feedback(mock_id, created_at);

-- ---------------------------------------------------------------------
-- 15. 강사양성 — 과정 목록 × 강사별 이수 상태
-- ---------------------------------------------------------------------
create table if not exists moalab.training_courses (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  summary    text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists training_courses_order_idx on moalab.training_courses(sort_order);

create table if not exists moalab.training_records (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references moalab.training_courses(id) on delete cascade,
  member_id  uuid not null references moalab.members(id) on delete cascade,
  state      text not null default 'todo',         -- todo | doing | done
  memo       text,
  done_at    timestamptz,
  updated_at timestamptz not null default now(),
  unique (course_id, member_id)
);
create index if not exists training_records_member_idx on moalab.training_records(member_id);

-- ---------------------------------------------------------------------
-- 16. 지출결의서 — 쓴 돈과 영수증을 한 줄에 묶어둔다
--
--   나중에 회계처리할 때 필요한 건 딱 네 가지다:
--   **언제 · 얼마 · 무엇에 · 영수증 어디**.
--   그래서 이 표 한 줄이 곧 지출결의서 한 건이고, 영수증은 그 줄에 붙는다.
--   월별 문서는 spent_on 으로 묶어서 뽑는다 (인쇄 화면이 그 일을 한다).
--
--   ※ 원가(cost_sheets)와 다른 것: 원가는 '앞으로 얼마 들까'(계획),
--     지출은 '실제로 얼마 썼나'(증빙)다. 섞으면 둘 다 못 쓴다.
-- ---------------------------------------------------------------------
create table if not exists moalab.expenses (
  id          uuid primary key default gen_random_uuid(),
  spent_on    date not null,                        -- 지출일 = 월별로 묶는 기준
  amount      numeric not null default 0,           -- 금액(원)
  category    text not null default 'material',     -- material|transport|meal|book|supply|outsource|etc
  purpose     text not null,                        -- 사용 내용 (회계가 읽는 칸)
  vendor      text,                                 -- 사용처·상호
  pay_method  text not null default 'card',          -- card|cash|transfer
  member_id   uuid references moalab.members(id) on delete set null,  -- 결의자(쓴 사람)
  app_id      uuid references moalab.apps(id)    on delete set null,  -- 관련 프로그램(선택)
  school      text,                                 -- 학교·현장(선택)
  note        text,                                 -- 비고
  approved    boolean not null default false,       -- 원장 확인
  approved_by uuid references moalab.members(id) on delete set null,
  approved_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists expenses_month_idx  on moalab.expenses(spent_on desc);
create index if not exists expenses_member_idx on moalab.expenses(member_id);
create index if not exists expenses_app_idx    on moalab.expenses(app_id);

-- 영수증 — 한 건에 여러 장 (카드전표 + 간이영수증 같이 붙는 경우가 흔하다)
create table if not exists moalab.expense_files (
  id         uuid primary key default gen_random_uuid(),
  expense_id uuid not null references moalab.expenses(id) on delete cascade,
  file_url   text not null,
  file_name  text not null,
  file_size  bigint,
  is_image   boolean not null default true,   -- 사진이면 인쇄물에 그대로 실린다
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists expense_files_expense_idx on moalab.expense_files(expense_id, sort_order);

-- ---------------------------------------------------------------------
-- 17. 업무 분장 — 원장이 쪼개서 · 담당자를 정하고 · 기한을 준다
--
--   "강사 역할을 하세요" 로는 아무도 움직이지 않는다. 무엇을 · 누가 · 언제까지가
--   한 줄로 적혀 있어야 일이 굴러간다. 그 한 줄이 tasks 한 행이다.
--
--   ※ 강사양성(training_*)과 섞지 않는다.
--     저쪽은 '전원 × 고정 커리큘럼' 매트릭스라 기한이 없고 목록이 영구적이다.
--     이쪽은 '1건 × 담당자 1명 × 기한' 이고 끝나면 지나간다.
--     합치면 이수율 판도, 기한 알림도 둘 다 못 쓴다 (원가 vs 지출과 같은 이유).
--
--   ※ 담당자는 한 명이다. 여럿에게 시킬 일은 템플릿에서 사람 수만큼 줄을 만든다.
--     '다 같이' 는 아무도 안 하는 일이 된다 — 그게 이 기능을 만든 이유다.
-- ---------------------------------------------------------------------
create table if not exists moalab.tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  detail      text,
  -- 담당자가 빠져도 '그 일이 있었다' 는 남아야 한다 → set null
  -- (app_reviewers 같은 배정 표는 cascade 지만, 이건 배정이 아니라 업무 기록 자체다)
  assignee_id uuid references moalab.members(id) on delete set null,
  due_date    date,
  state       text not null default 'todo',        -- todo | doing | done
  app_id      uuid references moalab.apps(id) on delete set null,   -- 딸린 프로그램(없어도 된다)
  -- 한 번에 뿌린 묶음. 일회성이라 따로 표를 두지 않고 이름을 그대로 박는다
  -- (주제 topics 는 계속 재사용돼서 표가 맞았지만, '8/25 A초 준비' 는 한 번 쓰고 만다)
  batch_id    uuid,
  batch_title text,
  created_by  uuid references moalab.members(id) on delete set null,
  sort_order  int not null default 0,
  -- 기한 알림을 보낸 날. 같은 알림이 하루에 두 번 울리는 걸 이 한 칸으로 막는다
  reminded_on date,
  done_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tasks_assignee_idx on moalab.tasks(assignee_id, state);
create index if not exists tasks_due_idx      on moalab.tasks(due_date);
create index if not exists tasks_batch_idx    on moalab.tasks(batch_id);
create index if not exists tasks_app_idx      on moalab.tasks(app_id);

-- 체크리스트 — 나눠주는 일은 매번 비슷하다. 한 번 만들어두고 버튼으로 뿌린다.
-- 뿌린 업무는 그 순간 사진처럼 굳는다 (템플릿을 고쳐도 이미 뿌린 건 안 바뀐다).
create table if not exists moalab.task_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists task_templates_order_idx on moalab.task_templates(sort_order);

create table if not exists moalab.task_template_items (
  id                  uuid primary key default gen_random_uuid(),
  template_id         uuid not null references moalab.task_templates(id) on delete cascade,
  title               text not null,
  detail              text,
  default_assignee_id uuid references moalab.members(id) on delete set null,
  -- 기준일 대비 며칠. 음수 = 미리 (기준일이 수업날이면 준비는 -5, -2 처럼 앞에 온다)
  day_offset          int not null default 0,
  sort_order          int not null default 0
);
create index if not exists task_template_items_tpl_idx
  on moalab.task_template_items(template_id, sort_order);

-- ---------------------------------------------------------------------
-- 18. 서버 전용 비밀값 — API 키 같은 것
--
--   ※ 이 표는 **members 와 같은 취급**이다. 아래 '권한 + RLS' 에서
--     anon/authenticated 를 걷어내고 service_role 만 남긴다.
--     internal_all 정책 배열에 넣으면 안 된다 — 넣는 순간 브라우저 키로
--     API 키가 통째로 읽힌다.
--   ※ 화면에는 값을 절대 안 보낸다. hint(끝 4자리)만 보여준다.
-- ---------------------------------------------------------------------
create table if not exists moalab.app_secrets (
  key        text primary key,          -- 'anthropic_api_key'
  value      text not null,
  hint       text,                      -- 끝 4자리. 어떤 키를 넣었는지 확인용
  -- 쓸 모델. 이건 비밀이 아니지만 키와 한 몸이라 같은 줄에 둔다
  model      text,
  updated_by uuid references moalab.members(id) on delete set null,
  updated_at timestamptz not null default now()
);
-- 예전에 만든 표에는 없다
alter table moalab.app_secrets add column if not exists model text;

-- ---------------------------------------------------------------------
-- 19. 역할분장 — 부서 › 중분류 › 소분류, 그리고 그 역할을 누가 맡나
--
--   업무(tasks)와 **축이 다르다.**
--     tasks : 1건 × 담당자 1명 × 기한. 끝나면 지나간다
--     여기  : 기한이 없고 계속 남는 '이 일은 누구 담당' 이다
--   합치면 기한 알림도 못 쓰고 역할표도 못 쓴다
--   (원가 vs 지출 · 업무 vs 강사양성 을 나눈 것과 같은 이유).
--
--   부서·중분류·소분류는 **전부 데이터다.** 조직이 바뀔 때 코드를 안 고친다
--   (topics 와 같은 판단). 예시 내용은 supabase/seed-org.sql 에 따로 뒀다 —
--   schema.sql 에 넣으면 원장이 지운 줄이 재실행할 때마다 되살아난다.
-- ---------------------------------------------------------------------
create table if not exists moalab.departments (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  -- 부서장. 사람을 지워도 부서는 남아야 하니 set null
  head_id    uuid references moalab.members(id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists departments_order_idx on moalab.departments(sort_order, name);

-- 중분류 — 부서 안의 묶음
create table if not exists moalab.duty_groups (
  id         uuid primary key default gen_random_uuid(),
  dept_id    uuid not null references moalab.departments(id) on delete cascade,
  name       text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (dept_id, name)
);
create index if not exists duty_groups_dept_idx on moalab.duty_groups(dept_id, sort_order);

-- 소분류 = 역할 한 줄. 이게 실제로 사람이 맡는 단위다
create table if not exists moalab.duties (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references moalab.duty_groups(id) on delete cascade,
  name       text not null,
  note       text,                                     -- 무슨 일인지 한 줄
  -- 주담당. 책임은 한 사람에게 지운다 (tasks 의 assignee_id 와 같은 판단).
  -- 사람을 지워도 역할은 남고 '담당자 미정' 으로 돌아간다
  owner_id   uuid references moalab.members(id) on delete set null,
  -- 이 일로 바로 가는 곳. 원장 말: "계획안이나 원가계산 이런 것은 부서가 나뉘었으니
  -- 거기로 이동해야 해". **자료를 옮기지는 않는다** — 프로그램 페이지 한 장에 계획안·
  -- 원가·샘플이 모여 있는 게 이 앱의 핵심 설계라, 부서별로 쪼개면 '따로국밥' 으로
  -- 되돌아간다. 대신 역할에서 그 화면으로 가는 길만 낸다 ('/apps/<id>' · '/cost/<id>')
  link       text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (group_id, name)
);
alter table moalab.duties add column if not exists link text;
create index if not exists duties_group_idx on moalab.duties(group_id, sort_order);
create index if not exists duties_owner_idx on moalab.duties(owner_id);

-- 부담당 — 같이 하는 사람. 여럿일 수 있다 (app_reviewers 와 같은 꼴).
-- 사람이 사라지면 부담당 줄도 같이 사라진다 — 주담당과 달리 남겨봐야 뜻이 없다
create table if not exists moalab.duty_helpers (
  duty_id   uuid not null references moalab.duties(id) on delete cascade,
  member_id uuid not null references moalab.members(id) on delete cascade,
  primary key (duty_id, member_id)
);
create index if not exists duty_helpers_member_idx on moalab.duty_helpers(member_id);


-- ---------------------------------------------------------------------
-- 20. 부서 간 협업 요청 / 업무 지시
--
--   업무(tasks)와 **축이 또 다르다.**
--     tasks           : 1건 × 담당자 **1명** × 기한. 개인의 할 일이다
--     collab_requests : **부서 → 부서.** 받는 쪽은 사람이 아니라 팀이고,
--                       받아들일지 말지(요청→진행중→완료)가 상대에게 있다
--   합치면 '내 할 일' 목록이 남의 부서 요청으로 뒤섞이고,
--   '받은 요청 / 보낸 요청' 이라는 편지함 축을 만들 수 없다
--   (원가 vs 지출 · 업무 vs 강사양성 을 나눈 것과 같은 이유).
--
--   부서 자체는 19번(departments)을 그대로 쓴다. 팀장도 이미 있는 head_id 다 —
--   새로 만들지 않는다.
-- ---------------------------------------------------------------------

-- 업무 흐름을 **데이터로** 둔다. 조직이 바뀔 때 코드를 안 고친다 (topics 와 같은 판단).
--   흐름: 영업마케팅(1) → 기획개발(2) → 생산운영(3) → 인사관리(4)
--   경영지원은 흐름 밖에서 전 부서를 지원한다 → is_support
alter table moalab.departments add column if not exists flow_order int;
alter table moalab.departments add column if not exists is_support boolean not null default false;

create table if not exists moalab.collab_requests (
  id           uuid primary key default gen_random_uuid(),
  -- 보내는 곳 / 받는 곳. 부서를 지우면 그 부서가 주고받은 요청도 같이 사라진다
  from_dept_id uuid not null references moalab.departments(id) on delete cascade,
  to_dept_id   uuid not null references moalab.departments(id) on delete cascade,
  -- 프로젝트명 — "○○중 3학년 4차시" 처럼 자유 입력. 표로 뺄 만큼 반복되지 않는다
  project      text,
  body         text not null,
  due_date     date,
  -- 'high' | 'normal' | 'low'
  priority     text not null default 'normal',
  -- 'requested' | 'doing' | 'done'
  status       text not null default 'requested',
  -- 사람을 지워도 요청 기록은 남는다 (tasks 와 같은 갈래)
  created_by   uuid references moalab.members(id) on delete set null,
  accepted_by  uuid references moalab.members(id) on delete set null,
  done_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- 값이 흘러들어 화면이 죽는 걸 막는다 (apps.status 에서 실제로 겪었다)
  constraint collab_requests_status_chk   check (status in ('requested','doing','done')),
  constraint collab_requests_priority_chk check (priority in ('high','normal','low')),
  -- 자기 부서에 자기가 요청하는 건 뜻이 없다
  constraint collab_requests_not_self     check (from_dept_id <> to_dept_id)
);
create index if not exists collab_to_idx   on moalab.collab_requests(to_dept_id, status, due_date);
create index if not exists collab_from_idx on moalab.collab_requests(from_dept_id, created_at desc);
create index if not exists collab_due_idx  on moalab.collab_requests(due_date);

-- 주고받는 말. 지적 답변(finding_replies)과 같은 꼴이다
create table if not exists moalab.collab_comments (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references moalab.collab_requests(id) on delete cascade,
  member_id  uuid references moalab.members(id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists collab_comments_req_idx on moalab.collab_comments(request_id, created_at);

-- ---------------------------------------------------------------------
-- 21. 출강 일정 — 9번(schedules)에 칸만 더한다
--
--   **새 표를 만들지 않았다.** 출강도 "언제·어디서·누가" 라 회의와 축이 같다.
--   따로 표를 만들면 달력을 두 번 그려야 하고, 한 화면에 섞어 보여줄 방법이
--   없어진다 (계획안 첨부에 갈래 칸 하나만 더한 것과 같은 판단).
--
--   갈래는 셋이다 — class(출강) · meeting(회의) · etc(기타).
--   **마감은 여기 안 넣는다.** apps.due_date 와 collab_requests.due_date 에서
--   달력이 스스로 만들어낸다 — 같은 날짜를 두 곳에 적게 하면 반드시 어긋난다.
--
--   담당 강사는 이미 있는 schedule_members 를 그대로 쓴다 (참석자와 같은 뜻이다).
-- ---------------------------------------------------------------------

-- 'visit'(학교 방문 수업)은 뜻이 그대로 '출강' 이라 이름만 옮긴다.
-- 아직 한 줄도 안 쌓였을 때 옮겨두는 것이다 — 나중에 하면 지난 기록의 뜻이 바뀐다
update moalab.schedules set kind = 'class' where kind = 'visit';

alter table moalab.schedules add column if not exists end_time  time;
-- 프로그램 — 자유 입력이 아니라 apps 를 가리킨다. 프로그램을 지워도 일정은 남는다
alter table moalab.schedules add column if not exists app_id    uuid references moalab.apps(id) on delete set null;
alter table moalab.schedules add column if not exists school    text;
alter table moalab.schedules add column if not exists headcount int;
-- 강의 타임 수 — 정산의 기준이다. 시간이 아니라 '차시' 라 정수다
alter table moalab.schedules add column if not exists periods   int;

-- 값이 흘러들어 화면이 죽는 걸 막는다 (apps.status 에서 실제로 겪었다).
-- 제약을 새로 걸기 전에 옛 값을 먼저 정리한다
update moalab.schedules set kind = 'etc' where kind not in ('class','meeting','etc');
alter table moalab.schedules drop constraint if exists schedules_kind_chk;
alter table moalab.schedules add  constraint schedules_kind_chk check (kind in ('class','meeting','etc'));

create index if not exists schedules_app_idx on moalab.schedules(app_id);

-- ---------------------------------------------------------------------
-- 22. 대화 (실시간 채팅)
--
--   ⚠️ **이 표들은 members(PIN) · app_secrets(API 키) 와 같은 취급이다.**
--   `internal_all` 배열에 **절대 넣지 않는다.** 넣는 순간 브라우저의 anon 키로
--   남의 1:1 대화가 통째로 읽힌다.
--
--   왜 RLS 정책으로 "자기 방만" 을 못 쓰나 —
--   이 앱은 Supabase Auth 를 안 쓴다. 브라우저는 anon 키로 붙으므로 DB 는
--   `auth.uid()` 를 모른다. 그래서 "이 사람이 이 방 멤버인가" 를 SQL 로 물을 수가 없다.
--   → 표는 통째로 잠그고(정책 없음), 읽기·쓰기는 전부 `/api/chat/*` 서버 라우트가
--     service_role 로 대신한다. 멤버 확인은 거기서 한다.
--     (CLAUDE.md: "권한을 진짜로 강제해야 할 일이 생기면 RLS 가 아니라 서버 라우트로")
--
--   신원은 **세션 토큰**으로 확인한다. `x-actor-id` 헤더는 브라우저가 아무 값이나
--   넣을 수 있어서 대화 격리에는 쓸 수 없다.
-- ---------------------------------------------------------------------

-- 로그인 세션 — /api/login 이 발급하고 /api/chat/* 이 확인한다.
-- 기기마다 한 줄 (폰과 PC 를 따로 로그아웃할 수 있다).
create table if not exists moalab.sessions (
  token        uuid primary key default gen_random_uuid(),
  member_id    uuid not null references moalab.members(id) on delete cascade,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '30 days'
);
create index if not exists sessions_member_idx on moalab.sessions(member_id);

-- 대화방 — 갈래 셋. 늘리지 않는다
--   dm   1:1        · 두 사람. dm_key 로 같은 짝이 두 번 안 생기게 한다
--   dept 부서 단톡  · 부서마다 하나 (dept_id 가 고유)
--   all  전체 공지방 · 딱 하나
create table if not exists moalab.rooms (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,
  dept_id    uuid references moalab.departments(id) on delete cascade,
  -- 1:1 은 두 사람 id 를 정렬해 이어붙인 값. 누가 먼저 열든 같은 방이 나온다
  dm_key     text,
  title      text,
  created_at timestamptz not null default now(),
  constraint rooms_kind_chk check (kind in ('dm','dept','all'))
);
create unique index if not exists rooms_dm_key_idx  on moalab.rooms(dm_key) where dm_key is not null;
create unique index if not exists rooms_dept_idx    on moalab.rooms(dept_id) where dept_id is not null;
create unique index if not exists rooms_all_idx     on moalab.rooms((kind)) where kind = 'all';

-- 누가 이 방에 있나 + 어디까지 읽었나.
-- **읽음 표시는 메시지마다가 아니라 사람마다 한 줄**이다 — 메시지 × 사람으로 두면
-- 5명이 100줄만 주고받아도 500줄이 쌓인다 (안 읽은 개수는 시각 비교로 충분하다)
create table if not exists moalab.room_members (
  room_id      uuid not null references moalab.rooms(id) on delete cascade,
  member_id    uuid not null references moalab.members(id) on delete cascade,
  last_read_at timestamptz not null default 'epoch',
  joined_at    timestamptz not null default now(),
  primary key (room_id, member_id)
);
create index if not exists room_members_member_idx on moalab.room_members(member_id);

-- 한 마디. 사진만 보낼 수도 있어서 body 가 비어도 된다 (둘 다 비면 제약이 막는다).
-- 사람을 지워도 대화 기록은 남는다 (지적사항·업무와 같은 갈래)
create table if not exists moalab.messages (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references moalab.rooms(id) on delete cascade,
  member_id  uuid references moalab.members(id) on delete set null,
  body       text,
  -- 비공개 버킷 안의 경로. 공개 URL 이 아니다 — 방 멤버에게만 서명 URL 을 내준다
  image_path text,
  created_at timestamptz not null default now(),
  constraint messages_not_empty check (coalesce(body,'') <> '' or image_path is not null)
);
create index if not exists messages_room_idx on moalab.messages(room_id, created_at desc);

-- =====================================================================
--  권한 + RLS
--   · members       : RLS on, 정책 없음 → anon 키로는 읽기/쓰기 전부 차단
--   · app_secrets   : 같은 취급 (API 키). 절대 internal_all 배열에 넣지 말 것
--                     (로그인·멤버관리는 service_role 을 쓰는 /api 라우트에서만)
--   · members_public: pin 을 뺀 뷰. 뷰는 소유자 권한으로 도니 RLS 를 우회함
--   · 나머지 테이블 : 전부 허용 (사내 5~7명 전용)
-- =====================================================================

-- moalab 스키마는 Supabase 기본 권한 대상이 아니므로 직접 부여한다.
-- service_role 도 반드시 포함해야 한다 — 로그인·멤버관리 API 가 이 역할로 돈다.
grant all on all tables    in schema moalab to anon, authenticated, service_role;
grant all on all sequences in schema moalab to anon, authenticated, service_role;
alter default privileges in schema moalab grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema moalab grant all on sequences to anon, authenticated, service_role;

alter table moalab.members enable row level security;
-- (정책을 만들지 않음 = anon/authenticated 접근 전면 차단)
-- 단 service_role 은 남겨둔다. PIN 검증은 오직 이 역할로만 이뤄진다.
revoke all on moalab.members from anon, authenticated;
grant all on moalab.members to service_role;

-- API 키도 PIN 과 똑같이 잠근다. 정책이 없으니 anon/authenticated 는 아예 못 붙는다.
-- 등록·삭제는 /api/settings/ai, 사용은 /api/task/parse — 둘 다 service_role 이다.
alter table moalab.app_secrets enable row level security;
revoke all on moalab.app_secrets from anon, authenticated;
grant all on moalab.app_secrets to service_role;

-- 대화 표 넷도 같은 취급이다. 정책을 만들지 않으니 anon/authenticated 는 아예 못 붙는다.
-- 읽기·쓰기는 전부 /api/chat/* 이 service_role 로 대신하고, 거기서 방 멤버인지 확인한다.
do $$
declare t text;
begin
  foreach t in array array['sessions','rooms','room_members','messages'] loop
    execute format('alter table moalab.%I enable row level security', t);
    execute format('drop policy if exists "internal_all" on moalab.%I', t);
    execute format('revoke all on moalab.%I from anon, authenticated', t);
    execute format('grant all on moalab.%I to service_role', t);
  end loop;
end $$;

create or replace view moalab.members_public as
  select id, name, role, active, sort_order, created_at
  from moalab.members;

grant select on moalab.members_public to anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'topics','apps','app_reviewers','rounds','checks','check_files','comments','comment_files',
    'findings','finding_files','finding_replies','round_signoffs',
    'cost_sheets','cost_items','cost_item_photos','revenue_projects','revenue_project_plans','revenue_project_months',
    'albums','photos','schedules','schedule_members','activity_logs',
    'plan_files','app_samples','lesson_plans','lesson_plan_items',
    'notices','notice_files','notice_reads','push_subscriptions','mock_lessons','mock_feedback',
    'training_courses','training_records',
    'tasks','task_templates','task_template_items',
    'expenses','expense_files',
    'departments','duty_groups','duties','duty_helpers',
    'collab_requests','collab_comments'
  ] loop
    execute format('alter table moalab.%I enable row level security', t);
    execute format('drop policy if exists "internal_all" on moalab.%I', t);
    execute format(
      'create policy "internal_all" on moalab.%I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- =====================================================================
--  Storage 버킷 6개 — 공개 읽기 + 인증된 쓰기
--  이름 앞에 moalab- 을 붙여 기존 버킷을 건드리지 않는다.
--
--  ★ 버킷은 나중에 늘어난다. 처음엔 3개였고 plans·notices 는 뒤에 추가됐다.
--    예전에 이 파일을 돌린 DB 에는 나중에 생긴 버킷이 없어서
--    "문서·공지 첨부만 안 올라간다" 가 된다.
--    그 경우 supabase/storage.sql 만 따로 붙여넣으면 된다.
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('moalab-comment-files','moalab-comment-files', true),
       ('moalab-cost-photos','moalab-cost-photos', true),
       ('moalab-gallery','moalab-gallery', true),
       ('moalab-plans','moalab-plans', true),
       ('moalab-notices','moalab-notices', true),
       ('moalab-receipts','moalab-receipts', true)
on conflict (id) do update set public = true;

do $$
declare b text;
begin
  foreach b in array array[
    'moalab-comment-files','moalab-cost-photos','moalab-gallery',
    'moalab-plans','moalab-notices','moalab-receipts'
  ] loop
    execute format('drop policy if exists "read_%s"   on storage.objects', b);
    execute format('drop policy if exists "write_%s"  on storage.objects', b);
    execute format('drop policy if exists "update_%s" on storage.objects', b);
    execute format('drop policy if exists "delete_%s" on storage.objects', b);

    execute format($f$create policy "read_%s" on storage.objects
      for select to anon, authenticated using (bucket_id = %L)$f$, b, b);
    execute format($f$create policy "write_%s" on storage.objects
      for insert to anon, authenticated with check (bucket_id = %L)$f$, b, b);
    execute format($f$create policy "update_%s" on storage.objects
      for update to anon, authenticated using (bucket_id = %L)$f$, b, b);
    execute format($f$create policy "delete_%s" on storage.objects
      for delete to anon, authenticated using (bucket_id = %L)$f$, b, b);
  end loop;
end $$;

-- 대화 사진만 **비공개 버킷**이다. 다른 버킷과 판단이 다른 이유:
-- 1:1 대화를 남이 못 보게 하는 게 대화 기능의 전제라, 사진 URL 만 알면
-- 누구나 열리는 공개 버킷을 쓰면 표를 잠근 의미가 없다.
-- 정책을 하나도 안 만든다 = anon/authenticated 는 아예 못 붙는다.
-- 올리기는 /api/chat/upload, 보기는 방 멤버에게만 내주는 서명 URL (둘 다 service_role).
insert into storage.buckets (id, name, public)
values ('moalab-chat','moalab-chat', false)
on conflict (id) do update set public = false;

do $$
begin
  execute 'drop policy if exists "read_moalab-chat"   on storage.objects';
  execute 'drop policy if exists "write_moalab-chat"  on storage.objects';
  execute 'drop policy if exists "update_moalab-chat" on storage.objects';
  execute 'drop policy if exists "delete_moalab-chat" on storage.objects';
end $$;

-- =====================================================================
--  초기 멤버 — 멤버가 하나도 없을 때만 넣는다.
--  (이미 쓰고 있는 DB 에 다시 실행해도 이름을 바꿔둔 멤버가 되살아나거나
--   원장이 두 명이 되는 일이 없다. PIN 은 로그인 후 관리 화면에서 꼭 바꾸세요)
-- =====================================================================
insert into moalab.members (name, pin, role, sort_order)
select v.name, v.pin, v.role, v.sort_order
from (values
  ('강양희', '0000', 'admin',   0),
  ('이서은', '1111', 'teacher', 1),
  ('주은서', '2222', 'teacher', 2),
  ('강지연', '3333', 'teacher', 3),
  ('윤창진', '4444', 'teacher', 4)
) as v(name, pin, role, sort_order)
where not exists (select 1 from moalab.members);

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 23. 구글 드라이브 자동 업로드
--
--   앱에 올린 파일(문서첨부·영수증·수업사진·강의계획서)을 원장님 구글
--   드라이브에도 한 벌 복사한다.
--
--   ⚠️ **이 앱은 구글 계정 개념이 없다** (PIN 로그인). 그래서 서비스 계정이
--   아니라 **원장 계정의 OAuth 리프레시 토큰**으로 대신 올린다. 개인 지메일에서는
--   서비스 계정이 저장 용량 0이라 아예 못 올린다 (구글 제약).
--
--   토큰은 app_secrets 에 넣는다 — PIN·API키와 똑같이 잠긴 표다.
--   **internal_all 배열에 절대 넣지 않는다.**
--
--   올릴 것은 바로 보내지 않고 **줄을 세운다**(drive_uploads).
--   그래야 (1) 앱 저장이 드라이브 때문에 느려지거나 막히지 않고
--        (2) 실패한 것을 안 잃고 나중에 한 번에 다시 시도할 수 있다.
-- ---------------------------------------------------------------------

-- 폴더 id 캐시·켜둔 갈래 등 비밀이 아닌 부속 정보
alter table moalab.app_secrets add column if not exists meta jsonb;

create table if not exists moalab.drive_uploads (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,          -- plan | receipt | photo | lecture
  source_url  text not null,          -- 수파베이스 공개 URL (여기서 받아 드라이브로 넘긴다)
  folder_path text not null,          -- '프로그램/미술/제과제빵' — 없으면 만들면서 내려간다
  file_name   text not null,
  mime_type   text,
  status      text not null default 'pending' check (status in ('pending','done','failed')),
  drive_id    text,                   -- 올라간 뒤 드라이브 파일 id
  error       text,                   -- 실패 사유 (화면에 한글로 보여준다)
  tries       int  not null default 0,
  member_id   uuid references moalab.members(id) on delete set null,
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
create index if not exists drive_uploads_status_idx on moalab.drive_uploads(status, created_at);
-- 같은 파일을 두 번 줄 세우지 않는다 (다시 눌러도 하나만 올라간다)
create unique index if not exists drive_uploads_src_idx on moalab.drive_uploads(source_url);

alter table moalab.drive_uploads enable row level security;
drop policy if exists "internal_all" on moalab.drive_uploads;
create policy "internal_all" on moalab.drive_uploads for all using (true) with check (true);
grant all on moalab.drive_uploads to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 24. 역할 자료함 — 그 역할로 만든 결과물을 역할에 붙인다
--
--   역할분장의 소분류(duties) 하나가 곧 **해야 할 일**이다.
--   'SNS·블로그 운영', '브로셔만들기[A4버전]' 처럼.
--   그 일을 해서 만든 파일은 그 역할 안에 들어가야 한다 — 부서에 뭉뚱그려 붙이면
--   무엇을 하다 나온 자료인지 다시 알 수 없다.
--
--   ⚠️ 처음엔 부서(dept_files)에 붙였는데 원장이 *"해야할일 항목란에 들어가서
--   올리게"* 라고 바로잡아 역할로 옮겼다. 그 표는 안 쓴다.
--
--   드라이브로는 `업무분장/{부서}/{중분류}` 로 가고 파일 이름 앞에 역할명을 붙인다.
--   손으로 만들어둔 그 폴더를 그대로 쓴다 (역할마다 폴더를 또 파면 63개가 된다).
-- ---------------------------------------------------------------------

create table if not exists moalab.duty_files (
  id         uuid primary key default gen_random_uuid(),
  duty_id    uuid not null references moalab.duties(id) on delete cascade,
  file_url   text not null,
  file_name  text not null,
  file_size  int,
  note       text,                     -- 무엇을 만든 자료인지 한 줄
  -- 사람을 지워도 자료는 남는다 (plan_files 와 같은 갈래)
  member_id  uuid references moalab.members(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists duty_files_duty_idx on moalab.duty_files(duty_id, created_at desc);

alter table moalab.duty_files enable row level security;
drop policy if exists "internal_all" on moalab.duty_files;
create policy "internal_all" on moalab.duty_files for all using (true) with check (true);
grant all on moalab.duty_files to anon, authenticated, service_role;

-- 부서에 붙이던 표는 안 쓴다 (있으면 지운다 — 아직 아무것도 안 쌓였다)
drop table if exists moalab.dept_files;
