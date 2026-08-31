/**
 * 대화 계산 테스트.
 *
 *   node scripts/chat.test.mjs
 *
 * src/lib/chat.ts 를 임시로 컴파일해서 **실제 코드 그대로** 돌린다
 * (task.test.mjs · collab.test.mjs · schedule.test.mjs 와 같은 방식).
 *
 * 여기서 막고 싶은 것:
 *   · 같은 두 사람의 1:1 이 **두 방으로 갈라지는 것** (누가 먼저 열었느냐에 따라)
 *   · 안 읽은 수에 **내 글이 섞이는 것** — 내가 쓴 건 안 읽은 게 아니다
 *   · 한 마디도 없는 부서방·전체방이 목록에서 **사라지는 것**
 *   · 사진만 보낸 줄이 목록에서 **빈 줄로 보이는 것**
 *   · 이름표가 줄마다 붙어 폰 화면의 절반을 먹는 것
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const out = mkdtempSync(join(tmpdir(), 'moalab-chat-'));
let C;
try {
  execFileSync(
    'npx',
    ['tsc', 'src/lib/chat.ts', 'src/lib/types.ts', '--outDir', out,
     '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { stdio: 'pipe' },
  );
  C = createRequire(import.meta.url)(join(out, 'chat.js'));
} catch (e) {
  console.error('컴파일 실패:', e.stdout?.toString() || e.message);
  process.exit(1);
}

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    console.log(`OK   ${label} → ${g}`);
  } else {
    console.log(`FAIL ${label}\n     받은 값: ${g}\n     기대값 : ${w}`);
    fail += 1;
  }
};

const ME = 'm1';

/* ------------------------------------------------------------------ 1:1 열쇠 */

eq('1:1 열쇠 — 순서가 달라도 같은 값', C.dmKey('a', 'b'), C.dmKey('b', 'a'));
eq('열쇠 모양', C.dmKey('b', 'a'), 'a:b');
eq('상대 찾기', C.otherOf(['m1', 'm2'], ME), 'm2');
eq('나 혼자 남으면 없음', C.otherOf(['m1'], ME), null);

/* -------------------------------------------------------------------- 안 읽음 */

{
  const msgs = [
    { member_id: 'm2', created_at: '2026-09-01T10:00:00Z' },
    { member_id: ME, created_at: '2026-09-01T10:01:00Z' },   // 내 글
    { member_id: 'm2', created_at: '2026-09-01T10:02:00Z' },
    { member_id: 'm3', created_at: '2026-09-01T10:03:00Z' },
  ];
  eq('처음 보면 남의 글 전부', C.unreadCount(msgs, '1970-01-01T00:00:00Z', ME), 3);
  eq('내 글은 안 읽은 게 아니다', C.unreadCount(msgs, '2026-09-01T10:01:30Z', ME), 2);
  eq('다 읽었으면 0', C.unreadCount(msgs, '2026-09-01T23:59:59Z', ME), 0);
  eq('마지막 읽은 시각과 같은 순간은 안 센다', C.unreadCount(msgs, '2026-09-01T10:03:00Z', ME), 0);
  eq('빈 방은 0', C.unreadCount([], '1970-01-01T00:00:00Z', ME), 0);
}
eq('배지 — 두 자리', C.unreadLabel(12), '12');
eq('배지 — 99 까지', C.unreadLabel(99), '99');
eq('배지 — 넘으면 자른다 (칸이 밀린다)', C.unreadLabel(140), '99+');

/* ------------------------------------------------------------------ 미리보기 */

eq('글이 있으면 글', C.preview({ body: '내일 몇 시예요?', image_path: null }), '내일 몇 시예요?');
eq('줄바꿈은 한 칸으로', C.preview({ body: '가\n\n나', image_path: null }), '가 나');
eq('사진만 보내도 빈 줄이 아니다', C.preview({ body: null, image_path: 'x/y.webp' }), '사진');
eq('공백만 있는 글 + 사진', C.preview({ body: '   ', image_path: 'x/y.webp' }), '사진');
eq('아무것도 없으면 빈 글', C.preview(null), '');

/* -------------------------------------------------------------------- 정렬 */

{
  const room = (o) => ({
    id: o.id, kind: o.kind ?? 'dm', title: o.title ?? o.id, memberIds: [],
    unread: o.unread ?? 0, lastBody: o.lastAt ? '말' : null,
    lastAt: o.lastAt ?? null, lastFrom: null,
  });
  const list = [
    room({ id: '조용한부서방', kind: 'dept', title: '기획개발부' }),
    room({ id: '어제', lastAt: '2026-09-01T10:00:00Z' }),
    room({ id: '전체방', kind: 'all', title: '전체 공지방' }),
    room({ id: '방금', lastAt: '2026-09-02T10:00:00Z' }),
  ];
  eq(
    '말이 오간 방이 최근 순으로 위, 조용한 방은 아래',
    C.sortRooms(list).map((r) => r.id),
    ['방금', '어제', '전체방', '조용한부서방'],
  );
  eq('한 마디도 없는 방도 사라지지 않는다', C.sortRooms(list).length, 4);
  eq('안 읽은 수 합계', C.totalUnread([room({ id: 'a', unread: 3 }), room({ id: 'b', unread: 2 })]), 5);
}

/* -------------------------------------------------------------------- 묶기 */

{
  const m = (who, t) => ({ member_id: who, created_at: t });
  const g = C.groupMessages([
    m('m2', '2026-09-01T10:00:00Z'),
    m('m2', '2026-09-01T10:01:00Z'),   // 같은 사람, 1분 뒤 → 이름표 안 그린다
    m('m2', '2026-09-01T10:30:00Z'),   // 29분 뒤 → 다시 그린다
    m('m3', '2026-09-01T10:31:00Z'),   // 사람이 바뀜
    m('m3', '2026-09-02T09:00:00Z'),   // 날이 바뀜
  ]);
  eq('이름표를 그리는 줄', g.map((x) => x.head), [true, false, true, true, true]);
  eq('시각을 그리는 줄', g.map((x) => x.tail), [false, true, true, true, true]);
  eq('날짜 가름선', g.map((x) => x.daybreak), [true, false, false, false, true]);
  eq('빈 방', C.groupMessages([]).length, 0);
}

/* -------------------------------------------------------------------- 이름표·문구 */

eq('갈래 이름', C.CHAT_KINDS.map((k) => k.label), ['전체', '부서', '1:1']);
eq('모르는 갈래는 1:1 로', C.chatKindLabel('없음'), '1:1');
eq(
  '알림은 방 이름을 앞세운다',
  C.chatNotice('기획개발부', '이서은', '교안 올렸어요'),
  { title: '기획개발부', body: '이서은: 교안 올렸어요' },
);
eq(
  '긴 글은 잘린다 (잠금화면은 한 줄이다)',
  C.chatNotice('전체 공지방', '강양희', '가'.repeat(200)).body.length,
  120,
);

rmSync(out, { recursive: true, force: true });
console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
