/**
 * 업무 문서 -> Google Drive 자동 저장 연결 검사.
 *
 *   node scripts/duty-document-drive.test.mjs
 *
 * 여기서 막고 싶은 것:
 *   · 문서는 저장됐는데 Drive 요청에 새 행 id가 빠지는 것
 *   · 수정할 때 source key / 파일명이 바뀌어 같은 문서가 여러 벌 생기는 것
 *   · 이미 끝난 대기열을 pending으로 되돌리지 않아 수정본이 안 올라가는 것
 *   · Drive 미연결/오류가 앱 문서 저장까지 실패시키는 것
 *   · 계약서 본문을 공개 URL이나 브라우저 요청 본문에 싣는 것
 *   · 기존 Google 문서 id가 있는데도 POST로 새 문서를 만드는 것
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

let passed = 0;
const failed = [];
const ok = (label, condition, detail = '') => {
  if (condition) passed += 1;
  else failed.push(detail ? `${label} (${detail})` : label);
};

const editor = readFileSync('src/app/(app)/roles/[dutyId]/document/page.tsx', 'utf8');
const queueRoute = readFileSync('src/app/api/drive/duty-document/route.ts', 'utf8');
const runRoute = readFileSync('src/app/api/drive/run/route.ts', 'utf8');
const genericQueueRoute = readFileSync('src/app/api/drive/queue/route.ts', 'utf8');
const driveCard = readFileSync('src/components/DriveCard.tsx', 'utf8');
const driveStartRoute = readFileSync('src/app/api/settings/drive/start/route.ts', 'utf8');
const schema = readFileSync('supabase/schema.sql', 'utf8');

console.log('\n[저장 화면 -> 대기열]');
ok('새 문서와 수정 문서 모두 저장된 row id로 Drive 요청한다',
  editor.includes('void syncDrive(savedRow.id)'));
ok('Drive 요청에는 dutyId와 rowId만 싣는다',
  editor.includes('body: JSON.stringify({ dutyId, rowId })'));
ok('문서 내용·HTML을 브라우저에서 Drive API로 보내지 않는다',
  !/body:\s*JSON\.stringify\(\{[^}]*\b(values|html|cells)\b/.test(editor));
ok('앱 저장 성공을 먼저 표시하고 Drive는 기다리지 않는다',
  editor.indexOf('setSaved(true)') < editor.indexOf('void syncDrive(savedRow.id)'));
ok('Drive 실패는 앱 저장 오류로 다시 던지지 않는다',
  editor.includes("setDriveState('failed')") && editor.includes('앱 문서는 이미 저장됐다'));

console.log('\n[세션 검증과 대기열 잠금]');
ok('업무 문서 전송은 로그인 세션 토큰을 보낸다',
  editor.includes("'x-session-token': session.token"));
ok('업무 문서 API는 위조 가능한 actor id 대신 세션을 검증한다',
  queueRoute.includes('actorFromToken(admin, tokenOf(req))'));
ok('일반 첨부 대기열 API도 세션을 검증한다',
  genericQueueRoute.includes('actorFromToken(admin, tokenOf(req))'));
ok('Drive worker POST와 GET 모두 세션을 검증한다',
  (runRoute.match(/actorFromToken\(admin, tokenOf\(req\)\)/g) ?? []).length === 2);
ok('Drive 대기열의 anon/authenticated 권한을 회수한다',
  schema.includes('revoke all on moalab.drive_uploads from anon, authenticated') &&
    !schema.includes('create policy "internal_all" on moalab.drive_uploads'));
ok('OAuth 시작도 URL의 actor id가 아닌 POST 세션을 검증한다',
  driveStartRoute.includes('export async function POST') &&
    driveStartRoute.includes("form?.get('sessionToken')") &&
    !driveStartRoute.includes("searchParams.get('actor')"));
ok('Drive 관리 화면의 모든 fetch와 OAuth 폼에 세션 토큰이 있다',
  driveCard.includes("'x-session-token': session?.token ?? ''") &&
    driveCard.includes('name="sessionToken" value={session.token ?? \'\'}'));

console.log('\n[안정 source key와 수정 재전송]');
ok('source key는 duty id + row id만으로 고정한다',
  queueRoute.includes('`duty-document:${dutyId}:${rowId}`'));
const sourceKeyLine = queueRoute.split('\n').find((line) => line.includes('const sourceKey =')) ?? '';
ok('source key에 시각·문서 제목·본문을 섞지 않는다',
  !/(Date|updated_at|documentTitle|values)/.test(sourceKeyLine));
ok('행과 업무가 실제로 같은지 둘 다 제한한다',
  queueRoute.includes(".eq('id', rowId).eq('duty_id', dutyId)"));
ok('업무 문서는 역할 자료 갈래와 부서/중분류 폴더로 간다',
  queueRoute.includes("kind: 'dept'") &&
    queueRoute.includes('folder_path: deptPath(department.name, group.name)'));
ok('같은 source key를 새 행으로 쌓지 않고 upsert한다',
  queueRoute.includes("{ onConflict: 'source_url' }") &&
    !queueRoute.includes('ignoreDuplicates: true'));
ok('수정 저장은 끝난/실패한 행도 처음부터 다시 보내게 reset한다',
  queueRoute.includes("status: 'pending'") &&
    queueRoute.includes('tries: 0') &&
    queueRoute.includes('error: null') &&
    queueRoute.includes('done_at: null'));

console.log('\n[미연결/비공개 처리]');
const configAt = queueRoute.indexOf('const cfg = await loadConfig(admin)');
const upsertAt = queueRoute.indexOf("from('drive_uploads').upsert");
ok('Drive 미연결 여부를 대기열 쓰기보다 먼저 확인한다',
  configAt >= 0 && upsertAt > configAt);
ok('Drive가 없으면 문서 저장 자체는 실패시키지 않고 skipped로 끝낸다',
  queueRoute.includes("if (!cfg) return NextResponse.json({ skipped: '드라이브 연결 안 됨' })"));
ok('역할 자료 자동 저장을 끈 경우도 대기열을 만들지 않는다',
  queueRoute.includes("!cfg.meta.kinds.includes('dept')") &&
    queueRoute.indexOf("!cfg.meta.kinds.includes('dept')") < upsertAt);
ok('대기열에는 공개 파일 URL 대신 내부 참조만 저장한다',
  queueRoute.includes('source_url: source') &&
    !queueRoute.includes('supabase.storage') &&
    !queueRoute.includes('getPublicUrl'));
ok('서버 전송 시에도 rowId와 dutyId가 일치하는 최신 DB 행만 읽는다',
  runRoute.includes(".eq('id', documentIds.rowId)") &&
    runRoute.includes(".eq('duty_id', documentIds.dutyId)"));
ok('내부 참조는 fetch하지 않고 DB에서 문서를 다시 만든다',
  runRoute.includes('const documentIds = dutyDocumentIds(row.source_url)') &&
    runRoute.includes('buildDutyDocumentHtml(template, payload.values') &&
    /else\s*\{\s*const src = await fetch\(row\.source_url\)/.test(runRoute));
ok('기존 Drive id를 넘겨 같은 Google 문서를 갱신한다',
  runRoute.includes('uploadGoogleDocument(access, folderId, row.file_name, blob, row.drive_id)'));

console.log('\n[동시 실행 선점]');
ok('업로드 전에 tries를 올리고 임시 처리 상태로 선점한다',
  runRoute.includes("update({ status: 'failed', error: '드라이브로 보내는 중…', tries: claimedTries })") &&
    runRoute.indexOf("error: '드라이브로 보내는 중…'") < runRoute.indexOf('const folderId = await ensurePath'));
ok('선점은 읽었을 때의 status와 tries가 그대로인 행만 바꾼다',
  runRoute.includes(".eq('status', row.status)") &&
    runRoute.includes(".eq('tries', row.tries ?? 0)"));
ok('다른 실행이 먼저 선점했으면 업로드하지 않고 건너뛴다',
  runRoute.includes('if (!claimed) continue;'));
ok('완료 기록도 자신이 선점한 세대에만 쓴다',
  runRoute.includes(".eq('status', 'failed')") &&
    runRoute.includes(".eq('tries', claimedTries)"));
ok('시도 횟수는 선점할 때 한 번만 증가한다',
  runRoute.includes('const claimedTries = (row.tries ?? 0) + 1') &&
    !/const fin[\s\S]{0,260}tries:\s*\(row\.tries/.test(runRoute));

console.log('\n[Google Drive 생성/수정 요청]');
const out = mkdtempSync(join(tmpdir(), 'moalab-duty-drive-'));
let Drive;
try {
  execFileSync(
    'npx',
    ['tsc', 'src/lib/drive.ts', '--outDir', out, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck', '--esModuleInterop'],
    { stdio: 'pipe' },
  );
  Drive = createRequire(import.meta.url)(join(out, 'drive.js'));
} catch (error) {
  failed.push(`drive.ts 컴파일 (${error.stdout?.toString() || error.message})`);
}

if (Drive) {
  const realFetch = globalThis.fetch;
  try {
    // drive_id가 있으면 이름 검색도, 새 파일 POST도 하지 않고 그 id를 PATCH한다.
    {
      const calls = [];
      globalThis.fetch = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ id: 'drive-existing' }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      };
      const result = await Drive.uploadGoogleDocument(
        'access', 'folder-1', '기관 프로그램 제안서_4ef3c612',
        new Blob(['<html>수정본</html>'], { type: 'text/html' }), 'drive-existing',
      );
      ok('기존 Drive id가 있으면 호출은 한 번뿐이다', calls.length === 1, `${calls.length}회`);
      ok('기존 문서는 POST가 아니라 같은 id에 PATCH한다',
        calls[0]?.init.method === 'PATCH' && calls[0]?.url.includes('/drive-existing?uploadType=multipart'));
      ok('기존 문서 수정 결과도 같은 id다', result.id === 'drive-existing');
      const body = await calls[0]?.init.body?.text();
      ok('수정 요청은 기존 문서의 부모 폴더/MIME을 바꾸지 않는다',
        body?.includes('"name":"기관 프로그램 제안서_4ef3c612"') &&
        !body?.includes('"parents"') && !body?.includes('"mimeType"'));
    }

    // id가 없어도 같은 이름의 Google 문서를 찾으면 그 파일을 PATCH한다.
    {
      const calls = [];
      globalThis.fetch = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if ((init.method ?? 'GET') === 'GET') {
          return new Response(JSON.stringify({ files: [{ id: 'found-by-name' }] }), {
            status: 200, headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ id: 'found-by-name' }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      };
      await Drive.uploadGoogleDocument('access', 'folder-1', '교육 프로그램 견적서_aaaaaaaa', new Blob(['견적']));
      ok('drive_id가 없어도 같은 이름의 Google 문서를 먼저 찾는다',
        calls[0]?.url.includes('/drive/v3/files?q=') &&
        decodeURIComponent(calls[0]?.url).includes("mimeType = 'application/vnd.google-apps.document'"));
      ok('찾은 같은 이름의 문서를 PATCH하고 새 POST는 하지 않는다',
        calls.some((call) => call.init.method === 'PATCH' && call.url.includes('/found-by-name?')) &&
        !calls.some((call) => call.init.method === 'POST'));
    }

    // 정말 없는 문서만 변환 MIME으로 한 번 새로 만든다.
    {
      const calls = [];
      globalThis.fetch = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if ((init.method ?? 'GET') === 'GET') {
          return new Response(JSON.stringify({ files: [] }), {
            status: 200, headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ id: 'made-once' }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      };
      await Drive.uploadGoogleDocument('access', 'folder-1', '만족도 조사지_cccccccc', new Blob(['설문']));
      const post = calls.find((call) => call.init.method === 'POST');
      const body = await post?.init.body?.text();
      ok('없는 문서만 POST 한 번으로 만든다',
        calls.filter((call) => call.init.method === 'POST').length === 1);
      ok('새 파일은 Google 문서 MIME과 목표 폴더를 함께 보낸다',
        body?.includes('"mimeType":"application/vnd.google-apps.document"') &&
        body?.includes('"parents":["folder-1"]'));
    }

    // 사용자가 Drive 문서를 삭제했으면 낡은 id PATCH 404 뒤 새 문서를 만든다.
    {
      const methods = [];
      globalThis.fetch = async (_url, init = {}) => {
        methods.push(init.method);
        if (methods.length === 1) return new Response('', { status: 404 });
        return new Response(JSON.stringify({ id: 'replacement' }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      };
      const result = await Drive.uploadGoogleDocument(
        'access', 'folder-1', '출강 계약서_bbbbbbbb', new Blob(['계약']), 'deleted-id',
      );
      ok('Drive에서 지운 문서는 PATCH 404 뒤 POST 한 번으로 복구한다',
        JSON.stringify(methods) === JSON.stringify(['PATCH', 'POST']));
      ok('복구된 새 Drive id를 돌려준다', result.id === 'replacement');
    }
  } finally {
    globalThis.fetch = realFetch;
  }
}

rmSync(out, { recursive: true, force: true });
console.log(`\n${passed}건 통과${failed.length ? `, ${failed.length}건 실패` : ''}`);
for (const label of failed) console.error(`  ✗ ${label}`);
if (failed.length) process.exit(1);
