import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseAdmin';
import { csvDisposition, toCsv } from '@/lib/dutyTable';
import type { DutyColumn, DutyRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * 역할 표를 **CSV 파일로 내려준다** — `GET /api/duty/csv?dutyId=...`
 *
 * ⚠️ **왜 브라우저에서 직접 안 만드나.** 처음엔 화면에서 Blob 을 만들어
 * `<a download="신규 기관 발굴.csv">` 로 내려받게 했는데, **크로미움이 파일 이름에
 * 한글이 들어가면 그 이름을 통째로 버리고 `download`(확장자도 없이)로 저장한다.**
 * 그러면 원장님은 엑셀에서 열 수도 없는 파일을 받는다 — 점검 스크립트가 잡았다.
 *
 * 서버가 `Content-Disposition` 에 **RFC 5987(`filename*=UTF-8''…`)** 로 실어 보내면
 * 한글 이름 그대로 저장된다. 그래서 이 한 줄 때문에 라우트를 하나 뒀다.
 *
 * 읽기 전용이고 `duty_columns`·`duty_rows` 는 어차피 브라우저도 읽을 수 있는 표라
 * (`internal_all`) 권한을 새로 만들지 않는다 — PIN·API 키처럼 잠긴 표가 아니다.
 */
export async function GET(req: Request) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: '서버 설정이 아직 안 됐어요.' }, { status: 500 });

  const dutyId = new URL(req.url).searchParams.get('dutyId');
  if (!dutyId) return NextResponse.json({ error: '어떤 역할인지 알 수 없어요.' }, { status: 400 });

  const [d, c, r] = await Promise.all([
    admin.from('duties').select('name').eq('id', dutyId).maybeSingle(),
    admin.from('duty_columns').select('*').eq('duty_id', dutyId).order('sort_order'),
    admin.from('duty_rows').select('*').eq('duty_id', dutyId).order('sort_order'),
  ]);
  if (!d.data) return NextResponse.json({ error: '없는 역할이에요.' }, { status: 404 });

  const cols = (c.data ?? []) as DutyColumn[];
  if (cols.length === 0) {
    return NextResponse.json({ error: '아직 표를 안 만들었어요.' }, { status: 400 });
  }

  const csv = toCsv(cols, (r.data ?? []) as DutyRow[]);
  return new NextResponse(
    // BOM 을 안 붙이면 엑셀이 UTF-8 인 줄 모르고 한글을 전부 깨서 연다
    '﻿' + csv,
    {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        // 한글 이름이 살아남게 하는 한 줄 — 계산은 dutyTable.csvDisposition 에 있다
        'content-disposition': csvDisposition(d.data.name as string),
        'cache-control': 'no-store',
      },
    },
  );
}
