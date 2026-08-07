'use client';

import { supabase } from './supabase';

/**
 * 활동 로그. "누가 했냐" 분쟁 방지용이라 실패해도 본 작업을 막지 않는다.
 * 예) logActivity(me.id, 'ai-bakery 2차 검증 항목3 통과', 'app:<uuid>')
 */
export function logActivity(memberId: string | null | undefined, action: string, target?: string | null) {
  if (!memberId) return;
  void supabase
    .from('activity_logs')
    .insert({ member_id: memberId, action, target: target ?? null })
    .then(({ error }) => {
      if (error) console.warn('[activity_log]', error.message);
    });
}
