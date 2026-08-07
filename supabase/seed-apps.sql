-- =====================================================================
--  기존 웹앱 21개 일괄 등록 (노션 목록 이관)
--
--  SQL Editor 에 붙여넣고 실행하세요. 여러 번 실행해도 안전합니다
--  (slug 가 이미 있으면 건너뜁니다).
--
--  같이 만들어지는 것
--   · 앱 21개 (slug · 한글명 · 배포 링크)
--   · 검증자 배정 (노션 '담당자' 열 그대로)
--   · 1차 검증 라운드 + (검증자 2명 × 5항목) 체크 칸
--
--  ★ 두 가지는 일부러 비워뒀습니다
--   1) 제작자 — 노션 목록에 없어서 넣을 수가 없었습니다.
--      앱을 열고 '수정' 에서 골라주세요.
--   2) 검증 결과 — 노션의 '수정 완료' 5개도 전부 '미확인' 으로 들어갑니다.
--      제가 임의로 "이서은 통과" 라고 찍어버리면 실제로 안 본 걸 봤다고
--      기록하는 셈이라 그렇게 하지 않았습니다.
--      노션 상태는 각 앱의 '제작 목적' 칸에 메모로 남겨뒀습니다.
--      그대로 완료 처리하고 싶으시면 맨 아래 주석을 참고하세요.
-- =====================================================================

do $$
declare
  r          record;
  v_app_id   uuid;
  v_round_id uuid;
  v_member   uuid;
  v_name     text;
  n_new      int := 0;
  n_skip     int := 0;
