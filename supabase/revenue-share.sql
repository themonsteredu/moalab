-- 모아랩 프로젝트별 월 수익배분 기능을 기존 운영 DB에 추가할 때 실행한다.
-- 광주중학교·모두의창업 같은 '수익 프로젝트'와 교육 프로그램(apps)은 서로 다른 단위다.

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

grant usage on schema moalab to anon, authenticated, service_role;
grant select, insert, update, delete on
  moalab.revenue_projects,
  moalab.revenue_project_plans,
  moalab.revenue_project_months
to anon, authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array[
    'revenue_projects',
    'revenue_project_plans',
    'revenue_project_months'
  ] loop
    execute format('alter table moalab.%I enable row level security', t);
    execute format('drop policy if exists "internal_all" on moalab.%I', t);
    execute format(
      'create policy "internal_all" on moalab.%I for all to anon, authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;

notify pgrst, 'reload schema';
