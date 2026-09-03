-- Google Drive 대기열은 원장 계정으로 실제 외부 파일을 생성한다.
-- 브라우저의 anon/authenticated 키로 행을 넣거나 바꾸지 못하게 서버 전용으로 잠근다.
alter table moalab.drive_uploads enable row level security;
drop policy if exists "internal_all" on moalab.drive_uploads;
revoke all on table moalab.drive_uploads from anon, authenticated;
grant all on table moalab.drive_uploads to service_role;
