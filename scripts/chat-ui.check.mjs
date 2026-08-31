/**
 * **두 사람이 대화하는 것을 실제로 시뮬레이션**한다.
 *
 *   npm run dev                 (다른 창에서 띄워두고)
 *   node scripts/chat-ui.check.mjs
 *
 * 브라우저 창을 **셋** 띄운다 — 이서은(A) · 주은서(B) · 강지연(C).
 * A 가 보낸 말이 B 화면에 **새로고침 없이** 나타나는지, 안 읽음 뱃지가 붙었다가
 * 방을 열면 사라지는지, **C 가 남의 1:1 방 주소를 알아도 막히는지**를 눌러서 확인한다.
 *
 * 무엇을 재고 무엇을 안 재는지 (섞으면 안 된다):
 *   · 재는 것 — 화면이 실제로 따라오는가, 읽음이 실제로 지워지는가,
 *     서버가 막았을 때 화면이 **한글로** 알려주는가
 *   · 안 재는 것 — Supabase Realtime 소켓 자체. 여기서는 붙지 않으므로
 *     **5초 폴링 경로**가 도는 것을 본다. 두 갈래를 다 둔 이유가 이것이다
 *     (한 갈래만 두면 "어제는 됐는데 오늘은 안 온다" 가 된다)
 *   · 격리의 **서버 코드**는 scripts/chat-server.test.mjs 가 진짜 함수로 잰다.
 *     여기 API 는 그 규칙을 같은 모양으로 흉내낸 것이다 — 화면 쪽을 보는 게 목적이다
 *   · DB 층(anon 이 표에 아예 못 붙음)은 SQL 로 따로 확인했다
 *
 * playwright 는 이 스크립트에만 필요해서 package.json 에 안 넣었다.
 */
import { existsSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:3000';

const A = '00000000-0000-0000-0000-000000000101';
const B = '00000000-0000-0000-0000-000000000102';
const C = '00000000-0000-0000-0000-000000000103';
const ROOM = '00000000-0000-0000-0000-000000000900';

const MEMBERS = [
  { id: A, name: '이서은', role: 'teacher', active: true, sort_order: 0 },
  { id: B, name: '주은서', role: 'teacher', active: true, sort_order: 1 },
  { id: C, name: '강지연', role: 'teacher', active: true, sort_order: 2 },
];

/* ------------------------------------------- 창 셋이 같이 보는 가짜 대화 서버
   방 하나(A·B 의 1:1). C 는 멤버가 아니다. */

const store = {
  members: [A, B],
  messages: [],
  read: { [A]: '1970-01-01T00:00:00.000Z', [B]: '1970-01-01T00:00:00.000Z' },
  seq: 0,
};
const whoOf = (token) => ({ 'tok-A': A, 'tok-B': B, 'tok-C': C })[token] ?? null;
const nameOf = (id) => MEMBERS.find((m) => m.id === id)?.name ?? '-';
const isMember = (who) => store.members.includes(who);

function unread(who) {
  return store.messages.filter((m) => m.member_id !== who && m.created_at > store.read[who]).length;
}

function handle(url, method, token, body) {
  const who = whoOf(token);
  if (!who) return [401, { error: '다시 로그인해주세요.' }];
  const path = new URL(url).pathname;

  if (path === '/api/chat/rooms' && method === 'GET') {
    if (!isMember(who)) return [200, { rooms: [] }]; // C 목록에는 남의 방이 없다
    const last = store.messages[store.messages.length - 1] ?? null;
    return [200, {
      rooms: [{
        id: ROOM, kind: 'dm', title: nameOf(store.members.find((m) => m !== who)),
        memberIds: store.members, unread: unread(who),
        lastBody: last?.body ?? null, lastAt: last?.created_at ?? null,
        lastFrom: last ? nameOf(last.member_id) : null,
      }],
    }];
  }

  if (path === '/api/chat/messages') {
    // ★ 여기서 막는다 — 방 id 를 알아도 멤버가 아니면 403
    if (!isMember(who)) return [403, { error: '볼 수 없는 대화방이에요.' }];
    if (method === 'GET') return [200, { messages: store.messages, memberIds: store.members, hasMore: false }];
    const at = new Date(2026, 8, 1, 10, 0, ++store.seq).toISOString();
    const msg = { id: `m${store.seq}`, room_id: ROOM, member_id: who, body: body.body ?? '', image_path: null, created_at: at };
    store.messages.push(msg);
    store.read[who] = at; // 보낸 사람은 그 줄까지 읽은 것이다
    return [200, { message: msg }];
  }

  if (path === '/api/chat/read' && method === 'POST') {
    if (!isMember(who)) return [403, { error: '볼 수 없는 대화방이에요.' }];
    if (body.at > store.read[who]) store.read[who] = body.at;
    return [200, { ok: true }];
  }
  return [404, { error: '없어요.' }];
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright 가 없어요.  npm i -D playwright  후 다시 실행해주세요.');
  process.exit(1);
}

const exe = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {});

