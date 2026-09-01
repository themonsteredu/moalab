-- =====================================================================
--  역할마다 붙는 표 (문서 양식) — Supabase SQL Editor 에 통째로 붙여넣고 실행
--
--  여러 번 실행해도 안전합니다 (이미 있으면 건너뜁니다).
--  schema.sql 25번 절과 같은 내용이라, 스키마 전체를 다시 돌리지 않아도 됩니다.
--
--  ★ 이 표가 없으면 역할 화면의 `목록` 이 "표가 없어요" 로만 보입니다.
--    (나머지 화면은 그대로 돌아갑니다)
-- =====================================================================

create table if not exists moalab.duty_columns (
  id         uuid primary key default gen_random_uuid(),
  duty_id    uuid not null references moalab.duties(id) on delete cascade,
  name       text not null,
  kind       text not null default 'text'
             check (kind in ('text','number','date','select','check')),
  options    jsonb,                    -- 고르기 칸의 보기들. 다른 갈래면 null
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists duty_columns_duty_idx on moalab.duty_columns(duty_id, sort_order);

create table if not exists moalab.duty_rows (
  id         uuid primary key default gen_random_uuid(),
  duty_id    uuid not null references moalab.duties(id) on delete cascade,
  -- ⚠️ 이름이 values 가 아니다 — values 는 SQL 예약어라 컬럼으로 못 쓴다
  cells      jsonb not null default '{}'::jsonb,
  sort_order int  not null default 0,
  updated_by uuid references moalab.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists duty_rows_duty_idx on moalab.duty_rows(duty_id, sort_order);

-- RLS + 권한 (커스텀 스키마는 Supabase 기본 권한이 안 붙는다)
alter table moalab.duty_columns enable row level security;
alter table moalab.duty_rows    enable row level security;
drop policy if exists "internal_all" on moalab.duty_columns;
drop policy if exists "internal_all" on moalab.duty_rows;
create policy "internal_all" on moalab.duty_columns for all using (true) with check (true);
create policy "internal_all" on moalab.duty_rows    for all using (true) with check (true);
grant all on moalab.duty_columns to anon, authenticated, service_role;
grant all on moalab.duty_rows    to anon, authenticated, service_role;

-- 확인 (둘 다 0 으로 나오면 성공입니다 — 아직 아무것도 안 넣었으니까요)
select 'duty_columns' as 표, count(*) from moalab.duty_columns
union all
select 'duty_rows', count(*) from moalab.duty_rows;
