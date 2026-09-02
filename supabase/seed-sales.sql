-- =====================================================================
--  영업마케팅부 미리 채우기 — 바로가기 · 표 정리 · 계약까지 체크리스트
--
--  SQL Editor 에 통째로 붙여넣고 실행하세요. 여러 번 실행해도 안전합니다.
--
--  원장님 말: *"내가 영업 마케팅을 맡아놔서 그부분을 먼저 채우려고"*
--
--  ★ 지어내는 것은 하나도 없습니다 — 이미 있는 화면으로 가는 길을 걸고,
--    표의 칸(열)을 붙이고, 반복하는 절차를 체크리스트로 적어둘 뿐입니다.
--    기관 이름·가격·학년처럼 **사실**은 넣지 않습니다.
--
--  ★ 세 블록 모두 "이미 있으면 건드리지 않는다" 입니다.
--    · 바로가기 — 비어 있는 역할에만 건다
--    · 표 — 칸이 있는 역할은 그대로 둔다 (단 하나 예외: 아래 참고)
--    · 체크리스트 — 같은 이름이 있으면 안 만든다
-- =====================================================================

-- ------------------------------------------------------- ① 바로가기 6곳
--  역할에서 그 일을 실제로 하는 화면으로 바로 간다. 이 앱은 프로그램 페이지
--  한 장에 계획서·원가·샘플을 모아둔 게 핵심이라(따로국밥 없애기), 부서별로
--  자료를 옮기지 않고 **길만 낸다** (CLAUDE.md `duties.link`).
--  ※ UPDATE … FROM 에서는 고치는 표(du)를 JOIN 조건에 못 쓴다 — 전부 WHERE 로.
update moalab.duties du
   set link = t.href
  from moalab.duty_groups gr,
       moalab.departments d,
       (values
         ('제안서 작성·발송',     '/apps'),           -- 강의계획서·샘플이 제안서 재료
         ('견적·계약',            '/cost'),           -- 원가표에서 인원 맞춰 견적
         ('수업 사진 정리',       '/gallery'),
         ('기관리스트관리',       '/schedule'),       -- 어디서 무슨 수업을 했는지 = 출강 기록
         ('재출강·재계약',        '/schedule'),       -- 지난 출강을 보고 다음 학기를 연다
         ('브로셔만들기[A4버전]', '/print/lectures')  -- 강의계획서 전체를 A4 로
       ) as t(name, href)
 where gr.id = du.group_id
   and d.id = gr.dept_id
   and d.name = '영업마케팅부'
   and t.name = du.name
   and du.link is null;

-- ------------------------------------------------ ② 표 정리 — 5곳
--  ⚠️ 딱 하나 **지우는** 것이 있다 — `기관리스트관리` 에 붙어 있던 칸 9개.
--     차시·학년·수업 주제·준비물… 즉 **차시 커리큘럼 양식**이 붙어 있었는데,
--     원장님 설명은 "어떤 수업을 했는지 적는다"(기관 목록)라 양식이 엉뚱했다.
--     **줄이 0건이고, 그 엉뚱한 양식(`차시` 칸)이 붙어 있을 때만** 지운다.
--     ⚠️ 처음엔 '줄 0건' 만 보고 지웠더니 **두 번째 실행에서 새로 만든 칸을 또 지우고
--     다시 만들었다** — 원장님이 칸을 손봐뒀다가 다시 돌리면 날아간다 (테스트가 잡았다).
delete from moalab.duty_columns dc
 using moalab.duties du, moalab.duty_groups gr, moalab.departments d
 where dc.duty_id = du.id and du.group_id = gr.id and gr.dept_id = d.id
   and d.name = '영업마케팅부' and du.name = '기관리스트관리'
   and not exists (select 1 from moalab.duty_rows r where r.duty_id = du.id)
   and exists (select 1 from moalab.duty_columns y where y.duty_id = du.id and y.name = '차시');

