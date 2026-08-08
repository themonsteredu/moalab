/*
 * friendlyError 가 실제 PostgREST/Supabase 에러 문구를 제대로 갈라내는지 본다.
 *
 *   node scripts/friendly-error.test.mjs
 *
 * 이 함수가 한번 오진을 했다 — 'notice_files 표가 없다' 를
 * 'Exposed schemas 에 moalab 을 추가하라' 고 안내해서 원장이 엉뚱한 곳을 봤다.
 * 원인이 다른 것들을 한 문구로 뭉치지 않도록 여기서 못을 박아둔다.
 */
import { readFileSync } from 'node:fs';
const src = readFileSync('src/lib/supabase.ts','utf8');
const body = src.slice(src.indexOf('export function friendlyError'));
// 타입 표기만 걷어내고 그대로 실행한다 (로직은 손대지 않는다)
const js = body
  .replace(/^export function friendlyError\([^)]*\)[^{]*{/, '')
  .replace(/\n}\s*$/, '')
  .replace(/\(e as \{ message\?: string \}\)/g, 'e');
const fn = new Function('e', 'fallback', js);
const friendlyError = (e) => fn(e, '저장이 안 됐어요. 다시 눌러주세요.');

const cases = [
  // 실제 원장님이 만난 것 (표 없음)
  ["Could not find the table 'moalab.notice_files' in the schema cache", 'notice_files'],
  ["Could not find the table 'moalab.topics' in the schema cache", 'topics'],
  // 컬럼 없음 (topic_id SQL 안 돌린 경우)
  ["Could not find the 'topic_id' column of 'apps' in the schema cache", 'topic_id'],
  // 스키마 노출 안 된 진짜 경우
  ['The schema must be one of the following: public, graphql_public', 'Exposed schemas'],
  // Storage
  ['Bucket not found', '저장소'],
  // 권한
  ['new row violates row-level security policy for table "notices"', '권한'],
  // 네트워크
  ['Load failed', '인터넷'],
  // 못 알아본 것 → 원문이 붙어야 한다
  ['some weird thing exploded', 'some weird thing exploded'],
];
let bad = 0;
for (const [raw, expect] of cases) {
  const out = friendlyError({ message: raw });
  const ok = out.includes(expect);
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${raw.slice(0,52).padEnd(54)} → ${out.slice(0,88)}`);
}
console.log(bad === 0 ? '\n전부 통과' : `\n${bad}건 실패`);
process.exit(bad ? 1 : 0);
