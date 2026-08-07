-- =====================================================================
--  모아랩 업무 워크스페이스 (moalab-work) — Supabase 스키마
--  Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 실행하세요.
--  여러 번 실행해도 안전합니다 (전부 IF NOT EXISTS / CREATE OR REPLACE).
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. 멤버
-- ---------------------------------------------------------------------
create table if not exists members (
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
create table if not exists apps (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,              -- ai-bakery
  title_ko      text not null,                     -- 제과제빵
  url           text,
  purpose       text,
  target_grade  text,
  creator_id    uuid references members(id) on delete set null,
  due_date      date,
  current_round int not null default 1,
  status        text not null default 'pending',   -- pending | fixing | done
  archived      boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists apps_status_idx   on apps(status);
create index if not exists apps_due_date_idx on apps(due_date);

-- ---------------------------------------------------------------------
-- 3. 검증자 배정 (앱 1 : 검증자 N)
-- ---------------------------------------------------------------------
create table if not exists app_reviewers (
  id        uuid primary key default gen_random_uuid(),
  app_id    uuid not null references apps(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  unique (app_id, member_id)
);
create index if not exists app_reviewers_app_idx    on app_reviewers(app_id);
create index if not exists app_reviewers_member_idx on app_reviewers(member_id);

-- ---------------------------------------------------------------------
-- 4. 검증 라운드
-- ---------------------------------------------------------------------
create table if not exists rounds (
  id          uuid primary key default gen_random_uuid(),
  app_id      uuid not null references apps(id) on delete cascade,
  round_no    int not null,
  change_note text,                                -- 무엇을 수정했는지
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz,
  unique (app_id, round_no)
);
create index if not exists rounds_app_idx on rounds(app_id);

-- ---------------------------------------------------------------------
-- 5. 체크 결과 (라운드 × 검증자 × 항목 1~5)
-- ---------------------------------------------------------------------
create table if not exists checks (
  id         uuid primary key default gen_random_uuid(),
  round_id   uuid not null references rounds(id) on delete cascade,
  member_id  uuid not null references members(id) on delete cascade,
  item_no    int  not null check (item_no between 1 and 5),
  result     text not null default 'none',         -- none | pass | fail
  note       text,                                 -- fail 이면 필수 (앱에서 강제)
  updated_at timestamptz not null default now(),
  unique (round_id, member_id, item_no)
);
create index if not exists checks_round_idx  on checks(round_id);
create index if not exists checks_member_idx on checks(member_id);

-- ---------------------------------------------------------------------
-- 6. 댓글
-- ---------------------------------------------------------------------
create table if not exists comments (
  id         uuid primary key default gen_random_uuid(),
  app_id     uuid not null references apps(id) on delete cascade,
  member_id  uuid references members(id) on delete set null,
  body       text not null,
  resolved   boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists comments_app_idx on comments(app_id, created_at desc);

create table if not exists comment_files (
  id         uuid primary key default gen_random_uuid(),
  comment_id uuid not null references comments(id) on delete cascade,
  file_url   text not null,
  file_name  text
);
create index if not exists comment_files_comment_idx on comment_files(comment_id);

-- ---------------------------------------------------------------------
-- 7. 원가계산서
-- ---------------------------------------------------------------------
create table if not exists cost_sheets (
  id         uuid primary key default gen_random_uuid(),
  app_id     uuid references apps(id) on delete set null,
  title      text not null,
  headcount  int not null default 20,
  sale_price numeric not null default 0,           -- 1인당 판매가
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists cost_items (
  id              uuid primary key default gen_random_uuid(),
  sheet_id        uuid not null references cost_sheets(id) on delete cascade,
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
create index if not exists cost_items_sheet_idx on cost_items(sheet_id, sort_order);

create table if not exists cost_item_photos (
  id        uuid primary key default gen_random_uuid(),
  item_id   uuid not null references cost_items(id) on delete cascade,
  photo_url text not null
);
create index if not exists cost_item_photos_item_idx on cost_item_photos(item_id);

-- ---------------------------------------------------------------------
-- 8. 갤러리
-- ---------------------------------------------------------------------
create table if not exists albums (
  id             uuid primary key default gen_random_uuid(),
  school         text not null,
  class_date     date not null,
  app_id         uuid references apps(id) on delete set null,
  teacher_id     uuid references members(id) on delete set null,
  grade          text,
  headcount      int,
  cover_photo_id uuid,
  created_at     timestamptz not null default now()
);
create index if not exists albums_date_idx on albums(class_date desc);

create table if not exists photos (
  id         uuid primary key default gen_random_uuid(),
  album_id   uuid not null references albums(id) on delete cascade,
  url        text not null,
  caption    text,
  tag        text not null default 'work',        -- work | activity | board | group
  has_face   boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists photos_album_idx on photos(album_id, created_at);

do $$ begin
  alter table albums
    add constraint albums_cover_photo_fk
    foreign key (cover_photo_id) references photos(id) on delete set null;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------
-- 9. 일정
-- ---------------------------------------------------------------------
create table if not exists schedules (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null default 'meeting',      -- meeting | visit
  title      text not null,
  date       date not null,
  start_time time,
  place      text,
  memo       text,
  created_at timestamptz not null default now()
);
create index if not exists schedules_date_idx on schedules(date);

create table if not exists schedule_members (
  schedule_id uuid not null references schedules(id) on delete cascade,
  member_id   uuid not null references members(id) on delete cascade,
  primary key (schedule_id, member_id)
);

-- ---------------------------------------------------------------------
-- 10. 활동 로그
-- ---------------------------------------------------------------------
create table if not exists activity_logs (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid references members(id) on delete set null,
  action     text not null,
  target     text,
  created_at timestamptz not null default now()
);
create index if not exists activity_logs_created_idx on activity_logs(created_at desc);

-- =====================================================================
--  RLS — 내부 도구라 단순하게. 단, members.pin 은 브라우저에 절대 노출 금지.
--  · members       : RLS on, 정책 없음  → anon 키로는 읽기/쓰기 전부 차단
--                    (로그인·멤버관리는 service_role 을 쓰는 /api 라우트에서만)
--  · members_public: pin 을 뺀 뷰. 뷰는 소유자 권한으로 도니 RLS 를 우회함
--  · 나머지 테이블 : 전부 허용 (사내 5~7명 전용)
-- =====================================================================
alter table members enable row level security;
-- (정책을 만들지 않음 = anon/authenticated 접근 전면 차단)

create or replace view members_public as
  select id, name, role, active, sort_order, created_at
  from members;

grant select on members_public to anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'apps','app_reviewers','rounds','checks','comments','comment_files',
    'cost_sheets','cost_items','cost_item_photos',
    'albums','photos','schedules','schedule_members','activity_logs'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "internal_all" on %I', t);
    execute format(
      'create policy "internal_all" on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- =====================================================================
--  Storage 버킷 3개 — 공개 읽기 + 누구나 쓰기(사내 전용)
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('comment-files','comment-files', true),
       ('cost-photos','cost-photos', true),
       ('gallery','gallery', true)
on conflict (id) do update set public = true;

do $$
declare b text;
begin
  foreach b in array array['comment-files','cost-photos','gallery'] loop
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

-- =====================================================================
--  초기 멤버 (PIN 은 로그인 후 관리 화면에서 꼭 바꾸세요)
-- =====================================================================
insert into members (name, pin, role, sort_order) values
  ('원장',   '0000', 'admin',   0),
  ('이서은', '1111', 'teacher', 1),
  ('주은서', '2222', 'teacher', 2),
  ('강지연', '3333', 'teacher', 3),
  ('윤창진', '4444', 'teacher', 4)
on conflict (name) do nothing;