--  칸을 붙인다. **첫 칸이 줄의 제목**, **첫 고르기 칸이 오른쪽 상태 칩**이다.
--  이미 칸이 있는 역할은 건너뛴다.
insert into moalab.duty_columns (duty_id, name, kind, options, sort_order)
select du.id, c.name, c.kind, c.options::jsonb, c.ord
from moalab.duties du
join moalab.duty_groups gr on gr.id = du.group_id
join moalab.departments d  on d.id  = gr.dept_id
join (values
  -- 기관리스트관리 — 거래한 기관 명단. "어디와 무엇을 몇 번 했나" ------------
  ('기관리스트관리', '기관 이름',     'text',   null::text, 1),
  ('기관리스트관리', '관계',          'select', '["첫 거래","재출강","단골","끊김"]', 2),
  ('기관리스트관리', '지역',          'select',
     '["광주 동구","광주 서구","광주 남구","광주 북구","광주 광산구",
       "목포시","여수시","순천시","나주시","광양시",
       "담양군","곡성군","구례군","고흥군","보성군","화순군","장흥군","강진군",
       "해남군","영암군","무안군","함평군","영광군","장성군","완도군","진도군","신안군",
       "그 밖"]', 3),
  ('기관리스트관리', '담당자·부서',   'text',   null::text, 4),
  ('기관리스트관리', '연락처',        'text',   null::text, 5),
  ('기관리스트관리', '한 프로그램',   'text',   null::text, 6),
  ('기관리스트관리', '마지막 수업 날','date',   null::text, 7),
  ('기관리스트관리', '횟수',          'number', null::text, 8),
  ('기관리스트관리', '인원',          'number', null::text, 9),
  ('기관리스트관리', '메모',          'text',   null::text, 10),

  -- 담당 교사 응대 — 문의 한 건이 한 줄. 답 안 한 것이 눈에 띄어야 한다 --------
  ('담당 교사 응대', '기관·선생님',   'text',   null::text, 1),
  ('담당 교사 응대', '상태',          'select', '["답 대기","답함","일정 잡힘","끝남"]', 2),
  ('담당 교사 응대', '문의 내용',     'text',   null::text, 3),
  ('담당 교사 응대', '연락처',        'text',   null::text, 4),
  ('담당 교사 응대', '프로그램',      'text',   null::text, 5),
  ('담당 교사 응대', '받은 날',       'date',   null::text, 6),
  ('담당 교사 응대', '답한 날',       'date',   null::text, 7),
  ('담당 교사 응대', '메모',          'text',   null::text, 8),

  -- 만족도 조사 — 수업 한 번이 한 줄 --------------------------------------
  ('만족도 조사', '기관',             'text',   null::text, 1),
  ('만족도 조사', '상태',             'select', '["조사 전","보냄","받음","정리함"]', 2),
  ('만족도 조사', '수업 날',          'date',   null::text, 3),
  ('만족도 조사', '프로그램',         'text',   null::text, 4),
  ('만족도 조사', '점수(5점)',        'number', null::text, 5),
  ('만족도 조사', '좋았던 점',        'text',   null::text, 6),
  ('만족도 조사', '고칠 점',          'text',   null::text, 7),
  ('만족도 조사', '다시 부를 뜻',     'check',  null::text, 8),
  ('만족도 조사', '메모',             'text',   null::text, 9),

  -- 재출강·재계약 — 지난 기관에 다음 학기를 여는 일 ---------------------------
  ('재출강·재계약', '기관 이름',      'text',   null::text, 1),
  ('재출강·재계약', '상태',           'select', '["연락 전","연락함","제안 보냄","재계약","보류","종료"]', 2),
  ('재출강·재계약', '지난 프로그램',  'text',   null::text, 3),
  ('재출강·재계약', '지난 수업 날',   'date',   null::text, 4),
  ('재출강·재계약', '다음 학기 희망', 'text',   null::text, 5),
  ('재출강·재계약', '담당자·부서',    'text',   null::text, 6),
  ('재출강·재계약', '연락처',         'text',   null::text, 7),
  ('재출강·재계약', '다음 연락일',    'date',   null::text, 8),
  ('재출강·재계약', '메모',           'text',   null::text, 9),

  -- 견적·계약 — 견적 한 건이 한 줄. 견적 금액과 계약 금액을 따로 둔다 -----------
  ('견적·계약', '기관 이름',          'text',   null::text, 1),
  ('견적·계약', '상태',               'select', '["견적 전","견적 보냄","협의 중","계약","취소"]', 2),
  ('견적·계약', '프로그램',           'text',   null::text, 3),
  ('견적·계약', '인원',               'number', null::text, 4),
  ('견적·계약', '차시',               'number', null::text, 5),
  ('견적·계약', '견적 금액',          'number', null::text, 6),
  ('견적·계약', '계약 금액',          'number', null::text, 7),
  ('견적·계약', '계약일',             'date',   null::text, 8),
  ('견적·계약', '수업 예정일',        'date',   null::text, 9),
  ('견적·계약', '담당자·부서',        'text',   null::text, 10),
  ('견적·계약', '메모',               'text',   null::text, 11)
) as c(duty, name, kind, options, ord) on c.duty = du.name
where d.name = '영업마케팅부'
  and not exists (select 1 from moalab.duty_columns x where x.duty_id = du.id);

