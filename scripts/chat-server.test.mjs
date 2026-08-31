/**
 * 대화 **격리** 테스트 — 실제 서버 코드를 그대로 돌린다.
 *
 *   node scripts/chat-server.test.mjs
 *
 * `src/lib/chatServer.ts` 를 컴파일해서, Supabase 자리에 **가짜 admin 클라이언트**를
 * 끼우고 진짜 함수(isMember·openDm·ensureRooms·myRooms)를 부른다.
 * 화면 코드가 아니라 **실제로 막는 자리**를 검사한다.
 *
 * 여기서 막고 싶은 것:
 *   · 남의 1:1 방 id 를 알아냈을 때 **읽히는 것** — 이게 뚫리면 대화 기능 전체가 무의미하다
 *   · 세션 토큰 없이 / 만료된 토큰 / 비활성 멤버로 신원이 통과되는 것
 *   · 같은 두 사람의 1:1 이 두 방으로 갈라지는 것
 *   · ensureRooms 가 이미 읽은 방의 last_read_at 을 되돌려 안 읽음이 되살아나는 것
 *
 * ※ DB 층(anon 이 표에 아예 못 붙는 것)은 SQL 로 따로 확인했다 —
 *   정책 0개 · anon 권한 0건 · RLS 4/4. 그건 이 파일이 아니라 스키마가 지킨다.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const out = mkdtempSync(join(tmpdir(), 'moalab-chatsrv-'));
let S;
try {
  execFileSync(
    'npx',
    ['tsc', 'src/lib/chatServer.ts', 'src/lib/chat.ts', 'src/lib/types.ts', 'src/lib/supabaseAdmin.ts',
     '--outDir', out, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { stdio: 'pipe' },
  );
  S = createRequire(import.meta.url)(join(out, 'chatServer.js'));
} catch (e) {
  console.error('컴파일 실패:', e.stdout?.toString() || e.message);
  process.exit(1);
}

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) console.log(`OK   ${label} → ${g}`);
  else {
    console.log(`FAIL ${label}\n     받은 값: ${g}\n     기대값 : ${w}`);
    fail += 1;
  }
};

/* ------------------------------------------------------ 가짜 admin 클라이언트
   supabase-js 중 chatServer.ts 가 실제로 쓰는 만큼만 흉내낸다.
   진짜 DB 가 아니라 **진짜 코드 경로**를 재는 것이 목적이다. */

const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

