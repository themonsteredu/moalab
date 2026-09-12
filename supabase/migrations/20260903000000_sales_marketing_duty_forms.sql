-- 영업마케팅부의 기본 업무 13개를 실제 업무에 맞는 전용 양식으로 정리한다.
-- 기존 줄은 열 이름을 기준으로 새 양식에 옮긴 뒤에만 기존 열을 제거한다.
-- 신규발굴 세부 갈래 15개는 이미 전용 영업 파이프라인 양식이므로 건드리지 않는다.

create temp table _sales_forms (
  duty_name text not null,
  column_name text not null,
  kind text not null,
  options jsonb,
  sort_order int not null,
  primary key (duty_name, column_name)
) on commit drop;

insert into _sales_forms (duty_name, column_name, kind, options, sort_order) values
  ('제안서 작성·발송', '기관명', 'text', null, 1),
  ('제안서 작성·발송', '진행상태', 'select', '["작성 전","작성 중","발송 완료","답변 대기","협의 중","성사","보류"]', 2),
  ('제안서 작성·발송', '제안 프로그램', 'text', null, 3),
  ('제안서 작성·발송', '발송일', 'date', null, 4),
  ('제안서 작성·발송', '담당자', 'text', null, 5),
  ('제안서 작성·발송', '연락처', 'text', null, 6),
  ('제안서 작성·발송', '제안금액', 'number', null, 7),
  ('제안서 작성·발송', '답변기한', 'date', null, 8),
  ('제안서 작성·발송', '다음 할 일', 'text', null, 9),
  ('제안서 작성·발송', '메모', 'text', null, 10),

  ('견적·계약', '기관명', 'text', null, 1),
  ('견적·계약', '진행상태', 'select', '["견적 전","견적 발송","협의 중","계약 완료","취소"]', 2),
  ('견적·계약', '프로그램', 'text', null, 3),
  ('견적·계약', '인원', 'number', null, 4),
  ('견적·계약', '차시', 'number', null, 5),
  ('견적·계약', '견적금액', 'number', null, 6),
  ('견적·계약', '계약금액', 'number', null, 7),
  ('견적·계약', '계약일', 'date', null, 8),
  ('견적·계약', '수업일', 'date', null, 9),
  ('견적·계약', '담당자·부서', 'text', null, 10),
  ('견적·계약', '입금상태', 'select', '["확인 전","미입금","일부 입금","입금 완료"]', 11),
  ('견적·계약', '메모', 'text', null, 12),

  ('신규 기관 발굴', '기관명', 'text', null, 1),
  ('신규 기관 발굴', '진행상태', 'select', '["연락 전","연락함","제안서 발송","미팅","견적·계약","진행 중","완료","보류"]', 2),
  ('신규 기관 발굴', '기관유형', 'select', '["학교","청소년기관","아동·돌봄","청년·대학","공공·문화·복지","기타"]', 3),
  ('신규 기관 발굴', '지역', 'text', null, 4),
  ('신규 기관 발굴', '담당자·부서', 'text', null, 5),
  ('신규 기관 발굴', '연락처', 'text', null, 6),
  ('신규 기관 발굴', '이메일·홈페이지', 'text', null, 7),
  ('신규 기관 발굴', '관심 프로그램', 'text', null, 8),
  ('신규 기관 발굴', '예상 인원', 'number', null, 9),
  ('신규 기관 발굴', '예상 금액', 'number', null, 10),
  ('신규 기관 발굴', '다음 할 일', 'text', null, 11),
  ('신규 기관 발굴', '다음 연락일', 'date', null, 12),
  ('신규 기관 발굴', '메모', 'text', null, 13),

  ('SNS·블로그 운영', '콘텐츠 주제', 'text', null, 1),
  ('SNS·블로그 운영', '진행상태', 'select', '["아이디어","작성 중","검수","발행 예약","발행 완료","보류"]', 2),
  ('SNS·블로그 운영', '채널', 'select', '["인스타그램","블로그","유튜브","홈페이지","기타"]', 3),
  ('SNS·블로그 운영', '작성자', 'text', null, 4),
  ('SNS·블로그 운영', '발행예정일', 'date', null, 5),
  ('SNS·블로그 운영', '발행일', 'date', null, 6),
  ('SNS·블로그 운영', '발행주소', 'text', null, 7),
  ('SNS·블로그 운영', '메모', 'text', null, 8),

  ('브로셔만들기[A4버전]', '자료명', 'text', null, 1),
  ('브로셔만들기[A4버전]', '진행상태', 'select', '["기획","제작 중","검수","완료","보류"]', 2),
  ('브로셔만들기[A4버전]', '대상', 'text', null, 3),
  ('브로셔만들기[A4버전]', '담당자', 'text', null, 4),
  ('브로셔만들기[A4버전]', '마감일', 'date', null, 5),
  ('브로셔만들기[A4버전]', '파일·링크', 'text', null, 6),
  ('브로셔만들기[A4버전]', '검수상태', 'select', '["검수 전","수정 필요","승인"]', 7),
  ('브로셔만들기[A4버전]', '메모', 'text', null, 8),

  ('수업 사진 정리', '기관', 'text', null, 1),
  ('수업 사진 정리', '정리상태', 'select', '["정리 전","선별 중","정리 완료","공유 완료"]', 2),
  ('수업 사진 정리', '프로그램', 'text', null, 3),
  ('수업 사진 정리', '수업일', 'date', null, 4),
  ('수업 사진 정리', '촬영자', 'text', null, 5),
  ('수업 사진 정리', '초상권 확인', 'check', null, 6),
  ('수업 사진 정리', '보관 위치', 'text', null, 7),
  ('수업 사진 정리', '메모', 'text', null, 8),

  ('브로셔만들기[영상]', '영상명', 'text', null, 1),
  ('브로셔만들기[영상]', '진행상태', 'select', '["기획","촬영","편집","검수","완료","보류"]', 2),
  ('브로셔만들기[영상]', '대상', 'text', null, 3),
  ('브로셔만들기[영상]', '담당자', 'text', null, 4),
  ('브로셔만들기[영상]', '마감일', 'date', null, 5),
  ('브로셔만들기[영상]', '영상 링크', 'text', null, 6),
  ('브로셔만들기[영상]', '검수상태', 'select', '["검수 전","수정 필요","승인"]', 7),
  ('브로셔만들기[영상]', '메모', 'text', null, 8),

  ('브로셔만들기[링크]', '링크명', 'text', null, 1),
  ('브로셔만들기[링크]', '진행상태', 'select', '["준비 전","연결 중","검수","완료","보류"]', 2),
  ('브로셔만들기[링크]', '연결 대상', 'text', null, 3),
  ('브로셔만들기[링크]', '담당자', 'text', null, 4),
  ('브로셔만들기[링크]', '마감일', 'date', null, 5),
  ('브로셔만들기[링크]', 'URL', 'text', null, 6),
  ('브로셔만들기[링크]', '검수상태', 'select', '["검수 전","수정 필요","승인"]', 7),
  ('브로셔만들기[링크]', '메모', 'text', null, 8),

  ('명함제작', '대상자', 'text', null, 1),
  ('명함제작', '진행상태', 'select', '["요청","디자인 중","검수","발주","수령","보류"]', 2),
  ('명함제작', '직함·역할', 'text', null, 3),
  ('명함제작', '연락처', 'text', null, 4),
  ('명함제작', '이메일', 'text', null, 5),
  ('명함제작', '수량', 'number', null, 6),
  ('명함제작', '담당자', 'text', null, 7),
  ('명함제작', '마감일', 'date', null, 8),
  ('명함제작', '파일·링크', 'text', null, 9),
  ('명함제작', '메모', 'text', null, 10),

  ('담당 교사 응대', '기관', 'text', null, 1),
  ('담당 교사 응대', '처리상태', 'select', '["답변 대기","답변 완료","일정 확정","종료"]', 2),
  ('담당 교사 응대', '담당자', 'text', null, 3),
  ('담당 교사 응대', '연락처', 'text', null, 4),
  ('담당 교사 응대', '프로그램', 'text', null, 5),
  ('담당 교사 응대', '문의내용', 'text', null, 6),
  ('담당 교사 응대', '받은날', 'date', null, 7),
  ('담당 교사 응대', '답변내용', 'text', null, 8),
  ('담당 교사 응대', '답변일', 'date', null, 9),
  ('담당 교사 응대', '메모', 'text', null, 10),

  ('만족도 조사', '기관', 'text', null, 1),
  ('만족도 조사', '조사상태', 'select', '["조사 전","발송","응답 완료","정리 완료"]', 2),
  ('만족도 조사', '프로그램', 'text', null, 3),
  ('만족도 조사', '수업일', 'date', null, 4),
  ('만족도 조사', '점수(5점)', 'number', null, 5),
  ('만족도 조사', '좋았던 점', 'text', null, 6),
  ('만족도 조사', '개선점', 'text', null, 7),
  ('만족도 조사', '재출강 의사', 'select', '["있음","미정","없음"]', 8),
  ('만족도 조사', '메모', 'text', null, 9),

  ('재출강·재계약', '기관', 'text', null, 1),
  ('재출강·재계약', '진행상태', 'select', '["연락 전","연락함","제안 발송","재계약","보류","종료"]', 2),
  ('재출강·재계약', '지난 프로그램', 'text', null, 3),
  ('재출강·재계약', '지난 수업일', 'date', null, 4),
  ('재출강·재계약', '지난 계약금액', 'number', null, 5),
  ('재출강·재계약', '희망 시기', 'text', null, 6),
  ('재출강·재계약', '담당자·부서', 'text', null, 7),
  ('재출강·재계약', '연락처', 'text', null, 8),
  ('재출강·재계약', '다음 연락일', 'date', null, 9),
  ('재출강·재계약', '결과', 'text', null, 10),
  ('재출강·재계약', '메모', 'text', null, 11),

  ('기관리스트관리', '기관명', 'text', null, 1),
  ('기관리스트관리', '관계상태', 'select', '["첫 거래","재출강","단골","중단"]', 2),
  ('기관리스트관리', '기관유형', 'text', null, 3),
  ('기관리스트관리', '지역', 'text', null, 4),
  ('기관리스트관리', '담당자·부서', 'text', null, 5),
  ('기관리스트관리', '연락처', 'text', null, 6),
  ('기관리스트관리', '이메일·홈페이지', 'text', null, 7),
  ('기관리스트관리', '진행 프로그램', 'text', null, 8),
  ('기관리스트관리', '마지막 수업일', 'date', null, 9),
  ('기관리스트관리', '출강 횟수', 'number', null, 10),
  ('기관리스트관리', '누적 인원', 'number', null, 11),
  ('기관리스트관리', '누적 계약금액', 'number', null, 12),
  ('기관리스트관리', '다음 연락일', 'date', null, 13),
  ('기관리스트관리', '메모', 'text', null, 14);

