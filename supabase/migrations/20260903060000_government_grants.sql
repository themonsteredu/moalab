-- 정부지원사업: 공고 → 기획 공유 → 협업 작성 → 최종 제출 → 결과 분석

create table if not exists moalab.grant_projects (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  agency             text,
  announcement_url   text,
  deadline           date,
  item_name          text,
  target_audience    text,
  concept_summary    text,
  differentiation    text,
  support_needed     text,
  lead_id            uuid references moalab.members(id) on delete set null,
  status             text not null default 'discovered'
    check (status in ('discovered','concept_shared','writing','submitted','selected','not_selected','paused')),
  duplicate_checked  boolean not null default false,
  concept_shared_at  timestamptz,
  submitted_at       date,
  result_note        text,
  created_by         uuid references moalab.members(id) on delete set null,
  updated_by         uuid references moalab.members(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists grant_projects_status_idx
  on moalab.grant_projects(status, deadline, updated_at desc);
create index if not exists grant_projects_lead_idx on moalab.grant_projects(lead_id);
create index if not exists grant_projects_created_by_idx on moalab.grant_projects(created_by);
create index if not exists grant_projects_updated_by_idx on moalab.grant_projects(updated_by);

create table if not exists moalab.grant_collaborators (
  grant_id    uuid not null references moalab.grant_projects(id) on delete cascade,
  member_id   uuid not null references moalab.members(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (grant_id, member_id)
);
create index if not exists grant_collaborators_member_idx
  on moalab.grant_collaborators(member_id, grant_id);

create table if not exists moalab.grant_files (
  id          uuid primary key default gen_random_uuid(),
  grant_id    uuid not null references moalab.grant_projects(id) on delete cascade,
  kind        text not null check (kind in ('announcement','final_plan')),
  file_path   text not null,
  file_name   text not null,
  file_size   bigint,
  mime_type   text,
  member_id   uuid references moalab.members(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists grant_files_grant_idx
  on moalab.grant_files(grant_id, kind, created_at desc);
create index if not exists grant_files_member_idx on moalab.grant_files(member_id);

do $$
declare t text;
begin
  foreach t in array array['grant_projects','grant_collaborators','grant_files'] loop
    execute format('alter table moalab.%I enable row level security', t);
    execute format('drop policy if exists "internal_all" on moalab.%I', t);
    execute format('revoke all on moalab.%I from anon, authenticated', t);
    execute format('grant all on moalab.%I to service_role', t);
  end loop;
end $$;

-- 사업계획서는 내부 문서다. 공개 URL을 만들지 않고 세션 확인 API가 서명 URL을 발급한다.
insert into storage.buckets (id, name, public, file_size_limit)
values ('moalab-grants', 'moalab-grants', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

do $$ begin
  execute 'drop policy if exists "read_moalab-grants" on storage.objects';
  execute 'drop policy if exists "write_moalab-grants" on storage.objects';
  execute 'drop policy if exists "update_moalab-grants" on storage.objects';
  execute 'drop policy if exists "delete_moalab-grants" on storage.objects';
end $$;
