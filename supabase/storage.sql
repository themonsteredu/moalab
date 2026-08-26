-- =====================================================================
--  모아랩 Storage 버킷만 따로 (여러 번 실행해도 안전)
--
--  schema.sql 안에도 같은 내용이 들어있다. 이 파일을 따로 둔 이유:
--  버킷은 나중에 늘어난다. 처음엔 3개(comment-files·cost-photos·gallery)뿐이었고
--  plans·notices·receipts 는 뒤에 추가됐다. 그래서 "예전에 schema.sql 을 돌렸는데
--  문서·공지 첨부만 안 올라간다" 는 일이 생긴다 —
--  나중에 생긴 버킷이 그 DB 에는 없기 때문이다.
--  표를 다시 만들 걱정 없이 이 파일만 붙여넣으면 된다.
--
--  Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 Run.
--  맨 아래 확인 쿼리가 '버킷 6 / 정책 24' 를 돌려주면 정상이다.
-- =====================================================================

-- 1) 버킷 — 공개 읽기. 이름 앞에 moalab- 을 붙여 남의 버킷을 건드리지 않는다
insert into storage.buckets (id, name, public)
values ('moalab-comment-files','moalab-comment-files', true),  -- 댓글·검증 캡처
       ('moalab-cost-photos',  'moalab-cost-photos',   true),  -- 원가 재료 사진
       ('moalab-gallery',      'moalab-gallery',       true),  -- 수업 사진
       ('moalab-plans',        'moalab-plans',         true),  -- 문서 첨부(계획안·교육안·양식)
       ('moalab-notices',      'moalab-notices',       true),  -- 공지 첨부
       ('moalab-receipts',     'moalab-receipts',      true)   -- 지출결의서 영수증
on conflict (id) do update set public = true;

-- 2) 버킷마다 읽기·쓰기·수정·삭제 정책
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

-- 3) 확인 — 버킷 6 · 정책 24 가 나와야 정상
select 'moalab- 버킷' as 항목, count(*)::text as 값
  from storage.buckets where id like 'moalab-%'
union all
select 'moalab 정책', count(*)::text
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects' and policyname like '%moalab-%';
