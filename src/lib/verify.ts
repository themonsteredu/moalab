'use client';

import { supabase } from './supabase';
import { computeStatus } from './status';
import type { AppStatus, Finding } from './types';

/** 앱 생성 직후 1차 라운드를 연다. */
export async function openFirstRound(appId: string) {
  const { data: round, error } = await supabase
    .from('rounds')
    .insert({ app_id: appId, round_no: 1 })
    .select()
    .single();
  if (error) throw error;
  return round;
}

/**
 * "수정했음 → 재검증 요청". 이전 라운드를 닫고 N+1차를 새로 연다.
 * 지적과 검증 완료 표시는 라운드에 붙어 있어서, 새 라운드는 자동으로 백지에서 시작한다.
 */
export async function openNextRound(appId: string, changeNote: string) {
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
 * 앱 상태를 현재 라운드의 지적·검증완료로 다시 계산해서 저장한다.
 * 지적을 쓰거나 답하거나 닫을 때마다 부른다.
 */
export async function recomputeAppStatus(appId: string): Promise<AppStatus> {
  const round = await getCurrentRound(appId);
  if (!round) return 'pending';

  const [{ data: findings }, { count: reviewerCount }, { count: signedCount }] = await Promise.all([
    supabase.from('findings').select('status').eq('round_id', round.id),
    supabase.from('app_reviewers').select('id', { count: 'exact', head: true }).eq('app_id', appId),
    supabase.from('round_signoffs').select('member_id', { count: 'exact', head: true }).eq('round_id', round.id),
  ]);

  const status = computeStatus(
    (findings ?? []) as Pick<Finding, 'status'>[],
    reviewerCount ?? 0,
    signedCount ?? 0,
  );
  await supabase.from('apps').update({ status }).eq('id', appId);
  return status;
}
