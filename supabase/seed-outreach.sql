-- =====================================================================
--  신규 기관 발굴 — **표 하나로 합치기**
--
--  SQL Editor 에 통째로 붙여넣고 실행하세요. 여러 번 실행해도 안전합니다.
--
--  ⚠️ **이 파일은 예전에 정반대 일을 했습니다.** 원래는 연락할 곳을
--  갈래 15개(중분류 5 · 소분류 15)로 **쪼개서** 표를 15개 만들었습니다.
--  원장님이 써보고 *"합쳐"* 라고 하셔서 이 파일이 그 반대로 바뀌었습니다 —
--  **쪼갠 것을 다시 하나로 모읍니다.**
--
--  왜 합치나:
--  · 15개 표의 칸이 **전부 똑같았습니다** (기관 이름·진행 상태·지역·연락처…).
--    갈래는 칸 하나면 되는데 표를 열다섯 개 판 것이었습니다
--  · 채워진 건 둘뿐이고 열셋은 빈 표였습니다. *"이번 달 연락할 곳"* 을 보려고
--    열다섯 군데를 돌아야 했습니다
--  · 합치면 `기관 갈래` 로 걸러 보면 되고, 검색·인쇄·엑셀도 한 번에 됩니다
--
--  ★ 기관 이름은 여전히 넣지 않습니다 — 제가 지어낸 이름을 넣으면 원장님이
--    **없는 곳에 전화하시게 됩니다.** 실제 목록은 앱의 `목록 한꺼번에` 로
--    붙여넣으시면 됩니다 (엑셀·한글 표를 복사해 그대로).
--
--  ※ 먼저 supabase/duty-table.sql 이 돌아가 있어야 합니다
--    (moalab.duty_columns · duty_rows 두 표).
-- =====================================================================

-- ⚠️ **통째로 한 거래로 묶습니다.** 중간에 실패했는데 뒤의 `delete` 만 돌면
--    옮기지도 못한 줄이 사라집니다 (로컬에서 실제로 그렇게 날려보고 넣었습니다).
begin;

-- ------------------------------------------------------------ 부서·중분류
insert into moalab.departments (name, sort_order) values ('영업마케팅부', 2)
on conflict (name) do nothing;

insert into moalab.duty_groups (dept_id, name, sort_order)
select d.id, '학교·기관 영업', 1 from moalab.departments d where d.name = '영업마케팅부'
on conflict (dept_id, name) do nothing;

-- --------------------------------------------------------------- 역할 하나
insert into moalab.duties (group_id, name, note, sort_order)
select g.id, '신규 기관 발굴',
       '교육청·진로교육원·학교·청소년기관·아동돌봄·청년센터 등 연락할 곳을 한 표로', 3
from moalab.duty_groups g
join moalab.departments d on d.id = g.dept_id
where d.name = '영업마케팅부' and g.name = '학교·기관 영업'
on conflict (group_id, name) do nothing;

-- ------------------------------------------------------------------- 표 칸
--  ⚠️ **이미 있는 칸은 이름으로 찾아 갈래·보기만 맞춥니다.** 지우고 다시 만들면
--  그 칸에 적어둔 값이 통째로 사라집니다 (열 id 가 값의 열쇠이기 때문).
--
--  ⚠️⚠️ **세 걸음을 한 문장에 넣으면 안 됩니다.** CTE 는 문장 시작 시점을 보므로,
--  같은 문장 안에서 이름을 바꾸고 `not exists` 로 거르면 **바뀌기 전 이름**을 보고
--  같은 칸을 또 만듭니다 — 칸이 13개에서 16개로 늘고, 그다음 `기관 갈래` 를 찾는
--  곳이 두 줄을 받아 통째로 실패합니다. 로컬에서 돌려보고 잡은 사고입니다.

