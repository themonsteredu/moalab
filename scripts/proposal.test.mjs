/**
 * 제안서 — 계산·기본값 테스트.
 *
 *   node scripts/proposal.test.mjs
 *
 * 여기서 막고 싶은 것:
 *   · 가격을 안 적은 줄이 0원으로 합쳐져 **총액이 거짓말**이 되는 것 → '협의' 로 남겨야 한다
 *   · 학년·가격이 없는 프로그램에 지어낸 값이 들어가는 것 (원장이 안 고치고 그대로 보낸다)
 *   · `4만5,000원` 같은 입력이 0 으로 묻히는 것
 *   · 샘플 사진이 4장 넘게 들어가 작아지는 것
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const out = mkdtempSync(join(tmpdir(), 'moalab-proposal-'));
let P;
try {
  execFileSync('npx', ['tsc', 'src/lib/proposal.ts', 'src/lib/types.ts', '--outDir', out,
    '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'], { stdio: 'pipe' });
  P = createRequire(import.meta.url)(join(out, 'proposal.js'));
} catch (e) {
  console.error('컴파일 실패:', e.stdout?.toString() || e.message);
  process.exit(1);
}
let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) console.log(`  ok  ${label}`);
  else { fail++; console.log(`FAIL  ${label}\n      기대 ${w}\n      실제 ${g}`); }
};

const app = { id: 'a1', slug: 'x', title_ko: '라면공작소', url: null, purpose: ' 라면 봉지를 디자인한다 ', target_grade: null,
  topic_id: null, topic: null, creator_id: null, due_date: null, current_round: 1, status: 'pending', archived: false, plan_body: null, created_at: '' };
const plan = { app_id: 'a1', category: '', goal: 'AI 로 포장을 만든다', intro: null, dev_title: '', work_title: '', closing: null, tools: null, etc: null, logo_url: null, updated_by: null, updated_at: '', created_at: '' };
const cost = { id: 'c1', app_id: 'a1', title: '', headcount: 25, sale_price: 15000, updated_at: '', created_at: '' };
const samples = [3, 1, 2, 4].map((n) => ({ id: `s${n}`, app_id: 'a1', url: `u${n}`, caption: null, sort_order: n, created_at: '' }));

console.log('\n[프로그램 → 제안 줄]');
{
  const it = P.itemFromApp(app, plan, cost, samples);
  eq('이름·소개·목표를 가져온다 (앞뒤 공백 정리)', [it.title, it.purpose, it.goal], ['라면공작소', '라면 봉지를 디자인한다', 'AI 로 포장을 만든다']);
  eq('학년이 없으면 비워둔다 (지어내지 않는다)', it.grade, '');
  eq('원가표의 인원·판매가를 미리 채운다', [it.headcount, it.unitPrice], [25, 15000]);
  eq('샘플은 순서대로 3장까지', it.samples, ['u1', 'u2', 'u3']);
  const bare = P.itemFromApp(app, null, null, []);
  eq('계획서·원가표가 없으면 인원 20 · 가격 0', [bare.headcount, bare.unitPrice, bare.goal], [20, 0, '']);
  eq('차시는 1 로 시작', bare.sessions, 1);
}

console.log('\n[금액]');
{
  const priced = { ...P.itemFromApp(app, plan, cost, []), sessions: 2 };
  eq('한 줄 = 1인당 × 인원 × 차시', P.lineTotal(priced), 15000 * 25 * 2);
  const free = { ...priced, unitPrice: 0 };
  eq('가격을 안 적으면 0 (문서엔 협의)', P.lineTotal(free), 0);
  eq('합계', P.grandTotal([priced, free]), 750000);
  eq('안 적은 줄이 있으면 알려준다', P.hasUnpriced([priced, free]), true);
  eq('다 적었으면 아니다', P.hasUnpriced([priced]), false);
  eq('금액 표기', [P.priceText(750000), P.priceText(0)], ['750,000원', '협의']);
}

console.log('\n[입력 다듬기·검사]');
{
  eq('4만5,000원 → 45000', P.toNumber('4만5,000원'), 45000);
  eq('숫자 없으면 0', P.toNumber('협의'), 0);
  eq('숫자는 그대로', P.toNumber(12), 12);
  const p = P.emptyProposal('2026-09-02');
  eq('빈 제안서는 기관·프로그램이 비었다고 알려준다', P.proposalProblems(p).length, 2);
  p.org = '광주중학교'; p.items = [P.itemFromApp(app, null, null, [])];
  eq('채우면 통과', P.proposalProblems(p), []);
  p.date = '2026-9-2';
  eq('날짜 모양이 틀리면 막는다', P.proposalProblems(p).length, 1);
  p.date = '2026-09-02';
  p.items = Array.from({ length: 9 }, () => P.itemFromApp(app, null, null, []));
  eq('프로그램 9개는 막는다', P.proposalProblems(p).length, 1);
}

console.log('\n[기본 문구·회사·파일 이름]');
{
  eq('인사말에 기관 이름이 들어간다', P.defaultGreeting('광주중학교').startsWith('광주중학교의'), true);
  eq('기관이 비면 귀 기관', P.defaultGreeting('  ').startsWith('귀 기관의'), true);
  const org = { name: '모아킷', ceo: '강양희', tel: '062-000-0000', email: '', address: '광주 북구', bizNo: '' };
  eq('회사 한 줄 — 빈 것은 뺀다', P.orgLine(org), '모아킷 · 대표 강양희 · 062-000-0000 · 광주 북구');
  eq('이름이 있어야 실을 수 있다', [P.orgReady(org), P.orgReady({ ...org, name: ' ' })], [true, false]);
  eq('파일 이름', P.proposalFileName({ ...P.emptyProposal('2026-09-02'), org: '광주/중학교' }), '제안서_광주_중학교_2026-09-02');
}

rmSync(out, { recursive: true, force: true });
console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
