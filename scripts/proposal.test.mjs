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


// ── 견적서 — 한글 금액 · 부가세 · 유효기간
{
  eq('한글 금액 — 0', P.moneyInKorean(0), '영');
  eq('한글 금액 — 10 은 일십 (엑셀 NUMBERSTRING 과 같은 꼴)', P.moneyInKorean(10), '일십');
  eq('한글 금액 — 15000', P.moneyInKorean(15000), '일만오천');
  eq('한글 금액 — 600000', P.moneyInKorean(600000), '육십만');
  eq('한글 금액 — 1234567', P.moneyInKorean(1234567), '일백이십삼만사천오백육십칠');
  eq('한글 금액 — 1억', P.moneyInKorean(100000000), '일억');
  eq('한글 금액 — 1조 5억 (빈 묶음은 건너뛴다)', P.moneyInKorean(1000500000000), '일조오억');
  eq('한글 금액 — 20050', P.moneyInKorean(20050), '이만오십');
  eq('한글 금액 줄', P.moneyInKoreanLine(600000), '일금 육십만원정');
  const items = [{ appId: 'a', title: '', purpose: '', goal: '', grade: '', sessions: 2, headcount: 20, unitPrice: 15000, samples: [] }];
  eq('부가세 별도', P.vatSplit(items, 'separate'), { supply: 600000, vat: 60000, total: 660000 });
  eq('부가세 포함 — 합계는 그대로, 공급가액은 역산', P.vatSplit(items, 'included'), { supply: 545455, vat: 54545, total: 600000 });
  eq('면세', P.vatSplit(items, 'exempt'), { supply: 600000, vat: 0, total: 600000 });
  const inc = P.vatSplit([{ ...items[0], sessions: 1, headcount: 7 }], 'included');
  eq('포함 — 공급가액 + 부가세 = 합계 (1원도 안 어긋난다)', [inc.supply + inc.vat, inc.total], [105000, 105000]);
  eq('유효기간 — 월을 넘긴다', P.validUntil('2026-09-05', 30), '2026-10-05');
  eq('유효기간 — 연을 넘긴다', P.validUntil('2026-12-20', 15), '2027-01-04');
  eq('유효기간 — 날짜가 아니면 빈 값', P.validUntil('언젠가', 30), '');
  eq('견적 번호 기본값', P.defaultQuoteNo('2026-09-05'), 'Q-20260905');
}

// ── 초안 맞추기 — 견적 칸이 생기기 전 초안도 그대로 읽힌다
{
  const today = '2026-09-05';
  const old = { org: '광주중학교', contact: '', tel: '', date: '2026-09-01', greeting: 'g', closing: 'c',
    items: [{ appId: 'a1', title: 'T', purpose: '', goal: '', grade: '', sessions: '3', headcount: 20, unitPrice: '15000', samples: ['u'] }] };
  const n = P.normalizeInput(old, today);
  eq('옛 초안 — 갈래·견적 칸이 채워진다', [n.kind, n.quoteNo, n.validDays, n.vat, n.terms === P.DEFAULT_TERMS], ['proposal', 'Q-20260905', 30, 'separate', true]);
  eq('옛 초안 — 문자열 숫자를 숫자로', [n.items[0].sessions, n.items[0].unitPrice], [3, 15000]);
  eq('옛 초안 — 적어둔 값은 그대로', [n.org, n.date, n.greeting], ['광주중학교', '2026-09-01', 'g']);
  eq('깨진 초안은 빈 문서', P.normalizeInput('junk', today).items, []);
  const x = P.normalizeInput({ kind: 'memo', vat: 'half', validDays: -3, items: [] }, today);
  eq('없는 갈래·부가세·음수 기간은 기본값으로', [x.kind, x.vat, x.validDays], ['proposal', 'separate', 30]);
  eq('견적서 갈래는 살아남는다', P.normalizeInput({ kind: 'quote', vat: 'exempt', validDays: 14, quoteNo: 'Q-1', items: [] }, today).kind, 'quote');
  eq('appId 없는 줄은 버린다', P.normalizeInput({ items: [{ title: 'x' }, { appId: 'a', title: 'y' }] }, today).items.length, 1);
}

// ── 견적서는 제안서보다 엄하다
{
  const base = { ...P.emptyProposal('2026-09-05'), org: '광주중학교', items: [
    { appId: 'a', title: 'A', purpose: '', goal: '', grade: '', sessions: 1, headcount: 20, unitPrice: 0, samples: [] },
  ] };
  eq('제안서는 가격이 없어도 나간다', P.docProblems(base), []);
  eq('견적서는 가격 없는 줄이 있으면 막는다', P.docProblems({ ...base, kind: 'quote' }).length, 1);
  const priced = [{ ...base.items[0], unitPrice: 10000 }];
  eq('견적서 — 가격이 다 있으면 나간다', P.docProblems({ ...base, kind: 'quote', items: priced }), []);
  eq('견적서 — 번호가 비면 막는다', P.docProblems({ ...base, kind: 'quote', quoteNo: ' ', items: priced }).length, 1);
  eq('파일 이름 — 견적서', P.proposalFileName({ ...base, kind: 'quote' }), '견적서_광주중학교_2026-09-05');
  eq('갈래 이름', [P.docLabel('proposal'), P.docLabel('quote')], ['제안서', '견적서']);
}

rmSync(out, { recursive: true, force: true });
console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
