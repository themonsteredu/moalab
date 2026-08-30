/**
 * 프로그램 수익 배분 계산 테스트.
 *
 *   node scripts/revenue-share.test.mjs
 *
 * src/lib/revenueShare.ts 를 임시로 컴파일해 실제 코드를 그대로 돌린다.
 * 여기서 막고 싶은 것:
 *   · 성과 풀 참여자가 성과 몫만 받고 기본 1/N 몫에서 빠지는 것
 *   · 여러 풀의 몫이 같은 사람에게 누적되지 않는 것
 *   · 나머지 1원 때문에 총 배분액이 이익과 어긋나는 것
 *   · 배열 순서에 따라 그 1원을 받는 사람이 달라지는 것
 *   · 적자·0원·잘못된 입력에서 음수, NaN, Infinity가 나오는 것
 *   · 추천률을 구간 전체에 적용해 경계에서 추천금액이 역전되는 것
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const out = mkdtempSync(join(tmpdir(), 'moalab-revenue-share-'));
let R;
try {
  execFileSync(
    'npx',
    ['tsc', 'src/lib/revenueShare.ts', '--outDir', out,
     '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { stdio: 'pipe' },
  );
  R = createRequire(import.meta.url)(join(out, 'revenueShare.js'));
} catch (e) {
  console.error('컴파일 실패:', e.stdout?.toString() || e.message);
  rmSync(out, { recursive: true, force: true });
  process.exit(1);
}

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) fail += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} → ${g}${ok ? '' : `   (기대: ${w})`}`);
};
const near = (label, got, want, epsilon = 1e-9) => {
  const ok = Number.isFinite(got) && Math.abs(got - want) <= epsilon;
  if (!ok) fail += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} → ${got}${ok ? '' : `   (기대: ${want})`}`);
};
const throwsValidation = (label, fn) => {
  let ok = false;
  try {
    fn();
  } catch (e) {
    ok = e?.name === 'RevenueShareValidationError' && Array.isArray(e.issues) && e.issues.length > 0;
  }
  if (!ok) fail += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} → ${ok ? '검증 오류' : '오류 없음/다른 오류'}`);
};

const BASE = ['m1', 'm2', 'm3', 'm4', 'm5'];
const pool = (o = {}) => ({
  id: o.id ?? 'creator',
  kind: o.kind ?? 'creator',
  active: o.active ?? true,
  ...(o.fixedAmount === undefined ? { ratePercent: o.ratePercent ?? 20 } : { fixedAmount: o.fixedAmount }),
  memberIds: o.memberIds ?? ['m1', 'm2'],
});
const calc = (o = {}) => R.calculateRevenueShare({
  grossAmount: o.grossAmount ?? 100_000,
  directCosts: o.directCosts ?? 0,
  baseMemberIds: o.baseMemberIds ?? BASE,
  pools: o.pools ?? [pool()],
});
const totals = (r) => Object.fromEntries(r.members.map((m) => [m.memberId, m.totalAmount]));

console.log('--- 기본 1/N + 성과 풀 ---');
{
  const r = calc();
  eq('5명 · 10만원 · 20% 풀 · 2명', totals(r), {
    m1: 26_000, m2: 26_000, m3: 16_000, m4: 16_000, m5: 16_000,
  });
  eq('성과 풀 20,000원', r.pools[0].amount, 20_000);
  eq('남은 기본 풀 80,000원', r.baseAmount, 80_000);
  eq('총 배분액 = 기여이익', r.totalDistributed, r.contributionProfit);
}
{
  const r = calc({ pools: [pool({ memberIds: ['m1'] })] });
  eq('성과 풀 한 명이면 기본몫까지 36,000원', totals(r), {
    m1: 36_000, m2: 16_000, m3: 16_000, m4: 16_000, m5: 16_000,
  });
}

console.log('\n--- 여러 풀과 남은 비율 ---');
{
  const r = calc({
    pools: [
      pool({ id: 'creator', kind: 'creator', ratePercent: 20, memberIds: ['m1'] }),
      pool({ id: 'sales', kind: 'sales', ratePercent: 20, memberIds: ['m1', 'm2'] }),
    ],
  });
  eq('20% 두 풀 뒤 기본 비율은 60%', r.baseRatePercent, 60);
  eq('20% + 20% + 60% 금액', [r.pools[0].amount, r.pools[1].amount, r.baseAmount], [20_000, 20_000, 60_000]);
  eq('같은 사람에게 여러 풀 몫 누적', totals(r), {
    m1: 42_000, m2: 22_000, m3: 12_000, m4: 12_000, m5: 12_000,
  });
  eq('m1 풀별 기록', r.members[0].poolAmounts, { creator: 20_000, sales: 10_000 });
}

console.log('\n--- 누진 추천 고정액 + 수동 비율 혼합 ---');
{
  const r = calc({
    pools: [
      pool({ id: 'proposal-fixed', kind: 'proposal', fixedAmount: 10_001, memberIds: ['m1'] }),
      pool({ id: 'sales-rate', kind: 'sales', ratePercent: 20, memberIds: ['m2'] }),
    ],
  });
  eq('fixedAmount는 비율 대신 원 단위 그대로', r.pools.map((p) => [p.id, p.mode, p.amount]), [
    ['proposal-fixed', 'fixed', 10_001], ['sales-rate', 'rate', 20_000],
  ]);
  eq('고정액+비율을 뺀 나머지가 기본 풀', r.baseAmount, 69_999);
  near('고정액 풀 실제 실효율', r.pools[0].effectiveRate, 10.001);
  near('전체 성과금 실효율', r.totalEffectiveRate, 30.001);
  eq('혼합 모드도 합계 일치', r.totalDistributed, 100_000);
}
throwsValidation('고정액은 정수 원', () => calc({ pools: [pool({ fixedAmount: 1.5 })] }));
throwsValidation('고정액은 음수 불가', () => calc({ pools: [pool({ fixedAmount: -1 })] }));
throwsValidation('고정액+비율 성과금이 이익 초과', () => calc({
  pools: [
    pool({ id: 'fixed', fixedAmount: 60_001, memberIds: ['m1'] }),
    pool({ id: 'rate', kind: 'sales', ratePercent: 40, memberIds: ['m2'] }),
  ],
}));
{
  const r = calc({
    pools: [pool({ id: 'fixed-wins', fixedAmount: 12_345, ratePercent: 99, memberIds: ['m1'] })],
  });
  eq('fixedAmount가 있으면 ratePercent 대신 사용', [r.pools[0].amount, r.baseAmount], [12_345, 87_655]);
}

console.log('\n--- 원 단위 잔여와 순서 불변 ---');
{
  const r = R.calculateRevenueShare({
    grossAmount: 101,
    directCosts: 0,
    baseMemberIds: ['m3', 'm1', 'm2'],
    pools: [pool({ id: 'p', kind: 'custom', ratePercent: 20, memberIds: ['m2', 'm1'] })],
  });
  eq('101원도 빠짐없이 배분', r.totalDistributed, 101);
  eq('멤버 합도 101원', r.members.reduce((s, m) => s + m.totalAmount, 0), 101);
  eq('멤버 id 순으로 잔여 원 배정', r.members.map((m) => [m.memberId, m.totalAmount]), [
    ['m1', 37], ['m2', 37], ['m3', 27],
  ]);
}
{
  const a = R.calculateRevenueShare({
    grossAmount: 101,
    directCosts: 0,
    baseMemberIds: ['m1', 'm2', 'm3'],
    pools: [
      pool({ id: 'a', kind: 'proposal', ratePercent: 17, memberIds: ['m1', 'm3'] }),
      pool({ id: 'b', kind: 'sales', ratePercent: 23, memberIds: ['m2'] }),
    ],
  });
  const b = R.calculateRevenueShare({
    grossAmount: 101,
    directCosts: 0,
    baseMemberIds: ['m3', 'm2', 'm1'],
    pools: [
      pool({ id: 'b', kind: 'sales', ratePercent: 23, memberIds: ['m2'] }),
      pool({ id: 'a', kind: 'proposal', ratePercent: 17, memberIds: ['m3', 'm1'] }),
    ],
  });
  eq('입력 배열 순서를 바꿔도 멤버 결과 동일', a.members, b.members);
  eq('입력 배열 순서를 바꿔도 풀 결과 동일', a.pools, b.pools);
}

console.log('\n--- 0원·적자·검증 오류 ---');
{
  const zero = calc({ grossAmount: 0, directCosts: 0 });
  eq('0원은 전원 0원', zero.members.map((m) => m.totalAmount), [0, 0, 0, 0, 0]);
  eq('0원 결과에 NaN/Infinity 없음', JSON.stringify(zero).includes('null'), false);

  const loss = calc({ grossAmount: 100_000, directCosts: 120_000 });
  eq('적자는 배분가능액 0', loss.contributionProfit, 0);
  eq('부족액 20,000원', [loss.deficitAmount, loss.hasLoss], [20_000, true]);
  eq('적자도 음수 지급 없음', loss.members.map((m) => m.totalAmount), [0, 0, 0, 0, 0]);
  eq('적자 총 배분 0', loss.totalDistributed, 0);
}

throwsValidation('음수 수금액', () => calc({ grossAmount: -1 }));
throwsValidation('소수 원 수금액', () => calc({ grossAmount: 10.5 }));
throwsValidation('음수 직접비', () => calc({ directCosts: -1 }));
throwsValidation('기본 멤버 없음', () => calc({ baseMemberIds: [] }));
throwsValidation('기본 멤버 중복', () => calc({ baseMemberIds: ['m1', 'm1'] }));
throwsValidation('활성 풀에 멤버 없음', () => calc({ pools: [pool({ memberIds: [] })] }));
throwsValidation('풀 멤버가 기본 멤버 밖', () => calc({ pools: [pool({ memberIds: ['outside'] })] }));
throwsValidation('음수 배분율', () => calc({ pools: [pool({ ratePercent: -1 })] }));
throwsValidation('100% 초과 배분율', () => calc({ pools: [pool({ ratePercent: 101 })] }));
throwsValidation('활성 풀 합 100% 초과', () => calc({
  pools: [pool({ id: 'a', ratePercent: 60 }), pool({ id: 'b', kind: 'sales', ratePercent: 41 })],
}));
throwsValidation('풀 id 중복', () => calc({ pools: [pool({ id: 'same' }), pool({ id: 'same' })] }));

{
  const full = calc({ pools: [pool({ ratePercent: 100, memberIds: ['m1'] })] });
  eq('성과 풀 100%면 기본 풀 0', [full.baseRatePercent, full.baseAmount], [0, 0]);
  eq('100%도 정확히 전액 배분', full.totalDistributed, 100_000);
}
{
  const none = calc({ pools: [pool({ ratePercent: 0 })] });
  eq('성과 풀 0%면 기본 풀 100%', [none.baseRatePercent, none.baseAmount], [100, 100_000]);
  eq('0% 풀 금액도 유한한 0', none.pools[0].amount, 0);
}
eq('창작자 기본 상수', R.DEFAULT_CREATOR_RATE_PERCENT, 15);

console.log('\n--- 영업 누진 추천 ---');
const sales = R.recommendSalesIncentive;
eq('영업 0원', sales(0), { amount: 0, effectiveRate: 0 });
eq('영업 2,999,999원', sales(2_999_999).amount, 449_999);
eq('영업 3,000,000원', sales(3_000_000).amount, 450_000);
eq('영업 3,000,001원', sales(3_000_001).amount, 450_000);
eq('영업 4,000,000원 = 3m×15% + 1m×10%', sales(4_000_000).amount, 550_000);
eq('영업 9,999,999원', sales(9_999_999).amount, 1_149_999);
eq('영업 10,000,000원', sales(10_000_000).amount, 1_150_000);
eq('영업 10,000,001원', sales(10_000_001).amount, 1_150_000);
eq('영업 29,999,999원', sales(29_999_999).amount, 2_549_999);
eq('영업 30,000,000원', sales(30_000_000).amount, 2_550_000);
eq('영업 30,000,001원', sales(30_000_001).amount, 2_550_000);
eq('영업 40,000,000원', sales(40_000_000).amount, 3_050_000);
near('영업 4m 실효 추천률', sales(4_000_000).effectiveRate, 13.75);
eq('영업 경계에서 금액이 역전되지 않음',
  [3_000_000, 10_000_000, 30_000_000].every(
    (b) => sales(b - 1).amount <= sales(b).amount && sales(b).amount <= sales(b + 1).amount,
  ),
  true,
);

console.log('\n--- 제안서 누진 추천 ---');
const proposal = R.recommendProposalIncentive;
eq('제안서 0원', proposal(0), { amount: 0, effectiveRate: 0 });
eq('제안서 2,999,999원', proposal(2_999_999).amount, 299_999);
eq('제안서 3,000,000원', proposal(3_000_000).amount, 300_000);
eq('제안서 3,000,001원', proposal(3_000_001).amount, 300_000);
eq('제안서 4,000,000원 = 3m×10% + 1m×7%', proposal(4_000_000).amount, 370_000);
eq('제안서 9,999,999원', proposal(9_999_999).amount, 789_999);
eq('제안서 10,000,000원', proposal(10_000_000).amount, 790_000);
eq('제안서 10,000,001원', proposal(10_000_001).amount, 790_000);
eq('제안서 29,999,999원', proposal(29_999_999).amount, 1_789_999);
eq('제안서 30,000,000원', proposal(30_000_000).amount, 1_790_000);
eq('제안서 30,000,001원', proposal(30_000_001).amount, 1_790_000);
eq('제안서 40,000,000원', proposal(40_000_000).amount, 2_090_000);
near('제안서 4m 실효 추천률', proposal(4_000_000).effectiveRate, 9.25);
eq('제안서 경계에서 금액이 역전되지 않음',
  [3_000_000, 10_000_000, 30_000_000].every(
    (b) => proposal(b - 1).amount <= proposal(b).amount && proposal(b).amount <= proposal(b + 1).amount,
  ),
  true,
);

throwsValidation('영업 추천 음수 입력', () => sales(-1));
throwsValidation('제안서 추천 소수 원 입력', () => proposal(100.5));

rmSync(out, { recursive: true, force: true });
console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
