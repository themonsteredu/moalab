'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/supabase';
import { computeStatus, roundProgress } from '@/lib/status';
import type { AppRow, AppStatus, CheckRow, Round } from '@/lib/types';

export interface AppOverview {
  app: AppRow;
  reviewerIds: string[];
  currentRound: Round | null;
  checks: CheckRow[];
  /** 저장된 status 가 아니라 체크 결과로 그 자리에서 다시 계산한 값 */
  status: AppStatus;
  progress: number;
  /** 미해결 댓글 수 */
  openComments: number;
}

/**
 * 목록 화면들이 공통으로 쓰는 앱 요약.
 * 앱이 계속 늘어나도 쿼리 수는 그대로(6개)라 코드를 손댈 일이 없다.
 */
export function useAppsOverview(includeArchived = false) {
  const [items, setItems] = useState<AppOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setError('');
    try {
      let appQ = supabase.from('apps').select('*').order('due_date', { nullsFirst: false });
      if (!includeArchived) appQ = appQ.eq('archived', false);

      const [appsRes, revRes, roundsRes, commentsRes] = await Promise.all([
        appQ,
        supabase.from('app_reviewers').select('app_id,member_id'),
        supabase.from('rounds').select('*').order('round_no', { ascending: false }),
        supabase.from('comments').select('app_id,resolved').eq('resolved', false),
      ]);

      if (appsRes.error) throw appsRes.error;
      const apps = (appsRes.data ?? []) as AppRow[];

      const reviewersByApp = new Map<string, string[]>();
      for (const r of revRes.data ?? []) {
        const list = reviewersByApp.get(r.app_id) ?? [];
        list.push(r.member_id);
        reviewersByApp.set(r.app_id, list);
      }

      // rounds 는 round_no 내림차순이므로 앱별 첫 항목이 현재 라운드
      const currentByApp = new Map<string, Round>();
      for (const r of (roundsRes.data ?? []) as Round[]) {
        if (!currentByApp.has(r.app_id)) currentByApp.set(r.app_id, r);
      }

      const roundIds = [...currentByApp.values()].map((r) => r.id);
      let checks: CheckRow[] = [];
      if (roundIds.length > 0) {
        const { data } = await supabase.from('checks').select('*').in('round_id', roundIds);
        checks = (data ?? []) as CheckRow[];
      }
      const checksByRound = new Map<string, CheckRow[]>();
      for (const c of checks) {
        const list = checksByRound.get(c.round_id) ?? [];
        list.push(c);
        checksByRound.set(c.round_id, list);
      }

      const openByApp = new Map<string, number>();
      for (const c of commentsRes.data ?? []) {
        openByApp.set(c.app_id, (openByApp.get(c.app_id) ?? 0) + 1);
      }

      setItems(
        apps.map((app) => {
          const reviewerIds = reviewersByApp.get(app.id) ?? [];
          const currentRound = currentByApp.get(app.id) ?? null;
          const rc = currentRound ? (checksByRound.get(currentRound.id) ?? []) : [];
          return {
            app,
            reviewerIds,
            currentRound,
            checks: rc,
            status: computeStatus(rc, reviewerIds.length),
            progress: roundProgress(rc, reviewerIds.length),
            openComments: openByApp.get(app.id) ?? 0,
          };
        }),
      );
    } catch (e) {
      setError(friendlyError(e, '앱 목록을 불러오지 못했어요. 다시 시도해주세요.'));
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { items, loading, error, reload };
}