async function openAs(id, name, token) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  await ctx.addInitScript(
    (s) => window.localStorage.setItem('moalab.session.v1', JSON.stringify(s)),
    { id, name, role: 'teacher', token, expiresAt: Date.now() + 30 * 24 * 3600 * 1000 },
  );
  await ctx.route('**/rest/v1/**', (r) =>
    r.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(MEMBERS) }));
  await ctx.route('**/api/chat/**', async (route) => {
    const req = route.request();
    let body = {};
    try { body = JSON.parse(req.postData() || '{}'); } catch { /* GET */ }
    const [status, json] = handle(req.url(), req.method(), req.headers()['x-session-token'], body);
    await route.fulfill({ status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) });
  });
  return { ctx, page: await ctx.newPage() };
}

let fail = 0;
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) fail += 1;
};

const a = await openAs(A, '이서은', 'tok-A');
const b = await openAs(B, '주은서', 'tok-B');
const c = await openAs(C, '강지연', 'tok-C');

/* ------------------------------------------------------------ 두 사람 대화 */

await a.page.goto(`${BASE}/chat/${ROOM}`, { waitUntil: 'commit' });
await b.page.goto(`${BASE}/chat/${ROOM}`, { waitUntil: 'commit' });
await a.page.waitForTimeout(4000);
await b.page.waitForTimeout(1000);

ok('A 가 대화방에 들어간다', new URL(a.page.url()).pathname === `/chat/${ROOM}`);
ok('B 도 같은 방에 들어간다', await b.page.getByText('아직 아무 말도 없어요').isVisible());

// A 가 한 마디 — B 는 **아무것도 안 누른다**
await a.page.getByPlaceholder('할 말을 적어주세요').fill('교안 올렸어요');
await a.page.getByRole('button', { name: '보내기', exact: true }).click();
await a.page.waitForTimeout(1200);
ok('A 화면에 내 말이 보인다', await a.page.getByText('교안 올렸어요').isVisible());

// 폴링이 도는 시간(5초)을 준다 — 새로고침은 하지 않는다
await b.page.waitForTimeout(7000);
ok('★ B 화면에 새로고침 없이 나타난다', await b.page.getByText('교안 올렸어요').isVisible());
ok('B 화면에 보낸 사람 이름이 붙는다', await b.page.getByText('이서은').first().isVisible());

// B 가 답한다
await b.page.getByPlaceholder('할 말을 적어주세요').fill('확인했습니다');
await b.page.getByRole('button', { name: '보내기', exact: true }).click();
await b.page.waitForTimeout(1200);
await a.page.waitForTimeout(7000);
ok('★ A 화면에도 B 의 답이 나타난다', await a.page.getByText('확인했습니다').isVisible());

/* ------------------------------------------------------------ 안 읽음 뱃지 */

// C 는 이 대화와 무관하지만, 뱃지는 목록에서 본다 → B 를 목록으로 보낸다
store.read[B] = '1970-01-01T00:00:00.000Z'; // B 가 아직 안 읽은 상태로 되돌린다
await b.page.goto(`${BASE}/chat`, { waitUntil: 'commit' });
await b.page.waitForTimeout(3500);
const badge = await b.page.locator('span.bg-brand.rounded-full').first().textContent().catch(() => null);
ok('안 읽은 수가 뱃지로 보인다', badge === '1', badge ?? '없음');

// 방을 열면 읽음 처리된다
await b.page.goto(`${BASE}/chat/${ROOM}`, { waitUntil: 'commit' });
await b.page.waitForTimeout(3500);
await b.page.goto(`${BASE}/chat`, { waitUntil: 'commit' });
await b.page.waitForTimeout(3500);
ok(
  '★ 방을 열면 뱃지가 사라진다',
  (await b.page.locator('span.bg-brand.rounded-full').count()) === 0,
);

/* ------------------------------------------------------------------ 격리 */

await c.page.goto(`${BASE}/chat`, { waitUntil: 'commit' });
await c.page.waitForTimeout(3500);
ok('★ C 목록에는 남의 1:1 방이 안 보인다', await c.page.getByText('아직 대화가 없어요').isVisible());

// 방 주소를 직접 쳐도
await c.page.goto(`${BASE}/chat/${ROOM}`, { waitUntil: 'commit' });
await c.page.waitForTimeout(3500);
ok('★ 방 주소를 알아도 막힌다 (한글로 알려준다)', await c.page.getByText('볼 수 없는 대화방이에요.').isVisible());
ok('★ C 화면에 남의 대화 내용이 한 글자도 없다', !(await c.page.getByText('교안 올렸어요').isVisible()));

/* -------------------------------------------------------------- 폰 375px */

const h = await c.page.evaluate(() => document.documentElement.scrollWidth);
ok('375px 에서 가로 스크롤이 없다', h <= 375, `${h}px`);

await browser.close();
console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
