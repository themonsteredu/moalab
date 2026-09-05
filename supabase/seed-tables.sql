-- =====================================================================
--  역할 표 미리 만들기 — 표가 어울리는데 아직 없는 역할 37개에 양식 칸 붙이기
--
--  SQL Editor 에 통째로 붙여넣고 실행하세요. 여러 번 실행해도 안전합니다
--  (★ 이미 표가 있는 역할은 건드리지 않습니다 — 손으로 만든 칸을 덮어쓰면 값도 사라집니다).
--
--  원장: *"양식들 잘 쓸 법한 거는 구축이 낫지 않아?"*
--  이 앱의 원래 기본값은 '업로드만' 이다 (표를 기본으로 두면 쓰지도 않을 빈 표가 63개 생긴다).
--  그래서 전부가 아니라 **앱의 분류 규칙(planFor)이 '표' 라고 짚은 역할만** 붙인다.
--  칸은 화면의 '양식 고르기' 가 넣는 것과 **완전히 같다** — 이 파일은 그 양식 정의
--  (src/lib/dutyTable.ts 의 PRESETS)에서 스크립트로 뽑았다. 손으로 옮겨 적지 않는다.
--  역할 이름이 바뀌어 안 맞으면 그 줄만 조용히 건너뛴다 (0줄 삽입).
--
--  양식별: 아이디어·기획 목록 1 · 차시 커리큘럼 2 · 제작물 목록 7 · 오류·개선 목록 2 · 문서·계약 대장 4 · 작업 일정·배정 4 · 사람 명단 3 · 학교·기관 목록 1 · 재료·교구 재고 5 · 점검 체크리스트 8
-- =====================================================================

