'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { countByDuty } from './org';

/**
 * 역할마다 **줄이 몇 개, 자료가 몇 개** 쌓였는지.
 *
 * 역할 목록에서 이름만 28줄 늘어놓으면 **어디에 일이 있는지 눌러봐야 안다.**
 * 원장이 `부서업무 › 내 부서` 를 찍어 보내며 *"되게 일하기 불편"* 이라고 한 것이
 * 이것이다 — 같은 목록인데 `내 업무` 에는 개수가 붙어 있고 `부서업무` 에는 없었다.
 *
 * 두 화면이 **같은 계산을 두 벌로 들고 있지 않게** 여기 하나로 뺐다
 * (컴포넌트를 두 벌로 만들면 내용이 갈라진다 — `DutyForm` 을 두 화면이 같이 쓰는 것과 같은 판단).
 *
 * `duty_rows`·`duty_files` 표가 아직 없는 DB 에서도 화면이 죽으면 안 되므로
 * **실패는 조용히 0** 이다 — 개수는 곁들이는 정보지 주인공이 아니다.
 */
export interface DutyCounts {
  rows: Record<string, number>;
  files: Record<string, number>;
}

export function useDutyCounts(enabled = true): DutyCounts & { reload: () => Promise<void> } {
  const [rows, setRows] = useState<Record<string, number>>({});
  const [files, setFiles] = useState<Record<string, number>>({});

  const reload = useCallback(async () => {
    const [r, f] = await Promise.all([
      supabase.from('duty_rows').select('duty_id'),
      supabase.from('duty_files').select('duty_id'),
    ]);
    setRows(countByDuty(r.error ? [] : (r.data as { duty_id: string }[] | null)));
    setFiles(countByDuty(f.error ? [] : (f.data as { duty_id: string }[] | null)));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void reload().catch(() => {
      setRows({});
      setFiles({});
    });
  }, [enabled, reload]);

  return { rows, files, reload };
}
