'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { computeStatus, roundProgress } from '@/lib/status';
import type { AppRow, AppStatus, CheckRow, Round } from '@/lib/types';

/** 프로그램 하나에 딸린 것들이 얼마나 채워졌는지 */
export interface Completeness {
  verify: boolean;
  plan: boolean;
  cost: boolean;
  sample: boolean;
  photo: boolean;
}

export interface AppOverview {
  app: AppRow;
  reviewerIds: string[];
  currentRound: Round | null;
  checks: CheckRow[];
  /** 저장된 status 가 아니라 체크 결과로 그 자리에서 다시 계산한 값 */
  status: AppStatus;
  progress: number;
  openComments: number;
  /** 대표 이미지 (샘플 우선, 없으면 수업 사진) */
  cover: string | null;
  sampleCount: number;
  photoCount: number;
  done: Completeness;
  /** 5개 중 몇 개가 채워졌나 */
  filled: number;
}

/**
 * 목록 화면들이 공통으로 쓰는 앱 요약.
 * 앱이 계속 늘어나도 쿼리 수는 그대로라 코드를 손댈 일이 없다.
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

      const [appsRes, revRes, roundsRes, commentsRes, planRes, sheetRes, sampleRes, albumRes] =
        await Promise.all([
          appQ,
          supabase.from('app_reviewers').select('app_id,member_id'),
          supabase.from('rounds').select('*').order('round_no', { ascending: false }),
          supabase.from('comments').select('app_id').eq('resolved', false),
          supabase.from('plan_files').select('app_id'),
          supabase.from('cost_sheets').select('app_id').not('app_id', 'is', null),
          supabase.from('app_samples').select('app_id,url,sort_order').order('sort_order'),
          supabase.from('albums').select('id,app_id').not('app_id', 'is', null),
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

      const count = <T extends { app_id: string }>(rows: T[] | null) => {
        const m = new Map<string, number>();
        for (const r of rows ?? []) m.set(r.app_id, (m.get(r.app_id) ?? 0) + 1);
        return m;
      };
      const planCount = count(planRes.data as { app_id: string }[] | null);
      const sheetCount = count(sheetRes.data as { app_id: string }[] | null);
      const openByApp = count(commentsRes.data as { app_id: string }[] | null);

      const sampleCover = new Map<string, string>();
      const sampleCount = new Map<string, number>();
      for (const s of (sampleRes.data ?? []) as { app_id: string; url: string }[]) {
        if (!sampleCover.has(s.app_id)) sampleCover.set(s.app_id, s.url);
        sampleCount.set(s.app_id, (sampleCount.get(s.app_id) ?? 0) + 1);
      }

      // 앨범 → 사진 수 / 대표 사진
      const albumToApp = new Map<string, string>();
      for (const a of (albumRes.data ?? []) as { id: string; app_id: string }[]) {
        albumToApp.set(a.id, a.app_id);
      }
      const photoCount = new Map<string, number>();
      const photoCover = new Map<string, string>();
      if (albumToApp.size > 0) {
        const { data: ps } = await supabase
          .from('photos')
          .select('album_id,url')
          .in('album_id', [...albumToApp.keys()]);
        for (const p of (ps ?? []) as { album_id: string; url: string }[]) {
          const appId = albumToApp.get(p.album_id);
          if (!appId) continue;
          photoCount.set(appId, (photoCount.get(appId) ?? 0) + 1);
          if (!photoCover.has(appId)) photoCover.set(appId, p.url);
        }
      }

      setItems(
        apps.map((app) => {
          const reviewerIds = reviewersByApp.get(app.id) ?? [];
          const currentRound = currentByApp.get(app.id) ?? null;
          const rc = currentRound ? (checksByRound.get(currentRound.id) ?? []) : [];
          const st = computeStatus(rc, reviewerIds.length);

          const done: Completeness = {
            verify: st === 'done',
            plan: Boolean(app.plan_body?.trim()) || (planCount.get(app.id) ?? 0) > 0,
            cost: (sheetCount.get(app.id) ?? 0) > 0,
            sample: (sampleCount.get(app.id) ?? 0) > 0,
            photo: (photoCount.get(app.id) ?? 0) > 0,
          };

          return {
            app,
            reviewerIds,
            currentRound,
            checks: rc,
            status: st,
            progress: roundProgress(rc, reviewerIds.length),
            openComments: openByApp.get(app.id) ?? 0,
            cover: sampleCover.get(app.id) ?? photoCover.get(app.id) ?? null,
            sampleCount: sampleCount.get(app.id) ?? 0,
            photoCount: photoCount.get(app.id) ?? 0,
            done,
            filled: Object.values(done).filter(Boolean).length,
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

/** 카드에 찍히는 5개 구성요소 라벨 */
export const PIECES: { key: keyof Completeness; icon: string; label: string }[] = [
  { key: 'verify', icon: '✅', label: '검증' },
  { key: 'plan', icon: '📄', label: '계획안' },
  { key: 'cost', icon: '💰', label: '원가' },
  { key: 'sample', icon: '🖼️', label: '샘플' },
  { key: 'photo', icon: '📸', label: '사진' },
];