-- ① 옛 이름으로 남아 있는 칸을 새 이름으로 (값은 그대로 붙어 있다)
update moalab.duty_columns c set name = w.name
from (values ('기관명','기관 이름'), ('진행상태','진행 상태'), ('기관유형','기관 갈래')) as w(alias, name)
where c.name = w.alias
  and c.duty_id = (select t.id from moalab.duties t
                   join moalab.duty_groups g on g.id = t.group_id
                   join moalab.departments d on d.id = g.dept_id
                   where d.name='영업마케팅부' and g.name='학교·기관 영업' and t.name='신규 기관 발굴')
  and not exists (select 1 from moalab.duty_columns x
                   where x.duty_id = c.duty_id and x.name = w.name);

-- ② 없는 칸만 새로 만든다
insert into moalab.duty_columns (duty_id, name, kind, options, sort_order)
select duty.id, w.name, w.kind, w.options, w.sort_order
from (select t.id from moalab.duties t
      join moalab.duty_groups g on g.id = t.group_id
      join moalab.departments d on d.id = g.dept_id
      where d.name='영업마케팅부' and g.name='학교·기관 영업' and t.name='신규 기관 발굴') duty,
     (values
  -- 첫 칸이 그 줄의 제목이다 (폰에서 카드 제목이 된다)
  (1,  '기관 이름',      'text',   null::jsonb),
  -- 첫 고르기 칸이 목록 오른쪽 **상태 칩**이 된다 — 갈래 칸보다 반드시 위
  (2,  '진행 상태',      'select', '["연락 전","연락함","제안서 보냄","미팅","견적·계약","진행 중","완료","보류"]'::jsonb),
  -- 표 열다섯 개를 대신하는 칸. 15갈래 + 기타
  (3,  '기관 갈래',      'select', '["초등학교","중학교","고등학교·특수·대안학교","청소년문화의집","청소년수련관·수련원","청소년상담복지센터·꿈드림","지역아동센터","다함께돌봄센터·방과후아카데미","아동복지시설·그룹홈","청년센터","대학·평생교육원","교육청·교육지원청·진로교육원","공공도서관·평생학습관","문화재단·과학관·체험관","복지관·지자체","기타"]'::jsonb),
  -- 글로 적으면 `광주 북구` 와 `북구` 가 따로 세어진다 → 고르기
  (4,  '지역',           'select', '["광주 동구","광주 서구","광주 남구","광주 북구","광주 광산구","목포시","여수시","순천시","나주시","광양시","담양군","곡성군","구례군","고흥군","보성군","화순군","장흥군","강진군","해남군","영암군","무안군","함평군","영광군","장성군","완도군","진도군","신안군","그 밖"]'::jsonb),
  (5,  '담당자·부서',    'text',   null),
  (6,  '연락처',         'text',   null),
  (7,  '이메일·홈페이지','text',   null),
  (8,  '관심 프로그램',  'text',   null),
  (9,  '예상 인원',      'number', null),
  (10, '예상 금액',      'number', null),
  (11, '다음 할 일',     'text',   null),
  -- ⚠️ `연락` 이 든 날짜 칸이 있어야 `내 업무` 의 **영업 한 판**이 이 표를 모은다
  (12, '다음 연락일',    'date',   null),
  (13, '메모',           'text',   null)
) as w(sort_order, name, kind, options)
where not exists (
  select 1 from moalab.duty_columns c where c.duty_id = duty.id and c.name = w.name
);

-- ③ 이미 있던 칸의 갈래·보기·순서를 맞춘다 (지우지 않는다)
update moalab.duty_columns c
   set kind = w.kind, options = w.options, sort_order = w.sort_order
