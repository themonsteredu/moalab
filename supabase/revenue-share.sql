-- 모아랩 수익배분 기능만 기존 운영 DB에 추가할 때 한 번 실행한다.
-- 전체 초기화용 supabase/schema.sql에도 같은 정의가 들어 있다.

create table if not exists moalab.revenue_share_plans (
  app_id           uuid primary key references moalab.apps(id) on delete cascade,
  funding_type     text not null default 'private'
                   check (funding_type in ('private','public_contract','grant')),
  gross_amount     numeric not null default 100000 check (gross_amount >= 0),
  direct_costs     numeric not null default 0 check (direct_costs >= 0),
  base_member_ids  uuid[] not null default '{}',
  pools            jsonb not null default '[]'::jsonb check (jsonb_typeof(pools) = 'array'),
  note             text,
  updated_by       uuid references moalab.members(id) on delete set null,
  updated_at       timestamptz not null default now(),
  created_at       timestamptz not null default now()
);
create index if not exists revenue_share_plans_updated_idx
  on moalab.revenue_share_plans(updated_at desc);

create table if not exists moalab.revenue_share_months (
  id                uuid primary key default gen_random_uuid(),
  app_id            uuid not null references moalab.apps(id) on delete cascade,
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
  unique (app_id, settlement_month)
);
create index if not exists revenue_share_months_month_idx
  on moalab.revenue_share_months(settlement_month desc);
create index if not exists revenue_share_months_updated_idx
  on moalab.revenue_share_months(updated_at desc);

grant usage on schema moalab to anon, authenticated, service_role;
grant all on moalab.revenue_share_plans, moalab.revenue_share_months
  to anon, authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['revenue_share_plans','revenue_share_months'] loop
    execute format('alter table moalab.%I enable row level security', t);
    execute format('drop policy if exists "internal_all" on moalab.%I', t);
    execute format(
      'create policy "internal_all" on moalab.%I for all to anon, authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;

notify pgrst, 'reload schema';
