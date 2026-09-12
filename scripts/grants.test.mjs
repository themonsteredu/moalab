/** 정부지원사업 상태 흐름의 표시와 마감 계산 테스트. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const out = mkdtempSync(join(tmpdir(), 'moalab-grants-'));
let G;
try {
  execFileSync('npx', ['tsc', 'src/lib/grants.ts', '--outDir', out, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'], { stdio: 'pipe' });
  G = createRequire(import.meta.url)(join(out, 'grants.js'));
} catch (error) {
  rmSync(out, { recursive: true, force: true });
  console.error(error.stdout?.toString() || error.message);
  process.exit(1);
}

let failed = 0;
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) console.log(`  ok  ${label}`);
  else { failed += 1; console.log(`FAIL  ${label}: ${JSON.stringify(got)} !== ${JSON.stringify(want)}`); }
};

eq('업무 흐름은 5단계', G.GRANT_STEPS, ['discovered', 'concept_shared', 'writing', 'submitted', 'selected']);
eq('공고 검토 진행률', G.grantProgress('discovered'), 20);
eq('작성 중 진행률', G.grantProgress('writing'), 60);
eq('선정 진행률', G.grantProgress('selected'), 100);
eq('미선정도 분석·보관 단계까지 도달', G.grantProgress('not_selected'), 100);
eq('마감까지 남은 날', G.daysUntil('2026-09-10', new Date('2026-09-03T12:00:00Z')), 8);
eq('마감 없음', G.daysUntil(null), null);
eq('아이템만 쓰면 기획안 미제출', G.isGrantConceptReady('MOAKIT', null), false);
eq('핵심 내용만 쓰면 기획안 미제출', G.isGrantConceptReady(null, '운영 기획'), false);
eq('아이템과 핵심 내용이 있으면 기획안 제출', G.isGrantConceptReady('MOAKIT', '운영 기획'), true);
eq('공백만 입력하면 기획안 미제출', G.isGrantConceptReady('  ', '운영 기획'), false);

rmSync(out, { recursive: true, force: true });
console.log(failed === 0 ? '\n전부 통과' : `\n${failed}건 실패`);
process.exitCode = failed ? 1 : 0;