-- 기존 열 이름을 사람이 보는 이름으로 백업한다. 행 데이터가 없는 업무도 같은 경로로 처리된다.
create temp table _sales_row_backup on commit drop as
select dr.id as row_id,
       du.name as duty_name,
       coalesce(
         jsonb_object_agg(dc.name, dr.cells -> dc.id::text)
           filter (where dc.id is not null and dr.cells ? dc.id::text),
         '{}'::jsonb
       ) as named_values
from moalab.departments d
join moalab.duty_groups gr on gr.dept_id = d.id
join moalab.duties du on du.group_id = gr.id
join _sales_forms sf on sf.duty_name = du.name
join moalab.duty_rows dr on dr.duty_id = du.id
left join moalab.duty_columns dc on dc.duty_id = du.id
where d.name = '영업마케팅부'
group by dr.id, du.name;

-- 새 열 이름마다 받아올 수 있는 예전 열 이름을 우선순위대로 둔다.
create temp table _sales_aliases (
  duty_name text not null,
  column_name text not null,
  old_names text[] not null,
  primary key (duty_name, column_name)
) on commit drop;

insert into _sales_aliases values
  ('제안서 작성·발송','기관명',array['기관명','기관 이름','학교·기관']),
  ('제안서 작성·발송','진행상태',array['진행상태','진행 상태','상태']),
  ('제안서 작성·발송','제안 프로그램',array['제안 프로그램','프로그램']),
  ('제안서 작성·발송','발송일',array['발송일']),
  ('제안서 작성·발송','담당자',array['담당자','담당 선생님','담당자·부서']),
  ('제안서 작성·발송','연락처',array['연락처']),
  ('제안서 작성·발송','제안금액',array['제안금액','제안 금액','금액']),
  ('제안서 작성·발송','답변기한',array['답변기한','다음 연락일']),
  ('제안서 작성·발송','다음 할 일',array['다음 할 일']),
  ('제안서 작성·발송','메모',array['메모']),

  ('신규 기관 발굴','기관명',array['기관명','기관 이름','학교·기관']),
  ('신규 기관 발굴','진행상태',array['진행상태','진행 상태','상태']),
  ('신규 기관 발굴','기관유형',array['기관유형','기관 유형']),
  ('신규 기관 발굴','지역',array['지역']),
  ('신규 기관 발굴','담당자·부서',array['담당자·부서','담당 선생님','담당자']),
  ('신규 기관 발굴','연락처',array['연락처']),
  ('신규 기관 발굴','이메일·홈페이지',array['이메일·홈페이지']),
  ('신규 기관 발굴','관심 프로그램',array['관심 프로그램','프로그램']),
  ('신규 기관 발굴','예상 인원',array['예상 인원','인원']),
  ('신규 기관 발굴','예상 금액',array['예상 금액','금액']),
  ('신규 기관 발굴','다음 할 일',array['다음 할 일']),
  ('신규 기관 발굴','다음 연락일',array['다음 연락일']),
  ('신규 기관 발굴','메모',array['메모']);