insert into moalab.duty_columns (duty_id, name, kind, options, sort_order)
select du.id, p.name, p.kind, p.options, p.ord
from (values
  ('기획개발부', '[1주차] 주제 발굴 및 핵심 기획 (아이디에이션 & 방향 설정)', '핵심 기능 정의', 'idea'),
  ('기획개발부', '[2주차] AI 웹앱 프로토타입 개발 및 커리큘럼 설계 (기술 구현 & 뼈대 잡기)', '학년·차시 설계 (커리큘럼 뼈대)', 'curriculum'),
  ('기획개발부', '[3주차] 현장 실무 교안 및 수업 양식 제작 (패키지화)', '활동지 및 학습 양식 제작', 'make'),
  ('기획개발부', '[3주차] 현장 실무 교안 및 수업 양식 제작 (패키지화)', '웹앱 UI/UX 최종 다듬기', 'bug'),
  ('기획개발부', '[3주차] 현장 실무 교안 및 수업 양식 제작 (패키지화)', '학년·차시 설계', 'curriculum'),
  ('기획개발부', '[4주차] 검증, 피드백 및 파일럿 테스트 (마무리 및 런칭)', '검증 지적 대응 및 디버깅', 'bug'),
  ('기획개발부', '[4주차] 검증, 피드백 및 파일럿 테스트 (마무리 및 런칭)', '데이터 백업 및 매뉴얼 문서화', 'doc'),
  ('기획개발부', '[4주차] 검증, 피드백 및 파일럿 테스트 (마무리 및 런칭)', '생산운영부 인계 (인프라 이관)', 'plan'),
  ('영업마케팅부', '홍보', '브로셔만들기[A4버전]', 'make'),
  ('영업마케팅부', '홍보', '브로셔만들기[영상]', 'make'),
  ('영업마케팅부', '홍보', '브로셔만들기[링크]', 'make'),
  ('영업마케팅부', '홍보', '명함제작', 'make'),
  ('인사관리부', '강사 채용', '강사 리스트관리', 'people'),
  ('인사관리부', '강사 교육', '교육안 전달', 'make'),
  ('인사관리부', '강사 교육', '강사 강의만족도조사', 'school'),
  ('인사관리부', '출강 관리', '강사 평가·피드백', 'people'),
  ('경영지원부', '회계·정산', '계약 행정문서 관리', 'doc'),
  ('경영지원부', '회계·정산', '총무 자산관리', 'stock'),
  ('경영지원부', '회계·정산', '개인정보 자료보안', 'check'),
  ('경영지원부', '문서·총무', '계약서·공문 보관', 'doc'),
  ('경영지원부', '문서·총무', '사무용품·비품', 'stock'),
  ('경영지원부', '전산·보안', '데이터 백업', 'doc'),
  ('경영지원부', '전산·보안', '초상권 동의 관리', 'people'),
  ('생산운영부', '재료·교구', '재료 발주', 'stock'),
  ('생산운영부', '재료·교구', '재고·단가 확인', 'stock'),
  ('생산운영부', '재료·교구', '교구 점검·수리', 'check'),
  ('생산운영부', '재료·교구', '장비 충전 관리', 'check'),
  ('생산운영부', '재료·교구', '보관 위치 관리', 'stock'),
  ('생산운영부', '수업 키트 준비', '키트 포장', 'plan'),
  ('생산운영부', '수업 키트 준비', '전날 준비물 점검', 'check'),
  ('생산운영부', '수업 키트 준비', '배송·운반', 'plan'),
  ('생산운영부', '수업 키트 준비', '키트 제작 메뉴얼 작성', 'make'),
  ('생산운영부', '수업 키트 준비', '작업 일정 관리', 'plan'),
  ('생산운영부', '현장 운영', '현장 세팅·정리', 'check'),
  ('생산운영부', '현장 운영', '안전 지도', 'check'),
  ('생산운영부', '현장 운영', '긴급 준비물 관리', 'check'),
  ('생산운영부', '현장 운영', '수업 현장 사전 확인', 'check')
) as r(dept, grp, duty, preset)
join moalab.departments d  on d.name = r.dept
join moalab.duty_groups gr on gr.dept_id = d.id and gr.name = r.grp
join moalab.duties du      on du.group_id = gr.id and du.name = r.duty
join (values
  ('idea', '주제·아이디어', 'text', null::jsonb, 1),
  ('idea', '상태', 'select', '["후보","검토 중","채택","보류","취소"]'::jsonb, 2),
  ('idea', '한 줄 설명', 'text', null::jsonb, 3),
  ('idea', '대상 학년', 'text', null::jsonb, 4),
  ('idea', '왜 좋은가', 'text', null::jsonb, 5),
  ('idea', '올린 사람', 'text', null::jsonb, 6),
  ('idea', '정한 날', 'date', null::jsonb, 7),
  ('idea', '메모', 'text', null::jsonb, 8),
  ('curriculum', '차시', 'text', null::jsonb, 1),
  ('curriculum', '상태', 'select', '["안 짬","초안","검토","확정"]'::jsonb, 2),
  ('curriculum', '학년', 'text', null::jsonb, 3),
  ('curriculum', '수업 주제', 'text', null::jsonb, 4),
  ('curriculum', '활동 내용', 'text', null::jsonb, 5),
  ('curriculum', '쓰는 웹앱·도구', 'text', null::jsonb, 6),
  ('curriculum', '준비물', 'text', null::jsonb, 7),
  ('curriculum', '시간(분)', 'number', null::jsonb, 8),
  ('curriculum', '만드는 것', 'text', null::jsonb, 9),
  ('make', '만들 것', 'text', null::jsonb, 1),
  ('make', '상태', 'select', '["기획","작업 중","검수","완료","보류"]'::jsonb, 2),
  ('make', '갈래', 'select', '["브로셔","영상","링크","명함","활동지","매뉴얼","기타"]'::jsonb, 3),
  ('make', '담당', 'text', null::jsonb, 4),
  ('make', '마감', 'date', null::jsonb, 5),
  ('make', '링크·파일', 'text', null::jsonb, 6),
  ('make', '메모', 'text', null::jsonb, 7),
  ('bug', '무엇이 이상한가', 'text', null::jsonb, 1),
  ('bug', '상태', 'select', '["확인 필요","고치는 중","고침","안 고침"]'::jsonb, 2),
  ('bug', '어디서', 'text', null::jsonb, 3),
  ('bug', '급한 정도', 'select', '["높음","보통","낮음"]'::jsonb, 4),
  ('bug', '남긴 사람', 'text', null::jsonb, 5),
  ('bug', '고친 내용', 'text', null::jsonb, 6),
  ('bug', '고친 날', 'date', null::jsonb, 7),
  ('doc', '문서 이름', 'text', null::jsonb, 1),
  ('doc', '갈래', 'select', '["계약서","공문","견적서","세금계산서","증빙","기타"]'::jsonb, 2),
  ('doc', '어디 것', 'text', null::jsonb, 3),
  ('doc', '받은 날', 'date', null::jsonb, 4),
  ('doc', '끝나는 날', 'date', null::jsonb, 5),
  ('doc', '보관 위치', 'text', null::jsonb, 6),
  ('doc', '끝남', 'check', null::jsonb, 7),
  ('doc', '메모', 'text', null::jsonb, 8),
  ('plan', '할 일', 'text', null::jsonb, 1),
  ('plan', '상태', 'select', '["예정","진행 중","완료","미룸"]'::jsonb, 2),
  ('plan', '날짜', 'date', null::jsonb, 3),
  ('plan', '담당', 'text', null::jsonb, 4),
  ('plan', '몇 개·몇 명', 'number', null::jsonb, 5),
  ('plan', '걸린 시간', 'text', null::jsonb, 6),
  ('plan', '메모', 'text', null::jsonb, 7),
  ('people', '이름', 'text', null::jsonb, 1),
  ('people', '상태', 'select', '["지원","서류","면접","합격","보류","종료"]'::jsonb, 2),
  ('people', '구분', 'select', '["지원자","강사","외주","기타"]'::jsonb, 3),
  ('people', '연락처', 'text', null::jsonb, 4),
  ('people', '날짜', 'date', null::jsonb, 5),
  ('people', '동의 받음', 'check', null::jsonb, 6),
  ('people', '메모', 'text', null::jsonb, 7),
  ('school', '학교·기관', 'text', null::jsonb, 1),
  ('school', '진행 상태', 'select', '["연락 전","연락함","제안서 보냄","미팅","견적·계약","진행 중","완료","보류"]'::jsonb, 2),
  ('school', '담당 선생님', 'text', null::jsonb, 3),
  ('school', '연락처', 'text', null::jsonb, 4),
  ('school', '프로그램', 'text', null::jsonb, 5),
  ('school', '인원', 'number', null::jsonb, 6),
  ('school', '금액', 'number', null::jsonb, 7),
  ('school', '다음 할 일', 'text', null::jsonb, 8),
  ('school', '다음 연락일', 'date', null::jsonb, 9),
  ('school', '메모', 'text', null::jsonb, 10),
  ('stock', '품목', 'text', null::jsonb, 1),
  ('stock', '상태', 'select', '["넉넉함","보통","부족","없음","수리 필요"]'::jsonb, 2),
  ('stock', '수량', 'number', null::jsonb, 3),
  ('stock', '단위', 'text', null::jsonb, 4),
  ('stock', '보관 위치', 'text', null::jsonb, 5),
  ('stock', '구매처', 'text', null::jsonb, 6),
  ('stock', '묶음가', 'number', null::jsonb, 7),
  ('stock', '재사용', 'check', null::jsonb, 8),
  ('stock', '확인한 날', 'date', null::jsonb, 9),
  ('stock', '메모', 'text', null::jsonb, 10),
  ('check', '점검 항목', 'text', null::jsonb, 1),
  ('check', '언제', 'select', '["수업 전날","수업 당일","수업 후","매주","매월"]'::jsonb, 2),
  ('check', '담당', 'text', null::jsonb, 3),
  ('check', '확인함', 'check', null::jsonb, 4),
  ('check', '이상 있음', 'check', null::jsonb, 5),
  ('check', '확인한 날', 'date', null::jsonb, 6),
  ('check', '조치 내용', 'text', null::jsonb, 7)
) as p(preset, name, kind, options, ord) on p.preset = r.preset
where not exists (select 1 from moalab.duty_columns x where x.duty_id = du.id);

-- ------------------------------------------------------------- 확인
select d.name as 부서,
       count(*) filter (where exists (select 1 from moalab.duty_columns c where c.duty_id = du.id)) as 표있음,
       count(*) as 역할
from moalab.duties du
join moalab.duty_groups gr on gr.id = du.group_id
join moalab.departments d on d.id = gr.dept_id
group by d.name, d.sort_order order by d.sort_order;