function makeAdmin(db) {
  const q = (table) => {
    let rows = () => db[table] ?? [];
    const state = { filters: [], order: null, desc: false, limit: null, lt: null };
    const apply = () => {
      let r = rows().filter((row) => state.filters.every(([k, v]) => row[k] === v));
      for (const [k, arr] of state.ins) r = r.filter((row) => arr.includes(row[k]));
      if (state.lt) r = r.filter((row) => row[state.lt[0]] < state.lt[1]);
      if (state.order) {
        r = [...r].sort((a, b) =>
          a[state.order] < b[state.order] ? (state.desc ? 1 : -1) : a[state.order] > b[state.order] ? (state.desc ? -1 : 1) : 0,
        );
      }
      if (state.limit != null) r = r.slice(0, state.limit);
      return r;
    };
    state.ins = [];
    const api = {
      select() { return api; },
      eq(k, v) { state.filters.push([k, v]); return api; },
      in(k, arr) { state.ins.push([k, arr]); return api; },
      lt(k, v) { state.lt = [k, v]; return api; },
      order(k, o) { state.order = k; state.desc = o?.ascending === false; return api; },
      limit(n) { state.limit = n; return api; },
      maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
      then(res) { return Promise.resolve({ data: apply(), error: null }).then(res); },
      insert(vals) {
        const list = Array.isArray(vals) ? vals : [vals];
        const made = [];
        for (const v of list) {
          const row = { id: uuid(++db._seq), created_at: new Date(2026, 8, 1, 0, 0, db._seq).toISOString(), ...v };
          // unique 흉내 — dm_key / kind='all' / dept_id
          const dup = (db[table] ?? []).find(
            (r) =>
              (row.dm_key && r.dm_key === row.dm_key) ||
              (row.kind === 'all' && r.kind === 'all') ||
              (row.dept_id && r.dept_id === row.dept_id),
          );
          if (dup) return { select: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'duplicate' } }) }) };
          (db[table] ??= []).push(row);
          made.push(row);
        }
        return {
          select: () => ({ maybeSingle: async () => ({ data: made[0] ?? null, error: null }) }),
          then: (r) => Promise.resolve({ data: made, error: null }).then(r),
        };
      },
      upsert(vals, opts) {
        const list = Array.isArray(vals) ? vals : [vals];
        const keys = (opts?.onConflict ?? 'id').split(',');
        for (const v of list) {
          const hit = (db[table] ??= []).find((r) => keys.every((k) => r[k] === v[k]));
          if (hit) {
            if (!opts?.ignoreDuplicates) Object.assign(hit, v);
            continue;
          }
          db[table].push({ last_read_at: '1970-01-01T00:00:00.000Z', ...v });
        }
        return Promise.resolve({ data: null, error: null });
      },
      update(vals) {
        const st = { f: [] };
        const u = {
          eq(k, v) { st.f.push([k, v]); return u; },
          then(res) {
            for (const row of rows()) if (st.f.every(([k, v]) => row[k] === v)) Object.assign(row, vals);
            return Promise.resolve({ data: null, error: null }).then(res);
          },
        };
        return u;
      },
    };
    return api;
  };
  return { from: q };
}

/* ------------------------------------------------------------------ 밑감 */

const A = uuid(101); // 이서은
const B = uuid(102); // 주은서
const C = uuid(103); // 강지연 — 남의 대화를 보면 안 되는 사람
const DEPT = uuid(201);

const fresh = () => ({
  _seq: 0,
  members: [
    { id: A, name: '이서은', role: 'teacher', active: true },
    { id: B, name: '주은서', role: 'teacher', active: true },
    { id: C, name: '강지연', role: 'teacher', active: true },
  ],
  sessions: [],
  departments: [{ id: DEPT, name: '기획개발부', head_id: A }],
  duty_groups: [],
  duties: [],
  duty_helpers: [],
  rooms: [],
  room_members: [],
  messages: [],
});

const future = new Date(Date.now() + 864e5).toISOString();
const past = new Date(Date.now() - 864e5).toISOString();

/* -------------------------------------------------------------- 신원 확인 */

{
  const db = fresh();
  db.sessions.push({ token: uuid(1), member_id: A, expires_at: future });
  db.sessions.push({ token: uuid(2), member_id: B, expires_at: past });
  db.members.push({ id: uuid(104), name: '나간사람', role: 'teacher', active: false });
  db.sessions.push({ token: uuid(3), member_id: uuid(104), expires_at: future });
  const admin = makeAdmin(db);

  eq('토큰이 없으면 통과 못 한다', await S.actorFromToken(admin, null), null);
  eq('아무 글자나 넣어도 통과 못 한다', await S.actorFromToken(admin, 'aaaa'), null);
  eq('없는 토큰', await S.actorFromToken(admin, uuid(999)), null);
  eq('만료된 토큰', await S.actorFromToken(admin, uuid(2)), null);
  eq('비활성 멤버의 토큰', await S.actorFromToken(admin, uuid(3)), null);
  eq('제대로 된 토큰', (await S.actorFromToken(admin, uuid(1)))?.name, '이서은');
}

/* ------------------------------------------------------------------ 1:1 */

