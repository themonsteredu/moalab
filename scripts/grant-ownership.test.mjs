/** 정부지원사업 공고 등록자와 첫 기획 담당자 분리 회귀 테스트. */
import { readFileSync } from 'node:fs';

const createRoute = readFileSync('src/app/api/grants/route.ts', 'utf8');
const detailRoute = readFileSync('src/app/api/grants/[id]/route.ts', 'utf8');
const listPage = readFileSync('src/app/(app)/grants/page.tsx', 'utf8');
const detailPage = readFileSync('src/app/(app)/grants/[id]/page.tsx', 'utf8');

let failed = 0;
const ok = (label, pass) => {
  if (pass) console.log(`  ok  ${label}`);
  else { failed += 1; console.log(`FAIL  ${label}`); }
};

ok('공고 등록 시 담당자는 비어 있음', createRoute.includes('lead_id: null'));
ok('공고 등록 창에는 아이템 입력이 없음', !listPage.includes('form.itemName'));
ok('첫 기획 담당자는 로그인 사용자로 지정', detailRoute.includes('lead_id: actor.memberId'));
ok('담당자 선점과 오래된 저장 모두 조건부 처리', detailRoute.match(/\.is\('lead_id', null\)/g)?.length === 2);
ok('동시 제출에서 늦은 요청은 409', detailRoute.includes("status: 409"));
ok('브라우저가 담당자를 직접 보내지 않음', !detailPage.includes('leadId:'));
ok('담당자 임의 선택창을 제거함', !detailPage.includes("onChange={(e) => set('lead_id'"));

console.log(failed === 0 ? '\n전부 통과' : `\n${failed}건 실패`);
process.exitCode = failed ? 1 : 0;
