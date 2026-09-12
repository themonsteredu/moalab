-- =====================================================================
--  설정 표 하나 — 회사 정보(제안서·견적서 맨 끝에 찍히는 것)를 둔다
--
--  SQL Editor 에 통째로 붙여넣고 실행하세요. 여러 번 실행해도 안전합니다.
--  schema.sql 26번 절과 같은 내용입니다 — 스키마 전체를 다시 돌리지 않아도 됩니다.
--
--  열쇠 하나에 jsonb 하나. 지금은 `org`(회사 정보) 한 줄뿐이다.
--  회사 정보를 코드에 박아넣지 않는 이유는 강의계획서 로고와 같다 —
--  대표·전화·주소는 바뀌고, 바뀔 때마다 배포할 일이 아니다.
--  ★ 비밀(API 키·PIN)은 여기 넣지 않는다 — 그건 app_secrets(잠긴 표)다.
-- =====================================================================

create table if not exists moalab.settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_by uuid references moalab.members(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table moalab.settings enable row level security;
drop policy if exists "internal_all" on moalab.settings;
create policy "internal_all" on moalab.settings for all to anon, authenticated using (true) with check (true);
grant all on moalab.settings to anon, authenticated, service_role;

-- 확인 (0 이 나오면 성공 — 아직 아무것도 안 넣었으니까요)
select count(*) as 설정줄 from moalab.settings;