-- 데이터가 없는 나머지 업무에도 재실행 안전성을 주기 위해 동일 이름은 자동으로 보존한다.
insert into _sales_aliases (duty_name, column_name, old_names)
select sf.duty_name, sf.column_name, array[sf.column_name]
from _sales_forms sf
on conflict (duty_name, column_name) do nothing;

delete from moalab.duty_columns dc
using moalab.duties du, moalab.duty_groups gr, moalab.departments d
where dc.duty_id = du.id
  and du.group_id = gr.id
  and gr.dept_id = d.id
  and d.name = '영업마케팅부'
  and exists (select 1 from _sales_forms sf where sf.duty_name = du.name);

insert into moalab.duty_columns (duty_id, name, kind, options, sort_order)
select du.id, sf.column_name, sf.kind, sf.options, sf.sort_order
from moalab.departments d
join moalab.duty_groups gr on gr.dept_id = d.id
join moalab.duties du on du.group_id = gr.id
join _sales_forms sf on sf.duty_name = du.name
where d.name = '영업마케팅부'
order by du.id, sf.sort_order;

-- 새 UUID 열쇠로 행을 다시 만들되, 백업한 모든 실제 값은 의미가 같은 새 칸으로 옮긴다.
update moalab.duty_rows dr
set cells = rebuilt.cells,
    updated_at = now()
from (
  select b.row_id,
         coalesce(
           jsonb_object_agg(
             dc.id::text,
             coalesce(
               (
                 select b.named_values -> old_name
                 from unnest(a.old_names) with ordinality as old(old_name, priority)
                 where b.named_values ? old_name
                   and b.named_values -> old_name <> 'null'::jsonb
                 order by priority
                 limit 1
               ),
               'null'::jsonb
             )
           ),
           '{}'::jsonb
         ) as cells
  from _sales_row_backup b
  join moalab.departments d on d.name = '영업마케팅부'
  join moalab.duty_groups gr on gr.dept_id = d.id
  join moalab.duties du on du.group_id = gr.id and du.name = b.duty_name
  join moalab.duty_columns dc on dc.duty_id = du.id
  join _sales_aliases a on a.duty_name = du.name and a.column_name = dc.name
  group by b.row_id
) rebuilt
where dr.id = rebuilt.row_id;