{
  const db = fresh();
  const admin = makeAdmin(db);

  const r1 = await S.openDm(admin, A, B);
  const r2 = await S.openDm(admin, B, A); // 반대로 열어도
  eq('같은 두 사람은 한 방이다 (누가 먼저 열든)', r1 === r2, true);
  eq('방이 하나만 생긴다', db.rooms.filter((r) => r.kind === 'dm').length, 1);
  eq('두 사람 다 멤버다', db.room_members.filter((m) => m.room_id === r1).length, 2);
  eq('자기 자신과는 못 연다', await S.openDm(admin, A, A), null);

  /* ★ 핵심 — 남의 1:1 방 id 를 알아내도 막힌다 */
  eq('A 는 자기 방을 본다', await S.isMember(admin, r1, A), true);
  eq('B 도 본다', await S.isMember(admin, r1, B), true);
  eq('C 는 방 id 를 알아도 못 본다', await S.isMember(admin, r1, C), false);
  eq('없는 방 id', await S.isMember(admin, uuid(777), A), false);
  eq('id 모양이 아니면 물어보지도 않는다', await S.isMember(admin, 'x', A), false);
}

/* -------------------------------------------------------------- 방 만들기 */

{
  const db = fresh();
  const admin = makeAdmin(db);

  await S.ensureRooms(admin, A); // A 는 기획개발부 팀장
  const kinds = db.rooms.map((r) => r.kind).sort();
  eq('전체방 + 내 부서방이 생긴다', kinds, ['all', 'dept']);
  eq('A 가 두 방 다 멤버다', db.room_members.filter((m) => m.member_id === A).length, 2);

  await S.ensureRooms(admin, C); // C 는 아무 역할이 없다
  eq('역할이 없으면 전체방만', db.room_members.filter((m) => m.member_id === C).length, 1);
  eq('전체방은 하나뿐이다 (두 번 안 생긴다)', db.rooms.filter((r) => r.kind === 'all').length, 1);
  eq('부서방도 하나뿐이다', db.rooms.filter((r) => r.kind === 'dept').length, 1);

  // 이미 읽은 상태를 되돌리면 안 읽음이 되살아난다
  const all = db.rooms.find((r) => r.kind === 'all');
  const row = db.room_members.find((m) => m.room_id === all.id && m.member_id === A);
  row.last_read_at = '2026-09-01T10:00:00.000Z';
  await S.ensureRooms(admin, A);
  eq('다시 들어와도 읽음이 안 되돌아간다', row.last_read_at, '2026-09-01T10:00:00.000Z');
}

/* -------------------------------------------------------------- 목록·안읽음 */

{
  const db = fresh();
  const admin = makeAdmin(db);
  const room = await S.openDm(admin, A, B);

  db.messages.push(
    { id: uuid(301), room_id: room, member_id: B, body: '안녕하세요', image_path: null, created_at: '2026-09-01T10:00:00.000Z' },
    { id: uuid(302), room_id: room, member_id: A, body: '네', image_path: null, created_at: '2026-09-01T10:01:00.000Z' },
    { id: uuid(303), room_id: room, member_id: B, body: '자료 보냈어요', image_path: null, created_at: '2026-09-01T10:02:00.000Z' },
  );

  const forA = await S.myRooms(admin, A);
  eq('A 목록에 방 하나', forA.length, 1);
  eq('1:1 방 이름은 상대 이름', forA[0].title, '주은서');
  eq('안 읽은 수 — 남이 쓴 것만', forA[0].unread, 2);
  eq('마지막 말 미리보기', forA[0].lastBody, '자료 보냈어요');

  const forC = await S.myRooms(admin, C);
  eq('★ C 목록에는 남의 방이 아예 없다', forC.length, 0);

  // A 가 다 읽으면
  db.room_members.find((m) => m.room_id === room && m.member_id === A).last_read_at = '2026-09-01T23:00:00.000Z';
  eq('다 읽으면 0', (await S.myRooms(admin, A))[0].unread, 0);
  eq('B 는 아직 안 읽었다', (await S.myRooms(admin, B))[0].unread, 1);
}

rmSync(out, { recursive: true, force: true });
console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