from (values
  (1,'기관 이름','text',null::jsonb),
  (2,'진행 상태','select','["연락 전","연락함","제안서 보냄","미팅","견적·계약","진행 중","완료","보류"]'::jsonb),
  (3,'기관 갈래','select','["초등학교","중학교","고등학교·특수·대안학교","청소년문화의집","청소년수련관·수련원","청소년상담복지센터·꿈드림","지역아동센터","다함께돌봄센터·방과후아카데미","아동복지시설·그룹홈","청년센터","대학·평생교육원","교육청·교육지원청·진로교육원","공공도서관·평생학습관","문화재단·과학관·체험관","복지관·지자체","기타"]'::jsonb),
  (4,'지역','select','["광주 동구","광주 서구","광주 남구","광주 북구","광주 광산구","목포시","여수시","순천시","나주시","광양시","담양군","곡성군","구례군","고흥군","보성군","화순군","장흥군","강진군","해남군","영암군","무안군","함평군","영광군","장성군","완도군","진도군","신안군","그 밖"]'::jsonb),
  (5,'담당자·부서','text',null),(6,'연락처','text',null),(7,'이메일·홈페이지','text',null),
  (8,'관심 프로그램','text',null),(9,'예상 인원','number',null),(10,'예상 금액','number',null),
  (11,'다음 할 일','text',null),(12,'다음 연락일','date',null),(13,'메모','text',null)
) as w(sort_order, name, kind, options)
where c.name = w.name
  and c.duty_id = (select t.id from moalab.duties t
                   join moalab.duty_groups g on g.id = t.group_id
                   join moalab.departments d on d.id = g.dept_id
                   where d.name='영업마케팅부' and g.name='학교·기관 영업' and t.name='신규 기관 발굴');

-- ------------------------------------------------------ 쪼개뒀던 줄을 옮긴다
--  **칸은 id 가 아니라 이름으로 잇습니다** (표마다 열 id 가 다릅니다).
--  갈래는 그 표의 역할 이름이 그대로 값이 됩니다 (`청소년문화의집` …).
insert into moalab.duty_rows (duty_id, cells, sort_order, updated_by, created_at, updated_at)
select tgt.id,
       coalesce((
         select jsonb_object_agg(tc.id::text, v.val)
         from jsonb_each(r.cells) v(key, val)
         join moalab.duty_columns sc on sc.id = v.key::uuid
         join moalab.duty_columns tc on tc.duty_id = tgt.id and tc.name = sc.name
         where v.val is not null and v.val <> 'null'::jsonb
       ), '{}'::jsonb)
       || jsonb_build_object(
            (select id::text from moalab.duty_columns
              where duty_id = tgt.id and name = '기관 갈래'),
            to_jsonb(t.name)),
       (select coalesce(max(x.sort_order), 0) from moalab.duty_rows x where x.duty_id = tgt.id)
         + row_number() over (order by g.sort_order, t.sort_order, r.sort_order),
       r.updated_by, r.created_at, r.updated_at
from moalab.duty_rows r
join moalab.duties t on t.id = r.duty_id
join moalab.duty_groups g on g.id = t.group_id
cross join lateral (
  select t2.id from moalab.duties t2
  join moalab.duty_groups g2 on g2.id = t2.group_id
  join moalab.departments d2 on d2.id = g2.dept_id
  where d2.name='영업마케팅부' and g2.name='학교·기관 영업' and t2.name='신규 기관 발굴'
) tgt
where g.name like '신규발굴%';

-- ------------------------------------------------- 쪼개뒀던 표·묶음을 걷어낸다
--  줄은 위에서 옮겼다. 역할을 지우면 그 표의 칸·줄이 같이 사라진다.
delete from moalab.duties t
 using moalab.duty_groups g
 where g.id = t.group_id and g.name like '신규발굴%';

--  역할이 없어진 묶음도 같이 — 빈 묶음이 남으면 트리에 빈 줄만 선다
delete from moalab.duty_groups where name like '신규발굴%';

commit;

-- ------------------------------------------------------------------- 확인
select t.name as 역할,
       (select count(*) from moalab.duty_columns c where c.duty_id = t.id) as 칸,
       (select count(*) from moalab.duty_rows r where r.duty_id = t.id)    as 줄,
       (select count(*) from moalab.duty_groups where name like '신규발굴%') as 남은_쪼갠묶음
from moalab.duties t
join moalab.duty_groups g on g.id = t.group_id
join moalab.departments d on d.id = g.dept_id
where d.name='영업마케팅부' and g.name='학교·기관 영업' and t.name='신규 기관 발굴';