begin
  for r in
    select * from (values
      ('ai-bakery',          '제과제빵',      'https://ai-bakery-themonsteredu.vercel.app',          '이서은,주은서', '노션 기록: 수정 완료'),
      ('ai-smell',           '조향',          'https://ai-smell-themonsteredu.vercel.app',           '주은서,윤창진', '노션 기록: 수정 완료'),
      ('ai-stone',           '워리스톤 만들기','https://ai-stone-themonsteredu.vercel.app',           '강지연,윤창진', '노션 기록: 수정 완료'),
      ('ai-science',         '과학',          'https://ai-science-themonsteredu.vercel.app',         '이서은,주은서', '노션 기록: 수정 완료'),
      ('ai-deok-ryeong',     '김덕령',        'https://ai-deok-ryeong-themonsteredu.vercel.app',     '강지연,윤창진', '노션 기록: 수정 완료'),
      ('ai-cosmetic',        '화장품',        'https://ai-cosmetic-themonsteredu.vercel.app',        '강지연,윤창진', '노션 기록: 진행 중 — 수정안 확인 필요'),
      ('ai-music',           '음악',          'https://ai-music-themonsteredu.vercel.app',           '주은서,윤창진', '노션 기록: 진행 중 — 검증 한 번 더 필요'),
      ('ai-doll',            '인형·캐릭터',   'https://ai-doll-themonsteredu.vercel.app',            '주은서,윤창진', '노션 기록: 진행 중'),
      ('ai-upcycling',       '업사이클링',    'https://ai-upcycling.vercel.app',                     '이서은,강지연', '노션 기록: 진행 중'),
      ('ai-culture',         '문화',          'https://ai-culture-themonsteredu.vercel.app',         '이서은,강지연', '노션 기록: 진행 중'),
      ('ai-culture-find',    '문화 찾기',     'https://ai-culture-find-themonsteredu.vercel.app',    '주은서,윤창진', '노션 기록: 진행 중'),
      ('ai-culture-ar',      '문화 AR',       'https://ai-culture-ar-themonsteredu.vercel.app',      '주은서,윤창진', '노션 기록: 진행 중'),
      ('ai-data',            '데이터',        'https://ai-data-themonsteredu.vercel.app',            '강지연,윤창진', '노션 기록: 진행 중'),
      ('ai-ethics-tamjung',  'AI윤리 탐정',   'https://ai-ethics-tamjung-themonsteredu.vercel.app',  '강지연,윤창진', '노션 기록: 진행 중'),
      ('ai-chatbot',         '챗봇',          'https://ai-chatbot-themonsteredu.vercel.app',         '이서은,주은서', '노션 기록: 진행 중'),
      ('ai-dream',           '꿈·진로',       'https://ai-dream-themonsteredu.vercel.app',           '이서은,강지연', '노션 기록: 진행 중'),
      ('ai-fashion',         '패션',          'https://ai-fashion-themonsteredu.vercel.app',         '이서은,강지연', '노션 기록: 진행 중'),
      ('earth-saver',        '환경',          'https://earth-saver-themonsteredu.vercel.app',        '이서은,강지연', '노션 기록: 진행 중'),
      ('ai-city',            '도시',          'https://ai-city-themonsteredu.vercel.app',            '이서은,주은서', '노션 기록: 진행 중'),
      ('ai-gwangju',         '광주',          'https://ai-gwangju-themonsteredu.vercel.app',         '이서은,주은서', '노션 기록: 진행 중 — 좀 더 봐야 함'),
      ('ai-prompt-practice', '프롬프트 연습', 'https://ai-prompt-practice-themonsteredu.vercel.app', '이서은,강지연', '노션 기록: 진행 중')
    ) as t(slug, title_ko, url, reviewers, note)
  loop
    select id into v_app_id from moalab.apps where slug = r.slug;

    if v_app_id is not null then
      n_skip := n_skip + 1;
      continue;
    end if;

    insert into moalab.apps (slug, title_ko, url, purpose)
    values (r.slug, r.title_ko, r.url, r.note)
    returning id into v_app_id;
    n_new := n_new + 1;

    -- 1차 라운드
    insert into moalab.rounds (app_id, round_no) values (v_app_id, 1) returning id into v_round_id;

    -- 검증자 배정 + 5항목 체크 칸
    foreach v_name in array string_to_array(r.reviewers, ',') loop
      select id into v_member from moalab.members where name = trim(v_name);
      if v_member is null then
        raise notice '멤버를 찾지 못했습니다: % (앱 %)', v_name, r.slug;
        continue;
      end if;

      insert into moalab.app_reviewers (app_id, member_id)
      values (v_app_id, v_member)
      on conflict (app_id, member_id) do nothing;

      insert into moalab.checks (round_id, member_id, item_no, result)
      select v_round_id, v_member, g, 'none'
      from generate_series(1, 5) as g
      on conflict (round_id, member_id, item_no) do nothing;
    end loop;
  end loop;

  raise notice '새로 등록 %개 / 이미 있어서 건너뜀 %개', n_new, n_skip;
end $$;

notify pgrst, 'reload schema';

-- 결과 확인
select a.slug,
       a.title_ko,
       a.status,
       (select string_agg(m.name, ' · ' order by m.name)
          from moalab.app_reviewers ar
          join moalab.members m on m.id = ar.member_id
         where ar.app_id = a.id) as 검증자
from moalab.apps a
order by a.created_at;

-- =====================================================================
--  [선택] 노션에서 '수정 완료' 였던 5개를 바로 검증 완료로 만들고 싶다면
--  아래 주석을 풀고 실행하세요.
--  검증자 2명 × 5항목이 전부 '통과' 로 채워지고, 각 항목에
--  "노션에서 이관 — 개별 확인 안 함" 메모가 남습니다.
--  (실제로 다시 확인하실 거면 실행하지 마세요)
-- =====================================================================
-- update moalab.checks c
--    set result = 'pass',
--        note = '노션에서 이관 — 개별 확인 안 함',
--        updated_at = now()
--   from moalab.rounds r
--   join moalab.apps a on a.id = r.app_id
--  where c.round_id = r.id
--    and a.slug in ('ai-bakery','ai-smell','ai-stone','ai-science','ai-deok-ryeong');
--
-- update moalab.apps set status = 'done'
--  where slug in ('ai-bakery','ai-smell','ai-stone','ai-science','ai-deok-ryeong');