-- ------------------------------------ ③ 체크리스트 "기관 계약 한 바퀴"
--  기준일 = **수업 날**. 앞은 음수(며칠 전), 뒤는 양수(며칠 후).
--  담당자는 비워둔다 — 뿌릴 때 미리보기에서 줄마다 고른다.
--  단계·날짜는 초안이다. 관리 > 체크리스트 관리에서 고치면 된다.
insert into moalab.task_templates (name, sort_order)
select '기관 계약 한 바퀴 (기준일 = 수업 날)', coalesce((select max(sort_order) from moalab.task_templates), 0) + 1
where not exists (select 1 from moalab.task_templates where name = '기관 계약 한 바퀴 (기준일 = 수업 날)');

insert into moalab.task_template_items (template_id, title, detail, day_offset, sort_order)
select t.id, i.title, i.detail, i.off, i.ord
from moalab.task_templates t
join (values
  ('첫 연락·수요 파악',      '학년·인원·희망 날짜·예산을 묻는다',                      -30, 1),
  ('제안서 보내기',          '프로그램계획에서 강의계획서·샘플 이미지를 뽑아 보낸다',   -25, 2),
  ('견적 보내기',            '원가표에서 인원에 맞춰 뽑는다',                          -20, 3),
  ('계약서 주고받기',        null,                                                     -14, 4),
  ('일정·인원·장소 확정',    '일정 화면에 출강으로 등록한다',                          -10, 5),
  ('강사 배정',              '출강에 담당 강사를 넣는다 — 그 사람에게만 알림이 간다',   -7, 6),
  ('교구·키트 준비 확인',    null,                                                      -3, 7),
  ('수업',                   null,                                                       0, 8),
  ('만족도 조사 보내기',     null,                                                       1, 9),
  ('수업 사진 정리·SNS',     '갤러리에 올리면 드라이브에도 한 벌 간다',                  3, 10),
  ('정산·세금계산서',        null,                                                       7, 11),
  ('재출강 제안',            '다음 학기 이야기를 꺼낸다',                               30, 12)
) as i(title, detail, off, ord) on true
where t.name = '기관 계약 한 바퀴 (기준일 = 수업 날)'
  and not exists (select 1 from moalab.task_template_items x where x.template_id = t.id);

-- ------------------------------------------------------------- 확인
select '바로가기' as 항목, count(*)::text as 결과
  from moalab.duties du join moalab.duty_groups gr on gr.id = du.group_id
  join moalab.departments d on d.id = gr.dept_id
 where d.name = '영업마케팅부' and du.link is not null
union all
select '표 있는 역할', count(distinct du.id)::text
  from moalab.duties du join moalab.duty_groups gr on gr.id = du.group_id
  join moalab.departments d on d.id = gr.dept_id
  join moalab.duty_columns dc on dc.duty_id = du.id
 where d.name = '영업마케팅부' and gr.sort_order < 10
union all
select '체크리스트 항목', count(*)::text
  from moalab.task_template_items i join moalab.task_templates t on t.id = i.template_id
 where t.name = '기관 계약 한 바퀴 (기준일 = 수업 날)';
