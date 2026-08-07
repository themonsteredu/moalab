'use client';

import { supabase } from './supabase';
import { computeStatus } from './status';
import { CHECK_ITEM_COUNT, type AppStatus, type CheckRow } from './types';

/** 라운드 하나에 대해 (검증자 × 5항목) 빈 체크 레코드를 채운다. 이미 있으면 건너뛴다. */
export async function ensureChecks(roundId: string, reviewerIds: string[]) {
  if (reviewerIds.length === 0) return;

  const { data: existing, error: exErr } = await supabase
    .from('checks')
    .select('member_id,item_no')
    .eq('round_id', roundId);
  if (exErr) throw exErr;

  const have = new Set((existing ?? []).map((c) => `${c.member_id}:${c.item_no}`));
  const rows: { round_id: string; member_id: string; item_no: number; result: 'none' }[] = [];

  for (const memberId of reviewerIds) {
    for (let i = 1; i <= CHECK_ITEM_COUNT; i++) {
      if (!have.has(`${memberId}:${i}`)) {
        rows.push({ round_id: roundId, member_id: memberId, item_no: i, result: 'none' });
      }
    }
  }
  if (rows.length === 0) return;

  const { error } = await supabase.from('checks').insert(rows);
  if (error) throw error;
}

/** 앱 생성 직후 1차 라운드를 연다. */
export async function openFirstRound(appId: string, reviewerIds: string[]) {
  const { data: round, error } = await supabase
    .from('rounds')
    .insert({ app_id: appId, round_no: 1 })
    .select()
    .single();
  if (error) throw error;
  await ensureChecks(round.id, reviewerIds);
  return round;
}

/** "수정했음 → 재검증 요청". 이전 라운드를 닫고 N+1차를 새로 연다. */
export async function openNextRound(appId: string, changeNote: string, reviewerIds: string[]) {
  const { data: app, error: appErr } = await supabase
    .from('apps')
    .select('current_round')
    .eq('id', appId)
    .single();
  if (appErr) throw appErr;

  const nextNo = (app.current_round ?? 1) + 1;

  await supabase
    .from('rounds')
    .update({ closed_at: new Date().toISOString() })
    .eq('app_id', appId)
    .is('closed_at', null);

  const { data: round, error } = await supabase
    .from('rounds')
    .insert({ app_id: appId, round_no: nextNo, change_note: changeNote })
    .select()
    .single();
  if (error) throw error;

  // 새 라운드는 전부 '미확인'으로 시작 — 이전 검증은 무효다.
  await ensureChecks(round.id, reviewerIds);

  const { error: upErr } = await supabase
    .from('apps')
    .update({ current_round: nextNo, status: 'pending' })
    .eq('id', appId);
  if (upErr) throw upErr;

  return round;
}

/** 현재(가장 최근) 라운드를 가져온다. */
export async function getCurrentRound(appId: string) {
  const { data, error } = await supabase
    .from('rounds')
    .select('*')
    .eq('app_id', appId)
    .order('round_no', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * 앱 상태를 현재 라운드 체크 결과로 다시 계산해서 저장한다.
 * 체크를 저장할 때마다 부른다.
 */
export async function recomputeAppStatus(appId: string): Promise<AppStatus> {
  const round = await getCurrentRound(appId);
  if (!round) return 'pending';

  const [{ data: checks }, { count: reviewerCount }] = await Promise.all([
    supabase.from('checks').select('result').eq('round_id', round.id),
    supabase.from('app_reviewers').select('id', { count: 'exact', head: true }).eq('app_id', appId),
  ]);

  const status = computeStatus((checks ?? []) as Pick<CheckRow, 'result'>[], reviewerCount ?? 0);
  await supabase.from('apps').update({ status }).eq('id', appId);
  return status;
}
